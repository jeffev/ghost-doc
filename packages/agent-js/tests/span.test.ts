import { describe, it, expect } from "vitest";
import { newTraceId, newSpanId, buildSpan, captureError } from "../src/span.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("newTraceId / newSpanId", () => {
  it("generates valid UUID v4 strings", () => {
    expect(newTraceId()).toMatch(UUID_RE);
    expect(newSpanId()).toMatch(UUID_RE);
  });

  it("generates unique IDs on each call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newTraceId()));
    expect(ids.size).toBe(100);
  });
});

describe("buildSpan", () => {
  const baseSource = {
    agent_id: "test-agent",
    language: "js" as const,
    file: "/src/service.ts",
    line: 42,
    function_name: "myMethod",
  };

  it("produces a valid TraceEvent shape", () => {
    const event = buildSpan({
      traceId: newTraceId(),
      spanId: newSpanId(),
      parentSpanId: null,
      source: baseSource,
      startedAt: Date.now(),
      durationMs: 12.5,
      input: [1, "hello"],
      output: { ok: true },
      error: null,
    });

    expect(event.schema_version).toBe("1.0");
    expect(event.source.function_name).toBe("myMethod");
    expect(event.timing.duration_ms).toBe(12.5);
    expect(event.input).toEqual([1, "hello"]);
    expect(event.output).toEqual({ ok: true });
    expect(event.error).toBeNull();
    expect(event.tags).toEqual({});
  });

  it("accepts custom tags", () => {
    const event = buildSpan({
      traceId: newTraceId(),
      spanId: newSpanId(),
      parentSpanId: null,
      source: baseSource,
      startedAt: Date.now(),
      durationMs: 0,
      input: [],
      output: null,
      error: null,
      tags: { env: "test", version: "1.0.0" },
    });

    expect(event.tags).toEqual({ env: "test", version: "1.0.0" });
  });

  it("carries parent_span_id when provided", () => {
    const parentId = newSpanId();
    const event = buildSpan({
      traceId: newTraceId(),
      spanId: newSpanId(),
      parentSpanId: parentId,
      source: baseSource,
      startedAt: Date.now(),
      durationMs: 5,
      input: [],
      output: null,
      error: null,
    });

    expect(event.parent_span_id).toBe(parentId);
  });
});

describe("captureError", () => {
  it("captures Error instances correctly", () => {
    const err = new Error("something went wrong");
    const info = captureError(err);
    expect(info.type).toBe("Error");
    expect(info.message).toBe("something went wrong");
    expect(info.stack).toContain("Error: something went wrong");
  });

  it("captures custom Error subclasses", () => {
    class ValidationError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "ValidationError";
      }
    }
    const err = new ValidationError("invalid input");
    const info = captureError(err);
    expect(info.type).toBe("ValidationError");
    expect(info.message).toBe("invalid input");
  });

  it("captures non-Error thrown values", () => {
    const info = captureError("just a string error");
    expect(info.type).toBe("UnknownError");
    expect(info.message).toBe("just a string error");
    expect(info.stack).toBe("");
  });
});
