import { randomUUID } from "node:crypto";
import type { TraceEvent } from "@ghost-doc/shared-types";
import type { SessionCall, SessionSnapshot } from "../src/types.js";

/** Creates a minimal valid TraceEvent with overrides. */
export function makeTrace(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    schema_version: "1.0",
    trace_id: randomUUID(),
    span_id: randomUUID(),
    parent_span_id: null,
    source: {
      agent_id: "test-agent",
      language: "js",
      file: "src/orders.ts",
      line: 10,
      function_name: "createOrder",
    },
    timing: {
      started_at: Date.now(),
      duration_ms: 50,
    },
    input: [{ userId: "u_1", amount: 99.99 }],
    output: { orderId: "ord_1", status: "pending" },
    error: null,
    tags: {},
    ...overrides,
  };
}

/** Create n traces for a named function with varying input/output. */
export function makeTraces(
  functionName: string,
  count: number,
  overrides: Partial<TraceEvent> = {},
): TraceEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeTrace({
      source: {
        agent_id: "test-agent",
        language: "js",
        file: "src/orders.ts",
        line: 10,
        function_name: functionName,
      },
      input: [{ userId: `u_${i}`, amount: (i + 1) * 10 }],
      output: { orderId: `ord_${i}`, status: "pending" },
      timing: { started_at: Date.now() + i, duration_ms: 40 + i },
      ...overrides,
    }),
  );
}

export function makeSessionCall(overrides: Partial<SessionCall> = {}): SessionCall {
  return {
    function: "createOrder",
    spanId: randomUUID(),
    traceId: randomUUID(),
    args: [{ userId: "u_1", amount: 99 }],
    return: { orderId: "ord_1", status: "pending" },
    durationMs: 50,
    error: null,
    sequence: 1,
    ...overrides,
  };
}

export function makeSession(name: string, calls: SessionCall[]): SessionSnapshot {
  return {
    session: name,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    calls,
  };
}
