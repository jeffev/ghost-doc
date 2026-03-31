import { buildMermaidDiagram } from "./mermaid.js";
import type { ExportGraph, SpanInput } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

function durationLabel(ms: number): string {
  if (ms < 1) return `${Math.round(ms * 1000)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function relativePath(filePath: string, rootPath: string | undefined): string {
  if (!rootPath) return filePath;
  const normalRoot = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalFile = filePath.replace(/\\/g, "/");
  if (normalFile.startsWith(normalRoot + "/")) {
    return normalFile.slice(normalRoot.length + 1);
  }
  return normalFile;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface MarkdownDocOptions {
  /** Workspace root for relative file paths. Typically `process.cwd()`. */
  rootPath?: string;
  /** Max number of call chains to show. Default: 8 */
  maxChains?: number;
  /** Max number of error examples to show. Default: 5 */
  maxErrors?: number;
}

// ---------------------------------------------------------------------------
// Performance section
// ---------------------------------------------------------------------------

function buildPerformanceSection(graph: ExportGraph): string[] {
  const lines: string[] = [];

  const totalTime = graph.nodes.reduce((sum, n) => sum + n.avgDurationMs * n.callCount, 0);

  const ranked = [...graph.nodes]
    .sort((a, b) => b.avgDurationMs * b.callCount - a.avgDurationMs * a.callCount)
    .slice(0, 10);

  lines.push("## Performance");
  lines.push("");
  lines.push(`> Total observed CPU-time across all calls: **${durationLabel(totalTime)}**`);
  lines.push("");
  lines.push("### Slowest Functions (avg latency)");
  lines.push("");
  lines.push("| # | Function | Avg | P95 | Calls | Time Share |");
  lines.push("| ---: | :--- | ---: | ---: | ---: | ---: |");

  const slowest = [...graph.nodes].sort((a, b) => b.avgDurationMs - a.avgDurationMs).slice(0, 8);
  slowest.forEach((node, i) => {
    const share = totalTime > 0 ? ((node.avgDurationMs * node.callCount) / totalTime) * 100 : 0;
    lines.push(
      `| ${i + 1} | ${node.functionName} | ${durationLabel(node.avgDurationMs)} | ${durationLabel(node.p95DurationMs)} | ${node.callCount} | ${share.toFixed(1)}% |`,
    );
  });

  lines.push("");
  lines.push("### Highest Total Time (avg × calls)");
  lines.push("");
  lines.push("| # | Function | Total Time | Calls | Avg |");
  lines.push("| ---: | :--- | ---: | ---: | ---: |");

  ranked.slice(0, 8).forEach((node, i) => {
    const total = node.avgDurationMs * node.callCount;
    lines.push(
      `| ${i + 1} | ${node.functionName} | ${durationLabel(total)} | ${node.callCount} | ${durationLabel(node.avgDurationMs)} |`,
    );
  });

  lines.push("");
  return lines;
}

// ---------------------------------------------------------------------------
// Call chains section
// ---------------------------------------------------------------------------

interface ChainNode {
  functionName: string;
  durationMs: number;
  children: ChainNode[];
}

function buildSpanTree(rootSpan: SpanInput, byParent: Map<string, SpanInput[]>): ChainNode {
  const children = (byParent.get(rootSpan.span_id) ?? []).map((child) =>
    buildSpanTree(child, byParent),
  );
  return {
    functionName: rootSpan.source.function_name,
    durationMs: rootSpan.timing.duration_ms,
    children,
  };
}

function chainToString(node: ChainNode, depth = 0): string {
  const indent = "  ".repeat(depth);
  const prefix = depth === 0 ? "" : `${indent}└─ `;
  const line = `${prefix}**${node.functionName}** *(${durationLabel(node.durationMs)})*`;
  const childLines = node.children.map((c) => chainToString(c, depth + 1));
  return [line, ...childLines].join("\n");
}

function chainDepth(node: ChainNode): number {
  if (node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map(chainDepth));
}

function buildCallChainsSection(spans: SpanInput[], maxChains: number): string[] {
  const lines: string[] = [];

  // Build parent → children index
  const byParent = new Map<string, SpanInput[]>();
  for (const span of spans) {
    if (span.parent_span_id !== null) {
      const siblings = byParent.get(span.parent_span_id);
      if (siblings !== undefined) {
        siblings.push(span);
      } else {
        byParent.set(span.parent_span_id, [span]);
      }
    }
  }

  // Root spans = spans with no parent (or parent not in this set)
  const spanIds = new Set(spans.map((s) => s.span_id));
  const roots = spans.filter((s) => s.parent_span_id === null || !spanIds.has(s.parent_span_id));

  // Keep only roots that have children (otherwise they're uninteresting single calls)
  const trees = roots
    .filter((r) => (byParent.get(r.span_id)?.length ?? 0) > 0)
    .map((r) => buildSpanTree(r, byParent))
    .sort((a, b) => chainDepth(b) - chainDepth(a) || b.durationMs - a.durationMs)
    .slice(0, maxChains);

  if (trees.length === 0) return lines;

  lines.push("## Call Chains");
  lines.push("");
  lines.push(
    `> Showing the ${trees.length} deepest traced call chains observed during this session.`,
  );
  lines.push("");

  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i]!;
    lines.push(
      `### Chain ${i + 1} — ${tree.functionName} *(${durationLabel(tree.durationMs)} total)*`,
    );
    lines.push("");
    lines.push("```");
    lines.push(chainToString(tree));
    lines.push("```");
    lines.push("");
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Error details section
// ---------------------------------------------------------------------------

