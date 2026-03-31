import type { TraceEvent } from "@ghost-doc/shared-types";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/**
 * A TraceEvent that may carry Hub-enriched metadata (anomaly, distributed).
 * Matches `StoredSpan` from the Hub without creating a hard dependency on it.
 */
export interface SpanInput extends TraceEvent {
  anomaly?: boolean;
  distributed?: boolean;
  received_at?: number;
}

// ---------------------------------------------------------------------------
// Export graph types
// ---------------------------------------------------------------------------

export interface ExportNode {
  /** "<agentId>::<functionName>" — stable identifier across spans */
  id: string;
  functionName: string;
  agentId: string;
  file: string;
  line: number;
  /** Optional human-readable description (from docstring or explicit @trace option) */
  description?: string;
  callCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
  hasAnomaly: boolean;
  hasError: boolean;
}

export interface ExportEdge {
  fromId: string;
  toId: string;
  /** Number of times this caller → callee edge was observed */
  callCount: number;
  avgDurationMs: number;
}

export interface ExportGraph {
  nodes: ExportNode[];
  edges: ExportEdge[];
  /** Unique agent IDs present in the graph */
  agents: string[];
  /** Unix ms timestamp when the graph was built */
  generatedAt: number;
  totalSpans: number;
  anomalyCount: number;
  errorCount: number;
  /** Raw spans — kept for call-chain and error-detail sections */
  spans: SpanInput[];
}

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

export interface Snapshot {
  id: string;
  createdAt: number;
  agents: string[];
  spans: SpanInput[];
  tags: Record<string, string>;
}
