import type { TraceEvent } from "@ghost-doc/shared-types";
import type { StoredSpan } from "./store.js";

// ---------------------------------------------------------------------------
// Span tree types
// ---------------------------------------------------------------------------

export interface SpanNode {
  span: StoredSpan;
  children: SpanNode[];
}

export interface CorrelationResult {
  /** Root-level nodes (spans with no parent inside the provided set). */
  roots: SpanNode[];
  /** True when spans from more than one agent share the same trace_id. */
  isDistributed: boolean;
  /** All agent IDs present in this trace. */
  agentIds: string[];
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

/**
 * Builds a call tree from a flat list of spans that share the same trace_id.
 *
 * Spans whose parent_span_id is absent from the provided set are treated as
 * roots (either the true root, or the entry point into a distributed sub-tree).
 */
export function buildSpanTree(spans: StoredSpan[]): CorrelationResult {
  const bySpanId = new Map<string, StoredSpan>();
  const agentIds = new Set<string>();

  for (const span of spans) {
    bySpanId.set(span.span_id, span);
    agentIds.add(span.source.agent_id);
  }

  const childMap = new Map<string, StoredSpan[]>();
  const roots: StoredSpan[] = [];

  for (const span of spans) {
    if (span.parent_span_id !== null && bySpanId.has(span.parent_span_id)) {
      let children = childMap.get(span.parent_span_id);
      if (children === undefined) {
        children = [];
        childMap.set(span.parent_span_id, children);
      }
      children.push(span);
    } else {
      roots.push(span);
    }
  }

  function buildNode(span: StoredSpan): SpanNode {
    return {
      span,
      children: (childMap.get(span.span_id) ?? []).map(buildNode),
    };
  }

  return {
    roots: roots.map(buildNode),
    isDistributed: agentIds.size > 1,
    agentIds: [...agentIds],
  };
}

// ---------------------------------------------------------------------------
// Anomaly detector
// ---------------------------------------------------------------------------

/**
 * Tracks the set of observed output types per (agent_id, function_name) pair.
 *
 * On first observation the call is considered normal.
 * On any subsequent call whose output type differs from all previously seen
 * types the call is flagged as anomalous.
 */
export class AnomalyDetector {
  /**
   * Key: `"<agent_id>:<function_name>"`
   * Value: set of JavaScript type strings (as returned by `outputType()`)
   */
  private readonly seenTypes = new Map<string, Set<string>>();

  /**
   * Returns `true` when the span's output type has not been seen before for
   * this (agent, function) pair and the function has been observed at least once
   * previously.
   */
  check(span: TraceEvent): boolean {
    const key = `${span.source.agent_id}:${span.source.function_name}`;
    const type = outputType(span.output);

    const known = this.seenTypes.get(key);
    if (known === undefined) {
      this.seenTypes.set(key, new Set([type]));
      return false; // first observation — not anomalous
    }

    const isAnomaly = !known.has(type);
    known.add(type);
    return isAnomaly;
  }

  reset(): void {
    this.seenTypes.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a deterministic string tag for the runtime type of a value.
 * Distinguishes between `null`, arrays, objects, and primitives.
 */
function outputType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
