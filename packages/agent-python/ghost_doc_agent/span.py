"""
Utilities for building TraceEvent payloads.
"""
from __future__ import annotations

import traceback
import uuid
from typing import Any, Optional

from .types import ErrorInfo, SourceInfo, TimingInfo, TraceEvent


def new_trace_id() -> str:
    """Generate a new UUID v4 trace ID."""
    return str(uuid.uuid4())


def new_span_id() -> str:
    """Generate a new UUID v4 span ID."""
    return str(uuid.uuid4())


def build_span(
    *,
    trace_id: str,
    span_id: str,
    parent_span_id: Optional[str],
    source: SourceInfo,
    started_at: float,
    duration_ms: float,
    input: list[Any],
    output: Any,
    error: Optional[ErrorInfo],
    tags: Optional[dict[str, str]] = None,
) -> TraceEvent:
    """Assemble a complete TraceEvent from its parts."""
    return TraceEvent(
        schema_version="1.0",
        trace_id=trace_id,
        span_id=span_id,
        parent_span_id=parent_span_id,
        source=source,
        timing=TimingInfo(
            started_at=started_at,
            duration_ms=duration_ms,
        ),
        input=input,
        output=output,
        error=error,
        tags=tags or {},
    )


def capture_error(exc: BaseException) -> ErrorInfo:
    """Serialize an exception into an ErrorInfo dict."""
    return ErrorInfo(
        type=type(exc).__name__,
        message=str(exc),
        stack=traceback.format_exc(),
    )
