"""
WebSocket transport for the Ghost Doc Python agent.

Architecture:
- A daemon background thread runs a dedicated asyncio event loop.
- The thread connects to the Hub and maintains the connection indefinitely.
- The public ``send()`` method is thread-safe and fire-and-forget.
- While disconnected, events are stored in the RingBuffer and flushed on reconnect.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Optional

import websockets
import websockets.exceptions

from .ring_buffer import RingBuffer
from .types import TraceEvent

logger = logging.getLogger("ghost_doc.transport")

_BASE_RETRY_DELAY = 1.0
_MAX_RETRY_DELAY = 30.0
_WARN_AFTER_ATTEMPTS = 10


class WsTransport:
    """
    Thread-safe WebSocket transport.

    Call ``start()`` once to launch the background connection thread.
    Call ``stop()`` for a graceful shutdown.
    """

    def __init__(self, hub_url: str, buffer: RingBuffer[TraceEvent]) -> None:
        self._hub_url = hub_url
        self._buffer = buffer
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._connected = False
        self._stopped = False
        self._reconnect_attempt = 0

    # ------------------------------------------------------------------
    # Public API (safe to call from any thread)
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Start the background event loop thread and initiate connection."""
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._run_loop,
            name="ghost-doc-transport",
            daemon=True,
        )
        self._thread.start()

    def send(self, event: TraceEvent) -> None:
        """
        Send a trace event to the Hub.
        Buffers the event if not currently connected.
        Thread-safe; non-blocking.
        """
        if self._loop is not None and self._connected:
            payload = json.dumps(event)
            asyncio.run_coroutine_threadsafe(self._send_async(payload), self._loop)
        else:
            self._buffer.push(event)

    def stop(self) -> None:
        """Signal the background thread to shut down."""
        self._stopped = True
        self._connected = False

        if self._ws is not None and self._loop is not None and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self._ws.close(), self._loop)

    # ------------------------------------------------------------------
    # Background thread
    # ------------------------------------------------------------------

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        assert self._loop is not None
        self._loop.run_until_complete(self._connect_loop())

    async def _connect_loop(self) -> None:
        while not self._stopped:
            try:
                async with websockets.connect(self._hub_url) as ws:  # type: ignore[attr-defined]
                    self._ws = ws
                    self._connected = True
                    self._reconnect_attempt = 0
                    await self._flush_buffer()
                    await self._receive_loop(ws)

            except (OSError, websockets.exceptions.WebSocketException):
                self._connected = False
                self._ws = None

                if self._stopped:
                    return

                self._reconnect_attempt += 1

                if self._reconnect_attempt == _WARN_AFTER_ATTEMPTS:
                    logger.warning(
                        "[ghost-doc] Hub at %s is unreachable after %d attempts. "
                        "Traces are buffered locally. Run `npx ghost-doc start`.",
                        self._hub_url,
                        self._reconnect_attempt,
                    )

                delay = min(
                    _BASE_RETRY_DELAY * (2 ** (self._reconnect_attempt - 1)),
                    _MAX_RETRY_DELAY,
                )
                await asyncio.sleep(delay)

            except Exception:  # noqa: BLE001
                # Unexpected error — log and retry
                logger.exception("[ghost-doc] Unexpected transport error")
                self._connected = False
                self._ws = None
                await asyncio.sleep(_BASE_RETRY_DELAY)

    async def _flush_buffer(self) -> None:
        """Send all buffered events after (re)connecting."""
        events = self._buffer.drain()
        for event in events:
            try:
                await self._ws.send(json.dumps(event))  # type: ignore[union-attr]
            except Exception:  # noqa: BLE001
                # Re-buffer and stop flushing — connection may have dropped
                self._buffer.push(event)
                break

    async def _send_async(self, payload: str) -> None:
        """Send a single JSON payload. Called from the background event loop."""
        if self._ws is None:
            return
        try:
            await self._ws.send(payload)
        except Exception:  # noqa: BLE001
            pass  # Fire-and-forget: event is dropped if connection breaks mid-send

    async def _receive_loop(self, ws: websockets.WebSocketClientProtocol) -> None:
        """
        Keep the connection alive by iterating incoming messages.
        The Hub does not send commands to agents in Phase 1,
        so all received data is discarded.
        """
        async for _ in ws:
            pass

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        return self._connected
