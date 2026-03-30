import type { TraceEvent } from "@ghost-doc/shared-types";

/** A TraceEvent enriched with Hub-side metadata. */
export interface StoredSpan extends TraceEvent {
  /** Unix ms timestamp when the Hub received this span. */
  received_at: number;
  /** True when the correlator detected an unexpected output type for this function. */
  anomaly: boolean;
  /** True when this span's trace_id is shared across more than one agent. */
  distributed: boolean;
}

/**
 * Fixed-capacity in-memory store for spans.
 *
 * Uses a circular/ring buffer (oldest entry evicted when full) and maintains
 * four secondary indexes for fast lookup by trace_id, span_id, agent_id, and
 * function_name.
 */
export class TraceStore {
  private readonly capacity: number;
  /** The ring buffer itself — slots may be undefined before first write or after eviction. */
  private readonly ring: (StoredSpan | undefined)[];
  /** Next write position in the ring. */
  private writePos = 0;
  /** Cumulative count of all spans ever added (monotonically increasing). */
  private total = 0;

  // Secondary indexes: key → Set of ring-buffer positions
  private readonly idxTraceId = new Map<string, Set<number>>();
  private readonly idxSpanId = new Map<string, number>();
  private readonly idxAgentId = new Map<string, Set<number>>();
  private readonly idxFunctionName = new Map<string, Set<number>>();

  constructor(capacity = 10_000) {
    this.capacity = capacity;
    this.ring = new Array<StoredSpan | undefined>(capacity).fill(undefined);
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  add(span: StoredSpan): void {
    const pos = this.writePos;
    const evicted = this.ring[pos];

    if (evicted !== undefined) {
      this.removeFromIndexes(evicted, pos);
    }

    this.ring[pos] = span;
    this.addToIndexes(span, pos);

    this.writePos = (this.writePos + 1) % this.capacity;
    this.total++;
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  getByTraceId(traceId: string): StoredSpan[] {
    const positions = this.idxTraceId.get(traceId);
    if (positions === undefined) return [];
    return this.resolvePositions(positions, (s) => s.trace_id === traceId);
  }

  getBySpanId(spanId: string): StoredSpan | undefined {
    const pos = this.idxSpanId.get(spanId);
    if (pos === undefined) return undefined;
    const span = this.ring[pos];
    return span?.span_id === spanId ? span : undefined;
  }

  getByAgentId(agentId: string): StoredSpan[] {
    const positions = this.idxAgentId.get(agentId);
    if (positions === undefined) return [];
    return this.resolvePositions(positions, (s) => s.source.agent_id === agentId);
  }

  /**
   * Returns up to `limit` spans in reverse-insertion order (newest first).
   * Optionally filtered by agent_id.
   */
  getRecent(limit = 100, agentId?: string): StoredSpan[] {
    const results: StoredSpan[] = [];
    // Walk backwards from the slot written most recently.
    let idx = (this.writePos - 1 + this.capacity) % this.capacity;
    const scanned = new Set<number>();

    for (let i = 0; i < this.capacity && results.length < limit; i++) {
      if (scanned.has(idx)) break;
      scanned.add(idx);

      const span = this.ring[idx];
      if (span !== undefined && (agentId === undefined || span.source.agent_id === agentId)) {
        results.push(span);
      }

      idx = (idx - 1 + this.capacity) % this.capacity;
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Mutation
  // ---------------------------------------------------------------------------

  /**
   * Marks a stored span as anomalous in-place.
   * No-op if the span is no longer in the ring (evicted).
   */
  markAnomaly(spanId: string): void {
    const span = this.getBySpanId(spanId);
    if (span !== undefined) {
      span.anomaly = true;
    }
  }

  clear(): void {
    this.ring.fill(undefined);
    this.writePos = 0;
    this.total = 0;
    this.idxTraceId.clear();
    this.idxSpanId.clear();
    this.idxAgentId.clear();
    this.idxFunctionName.clear();
  }

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  get totalCount(): number {
    return this.total;
  }

  /** Number of distinct agent IDs currently in the buffer. */
  get agentCount(): number {
    return this.idxAgentId.size;
  }

  getAgentIds(): string[] {
    return [...this.idxAgentId.keys()];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private addToIndexes(span: StoredSpan, pos: number): void {
    // trace_id
    let tSet = this.idxTraceId.get(span.trace_id);
    if (tSet === undefined) {
      tSet = new Set();
      this.idxTraceId.set(span.trace_id, tSet);
    }
    tSet.add(pos);

    // span_id (1:1)
    this.idxSpanId.set(span.span_id, pos);

    // agent_id
    const agentId = span.source.agent_id;
    let aSet = this.idxAgentId.get(agentId);
    if (aSet === undefined) {
      aSet = new Set();
      this.idxAgentId.set(agentId, aSet);
    }
    aSet.add(pos);

    // function_name
    const fnName = span.source.function_name;
    let fSet = this.idxFunctionName.get(fnName);
    if (fSet === undefined) {
      fSet = new Set();
      this.idxFunctionName.set(fnName, fSet);
    }
    fSet.add(pos);
  }

  private removeFromIndexes(span: StoredSpan, pos: number): void {
    removeFromSet(this.idxTraceId, span.trace_id, pos);

    if (this.idxSpanId.get(span.span_id) === pos) {
      this.idxSpanId.delete(span.span_id);
    }

    removeFromSet(this.idxAgentId, span.source.agent_id, pos);
    removeFromSet(this.idxFunctionName, span.source.function_name, pos);
  }

  private resolvePositions(
    positions: Set<number>,
    guard: (s: StoredSpan) => boolean,
  ): StoredSpan[] {
    const results: StoredSpan[] = [];
    for (const pos of positions) {
      const span = this.ring[pos];
      if (span !== undefined && guard(span)) {
        results.push(span);
      }
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function removeFromSet(
  index: Map<string, Set<number>>,
  key: string,
  pos: number,
): void {
  const set = index.get(key);
  if (set === undefined) return;
  set.delete(pos);
  if (set.size === 0) {
    index.delete(key);
  }
}
