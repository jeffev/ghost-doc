import WebSocket from "ws";
import type { RingBuffer } from "./ring-buffer.js";
import type { TraceEvent } from "@ghost-doc/shared-types";

const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const WARN_AFTER_ATTEMPTS = 10;

/**
 * Fire-and-forget WebSocket transport.
 *
 * - Connects to the Ghost Doc Hub on startup.
 * - Buffers events in a RingBuffer when the connection is unavailable.
 * - Flushes the buffer automatically when the connection is restored.
 * - Reconnects with exponential backoff (1s → 30s cap).
 * - Never throws; errors are logged with a [ghost-doc] prefix.
 */
export class WsTransport {
  private ws: WebSocket | null = null;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private _destroyed = false;

  constructor(
    private readonly hubUrl: string,
    private readonly buffer: RingBuffer<TraceEvent>,
  ) {}

  connect(): void {
    if (this._destroyed) return;
    this._openConnection();
  }

  private _openConnection(): void {
    if (this._destroyed) return;

    try {
      const ws = new WebSocket(this.hubUrl);
      this.ws = ws;

      ws.on("open", () => {
        this._connected = true;
        this.retryAttempt = 0;
        this._flushBuffer();
      });

      ws.on("close", () => {
        this._connected = false;
        this.ws = null;
        this._scheduleReconnect();
      });

      // Required: prevents Node.js unhandled-error crash.
      // The "error" event is always followed by "close", which handles reconnect.
      ws.on("error", () => {
        // intentionally empty — handled by "close"
      });
    } catch {
      this._scheduleReconnect();
    }
  }

  private _scheduleReconnect(): void {
    if (this._destroyed) return;

    this.retryAttempt++;

    if (this.retryAttempt === WARN_AFTER_ATTEMPTS) {
      console.warn(
        `[ghost-doc] Hub at ${this.hubUrl} is unreachable after ${this.retryAttempt} attempts. ` +
          "Traces are buffered locally. Run `npx ghost-doc start` to start the Hub.",
      );
    }

    const delay = Math.min(
      BASE_RETRY_DELAY_MS * Math.pow(2, this.retryAttempt - 1),
      MAX_RETRY_DELAY_MS,
    );

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._openConnection();
    }, delay);
  }

  private _flushBuffer(): void {
    const events = this.buffer.drain();
    for (const event of events) {
      this._sendRaw(event);
    }
  }

  private _sendRaw(event: TraceEvent): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    try {
      this.ws.send(JSON.stringify(event));
    } catch (err) {
      console.error("[ghost-doc] Failed to send trace event, re-buffering:", err);
      this.buffer.push(event);
    }
  }

  /** Send a trace event. Buffers the event if not currently connected. */
  send(event: TraceEvent): void {
    if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
      this._sendRaw(event);
    } else {
      this.buffer.push(event);
    }
  }

  /** Gracefully close the connection and cancel any pending reconnect timer. */
  disconnect(): void {
    this._destroyed = true;

    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }

    this._connected = false;
  }

  get isConnected(): boolean {
    return this._connected;
  }
}
