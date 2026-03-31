import type {
  StoredSpan,
  GraphData,
  GraphNode,
  GraphEdge,
  FilterState,
  GraphDiff,
  NodeDiffStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Incremental graph accumulator
// ---------------------------------------------------------------------------

/**
 * Mutable accumulator state used for incremental graph updates.
 * Maintained by the store between span arrivals so we avoid O(n) full rebuilds.
 */
export interface GraphAccumulators {
  nodeMap: Map<string, NodeAccumulator>;
  edgeMap: Map<string, EdgeAccumulator>;
  spanToNode: Map<string, string>;
}

/** Create empty accumulators (used on clear / snapshot load). */
export function emptyAccumulators(): GraphAccumulators {
  return { nodeMap: new Map(), edgeMap: new Map(), spanToNode: new Map() };
}

/**
 * Incorporate a single new span into existing accumulators and return
 * an updated GraphData without iterating the full span list.
 *
 * Only valid in live mode (no time-travel, no groupBy) — callers must
 * fall back to `buildGraphData` when those conditions are active.
 */
export function applySpanIncremental(
  span: StoredSpan,
  accs: GraphAccumulators,
  prevGraph: GraphData,
): GraphData {
  const { nodeMap, edgeMap, spanToNode } = accs;
  const nodeId = `${span.source.agent_id}:${span.source.function_name}`;
  spanToNode.set(span.span_id, nodeId);

  // ── Update or create the node accumulator ───────────────────────────────
  let nodeAcc = nodeMap.get(nodeId);
  const isNewNode = nodeAcc === undefined;
  if (nodeAcc === undefined) {
    nodeAcc = {
      id: nodeId,
      functionName: span.source.function_name,
      agentId: span.source.agent_id,
      file: span.source.file,
      ...(span.source.description !== undefined && { description: span.source.description }),
      callCount: 0,
      durations: [],
      hasAnomaly: false,
      hasError: false,
      latestSpan: span,
    };
    nodeMap.set(nodeId, nodeAcc);
  }

  nodeAcc.callCount++;
  nodeAcc.durations.push(span.timing.duration_ms);
  if (span.anomaly) nodeAcc.hasAnomaly = true;
  if (span.error !== null) nodeAcc.hasError = true;
  if (span.received_at > nodeAcc.latestSpan.received_at) nodeAcc.latestSpan = span;

  // ── Update or create the edge accumulator ───────────────────────────────
  let isNewEdge = false;
  let edgeKey: string | null = null;
  if (span.parent_span_id !== null) {
    const parentNodeId = spanToNode.get(span.parent_span_id);
    if (parentNodeId !== undefined && parentNodeId !== nodeId) {
      edgeKey = `${parentNodeId}->${nodeId}`;
      let edgeAcc = edgeMap.get(edgeKey);
      if (edgeAcc === undefined) {
        isNewEdge = true;
        edgeAcc = {
          id: edgeKey,
          source: parentNodeId,
          target: nodeId,
          callCount: 0,
          durations: [],
        };
        edgeMap.set(edgeKey, edgeAcc);
      }
      edgeAcc.callCount++;
      edgeAcc.durations.push(span.timing.duration_ms);
    }
  }

  // ── Recompute isSlow across all nodes (only if node count ≥ 5) ───────────
  const allAvgs = [...nodeMap.values()].map((n) => avg(n.durations));
  const globalP95 = nodeMap.size >= 5 ? p95(allAvgs) : Infinity;

  // ── Build updated node list ───────────────────────────────────────────────
  let nodes: GraphNode[];
  if (isNewNode) {
    // New node: add it and recompute isSlow for all nodes (threshold changed)
    nodes = [...nodeMap.values()].map((n) => accToNode(n, globalP95));
  } else {
    // Existing node: patch only the updated node in place
    nodes = prevGraph.nodes.map((n) =>
      n.id === nodeId
        ? accToNode(nodeAcc!, globalP95)
        : { ...n, isSlow: n.avgDurationMs >= globalP95 },
    );
  }

  // ── Build updated edge list ───────────────────────────────────────────────
  let edges: GraphEdge[];
  if (isNewEdge && edgeKey !== null) {
    const newEdgeAcc = edgeMap.get(edgeKey)!;
    edges = [
      ...prevGraph.edges,
      {
        id: newEdgeAcc.id,
        source: newEdgeAcc.source,
        target: newEdgeAcc.target,
        callCount: newEdgeAcc.callCount,
        avgDurationMs: avg(newEdgeAcc.durations),
      },
    ];
  } else if (edgeKey !== null) {
    // Update existing edge in place
    const updatedEdgeAcc = edgeMap.get(edgeKey)!;
    edges = prevGraph.edges.map((e) =>
      e.id === edgeKey
        ? {
            ...e,
            callCount: updatedEdgeAcc.callCount,
            avgDurationMs: avg(updatedEdgeAcc.durations),
          }
        : e,
    );
  } else {
    edges = prevGraph.edges;
  }

  return { nodes, edges };
}

function accToNode(acc: NodeAccumulator, globalP95: number): GraphNode {
  const avgMs = avg(acc.durations);
  return {
    id: acc.id,
    functionName: acc.functionName,
    agentId: acc.agentId,
    file: acc.file,
    ...(acc.description !== undefined && { description: acc.description }),
    callCount: acc.callCount,
    avgDurationMs: avgMs,
    p95DurationMs: p95(acc.durations),
    hasAnomaly: acc.hasAnomaly,
    hasError: acc.hasError,
    isSlow: avgMs >= globalP95,
    latestSpan: acc.latestSpan,
  };
}

/**
 * Derives a `GraphData` (nodes + edges) from a flat list of spans.
 *
 * Each unique `(agent_id, function_name)` pair becomes one node.
 * A parent→child span relationship becomes a directed edge.
 *
 * When `groupBy` is "agent" or "file", individual function nodes are collapsed
 * into group nodes; only cross-group edges are retained.
 *
 * Designed to be called whenever the span list changes; it rebuilds the graph
 * from scratch (cheap enough for ≤10k spans in a browser context).
 */
export function buildGraphData(
  spans: StoredSpan[],
  groupBy: FilterState["groupBy"] = "none",
): GraphData {
  const nodeMap = new Map<string, NodeAccumulator>();
  const edgeMap = new Map<string, EdgeAccumulator>();
  // Map span_id → node_id so we can resolve parent→child edges.
  const spanToNode = new Map<string, string>();

  for (const span of spans) {
    const nodeId = `${span.source.agent_id}:${span.source.function_name}`;
    spanToNode.set(span.span_id, nodeId);

    let acc = nodeMap.get(nodeId);
    if (acc === undefined) {
      acc = {
        id: nodeId,
        functionName: span.source.function_name,
        agentId: span.source.agent_id,
        file: span.source.file,
        ...(span.source.description !== undefined && { description: span.source.description }),
        callCount: 0,
        durations: [],
        hasAnomaly: false,
        hasError: false,
        latestSpan: span,
      };
      nodeMap.set(nodeId, acc);
    }

    acc.callCount++;
    acc.durations.push(span.timing.duration_ms);
    if (span.anomaly) acc.hasAnomaly = true;
    if (span.error !== null) acc.hasError = true;
    if (span.received_at > acc.latestSpan.received_at) {
      acc.latestSpan = span;
    }
  }

  // Build edges from parent_span_id relationships.
  for (const span of spans) {
    if (span.parent_span_id === null) continue;
    const parentNodeId = spanToNode.get(span.parent_span_id);
    const childNodeId = spanToNode.get(span.span_id);
    if (parentNodeId === undefined || childNodeId === undefined) continue;
    if (parentNodeId === childNodeId) continue; // skip self-loops

    const edgeId = `${parentNodeId}->${childNodeId}`;
    let edgeAcc = edgeMap.get(edgeId);
    if (edgeAcc === undefined) {
      edgeAcc = {
        id: edgeId,
        source: parentNodeId,
        target: childNodeId,
        callCount: 0,
        durations: [],
      };
      edgeMap.set(edgeId, edgeAcc);
    }
    edgeAcc.callCount++;
    edgeAcc.durations.push(span.timing.duration_ms);
  }

  // Build nodes with per-node stats.
  const rawNodes = [...nodeMap.values()].map((acc) => ({
    id: acc.id,
    functionName: acc.functionName,
    agentId: acc.agentId,
    file: acc.file,
    ...(acc.description !== undefined && { description: acc.description }),
    callCount: acc.callCount,
    avgDurationMs: avg(acc.durations),
    p95DurationMs: p95(acc.durations),
    hasAnomaly: acc.hasAnomaly,
    hasError: acc.hasError,
    latestSpan: acc.latestSpan,
  }));

  // A node is "slow" when its avg duration exceeds the P95 of all node averages
  // (requires at least 5 nodes so that the threshold is meaningful).
  const allAvgs = rawNodes.map((n) => n.avgDurationMs);
  const globalP95 = rawNodes.length >= 5 ? p95(allAvgs) : Infinity;

  const nodes: GraphNode[] = rawNodes.map((n) => ({
    ...n,
    isSlow: n.avgDurationMs >= globalP95,
  }));

  const edges: GraphEdge[] = [...edgeMap.values()].map((acc) => ({
    id: acc.id,
    source: acc.source,
    target: acc.target,
    callCount: acc.callCount,
    avgDurationMs: avg(acc.durations),
  }));

  if (groupBy === "none") {
    return { nodes, edges };
  }

  return collapseGroups(nodes, edges, groupBy);
}

// ---------------------------------------------------------------------------
// Group collapsing
// ---------------------------------------------------------------------------

/**
 * Collapses individual function nodes into group nodes.
 * The group key is determined by `groupBy`:
 *   - "agent" → group by agentId
 *   - "file"  → group by file path
 *
 * Cross-group edges are retained; within-group edges are dropped.
 */
function collapseGroups(
  nodes: GraphNode[],
  edges: GraphEdge[],
  groupBy: "agent" | "file",
): GraphData {
  // Map: nodeId → groupId
  const nodeToGroup = new Map<string, string>();
  // Map: groupId → accumulated group node data
  const groupMap = new Map<
    string,
    {
      id: string;
      label: string;
      nodeIds: string[];
      callCount: number;
      durations: number[];
      hasAnomaly: boolean;
      hasError: boolean;
      isSlow: boolean;
      latestSpan: GraphNode["latestSpan"];
      agentId: string;
      file: string;
    }
  >();

  for (const node of nodes) {
    const groupId = groupBy === "agent" ? `group:agent:${node.agentId}` : `group:file:${node.file}`;
    const label = groupBy === "agent" ? node.agentId : (node.file.split("/").pop() ?? node.file);

    nodeToGroup.set(node.id, groupId);

    let grp = groupMap.get(groupId);
    if (grp === undefined) {
      grp = {
        id: groupId,
        label,
        nodeIds: [],
        callCount: 0,
        durations: [],
        hasAnomaly: false,
        hasError: false,
        isSlow: false,
        latestSpan: node.latestSpan,
        agentId: node.agentId,
        file: node.file,
      };
      groupMap.set(groupId, grp);
    }

    grp.nodeIds.push(node.id);
    grp.callCount += node.callCount;
    grp.durations.push(node.avgDurationMs);
    if (node.hasAnomaly) grp.hasAnomaly = true;
    if (node.hasError) grp.hasError = true;
    if (node.isSlow) grp.isSlow = true;
    if (node.latestSpan.received_at > grp.latestSpan.received_at) {
      grp.latestSpan = node.latestSpan;
    }
  }

  // Build group GraphNodes.
  const groupNodes: GraphNode[] = [...groupMap.values()].map((grp) => ({
    id: grp.id,
    functionName: `${grp.label} (${grp.nodeIds.length} fn${grp.nodeIds.length !== 1 ? "s" : ""})`,
    agentId: grp.agentId,
    file: grp.file,
    callCount: grp.callCount,
    avgDurationMs: avg(grp.durations),
    p95DurationMs: p95(grp.durations),
    hasAnomaly: grp.hasAnomaly,
    hasError: grp.hasError,
    isSlow: grp.isSlow,
    latestSpan: grp.latestSpan,
  }));

  // Deduplicate cross-group edges.
  const groupEdgeMap = new Map<string, EdgeAccumulator>();
  for (const edge of edges) {
    const srcGroup = nodeToGroup.get(edge.source);
    const tgtGroup = nodeToGroup.get(edge.target);
    if (srcGroup === undefined || tgtGroup === undefined) continue;
    if (srcGroup === tgtGroup) continue; // skip within-group edges

    const edgeId = `${srcGroup}->${tgtGroup}`;
    let acc = groupEdgeMap.get(edgeId);
    if (acc === undefined) {
      acc = { id: edgeId, source: srcGroup, target: tgtGroup, callCount: 0, durations: [] };
      groupEdgeMap.set(edgeId, acc);
    }
    acc.callCount += edge.callCount;
    acc.durations.push(edge.avgDurationMs);
  }

  const groupEdges: GraphEdge[] = [...groupEdgeMap.values()].map((acc) => ({
    id: acc.id,
    source: acc.source,
    target: acc.target,
    callCount: acc.callCount,
    avgDurationMs: avg(acc.durations),
  }));

  return { nodes: groupNodes, edges: groupEdges };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

interface NodeAccumulator {
  id: string;
  functionName: string;
  agentId: string;
  file: string;
  description?: string;
  callCount: number;
  durations: number[];
  hasAnomaly: boolean;
  hasError: boolean;
  latestSpan: StoredSpan;
}

interface EdgeAccumulator {
  id: string;
  source: string;
  target: string;
  callCount: number;
  durations: number[];
}

// ---------------------------------------------------------------------------
// Snapshot diff
// ---------------------------------------------------------------------------

/**
 * Computes a visual diff between a base graph (old snapshot) and the current graph.
 *
 * - `added`    — node exists in `current` but not in `base`
 * - `removed`  — node exists in `base` but not in `current` (counted but not rendered)
 * - `slower`   — avg duration increased >10% relative to `base`
 * - `faster`   — avg duration dropped >10% relative to `base`
 * - `unchanged`— within ±10% of base duration
 */
export function computeGraphDiff(base: GraphData, current: GraphData): GraphDiff {
  const nodeStatus = new Map<string, NodeDiffStatus>();
  const durationDeltaPct = new Map<string, number>();

  const baseMap = new Map(base.nodes.map((n) => [n.id, n]));
  const currentIds = new Set(current.nodes.map((n) => n.id));

  for (const node of current.nodes) {
    const baseNode = baseMap.get(node.id);
    if (baseNode === undefined) {
      nodeStatus.set(node.id, "added");
      durationDeltaPct.set(node.id, 0);
    } else {
      const deltaPct =
        baseNode.avgDurationMs > 0
          ? ((node.avgDurationMs - baseNode.avgDurationMs) / baseNode.avgDurationMs) * 100
          : 0;
      durationDeltaPct.set(node.id, deltaPct);
      nodeStatus.set(node.id, deltaPct > 10 ? "slower" : deltaPct < -10 ? "faster" : "unchanged");
    }
  }

  let removedCount = 0;
  for (const node of base.nodes) {
    if (!currentIds.has(node.id)) {
      removedCount++;
    }
  }

  return { nodeStatus, durationDeltaPct, removedCount };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}
