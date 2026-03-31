import type { SpanInput, ExportNode, ExportEdge, ExportGraph } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodeId(agentId: string, functionName: string): string {
  return `${agentId}::${functionName}`;
}

function p95(durations: number[]): number {
  if (durations.length === 0) return 0;
  const sorted = [...durations].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Converts a flat array of spans into an ExportGraph (nodes + edges).
 *
 * Node identity = `agentId::functionName` — all spans for the same function
 * from the same agent are merged into a single node with aggregated stats.
 *
 * Edge identity = `parentNodeId → childNodeId` — built by looking up each
 * span's parent_span_id to find the calling node.
 */
export function buildGraph(spans: SpanInput[]): ExportGraph {
  // Index spans by span_id for parent lookup
  const bySpanId = new Map<string, SpanInput>();
  for (const span of spans) {
    bySpanId.set(span.span_id, span);
  }

  // Accumulate per-node stats
  const nodeStats = new Map<
    string,
    {
      functionName: string;
      agentId: string;
      file: string;
      line: number;
      description?: string;
      durations: number[];
      hasAnomaly: boolean;
      hasError: boolean;
    }
  >();

  // Accumulate per-edge stats
  const edgeStats = new Map<string, { fromId: string; toId: string; durations: number[] }>();

  for (const span of spans) {
    const nid = nodeId(span.source.agent_id, span.source.function_name);

    // Node accumulation
    let node = nodeStats.get(nid);
    if (node === undefined) {
      node = {
        functionName: span.source.function_name,
        agentId: span.source.agent_id,
        file: span.source.file,
        line: span.source.line,
        ...(span.source.description !== undefined && { description: span.source.description }),
        durations: [],
        hasAnomaly: false,
        hasError: false,
      };
      nodeStats.set(nid, node);
    }
    node.durations.push(span.timing.duration_ms);
    if (span.anomaly) node.hasAnomaly = true;
    if (span.error !== null) node.hasError = true;

    // Edge accumulation (only when parent span is known)
    if (span.parent_span_id !== null) {
      const parent = bySpanId.get(span.parent_span_id);
      if (parent !== undefined) {
        const fromId = nodeId(parent.source.agent_id, parent.source.function_name);
        const toId = nid;
        const edgeKey = `${fromId}→${toId}`;
        let edge = edgeStats.get(edgeKey);
        if (edge === undefined) {
          edge = { fromId, toId, durations: [] };
          edgeStats.set(edgeKey, edge);
        }
        edge.durations.push(span.timing.duration_ms);
      }
    }
  }

  // Build final nodes
  const nodes: ExportNode[] = [];
  for (const [id, s] of nodeStats) {
    nodes.push({
      id,
      functionName: s.functionName,
      agentId: s.agentId,
      file: s.file,
      line: s.line,
      ...(s.description !== undefined && { description: s.description }),
      callCount: s.durations.length,
      avgDurationMs: Math.round(avg(s.durations) * 100) / 100,
      p95DurationMs: Math.round(p95(s.durations) * 100) / 100,
      hasAnomaly: s.hasAnomaly,
      hasError: s.hasError,
    });
  }

  // Build final edges
  const edges: ExportEdge[] = [];
  for (const e of edgeStats.values()) {
    edges.push({
      fromId: e.fromId,
      toId: e.toId,
      callCount: e.durations.length,
      avgDurationMs: Math.round(avg(e.durations) * 100) / 100,
    });
  }

  const agents = [...new Set(spans.map((s) => s.source.agent_id))];

  return {
    nodes,
    edges,
    agents,
    generatedAt: Date.now(),
    totalSpans: spans.length,
    anomalyCount: nodes.filter((n) => n.hasAnomaly).length,
    errorCount: nodes.filter((n) => n.hasError).length,
    spans,
  };
}
