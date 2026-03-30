import { v4 as uuidv4 } from "uuid";
import type { TraceEvent, Source, ErrorInfo } from "@ghost-doc/shared-types";

export function newTraceId(): string {
  return uuidv4();
}

export function newSpanId(): string {
  return uuidv4();
}

export interface BuildSpanParams {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  source: Source;
  startedAt: number;
  durationMs: number;
  input: unknown[];
  output: unknown;
  error: ErrorInfo | null;
  tags?: Record<string, string>;
}

/** Assemble a complete, valid TraceEvent from its parts. */
export function buildSpan(params: BuildSpanParams): TraceEvent {
  return {
    schema_version: "1.0",
    trace_id: params.traceId,
    span_id: params.spanId,
    parent_span_id: params.parentSpanId,
    source: params.source,
    timing: {
      started_at: params.startedAt,
      duration_ms: params.durationMs,
    },
    input: params.input,
    output: params.output,
    error: params.error,
    tags: params.tags ?? {},
  };
}

/** Serialize an error object into the TraceEvent error shape. */
export function captureError(err: unknown): ErrorInfo {
  if (err instanceof Error) {
    return {
      type: err.name,
      message: err.message,
      stack: err.stack ?? "",
    };
  }
  return {
    type: "UnknownError",
    message: String(err),
    stack: "",
  };
}
