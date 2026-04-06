import * as http from "node:http";
import type { TraceEvent } from "@ghost-doc/shared-types";
import type { SessionCall, SessionSnapshot, RecordingOptions, ServeOptions } from "../types.js";

// ---------------------------------------------------------------------------
// Span → SessionCall conversion
// ---------------------------------------------------------------------------

function spanToCall(span: TraceEvent, sequence: number): SessionCall {
  return {
    function: span.source.function_name,
    spanId: span.span_id,
    traceId: span.trace_id,
    args: span.input as unknown[],
    return: span.output,
    durationMs: span.timing.duration_ms,
    error: span.error !== null ? { type: span.error.type, message: span.error.message } : null,
    sequence,
  };
}

// ---------------------------------------------------------------------------
// Public: create a session from an array of spans
// ---------------------------------------------------------------------------

/**
 * Convert a set of TraceEvent spans into a named SessionSnapshot.
 *
 * @param name   Human-readable session name (used as the file name stem).
 * @param spans  All spans to consider. Filtering is applied via `opts`.
 * @param opts   Recording options (function filter, max-per-function, custom filter).
 */
export function spansToSession(
  name: string,
  spans: TraceEvent[],
  opts: RecordingOptions = {},
): SessionSnapshot {
  const { functions, maxCallsPerFunction, filter } = opts;

  const startTime =
    spans.length > 0
      ? new Date(Math.min(...spans.map((s) => s.timing.started_at))).toISOString()
      : new Date().toISOString();

  const endTime =
    spans.length > 0
      ? new Date(
          Math.max(...spans.map((s) => s.timing.started_at + s.timing.duration_ms)),
        ).toISOString()
      : new Date().toISOString();

  // Sort by start time ascending so sequence numbers are meaningful
  const sorted = [...spans].sort((a, b) => a.timing.started_at - b.timing.started_at);

  const callsPerFunction = new Map<string, number>();
  const calls: SessionCall[] = [];
  let seq = 1;

  for (const span of sorted) {
    const fnName = span.source.function_name;

    // Function name filter
    if (functions !== undefined && !functions.includes(fnName)) continue;

    // maxCallsPerFunction guard
    if (maxCallsPerFunction !== undefined) {
      const count = callsPerFunction.get(fnName) ?? 0;
      if (count >= maxCallsPerFunction) continue;
      callsPerFunction.set(fnName, count + 1);
    }

    const call = spanToCall(span, seq++);

    // Custom filter
    if (filter !== undefined && !filter(call)) continue;

    calls.push(call);
  }

  return { session: name, startTime, endTime, calls };
}

// ---------------------------------------------------------------------------
// Session serialisation helpers
// ---------------------------------------------------------------------------

/** Serialise a SessionSnapshot to JSON. */
export function sessionToJson(session: SessionSnapshot): string {
  return JSON.stringify(session, null, 2);
}

/** Deserialise a JSON string or parsed object back to SessionSnapshot. */
export function loadSession(data: unknown): SessionSnapshot {
  const obj: unknown = typeof data === "string" ? (JSON.parse(data) as unknown) : data;

  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new Error("loadSession: expected a JSON object");
  }
  const raw = obj as Record<string, unknown>;
  if (typeof raw["session"] !== "string") {
    throw new Error('loadSession: missing string field "session"');
  }
  if (!Array.isArray(raw["calls"])) {
    throw new Error('loadSession: "calls" must be an array');
  }

  return {
    session: raw["session"],
    startTime: typeof raw["startTime"] === "string" ? raw["startTime"] : new Date().toISOString(),
    endTime: typeof raw["endTime"] === "string" ? raw["endTime"] : new Date().toISOString(),
    calls: raw["calls"] as SessionCall[],
  };
}

/** Lightweight YAML serialiser for SessionSnapshot. */
export function sessionToYaml(session: SessionSnapshot): string {
  const lines: string[] = [
    `session: ${session.session}`,
    `startTime: ${session.startTime}`,
    `endTime: ${session.endTime}`,
    "calls:",
  ];

  if (session.calls.length === 0) {
    lines.push("  []");
  } else {
    for (const call of session.calls) {
      lines.push(`  - function: ${call.function}`);
      lines.push(`    spanId: ${call.spanId}`);
      lines.push(`    traceId: ${call.traceId}`);
      lines.push(`    args: ${JSON.stringify(call.args)}`);
      lines.push(`    return: ${JSON.stringify(call.return)}`);
      lines.push(`    durationMs: ${call.durationMs}`);
      lines.push(`    error: ${call.error === null ? "null" : JSON.stringify(call.error)}`);
      lines.push(`    sequence: ${call.sequence}`);
    }
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Public: Mock HTTP server
// ---------------------------------------------------------------------------

export interface MockServer {
  /** URL the server is listening on (e.g. "http://127.0.0.1:8080") */
  url: string;
  /** Gracefully shut down the server. */
  stop(): Promise<void>;
}

/**
 * Start an HTTP mock server that replays a SessionSnapshot.
 *
 * Each recorded function is exposed as `POST /<functionName>`.
 * The server returns the recorded response in the configured mode.
 *
 * @example
 *   const server = await serveMocks(8080, snapshot, { mode: "exact" });
 *   // POST http://127.0.0.1:8080/createOrder → recorded response
 *   await server.stop();
 */
export async function serveMocks(
  port: number,
  session: SessionSnapshot,
  opts: ServeOptions = { mode: "exact" },
): Promise<MockServer> {
  const { mode, faultInjection } = opts;
  const errorRate = faultInjection?.errorRate ?? 0;
  const latencyFactor = faultInjection?.latencyFactor ?? 1;

  // Group calls by function name
  const byFunction = new Map<string, SessionCall[]>();
  for (const call of session.calls) {
    let arr = byFunction.get(call.function);
    if (arr === undefined) {
      arr = [];
      byFunction.set(call.function, arr);
    }
    arr.push(call);
  }

  // Cursor tracking for "exact" mode (cycles through calls in order)
  const cursors = new Map<string, number>();
  for (const [name] of byFunction) {
    cursors.set(name, 0);
  }

  function pickCall(fnName: string): SessionCall | undefined {
    const calls = byFunction.get(fnName);
    if (calls === undefined || calls.length === 0) return undefined;

    if (mode === "round-robin") {
      return calls[Math.floor(Math.random() * calls.length)];
    }

    // exact and latency-preserving: sequential with cycling
    const idx = cursors.get(fnName) ?? 0;
    const call = calls[idx % calls.length];
    cursors.set(fnName, idx + 1);
    return call;
  }

  function delay(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
  }

  const server = http.createServer((req, res) => {
    const fnName = decodeURIComponent((req.url ?? "/").replace(/^\//, ""));
    const call = pickCall(fnName);

    if (call === undefined) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `No recorded calls for: ${fnName}` }));
      return;
    }

    const shouldError = errorRate > 0 && call.error !== null && Math.random() < errorRate;

    const respondMs =
      mode === "latency-preserving" ? Math.round(call.durationMs * latencyFactor) : 0;

    const respond = (): void => {
      if (shouldError && call.error !== null) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: call.error }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(call.return));
      }
    };

    if (respondMs > 0) {
      void delay(respondMs).then(respond);
    } else {
      respond();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  return {
    url: `http://127.0.0.1:${port}`,
    stop(): Promise<void> {
      return new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