function buildErrorDetailsSection(
  spans: SpanInput[],
  maxErrors: number,
  rootPath?: string,
): string[] {
  const lines: string[] = [];

  const errorSpans = spans
    .filter((s) => s.error !== null)
    .sort((a, b) => (b.received_at ?? 0) - (a.received_at ?? 0))
    .slice(0, maxErrors);

  if (errorSpans.length === 0) return lines;

  const rel = (p: string) => relativePath(p, rootPath);

  lines.push("## Error Details");
  lines.push("");
  lines.push(
    `> ${errorSpans.length} error${errorSpans.length !== 1 ? "s" : ""} captured. Showing the ${errorSpans.length} most recent.`,
  );
  lines.push("");

  for (const span of errorSpans) {
    const err = span.error!;
    const loc = `${rel(span.source.file)}:${span.source.line}`;
    lines.push(`### \`${span.source.function_name}\` — ${err.type}`);
    lines.push("");
    lines.push(`- **Location:** \`${loc}\``);
    lines.push(`- **Agent:** ${span.source.agent_id}`);
    lines.push(`- **Duration:** ${durationLabel(span.timing.duration_ms)}`);
    lines.push(`- **Message:** ${err.message}`);
    if (err.stack) {
      lines.push("");
      lines.push("```");
      // Show only the first 6 lines of the stack to keep the doc readable
      lines.push(err.stack.split("\n").slice(0, 6).join("\n"));
      lines.push("```");
    }
    lines.push("");
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Markdown document builder
// ---------------------------------------------------------------------------

/**
 * Generates a complete Markdown document from an ExportGraph.
 *
 * Sections:
 *   1. Header (metadata summary)
 *   2. Flow Diagram (Mermaid — grouped by service subgraph)
 *   3. Performance (slowest functions + highest total time)
 *   4. Call Chains (deepest traced paths reconstructed from span trees)
 *   5. Function Index (full table with durations, relative paths)
 *   6. Anomalies (when present)
 *   7. Error Details (actual error messages + stack traces)
 */
export function buildMarkdownDoc(
  graph: ExportGraph,
  projectName = "Project",
  options: MarkdownDocOptions = {},
): string {
  const { rootPath, maxChains = 8, maxErrors = 5 } = options;
  const sections: string[] = [];
  const rel = (p: string) => relativePath(p, rootPath);

  // ── Header ──────────────────────────────────────────────────────────────
  sections.push(`# Ghost Doc — ${projectName} Flow Documentation`);
  sections.push("");
  sections.push(`> **Generated:** ${isoTimestamp(graph.generatedAt)}  `);
  sections.push(`> **Agents:** ${graph.agents.join(", ") || "none"}  `);
  sections.push(`> **Total spans:** ${graph.totalSpans}  `);
  sections.push(`> **Functions:** ${graph.nodes.length}  `);
  if (graph.anomalyCount > 0) sections.push(`> **Anomalies detected:** ${graph.anomalyCount}  `);
  if (graph.errorCount > 0) sections.push(`> **Functions with errors:** ${graph.errorCount}  `);
  sections.push("");

  // ── Flow Diagram ─────────────────────────────────────────────────────────
  sections.push("## Flow Diagram");
  sections.push("");
  sections.push("```mermaid");
  sections.push(buildMermaidDiagram(graph));
  sections.push("```");
  sections.push("");

  // ── Performance ───────────────────────────────────────────────────────────
  sections.push(...buildPerformanceSection(graph));

  // ── Call Chains ───────────────────────────────────────────────────────────
  sections.push(...buildCallChainsSection(graph.spans, maxChains));

  // ── Function Index ────────────────────────────────────────────────────────
  sections.push("## Function Index");
  sections.push("");

  const sorted = [...graph.nodes].sort(
    (a, b) => a.agentId.localeCompare(b.agentId) || a.functionName.localeCompare(b.functionName),
  );

  const hasDescriptions = sorted.some((n) => n.description);
  if (hasDescriptions) {
    sections.push("| Function | Description | Agent | File | Avg | P95 | Calls |");
    sections.push("| :--- | :--- | :--- | :--- | ---: | ---: | ---: |");
  } else {
    sections.push("| Function | Agent | File | Avg | P95 | Calls |");
    sections.push("| :--- | :--- | :--- | ---: | ---: | ---: |");
  }

  for (const node of sorted) {
    const flags = [node.hasAnomaly ? "⚠ anomaly" : "", node.hasError ? "✗ error" : ""]
      .filter(Boolean)
      .join(", ");
    const nameCell = flags ? `${node.functionName} *(${flags})*` : node.functionName;
    if (hasDescriptions) {
      sections.push(
        `| ${nameCell} | ${node.description ?? ""} | ${node.agentId} | \`${rel(node.file)}:${node.line}\` | ${durationLabel(node.avgDurationMs)} | ${durationLabel(node.p95DurationMs)} | ${node.callCount} |`,
      );
    } else {
      sections.push(
        `| ${nameCell} | ${node.agentId} | \`${rel(node.file)}:${node.line}\` | ${durationLabel(node.avgDurationMs)} | ${durationLabel(node.p95DurationMs)} | ${node.callCount} |`,
      );
    }
  }

  sections.push("");

  // ── Anomalies ─────────────────────────────────────────────────────────────
  const anomalies = graph.nodes.filter((n) => n.hasAnomaly);
  if (anomalies.length > 0) {
    sections.push("## Anomalies");
    sections.push("");
    sections.push("> Ghost Doc detected return-type changes for the following functions.");
    sections.push("");
    sections.push("| Function | Agent | File |");
    sections.push("| :--- | :--- | :--- |");
    for (const node of anomalies) {
      sections.push(
        `| ${node.functionName} | ${node.agentId} | \`${rel(node.file)}:${node.line}\` |`,
      );
    }
    sections.push("");
  }

  // ── Error Details ─────────────────────────────────────────────────────────
  sections.push(...buildErrorDetailsSection(graph.spans, maxErrors, rootPath));

  sections.push("---");
  sections.push("");
  sections.push("*Generated by [Ghost Doc](https://github.com/ghost-doc/ghost-doc)*");

  return sections.join("\n");
}
