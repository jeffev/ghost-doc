import type { TraceEvent } from "@ghost-doc/shared-types";

// ---------------------------------------------------------------------------
// StoredSpan — mirrors the Hub's StoredSpan shape
// ---------------------------------------------------------------------------

export interface StoredSpan extends TraceEvent {
  received_at: number;
  anomaly: boolean;
  distributed: boolean;
}

// ---------------------------------------------------------------------------
// Graph representation (derived from spans)
// ---------------------------------------------------------------------------

export interface GraphNode {
  /** Unique key: `"<agent_id>:<function_name>"` */
  id: string;
  functionName: string;
  agentId: string;
  /** File path where the function lives */
  file: string;
  /** Optional human-readable description from docstring or @trace option */
  description?: string;
  /** Total number of recorded calls */
  callCount: number;
  /** Average duration across all calls (ms) */
  avgDurationMs: number;
  /** P95 duration across all calls (ms) */
  p95DurationMs: number;
  /** Whether any call was flagged anomalous */
  hasAnomaly: boolean;
  /** Whether any call threw an error */
  hasError: boolean;
  /**
   * Whether this node's average duration is in the top 5% across the visible graph.
   * Used to render the orange "slow" border.
   */
  isSlow: boolean;
  /** Most recent span for this node */
  latestSpan: StoredSpan;
  /** x/y set by D3 during simulation */
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  /** Unique key: `"<sourceNodeId>-><targetNodeId>"` */
  id: string;
  source: string; // GraphNode.id of caller
  target: string; // GraphNode.id of callee
  callCount: number;
  avgDurationMs: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Time-travel
// ---------------------------------------------------------------------------

export type PlaybackSpeed = 0.5 | 1 | 2 | 10;

export type ViewMode = "flowchart" | "flamegraph";

export interface TimeTravelState {
  /** null = live mode */
  seekTs: number | null;
  isPlaying: boolean;
  playbackSpeed: PlaybackSpeed;
}

// ---------------------------------------------------------------------------
// Snapshot comparison / diff
// ---------------------------------------------------------------------------

/**
 * Status of a node when diffing two snapshots.
 * - added:     present in current graph, absent in base snapshot
 * - removed:   present in base snapshot, absent in current graph
 * - faster:    avg duration dropped >10% relative to base
 * - slower:    avg duration increased >10% relative to base
 * - unchanged: within ±10% of base duration
 */
export type NodeDiffStatus = "added" | "removed" | "faster" | "slower" | "unchanged";

export interface GraphDiff {
  /** node ID → diff status */
  nodeStatus: Map<string, NodeDiffStatus>;
  /** node ID → % change from base avg duration (+positive = slower) */
  durationDeltaPct: Map<string, number>;
  /** Count of nodes that exist in base but not in current */
  removedCount: number;
}

// ---------------------------------------------------------------------------
// Filter / search
// ---------------------------------------------------------------------------

export interface FilterState {
  agentId: string | null;
  functionName: string;
  tag: string;
  /**
   * Collapse nodes into groups by this dimension.
   * "none" = no grouping (default, shows individual function nodes).
   * "agent" = one node per agent, aggregating all its functions.
   * "file" = one node per source file, aggregating all functions within it.
   */
  groupBy: "none" | "agent" | "file";
}
