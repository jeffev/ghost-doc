import { randomUUID } from "node:crypto";
import type { StoredSpan } from "../src/store/types.js";

/** Creates a minimal valid StoredSpan, with overrides applied on top. */
export function makeSpan(overrides: Partial<StoredSpan> = {}): StoredSpan {
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
    received_at: Date.now(),
    anomaly: false,
    distributed: false,
    ...overrides,
  };
}
