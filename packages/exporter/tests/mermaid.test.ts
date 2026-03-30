import { describe, it, expect } from "vitest";
import { buildGraph } from "../src/graph.js";
import { buildMermaidDiagram } from "../src/mermaid.js";
import { makeSpan } from "./fixtures.js";

// Node definition lines look like: `    nodeId["label"]` or `    nodeId["label"]:::class`
// Subgraph lines look like: `  subgraph Foo["Foo"]` — filtered out by requiring 4 spaces indent.
function nodeDefinitionLines(diagram: string): string[] {
  return diagram
    .split("\n")
    .filter((l) => /^ {4}\w+\[/.test(l)); // 4-space indent = inside a subgraph block
}

describe("buildMermaidDiagram", () => {
  it("produces a flowchart LR header", () => {
    const graph = buildGraph([makeSpan()]);
    const diagram = buildMermaidDiagram(graph);
    expect(diagram).toMatch(/^flowchart LR/);
  });

  it("includes a node for each unique agent::function pair", () => {
    const spans = [
      makeSpan({ source: { agent_id: "api", language: "js", file: "a.ts", line: 1, function_name: "fetchUser" } }),
      makeSpan({ source: { agent_id: "api", language: "js", file: "a.ts", line: 5, function_name: "saveUser" } }),
      // duplicate — should not produce a second node
      makeSpan({ source: { agent_id: "api", language: "js", file: "a.ts", line: 1, function_name: "fetchUser" } }),
    ];
    const graph = buildGraph(spans);
    const diagram = buildMermaidDiagram(graph);
    expect(nodeDefinitionLines(diagram)).toHaveLength(2);
  });

  it("groups nodes into subgraphs by service class", () => {
    const spans = [
      makeSpan({ source: { agent_id: "api", language: "js", file: "a.ts", line: 1, function_name: "UserService.getUser" } }),
      makeSpan({ source: { agent_id: "api", language: "js", file: "a.ts", line: 5, function_name: "UserService.saveUser" } }),
      makeSpan({ source: { agent_id: "api", language: "js", file: "a.ts", line: 10, function_name: "OrderService.create" } }),
    ];
    const graph = buildGraph(spans);
    const diagram = buildMermaidDiagram(graph);
    expect(diagram).toContain('subgraph UserService');
    expect(diagram).toContain('subgraph OrderService');
  });

  it("renders an edge between parent and child spans", () => {
    const parent = makeSpan({
      span_id: "parent-1",
      source: { agent_id: "api", language: "js", file: "a.ts", line: 1, function_name: "handler" },
    });
    const child = makeSpan({
      span_id: "child-1",
      parent_span_id: "parent-1",
      source: { agent_id: "api", language: "js", file: "a.ts", line: 10, function_name: "fetchData" },
    });
    const graph = buildGraph([parent, child]);
    const diagram = buildMermaidDiagram(graph);
    expect(diagram).toMatch(/-->/);
  });

  it("annotates anomaly nodes with the anomalyNode class", () => {
    const span = makeSpan({
      source: { agent_id: "api", language: "js", file: "a.ts", line: 1, function_name: "unstable" },
      anomaly: true,
    });
    const graph = buildGraph([span]);
    const diagram = buildMermaidDiagram(graph);
    expect(diagram).toContain(":::anomalyNode");
    expect(diagram).toContain("classDef anomalyNode");
  });

  it("annotates error nodes with the errorNode class", () => {
    const span = makeSpan({
      source: { agent_id: "api", language: "js", file: "a.ts", line: 1, function_name: "boom" },
      error: { type: "Error", message: "oops", stack: "Error: oops\n  at boom" },
    });
    const graph = buildGraph([span]);
    const diagram = buildMermaidDiagram(graph);
    expect(diagram).toContain(":::errorNode");
  });

  it("produces valid Mermaid IDs (no special characters)", () => {
    const span = makeSpan({
      source: {
        agent_id: "my-frontend::v2",
        language: "js",
        file: "a.ts",
        line: 1,
        function_name: "fetch::data",
      },
    });
    const graph = buildGraph([span]);
    const diagram = buildMermaidDiagram(graph);
    // Edges use `nodeId -->|...| nodeId` — IDs must be alphanumeric + underscore only
    const edgeLines = diagram.split("\n").filter((l) => l.includes("-->"));
    for (const line of edgeLines) {
      const idMatch = /(\w+)\s+-->/.exec(line);
      if (idMatch) expect(idMatch[1]).toMatch(/^[a-zA-Z0-9_]+$/);
    }
  });

  it("returns a valid diagram for zero spans", () => {
    const graph = buildGraph([]);
    const diagram = buildMermaidDiagram(graph);
    expect(diagram).toMatch(/^flowchart LR/);
    expect(nodeDefinitionLines(diagram)).toHaveLength(0);
    expect(diagram).not.toContain("-->");
  });
});

describe("buildGraph", () => {
  it("aggregates duration stats per node", () => {
    const spans = [
      makeSpan({ timing: { started_at: 0, duration_ms: 10 } }),
      makeSpan({ timing: { started_at: 0, duration_ms: 30 } }),
      makeSpan({ timing: { started_at: 0, duration_ms: 20 } }),
    ];
    const graph = buildGraph(spans);
    expect(graph.nodes).toHaveLength(1);
    const node = graph.nodes[0]!;
    expect(node.callCount).toBe(3);
    expect(node.avgDurationMs).toBe(20);
  });

  it("preserves raw spans on the graph object", () => {
    const spans = [makeSpan(), makeSpan()];
    const graph = buildGraph(spans);
    expect(graph.spans).toHaveLength(2);
  });

  it("detects cross-agent distributed spans", () => {
    const spans = [
      makeSpan({ source: { agent_id: "frontend", language: "js", file: "f.ts", line: 1, function_name: "click" } }),
      makeSpan({ source: { agent_id: "backend", language: "python", file: "b.py", line: 1, function_name: "handle" } }),
    ];
    const graph = buildGraph(spans);
    expect(graph.agents).toContain("frontend");
    expect(graph.agents).toContain("backend");
  });
});
