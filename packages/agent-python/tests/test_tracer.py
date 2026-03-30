"""
Tests for the Tracer class covering sync, async, error, and context propagation.
"""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from ghost_doc_agent.tracer import Tracer, _trace_ctx
from ghost_doc_agent.types import TraceEvent


def make_tracer_with_mock() -> tuple[Tracer, list[TraceEvent]]:
    """Create a Tracer with a mocked transport.send for capturing events."""
    tracer = Tracer(agent_id="test-agent", enabled=False)
    captured: list[TraceEvent] = []

    def fake_send(event: TraceEvent) -> None:
        captured.append(event)

    # Bypass the enabled=False guard by patching the transport directly
    tracer._transport.send = fake_send  # type: ignore[method-assign]
    tracer.enabled = True  # re-enable after patching
    return tracer, captured


# ------------------------------------------------------------------
# Synchronous tracing
# ------------------------------------------------------------------

def test_trace_sync_function_emits_span() -> None:
    tracer, captured = make_tracer_with_mock()

    @tracer.trace
    def add(a: int, b: int) -> int:
        return a + b

    result = add(2, 3)

    assert result == 5
    assert len(captured) == 1

    span = captured[0]
    assert span["schema_version"] == "1.0"
    assert span["source"]["function_name"] == "test_tracer.add"
    assert span["source"]["agent_id"] == "test-agent"
    assert span["source"]["language"] == "python"
    assert span["output"] == 5
    assert span["error"] is None
    assert span["timing"]["duration_ms"] >= 0


def test_trace_captures_error_on_sync_exception() -> None:
    tracer, captured = make_tracer_with_mock()

    @tracer.trace
    def explode() -> None:
        raise ValueError("boom")

    with pytest.raises(ValueError, match="boom"):
        explode()

    assert len(captured) == 1
    span = captured[0]
    assert span["error"] is not None
    assert span["error"]["type"] == "ValueError"
    assert span["error"]["message"] == "boom"
    assert span["output"] is None


def test_trace_with_custom_label() -> None:
    tracer, captured = make_tracer_with_mock()

    @tracer.trace(label="my-custom-label")
    def some_fn() -> str:
        return "ok"

    some_fn()
    assert captured[0]["source"]["function_name"] == "my-custom-label"


# ------------------------------------------------------------------
# Asynchronous tracing
# ------------------------------------------------------------------

async def test_trace_async_function_emits_span() -> None:
    tracer, captured = make_tracer_with_mock()

    @tracer.trace
    async def fetch(item_id: str) -> dict:
        return {"id": item_id}

    result = await fetch("abc")

    assert result == {"id": "abc"}
    assert len(captured) == 1
    span = captured[0]
    assert span["source"]["function_name"] == "test_tracer.fetch"
    assert span["output"] == {"id": "abc"}
    assert span["error"] is None


async def test_trace_captures_error_on_async_exception() -> None:
    tracer, captured = make_tracer_with_mock()

    @tracer.trace
    async def fail() -> None:
        raise RuntimeError("async boom")

    with pytest.raises(RuntimeError, match="async boom"):
        await fail()

    assert captured[0]["error"]["type"] == "RuntimeError"


# ------------------------------------------------------------------
# Context propagation (parent-child spans)
# ------------------------------------------------------------------

def test_nested_sync_calls_share_trace_id() -> None:
    tracer, captured = make_tracer_with_mock()

    @tracer.trace
    def inner(x: int) -> int:
        return x + 1

    @tracer.trace
    def outer(x: int) -> int:
        return inner(x)

    outer(10)

    assert len(captured) == 2
    # inner emits first (deepest in call stack emits during finally)
    inner_span, outer_span = captured[0], captured[1]
    assert inner_span["trace_id"] == outer_span["trace_id"]
    assert inner_span["parent_span_id"] == outer_span["span_id"]


async def test_nested_async_calls_share_trace_id() -> None:
    tracer, captured = make_tracer_with_mock()

    @tracer.trace
    async def inner_async(x: int) -> int:
        return x * 2

    @tracer.trace
    async def outer_async(x: int) -> int:
        return await inner_async(x)

    await outer_async(5)

    assert len(captured) == 2
    inner_span, outer_span = captured[0], captured[1]
    assert inner_span["trace_id"] == outer_span["trace_id"]
    assert inner_span["parent_span_id"] == outer_span["span_id"]


# ------------------------------------------------------------------
# enabled=False
# ------------------------------------------------------------------

def test_disabled_tracer_does_not_emit() -> None:
    tracer = Tracer(agent_id="disabled-test", enabled=False)
    mock_send = MagicMock()
    tracer._transport.send = mock_send  # type: ignore[method-assign]

    @tracer.trace
    def noop() -> int:
        return 42

    result = noop()
    assert result == 42
    mock_send.assert_not_called()


# ------------------------------------------------------------------
# Sanitization
# ------------------------------------------------------------------

def test_sanitizes_sensitive_output_keys() -> None:
    tracer, captured = make_tracer_with_mock()

    @tracer.trace
    def get_credentials() -> dict:
        return {"user_id": "u1", "token": "super-secret"}

    get_credentials()
    output = captured[0]["output"]
    assert output["user_id"] == "u1"  # type: ignore[index]
    assert output["token"] == "[REDACTED]"  # type: ignore[index]
