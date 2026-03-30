import { useMemo } from "react";
import type { StoredSpan } from "../../store/types.js";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface FlameSpan {
  spanId: string;
  functionName: string;
  agentId: string;
  file: string;
  durationMs: number;
  startedAt: number;
  depth: number;
  /** Left edge as a fraction of the total trace window [0, 1]. */
  xFrac: number;
  /** Width as a fraction of the total trace window [0, 1]. */
  widthFrac: number;
  hasError: boolean;
  anomaly: boolean;
  /** Reference back to the raw span for Inspector wiring. */
  span: StoredSpan;
}

export interface FlameData {
  spans: FlameSpan[];
  totalDurationMs: number;
  maxDepth: number;
  traceStart: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Derives flame-graph layout data from a flat list of spans for a given trace ID.
 *
 * Algorithm:
 *  1. Filter spans to the given trace.
 *  2. Find the earliest started_at (= traceStart) and latest end.
 *  3. BFS from root spans to assign call-stack depth to each span.
 *  4. Compute xFrac / widthFrac using started_at and duration_ms relative to
 *     the total trace window.
 *
 * Returns null when the trace ID is null or has no matching spans.
 */
export function useFlameData(
  spans: StoredSpan[],
  traceId: string | null,
): FlameData | null {
  return useMemo(() => {
    if (traceId === null) return null;

    const traceSpans = spans.filter((s) => s.trace_id === traceId);
    if (traceSpans.length === 0) return null;

    // ── Find the absolute time window for this trace ─────────────────────────
    let traceStart = Infinity;
    let traceEnd = -Infinity;
    for (const s of traceSpans) {
      if (s.timing.started_at < traceStart) traceStart = s.timing.started_at;
      const end = s.timing.started_at + s.timing.duration_ms;
      if (end > traceEnd) traceEnd = end;
    }
    const totalDurationMs = traceEnd - traceStart;
    if (totalDurationMs <= 0) return null;

    // ── Build children map ───────────────────────────────────────────────────
    const spanIdSet = new Set(traceSpans.map((s) => s.span_id));
    const childrenOf = new Map<string, StoredSpan[]>();
    for (const s of traceSpans) {
      // Only treat as a child if the parent is also within this trace.
      if (s.parent_span_id !== null && spanIdSet.has(s.parent_span_id)) {
        const arr = childrenOf.get(s.parent_span_id) ?? [];
        arr.push(s);
        childrenOf.set(s.parent_span_id, arr);
      }
    }

    // ── BFS from roots to assign depths ─────────────────────────────────────
    const roots = traceSpans.filter(
      (s) => s.parent_span_id === null || !spanIdSet.has(s.parent_span_id),
    );

    const depthOf = new Map<string, number>();
    const queue: Array<{ span: StoredSpan; depth: number }> = roots.map((s) => ({
      span: s,
      depth: 0,
    }));

    while (queue.length > 0) {
      const item = queue.shift()!;
      depthOf.set(item.span.span_id, item.depth);
      const children = childrenOf.get(item.span.span_id) ?? [];
      for (const child of children) {
        queue.push({ span: child, depth: item.depth + 1 });
      }
    }

    // Orphaned spans (shouldn't happen in practice) default to depth 0.
    for (const s of traceSpans) {
      if (!depthOf.has(s.span_id)) depthOf.set(s.span_id, 0);
    }

    const maxDepth = Math.max(...[...depthOf.values()]);

    // ── Build output ─────────────────────────────────────────────────────────
    const flameSpans: FlameSpan[] = traceSpans.map((s) => {
      const depth = depthOf.get(s.span_id) ?? 0;
      const xFrac = (s.timing.started_at - traceStart) / totalDurationMs;
      const widthFrac = s.timing.duration_ms / totalDurationMs;
      return {
        spanId: s.span_id,
        functionName: s.source.function_name,
        agentId: s.source.agent_id,
        file: s.source.file,
        durationMs: s.timing.duration_ms,
        startedAt: s.timing.started_at,
        depth,
        xFrac: Math.max(0, xFrac),
        widthFrac: Math.max(widthFrac, 0),
        hasError: s.error !== null,
        anomaly: s.anomaly,
        span: s,
      };
    });

    return { spans: flameSpans, totalDurationMs, maxDepth, traceStart };
  }, [spans, traceId]);
}
