import type { ExportGraph, ExportNode } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Extracts the service/group name from a function name.
 *   "UserService.getUser"   → "UserService"
 *   "handleCheckout"        → "Handlers"
 *   "fetchUser"             → "Other"
 */
function serviceGroup(functionName: string): string {
  const dot = functionName.indexOf(".");
  if (dot > 0) return functionName.slice(0, dot);
  // Top-level handlers: starts with lowercase "handle", "process", etc.
  if (/^handle[A-Z]/.test(functionName) || /^process[A-Z]/.test(functionName)) return "Handlers";
  return "Other";
}

function nodeLabel(node: ExportNode): string {
  const baseName = node.functionName.includes(".")
    ? node.functionName.split(".").slice(1).join(".") // strip "ServiceName." prefix inside subgraph
    : node.functionName;
  const icons: string[] = [];
  if (node.hasError) icons.push("ERR");
  if (node.hasAnomaly) icons.push("ANOMALY");
  const suffix = icons.length > 0 ? `\\n[${icons.join(",")}]` : "";
  return `"${baseName}\\n${node.avgDurationMs}ms avg${suffix}"`;
}

function nodeClass(node: ExportNode): string {
  if (node.hasError) return ":::errorNode";
  if (node.hasAnomaly) return ":::anomalyNode";
  return "";
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Converts an ExportGraph to a Mermaid `flowchart LR` diagram with subgraphs.
 *
 * Nodes are grouped by service class (extracted from the function name prefix).
 * Anomalous nodes get a red border; error nodes get a red fill.
 * Edge labels show average duration.
 */
export function buildMermaidDiagram(graph: ExportGraph): string {
  const lines: string[] = ["flowchart LR"];

  // Class definitions
  lines.push("  classDef anomalyNode stroke:#e53e3e,stroke-width:3px");
  lines.push("  classDef errorNode fill:#e53e3e,color:#fff,stroke:#c53030");
  lines.push("  classDef handlerNode fill:#2b6cb0,color:#fff,stroke:#2c5282");
  lines.push("");

  // Group nodes by service
  const groups = new Map<string, ExportNode[]>();
  for (const node of graph.nodes) {
    const group = serviceGroup(node.functionName);
    const existing = groups.get(group);
    if (existing !== undefined) {
      existing.push(node);
    } else {
      groups.set(group, [node]);
    }
  }

  // Emit subgraphs — Handlers first, then alphabetical
  const groupOrder = [...groups.keys()].sort((a, b) => {
    if (a === "Handlers") return -1;
    if (b === "Handlers") return 1;
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });

  for (const group of groupOrder) {
    const nodes = groups.get(group)!;
    const subId = safeMermaidId(group);
    lines.push(`  subgraph ${subId}["${group}"]`);
    for (const node of nodes) {
      const mid = safeMermaidId(node.id);
      let styleClass = nodeClass(node);
      if (group === "Handlers" && styleClass === "") styleClass = ":::handlerNode";
      lines.push(`    ${mid}[${nodeLabel(node)}]${styleClass}`);
    }
    lines.push("  end");
    lines.push("");
  }

  // Edges (outside subgraphs)
  for (const edge of graph.edges) {
    const fromMid = safeMermaidId(edge.fromId);
    const toMid = safeMermaidId(edge.toId);
    const label = `${edge.avgDurationMs}ms`;
    lines.push(`  ${fromMid} -->|"${label}"| ${toMid}`);
  }

  return lines.join("\n");
}
