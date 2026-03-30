import { describe, it, expect } from "vitest";
import { buildGraphData } from "../src/store/graph.js";
import { makeSpan } from "./fixtures.js";

describe("buildGraphData", () => {
  it("produces one node per unique (agent, function) pair", () => {
    const spans = [
      makeSpan({ source: { agent_id: "a", language: "js", file: "f.ts", line: 1, function_name: "fn1" } }),
      makeSpan({ source: { agent_id: "a", language: "js", file: "f.ts", line: 1, function_name: "fn1" } }),
      makeSpan({ source: { agent_id: "a", language: "js", file: "f.ts", line: 2, function_name: "fn2" } }),
    ];
    const { nodes } = buildGraphData(spans);
    expect(nodes).toHaveLength(2);
  });

  it("accumulates callCount correctly", () => {
    const spans = [makeSpan(), makeSpan(), makeSpan()];
    const { nodes } = buildGraphData(spans);
    expect(nodes[0]?.callCount).toBe(3);
  });

  it("computes avgDurationMs correctly", () => {
    const spans = [
      makeSpan({ timing: { started_at: 1, duration_ms: 10 } }),
      makeSpan({ timing: { started_at: 2, duration_ms: 30 } }),
    ];
    const { nodes } = buildGraphData(spans);
    expect(nodes[0]?.avgDurationMs).toBe(20);
  });

  it("marks hasAnomaly when any span is anomalous", () => {
    const spans = [
      makeSpan({ anomaly: false }),
      makeSpan({ anomaly: true }),
    ];
    const { nodes } = buildGraphData(spans);
    expect(nodes[0]?.hasAnomaly).toBe(true);
  });

  it("marks hasError when any span has an error", () => {
    const spans = [
      makeSpan({ error: { type: "TypeError", message: "oops", stack: "..." } }),
    ];
    const { nodes } = buildGraphData(spans);
    expect(nodes[0]?.hasError).toBe(true);
  });

  it("produces an edge for parent→child span relationship", () => {
    const parent = makeSpan({ span_id: "aaaa-0000-4000-8000-000000000001", source: { agent_id: "a", language: "js", file: "f.ts", line: 1, function_name: "parent" } });
    const child = makeSpan({ span_id: "aaaa-0000-4000-8000-000000000002", parent_span_id: parent.span_id, source: { agent_id: "a", language: "js", file: "f.ts", line: 2, function_name: "child" } });
    const { edges } = buildGraphData([parent, child]);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe("a:parent");
    expect(edges[0]?.target).toBe("a:child");
  });

  it("does not produce self-loop edges", () => {
    const span = makeSpan({ span_id: "aaaa-0000-4000-8000-000000000001" });
    const child = makeSpan({ span_id: "aaaa-0000-4000-8000-000000000002", parent_span_id: span.span_id });
    // child has the same function name as parent → would produce a self-loop
    const { edges } = buildGraphData([span, child]);
    expect(edges.every((e) => e.source !== e.target)).toBe(true);
  });

  it("returns empty graph for empty input", () => {
    const { nodes, edges } = buildGraphData([]);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it("marks isSlow for nodes whose avg duration is in the top 5% (>= 5 nodes)", () => {
    // 5 nodes with durations 10, 20, 30, 40, 500 — last is clearly an outlier.
    const agents = ["a", "b", "c", "d", "e"];
    const durations = [10, 20, 30, 40, 500];
    const spans = agents.map((id, i) =>
      makeSpan({
        source: { agent_id: id, language: "js", file: "f.ts", line: 1, function_name: "fn" },
        timing: { started_at: i, duration_ms: durations[i]! },
      }),
    );
    const { nodes } = buildGraphData(spans);
    const slow = nodes.filter((n) => n.isSlow);
    expect(slow).toHaveLength(1);
    expect(slow[0]?.agentId).toBe("e");
  });

  it("does not mark isSlow when there are fewer than 5 nodes", () => {
    const spans = [
      makeSpan({ source: { agent_id: "a", language: "js", file: "f.ts", line: 1, function_name: "fn" }, timing: { started_at: 0, duration_ms: 9999 } }),
      makeSpan({ source: { agent_id: "b", language: "js", file: "f.ts", line: 1, function_name: "fn" }, timing: { started_at: 1, duration_ms: 1 } }),
    ];
    const { nodes } = buildGraphData(spans);
    expect(nodes.every((n) => !n.isSlow)).toBe(true);
  });
});
