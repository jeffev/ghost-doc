"""
Core Ghost Doc tracer for Python.

Usage:
    from ghost_doc_agent import Tracer

    tracer = Tracer(agent_id="my-service")

    @tracer.trace
    def get_user(user_id: int) -> dict:
        return {"id": user_id}

    @tracer.trace
    async def async_get_user(user_id: int) -> dict:
        return {"id": user_id}

    # With a custom label:
    @tracer.trace(label="database.query")
    def run_query(sql: str) -> list:
        ...

    # Disable all tracing without removing decorators:
    tracer = Tracer(agent_id="my-service", enabled=False)
"""
from __future__ import annotations

import asyncio
import functools
import inspect
import time
from contextvars import ContextVar, Token
from typing import Any, Callable, NamedTuple, Optional, TypeVar, Union, overload

from .ring_buffer import RingBuffer
from .sanitize import DEFAULT_SANITIZE_KEYS, sanitize_deep
from .span import build_span, capture_error, new_span_id, new_trace_id
from .transport import WsTransport
from .types import ErrorInfo, SourceInfo, TraceEvent

F = TypeVar("F", bound=Callable[..., Any])


class _TraceContext(NamedTuple):
    trace_id: str
    span_id: str  # current span's ID — becomes parent_span_id for nested calls


# Module-level ContextVar: propagates trace context through async/sync call chains.
_trace_ctx: ContextVar[Optional[_TraceContext]] = ContextVar("_trace_ctx", default=None)


