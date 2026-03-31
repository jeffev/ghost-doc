import { AsyncLocalStorage } from "node:async_hooks";
import { RingBuffer } from "./ring-buffer.js";
import { WsTransport } from "./transport.js";
import { DEFAULT_SANITIZE_KEYS, sanitizeDeep } from "./sanitize.js";
import { createMethodDecorator } from "./decorator.js";
import { createWrap } from "./wrap.js";
import { newSpanId } from "./span.js";
import type { TraceEvent } from "@ghost-doc/shared-types";
import type { SanitizeConfig } from "./sanitize.js";

/** HTTP header name used to propagate the trace ID across service boundaries. */
export const TRACE_ID_HEADER = "x-trace-id";

export interface TracerConfig {
  /** Identifies this agent in the Hub (e.g. "frontend", "api-server"). */
  agentId: string;
  /** WebSocket URL of the Ghost Doc Hub. Default: ws://localhost:3001/agent */
  hubUrl?: string;
  /** Set to false to disable all tracing without removing decorators. Default: true */
  enabled?: boolean;
  /**
   * Keys to redact from inputs/outputs before sending to the Hub.
   * - `string[]`: blocklist of key names (case-insensitive)
   * - `SanitizerFn`: custom function called per key
   * Defaults to DEFAULT_SANITIZE_KEYS.
   */
  sanitize?: SanitizeConfig;
  /** Maximum number of events to buffer while offline. Default: 500 */
  bufferSize?: number;
  /**
   * Fraction of spans to emit (0.0–1.0). Default: 1.0 (emit all).
   * For example, 0.1 emits ~10% of spans. Sampled-out spans are silently dropped.
   * Root spans and their entire call tree are sampled together (head-based sampling).
   */
  sampleRate?: number;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
}

/**
 * Tracer instance created by `createTracer()`.
 *
 * Attach `@tracer.trace()` to class methods, or use `tracer.wrap()` for plain functions.
 *
 * @example
 * ```ts
 * const tracer = createTracer({ agentId: "api", hubUrl: "ws://localhost:3001/agent" });
 *
 * class UserService {
 *   @tracer.trace()
 *   async getUser(id: string) { ... }
 * }
 *
 * const fetchData = tracer.wrap(async (url: string) => { ... });
 * ```
 */
export class TracerInstance {
  readonly _config: Readonly<Required<TracerConfig>>;
  readonly _buffer: RingBuffer<TraceEvent>;
  readonly _transport: WsTransport;
  readonly _storage: AsyncLocalStorage<TraceContext>;

  /** TC39 method decorator factory. Usage: `@tracer.trace()` or `@tracer.trace("label")` */
  readonly trace: ReturnType<typeof createMethodDecorator>;
  /** Wrap any function for tracing. Usage: `const fn = tracer.wrap(originalFn)` */
  readonly wrap: ReturnType<typeof createWrap>;

  constructor(config: TracerConfig) {
    this._config = {
      agentId: config.agentId,
      hubUrl: config.hubUrl ?? "ws://localhost:3001/agent",
      enabled: config.enabled ?? true,
      sanitize: config.sanitize ?? [...DEFAULT_SANITIZE_KEYS],
      bufferSize: config.bufferSize ?? 500,
      sampleRate: Math.max(0, Math.min(1, config.sampleRate ?? 1.0)),
    };

    this._buffer = new RingBuffer<TraceEvent>(this._config.bufferSize);
    this._transport = new WsTransport(this._config.hubUrl, this._buffer);
    this._storage = new AsyncLocalStorage<TraceContext>();

    this.trace = createMethodDecorator(this);
    this.wrap = createWrap(this);

    if (this._config.enabled) {
      this._transport.connect();
    }
  }

  /** Emit a fully-assembled TraceEvent directly (useful for advanced integrations). */
  emit(event: TraceEvent): void {
    if (!this._config.enabled) return;
    if (this._config.sampleRate < 1 && Math.random() > this._config.sampleRate) return;
    this._transport.send(event);
  }

  /** The active trace context for the current async scope, or undefined if none. */
  currentContext(): TraceContext | undefined {
    return this._storage.getStore();
  }

  /**
   * Sanitize a value using this tracer's configured sanitize rules.
   * Returns a new object; does not mutate the original.
   */
  sanitize(value: unknown): unknown {
    return sanitizeDeep(value, this._config.sanitize);
  }

  /**
   * Run `fn` within a trace context.
   * All spans created inside `fn` will share the given `traceId`.
   */
  runInContext<T>(ctx: TraceContext, fn: () => T): T {
    return this._storage.run(ctx, fn);
  }

  /**
   * Create a TraceContext from HTTP request headers.
   *
   * Reads the `X-Trace-Id` header (case-insensitive) and returns a context
   * that, when passed to `runInContext`, associates all nested spans with that
   * distributed trace ID.
   *
   * ```ts
   * app.use((req, res, next) => {
   *   const ctx = tracer.contextFromHeaders(req.headers);
   *   if (ctx) {
   *     tracer.runInContext(ctx, next);
   *   } else {
   *     next();
   *   }
   * });
   * ```
   */
  contextFromHeaders(headers: Record<string, string | string[] | undefined>): TraceContext | null {
    const raw = headers[TRACE_ID_HEADER] ?? headers["X-Trace-Id"] ?? headers["x-trace-id"];
    const traceId = Array.isArray(raw) ? raw[0] : raw;
    if (typeof traceId !== "string" || traceId.trim() === "") return null;
    return { traceId: traceId.trim(), spanId: newSpanId() };
  }

  /**
   * Inject the active trace ID into an outgoing HTTP headers object.
   *
   * Call this before making a downstream HTTP request so the receiving
   * service can correlate its spans with the current distributed trace.
   * Returns the same headers object for convenience.
   *
   * ```ts
   * const headers = tracer.injectHeaders({ "Content-Type": "application/json" });
   * await fetch(url, { headers });
   * ```
   */
  injectHeaders<T extends Record<string, string>>(headers: T): T {
    const ctx = this.currentContext();
    if (ctx !== undefined) {
      headers[TRACE_ID_HEADER as keyof T] = ctx.traceId as T[keyof T];
    }
    return headers;
  }

  /** Close the WebSocket connection and stop buffering. */
  disconnect(): void {
    this._transport.disconnect();
  }

  get isConnected(): boolean {
    return this._transport.isConnected;
  }
}

/**
 * Create a new tracer instance.
 *
 * One tracer per application entry point is typically sufficient.
 * Each tracer maintains its own WebSocket connection to the Hub.
 */
export function createTracer(config: TracerConfig): TracerInstance {
  return new TracerInstance(config);
}
