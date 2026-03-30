"""
Shared test fixtures for the Ghost Doc Python agent.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator

import pytest
import pytest_asyncio
import websockets
import websockets.server

from ghost_doc_agent.tracer import Tracer
from ghost_doc_agent.types import TraceEvent


class MockHub:
    """
    A minimal local WebSocket server that records received messages.
    Used to verify the agent sends well-formed TraceEvent payloads.
    """

    def __init__(self) -> None:
        self.received: list[TraceEvent] = []
        self._server: websockets.server.WebSocketServer | None = None

    async def _handler(
        self, ws: websockets.server.WebSocketServerProtocol
    ) -> None:
        async for raw in ws:
            try:
                event: TraceEvent = json.loads(raw)
                self.received.append(event)
            except json.JSONDecodeError:
                pass

    async def start(self) -> str:
        """Start the server on a random port and return its ws:// URL."""
        self._server = await websockets.serve(  # type: ignore[attr-defined]
            self._handler,
            host="127.0.0.1",
            port=0,  # OS assigns a free port
        )
        port = next(iter(self._server.sockets)).getsockname()[1]
        return f"ws://127.0.0.1:{port}"

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def wait_for_events(self, count: int, timeout: float = 2.0) -> None:
        """Block until at least ``count`` events have been received."""
        deadline = asyncio.get_event_loop().time() + timeout
        while len(self.received) < count:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                raise TimeoutError(
                    f"Expected {count} events, got {len(self.received)} in {timeout}s"
                )
            await asyncio.sleep(0.05)


@pytest_asyncio.fixture
async def mock_hub() -> AsyncGenerator[MockHub, None]:
    """Provides a running MockHub; shuts it down after the test."""
    hub = MockHub()
    await hub.start()
    yield hub
    await hub.stop()


@pytest_asyncio.fixture
async def hub_url(mock_hub: MockHub) -> str:
    """Provides just the URL of the running MockHub."""
    port = next(iter(mock_hub._server.sockets)).getsockname()[1]  # type: ignore[union-attr]
    return f"ws://127.0.0.1:{port}"


def make_tracer(hub_url: str, **kwargs: object) -> Tracer:
    """Factory helper: creates a Tracer pointed at the MockHub."""
    return Tracer(agent_id="test-agent", hub_url=hub_url, **kwargs)  # type: ignore[arg-type]
