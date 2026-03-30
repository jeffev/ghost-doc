import { randomUUID } from "node:crypto";
import type { TraceEvent } from "@ghost-doc/shared-types";
import type { StoredSpan } from "../src/store.js";

/** Creates a minimal valid TraceEvent, with overrides applied on top. */
export function makeTrace(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    schema_version: "1.0",
    trace_id: randomUUID(),
    span_id: randomUUID(),
    parent_span_id: null,
    source: {
      agent_id: "test-agent",
      language: "js",
      file: "src/index.ts",
      line: 1,
      function_name: "doSomething",
    },
    timing: {
      started_at: Date.now(),
      duration_ms: 42,
    },
    input: [],
    output: "ok",
    error: null,
    tags: {},
    ...overrides,
  };
}

/** Wraps a TraceEvent in StoredSpan Hub metadata. */
export function makeStored(overrides: Partial<TraceEvent> = {}): StoredSpan {
  return {
    ...makeTrace(overrides),
    received_at: Date.now(),
    anomaly: false,
    distributed: false,
  };
}
