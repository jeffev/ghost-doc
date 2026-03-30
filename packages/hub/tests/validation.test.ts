import { describe, it, expect } from "vitest";
import { TraceEventSchema } from "@ghost-doc/shared-types";
import { makeTrace } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Schema validation (Hub boundary)
// ---------------------------------------------------------------------------

describe("TraceEvent schema validation", () => {
  it("accepts a fully valid trace event", () => {
    const result = TraceEventSchema.safeParse(makeTrace());
    expect(result.success).toBe(true);
  });

  it("rejects a trace with missing schema_version", () => {
    const { schema_version: _, ...rest } = makeTrace();
    const result = TraceEventSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a trace with wrong schema_version", () => {
    const result = TraceEventSchema.safeParse(makeTrace({ schema_version: "2.0" as "1.0" }));
    expect(result.success).toBe(false);
  });

  it("rejects a trace with invalid trace_id (not a UUID)", () => {
    const result = TraceEventSchema.safeParse(makeTrace({ trace_id: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  it("rejects a trace with invalid span_id (not a UUID)", () => {
    const result = TraceEventSchema.safeParse(makeTrace({ span_id: "nope" }));
    expect(result.success).toBe(false);
  });

  it("accepts parent_span_id: null (root span)", () => {
    const result = TraceEventSchema.safeParse(makeTrace({ parent_span_id: null }));
    expect(result.success).toBe(true);
  });

  it("accepts a valid parent_span_id (UUID)", () => {
    const result = TraceEventSchema.safeParse(
      makeTrace({ parent_span_id: "aaaaaaaa-0000-4000-8000-000000000001" }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a trace with negative duration_ms", () => {
    const result = TraceEventSchema.safeParse(
      makeTrace({ timing: { started_at: Date.now(), duration_ms: -1 } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a trace with zero started_at", () => {
    const result = TraceEventSchema.safeParse(
      makeTrace({ timing: { started_at: 0, duration_ms: 10 } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an unknown language", () => {
    const trace = makeTrace();
    const result = TraceEventSchema.safeParse({
      ...trace,
      source: { ...trace.source, language: "cobol" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a trace with error populated", () => {
    const result = TraceEventSchema.safeParse(
      makeTrace({
        error: { type: "TypeError", message: "Cannot read property", stack: "Error\n  at..." },
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a trace with non-empty tags", () => {
    const result = TraceEventSchema.safeParse(
      makeTrace({ tags: { env: "production", version: "1.2.3" } }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects completely malformed JSON (non-object)", () => {
    const result = TraceEventSchema.safeParse("i am not an object");
    expect(result.success).toBe(false);
  });
});
