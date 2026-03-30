import type { SpanInput } from "../src/types.js";

let spanCounter = 0;

export function makeSpan(overrides: Partial<SpanInput> = {}): SpanInput {
  const id = `span-${++spanCounter}`;
  return {
    schema_version: "1.0",
    trace_id: "trace-1",
    span_id: id,
    parent_span_id: null,
    source: {
      agent_id: "test-agent",
      language: "js",
      file: "src/app.ts",
      line: 10,
      function_name: "doWork",
    },
    timing: {
      started_at: Date.now(),
      duration_ms: 42,
    },
    input: [],
    output: "ok",
    error: null,
    tags: {},
    anomaly: false,
    distributed: false,
    ...overrides,
  };
}
