import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { buildGraph } from "../src/graph.js";
import { buildMarkdownDoc } from "../src/markdown.js";
import { syncToObsidian } from "../src/obsidian.js";
import { makeSpan } from "./fixtures.js";

const tmpDir = path.join(os.tmpdir(), `ghost-doc-test-${process.pid}`);

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("full export pipeline: spans → markdown file", () => {
  it("writes a valid markdown file with mermaid block and function table", async () => {
    const spans = [
      makeSpan({
        span_id: "p1",
        source: { agent_id: "api", language: "js", file: "src/routes.ts", line: 12, function_name: "handleRequest" },
        timing: { started_at: Date.now(), duration_ms: 55 },
      }),
      makeSpan({
        span_id: "c1",
        parent_span_id: "p1",
        source: { agent_id: "api", language: "js", file: "src/db.ts", line: 34, function_name: "queryDB" },
        timing: { started_at: Date.now(), duration_ms: 20 },
      }),
      makeSpan({
        source: { agent_id: "api", language: "js", file: "src/db.ts", line: 34, function_name: "queryDB" },
        timing: { started_at: Date.now(), duration_ms: 30 },
        anomaly: true,
      }),
    ];

    const graph = buildGraph(spans);
    const md = buildMarkdownDoc(graph, "TestApp");

    // Has title
    expect(md).toContain("# Ghost Doc — TestApp Flow Documentation");
    // Has mermaid block
    expect(md).toContain("```mermaid");
    expect(md).toContain("flowchart LR");
    // Has function index table
    expect(md).toContain("## Function Index");
    expect(md).toContain("handleRequest");
    expect(md).toContain("queryDB");
    // Has anomalies section because queryDB has anomaly=true
    expect(md).toContain("## Anomalies");
    // Has generated-by footer
    expect(md).toContain("Ghost Doc");
  });

  it("omits the anomalies section when there are none", () => {
    const graph = buildGraph([makeSpan()]);
    const md = buildMarkdownDoc(graph, "Clean");
    expect(md).not.toContain("## Anomalies");
  });
});

describe("Obsidian sync", () => {
  it("writes markdown into Ghost-Doc/<project>.md inside the vault", async () => {
    const spans = [
      makeSpan({ source: { agent_id: "svc", language: "js", file: "a.ts", line: 1, function_name: "fn" } }),
    ];
    const graph = buildGraph(spans);

    const filePath = await syncToObsidian(graph, {
      vaultPath: tmpDir,
      projectName: "MyVaultProject",
    });

    expect(filePath).toBe(path.join(tmpDir, "Ghost-Doc", "MyVaultProject.md"));

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain("# Ghost Doc — MyVaultProject Flow Documentation");
    expect(content).toContain("fn");
  });

  it("overwrites existing file on re-run", async () => {
    const graph = buildGraph([makeSpan()]);
    await syncToObsidian(graph, { vaultPath: tmpDir, projectName: "Proj" });
    await syncToObsidian(graph, { vaultPath: tmpDir, projectName: "Proj" });

    const files = await fs.readdir(path.join(tmpDir, "Ghost-Doc"));
    expect(files).toHaveLength(1);
  });
});