class Tracer:
    """
    Ghost Doc tracer instance.

    One tracer per application is typically sufficient.
    Each tracer maintains its own WebSocket connection to the Hub.

    Args:
        agent_id:     Identifies this agent in the Hub (e.g. "api-service").
        hub_url:      WebSocket URL of the Ghost Doc Hub.
        sanitize:     Set of lowercase key names to redact before sending.
        buffer_size:  Maximum number of events to buffer while offline.
        enabled:      Set to False to disable all tracing (decorators become no-ops).
    """

    def __init__(
        self,
        agent_id: str,
        hub_url: str = "ws://localhost:3001/agent",
        sanitize: Optional[frozenset[str]] = None,
        buffer_size: int = 500,
        enabled: bool = True,
    ) -> None:
        self.agent_id = agent_id
        self.hub_url = hub_url
        self.sanitize_keys = sanitize if sanitize is not None else DEFAULT_SANITIZE_KEYS
        self.buffer_size = buffer_size
        self.enabled = enabled

        self._buffer: RingBuffer[TraceEvent] = RingBuffer(buffer_size)
        self._transport = WsTransport(hub_url, self._buffer)

        if enabled:
            self._transport.start()

    # ------------------------------------------------------------------
    # Public decorator API
    # ------------------------------------------------------------------

    @overload
    def trace(self, fn: F) -> F: ...

    @overload
    def trace(self, *, label: str = ..., description: str = ...) -> Callable[[F], F]: ...

    def trace(
        self,
        fn: Optional[F] = None,
        *,
        label: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Union[F, Callable[[F], F]]:
        """
        Decorator that instruments a function for tracing.

        Can be used in four ways::

            @tracer.trace                                       # no parentheses
            @tracer.trace()                                     # empty parentheses
            @tracer.trace(label="foo")                          # with label
            @tracer.trace(description="Fetches user by ID")     # with description
        """
        if fn is None:
            # Called as @tracer.trace() or @tracer.trace(label="...", description="...")
            return lambda f: self._instrument(f, label=label, description=description)  # type: ignore[return-value]

        # Called as @tracer.trace (no parentheses)
        return self._instrument(fn, label=label, description=description)  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _instrument(self, fn: F, *, label: Optional[str], description: Optional[str] = None) -> F:
        """Wrap ``fn`` with tracing logic, preserving its sync/async nature."""
        fn_name = label or fn.__qualname__

        # Capture definition location at decoration time, not call time.
        try:
            source_file = inspect.getfile(fn)
            source_lines, source_line = inspect.getsourcelines(fn)
        except (TypeError, OSError):
            source_file = "unknown"
            source_line = 0

        source: SourceInfo = {
            "agent_id": self.agent_id,
            "language": "python",
            "file": source_file,
            "line": source_line,
            "function_name": fn_name,
        }
        if description is not None:
            source["description"] = description
        elif fn.__doc__:
            # Auto-extract the first line of the docstring when no explicit description is given.
            first_line = inspect.cleandoc(fn.__doc__).split("\n")[0].strip()
            if first_line:
                source["description"] = first_line

        if asyncio.iscoroutinefunction(fn):
            @functools.wraps(fn)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                return await self._execute_async(fn, source, args, kwargs)

            return async_wrapper  # type: ignore[return-value]

        @functools.wraps(fn)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            return self._execute_sync(fn, source, args, kwargs)

        return sync_wrapper  # type: ignore[return-value]

    def _start_span(self) -> tuple[str, str, Optional[str], Token[Optional[_TraceContext]]]:
        """
        Allocate IDs for a new span and push a new context.

        Returns:
            (trace_id, span_id, parent_span_id, ctx_token)
        """
        existing = _trace_ctx.get()
        trace_id = existing.trace_id if existing else new_trace_id()
        parent_span_id: Optional[str] = existing.span_id if existing else None
        span_id = new_span_id()
        token = _trace_ctx.set(_TraceContext(trace_id, span_id))
        return trace_id, span_id, parent_span_id, token

    def _emit(
        self,
        *,
        trace_id: str,
        span_id: str,
        parent_span_id: Optional[str],
        source: SourceInfo,
        started_at: float,
        start_perf: float,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        output: Any,
        error: Optional[ErrorInfo],
    ) -> None:
        """Sanitize and send the completed span to the transport."""
        raw_input: list[Any] = [*args, kwargs] if kwargs else list(args)
        event = build_span(
            trace_id=trace_id,
            span_id=span_id,
            parent_span_id=parent_span_id,
            source=source,
            started_at=started_at * 1_000,  # convert to milliseconds
            duration_ms=(time.perf_counter() - start_perf) * 1_000,
            input=sanitize_deep(raw_input, self.sanitize_keys),  # type: ignore[arg-type]
            output=sanitize_deep(output, self.sanitize_keys),
            error=error,
        )
        self._transport.send(event)

    def _execute_sync(
        self,
        fn: Callable[..., Any],
        source: SourceInfo,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
    ) -> Any:
        if not self.enabled:
            return fn(*args, **kwargs)

        trace_id, span_id, parent_span_id, token = self._start_span()
        started_at = time.time()
        start_perf = time.perf_counter()
        error: Optional[ErrorInfo] = None
        output: Any = None

        try:
            output = fn(*args, **kwargs)
            return output
        except BaseException as exc:
            error = capture_error(exc)
            raise
        finally:
            _trace_ctx.reset(token)
            self._emit(
                trace_id=trace_id,
                span_id=span_id,
                parent_span_id=parent_span_id,
                source=source,
                started_at=started_at,
                start_perf=start_perf,
                args=args,
                kwargs=kwargs,
                output=output,
                error=error,
            )

    async def _execute_async(
        self,
        fn: Callable[..., Any],
        source: SourceInfo,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
    ) -> Any:
        if not self.enabled:
            return await fn(*args, **kwargs)

        trace_id, span_id, parent_span_id, token = self._start_span()
        started_at = time.time()
        start_perf = time.perf_counter()
        error: Optional[ErrorInfo] = None
        output: Any = None

        try:
            output = await fn(*args, **kwargs)
            return output
        except BaseException as exc:
            error = capture_error(exc)
            raise
        finally:
            _trace_ctx.reset(token)
            self._emit(
                trace_id=trace_id,
                span_id=span_id,
                parent_span_id=parent_span_id,
                source=source,
                started_at=started_at,
                start_perf=start_perf,
                args=args,
                kwargs=kwargs,
                output=output,
                error=error,
            )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def stop(self) -> None:
        """Gracefully stop the transport and close the WebSocket connection."""
        self._transport.stop()
