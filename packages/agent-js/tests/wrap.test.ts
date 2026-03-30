import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTracer } from "../src/tracer.js";
import type { TraceEvent } from "@ghost-doc/shared-types";

function createTestTracer() {
  const tracer = createTracer({ agentId: "wrap-agent", enabled: false });
  const emitted: TraceEvent[] = [];
  vi.spyOn(tracer, "emit").mockImplementation((event) => {
    emitted.push(event);
  });
  return { tracer, emitted };
}

describe("tracer.wrap()", () => {
  let emitted: TraceEvent[];
  let tracer: ReturnType<typeof createTracer>;

  beforeEach(() => {
    const result = createTestTracer();
    tracer = result.tracer;
    emitted = result.emitted;
  });

  it("wraps a synchronous function and emits a span", () => {
    const multiply = tracer.wrap((a: number, b: number) => a * b, "multiply");

    const result = multiply(4, 5);

    expect(result).toBe(20);
    expect(emitted).toHaveLength(1);
    const span = emitted[0]!;
    expect(span.source.function_name).toBe("multiply");
    expect(span.input).toEqual([4, 5]);
    expect(span.output).toBe(20);
    expect(span.error).toBeNull();
  });

  it("wraps an async function and emits a span after resolution", async () => {
    const asyncFetch = tracer.wrap(async (id: number) => ({ id, name: "test" }), "asyncFetch");

    const result = await asyncFetch(42);

    expect(result).toEqual({ id: 42, name: "test" });
    expect(emitted).toHaveLength(1);
    const span = emitted[0]!;
    expect(span.source.function_name).toBe("asyncFetch");
    expect(span.output).toEqual({ id: 42, name: "test" });
  });

  it("captures errors thrown by wrapped sync functions", () => {
    const fail = tracer.wrap(() => {
      throw new TypeError("type mismatch");
    }, "fail");

    expect(() => fail()).toThrow("type mismatch");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.error?.type).toBe("TypeError");
    expect(emitted[0]?.error?.message).toBe("type mismatch");
  });

  it("captures rejections from wrapped async functions", async () => {
    const asyncFail = tracer.wrap(async () => {
      throw new Error("async error");
    }, "asyncFail");

    await expect(asyncFail()).rejects.toThrow("async error");
    expect(emitted[0]?.error?.message).toBe("async error");
  });

  it("uses the function name as label when no label is provided", () => {
    function namedFunction(x: number): number {
      return x * 2;
    }
    const wrapped = tracer.wrap(namedFunction);
    wrapped(5);
    expect(emitted[0]?.source.function_name).toBe("namedFunction");
  });

  it("uses 'anonymous' for unnamed arrow functions without label", () => {
    const wrapped = tracer.wrap((x: number) => x);
    wrapped(1);
    expect(emitted[0]?.source.function_name).toBe("anonymous");
  });

  it("propagates trace context to nested wrapped calls", () => {
    const inner = tracer.wrap((x: number) => x + 1, "inner");
    const outer = tracer.wrap((x: number) => inner(x), "outer");

    outer(10);

    expect(emitted).toHaveLength(2);
    const [innerSpan, outerSpan] = emitted;
    expect(innerSpan!.trace_id).toBe(outerSpan!.trace_id);
    expect(innerSpan!.parent_span_id).toBe(outerSpan!.span_id);
  });

  it("records timing (duration_ms >= 0)", async () => {
    const sleep = tracer.wrap(
      () => new Promise<void>((resolve) => setTimeout(resolve, 10)),
      "sleep",
    );

    await sleep();
    expect(emitted[0]?.timing.duration_ms).toBeGreaterThanOrEqual(10);
  });
});
