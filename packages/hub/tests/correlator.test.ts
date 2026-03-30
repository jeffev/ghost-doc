import { describe, it, expect, beforeEach } from "vitest";
import { AnomalyDetector, buildSpanTree } from "../src/correlator.js";
import { makeStored, makeTrace } from "./fixtures.js";

// ---------------------------------------------------------------------------
// buildSpanTree
// ---------------------------------------------------------------------------

describe("buildSpanTree", () => {
  it("returns single root span with no children for a single span", () => {
    const span = makeStored();
    const result = buildSpanTree([span]);

    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]?.span.span_id).toBe(span.span_id);
    expect(result.roots[0]?.children).toHaveLength(0);
  });

  it("builds a parent→child tree", () => {
    const root = makeStored({ span_id: "aaaa-0000-4000-8000-000000000001", parent_span_id: null });
    const child = makeStored({
      span_id: "aaaa-0000-4000-8000-000000000002",
      parent_span_id: root.span_id,
    });
    const result = buildSpanTree([root, child]);

    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]?.children).toHaveLength(1);
    expect(result.roots[0]?.children[0]?.span.span_id).toBe(child.span_id);
  });

  it("handles multiple roots (e.g. partial trace)", () => {
    const r1 = makeStored({ span_id: "aaaa-0000-4000-8000-000000000001", parent_span_id: null });
    const r2 = makeStored({ span_id: "aaaa-0000-4000-8000-000000000002", parent_span_id: null });
    const result = buildSpanTree([r1, r2]);

    expect(result.roots).toHaveLength(2);
  });

  it("isDistributed is false when all spans share the same agent", () => {
    const root = makeStored({ span_id: "aaaa-0000-4000-8000-000000000001" });
    const child = makeStored({
      span_id: "aaaa-0000-4000-8000-000000000002",
      parent_span_id: root.span_id,
    });
    const result = buildSpanTree([root, child]);
    expect(result.isDistributed).toBe(false);
  });

  it("isDistributed is true when spans come from different agents", () => {
    const frontend = makeStored({
      span_id: "aaaa-0000-4000-8000-000000000001",
      source: { agent_id: "frontend", language: "js", file: "f.ts", line: 1, function_name: "fn" },
    });
    const backend = makeStored({
      span_id: "aaaa-0000-4000-8000-000000000002",
      parent_span_id: frontend.span_id,
      source: { agent_id: "backend", language: "python", file: "b.py", line: 1, function_name: "fn" },
    });
    const result = buildSpanTree([frontend, backend]);
    expect(result.isDistributed).toBe(true);
    expect(result.agentIds).toContain("frontend");
    expect(result.agentIds).toContain("backend");
  });
});

// ---------------------------------------------------------------------------
// AnomalyDetector
// ---------------------------------------------------------------------------

describe("AnomalyDetector", () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    detector = new AnomalyDetector();
  });

  it("first call for a function is never anomalous", () => {
    const trace = makeTrace({ output: "hello" });
    expect(detector.check(trace)).toBe(false);
  });

  it("second call with same output type is not anomalous", () => {
    const trace = makeTrace({ output: "hello" });
    detector.check(trace);
    expect(detector.check(makeTrace({ output: "world" }))).toBe(false);
  });

  it("detects type change: string → number", () => {
    detector.check(makeTrace({ output: "hello" }));
    expect(detector.check(makeTrace({ output: 42 }))).toBe(true);
  });

  it("detects type change: object → null", () => {
    detector.check(makeTrace({ output: { id: 1 } }));
    expect(detector.check(makeTrace({ output: null }))).toBe(true);
  });

  it("detects type change: array → string", () => {
    detector.check(makeTrace({ output: [1, 2, 3] }));
    expect(detector.check(makeTrace({ output: "oops" }))).toBe(true);
  });

  it("does not flag anomaly for the same previously-seen type (after new type added)", () => {
    detector.check(makeTrace({ output: "hello" })); // seen: string
    detector.check(makeTrace({ output: 42 })); // anomaly: adds number
    // Now both types are known — no anomaly
    expect(detector.check(makeTrace({ output: "back to string" }))).toBe(false);
  });

  it("tracks each (agent_id, function_name) pair independently", () => {
    const agentA = makeTrace({
      source: { agent_id: "a", language: "js", file: "a.ts", line: 1, function_name: "fn" },
      output: "hello",
    });
    const agentB = makeTrace({
      source: { agent_id: "b", language: "js", file: "b.ts", line: 1, function_name: "fn" },
      output: 42, // different type but different agent — first observation
    });
    detector.check(agentA);
    expect(detector.check(agentB)).toBe(false);
  });

  it("reset() clears all type history", () => {
    detector.check(makeTrace({ output: "hello" }));
    detector.reset();
    expect(detector.check(makeTrace({ output: 42 }))).toBe(false); // first observation again
  });
});
