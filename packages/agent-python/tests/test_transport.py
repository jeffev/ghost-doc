"""
Integration tests for WsTransport using a real local WebSocket server.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from ghost_doc_agent.ring_buffer import RingBuffer
from ghost_doc_agent.transport import WsTransport
from ghost_doc_agent.types import TraceEvent
from tests.conftest import MockHub


def make_event(trace_id: str) -> TraceEvent:
    return TraceEvent(
        schema_version="1.0",
        trace_id=trace_id,
        span_id=trace_id,
        parent_span_id=None,
        source={
            "agent_id": "test",
            "language": "python",
            "file": "test.py",
            "line": 1,
            "function_name": "fn",
        },
        timing={"started_at": 1_000_000, "duration_ms": 1.0},
        input=[],
        output=None,
        error=None,
        tags={},
    )


async def test_sends_event_when_connected(mock_hub: MockHub) -> None:
    port = next(iter(mock_hub._server.sockets)).getsockname()[1]  # type: ignore[union-attr]
    url = f"ws://127.0.0.1:{port}"

    buffer: RingBuffer[TraceEvent] = RingBuffer(100)
    transport = WsTransport(url, buffer)
    transport.start()

    await asyncio.sleep(0.2)  # wait for connection

    event = make_event("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa")
    transport.send(event)

    await mock_hub.wait_for_events(1)

    assert len(mock_hub.received) == 1
    assert mock_hub.received[0]["trace_id"] == event["trace_id"]

    transport.stop()


async def test_buffers_events_when_disconnected() -> None:
    buffer: RingBuffer[TraceEvent] = RingBuffer(100)
    transport = WsTransport("ws://localhost:19998", buffer)  # no server
    transport.start()

    event = make_event("bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb")
    transport.send(event)

    # Event must be in the buffer since there is no server
    await asyncio.sleep(0.1)
    assert buffer.length == 1

    transport.stop()


async def test_sends_multiple_events_in_order(mock_hub: MockHub) -> None:
    port = next(iter(mock_hub._server.sockets)).getsockname()[1]  # type: ignore[union-attr]
    url = f"ws://127.0.0.1:{port}"

    buffer: RingBuffer[TraceEvent] = RingBuffer(100)
    transport = WsTransport(url, buffer)
    transport.start()

    await asyncio.sleep(0.2)

    ids = [
        "11111111-1111-4111-a111-111111111111",
        "22222222-2222-4222-a222-222222222222",
        "33333333-3333-4333-a333-333333333333",
    ]
    for event_id in ids:
        transport.send(make_event(event_id))

    await mock_hub.wait_for_events(3)

    received_ids = [e["trace_id"] for e in mock_hub.received]
    assert received_ids == ids

    transport.stop()


async def test_is_connected_reflects_state(mock_hub: MockHub) -> None:
    port = next(iter(mock_hub._server.sockets)).getsockname()[1]  # type: ignore[union-attr]
    url = f"ws://127.0.0.1:{port}"

    buffer: RingBuffer[TraceEvent] = RingBuffer(10)
    transport = WsTransport(url, buffer)

    assert not transport.is_connected

    transport.start()
    await asyncio.sleep(0.2)
    assert transport.is_connected

    transport.stop()
