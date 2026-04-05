import { create } from "zustand";
import type {
  StoredSpan,
  GraphData,
  GraphNode,
  TimeTravelState,
  FilterState,
  PlaybackSpeed,
  ViewMode,
  GraphDiff,
} from "./types.js";
import {
  buildGraphData,
  computeGraphDiff,
  computeCriticalPath,
  applySpanIncremental,
  emptyAccumulators,
  type GraphAccumulators,
  type CriticalPath,
} from "./graph.js";

// ---------------------------------------------------------------------------
// Hub WebSocket message shapes
// ---------------------------------------------------------------------------

interface TraceMessage {
  type: "trace";
  span: StoredSpan;
}

interface SnapshotMessage {
  type: "snapshot";
  traces: StoredSpan[];
}

export type HubMessage = TraceMessage | SnapshotMessage;

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export interface DashboardStore {
  // ── Spans ──────────────────────────────────────────────────────────────────
  spans: StoredSpan[];
  /** Append a single incoming span (live mode). */
  addSpan: (span: StoredSpan) => void;
  /** Bulk-load spans from a snapshot message. */
  loadSnapshot: (spans: StoredSpan[]) => void;
  /** Wipe all spans. */
  clearSpans: () => void;

  // ── Graph (derived) ────────────────────────────────────────────────────────
  /** Graph computed from the *currently visible* spans (respects time-travel). */
  graph: GraphData;

  // ── Selected node ─────────────────────────────────────────────────────────
  selectedNodeId: string | null;
  selectNode: (id: string | null) => void;
  /** All spans for the selected node (newest first). */
  selectedNodeSpans: () => StoredSpan[];

  // ── Time-travel ────────────────────────────────────────────────────────────
  timeTravel: TimeTravelState;
  seekTo: (ts: number | null) => void;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
  setPlaying: (playing: boolean) => void;
  /** Advance playback by one tick (called by the playback interval). */
  tickPlayback: () => void;

  // ── Filters ────────────────────────────────────────────────────────────────
  filter: FilterState;
  setFilter: (partial: Partial<FilterState>) => void;

  // ── Connection status ──────────────────────────────────────────────────────
  connectionStatus: "connecting" | "connected" | "disconnected";
  setConnectionStatus: (status: "connecting" | "connected" | "disconnected") => void;

  // ── View mode ──────────────────────────────────────────────────────────────
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // ── Flame graph trace selection ────────────────────────────────────────────
  /** Trace ID currently displayed in the flame graph. null = auto (latest). */
  selectedTraceId: string | null;
  setSelectedTraceId: (id: string | null) => void;

  // ── Node search (flowchart highlight, does not filter nodes out) ───────────
  nodeSearch: string;
  setNodeSearch: (q: string) => void;

  // ── Snapshot comparison ────────────────────────────────────────────────────
  /** Spans from the loaded comparison snapshot. null = no comparison active. */
  compareSpans: StoredSpan[] | null;
  /** Graph built from compareSpans (with same filter as main graph). */
  compareGraph: GraphData | null;
  /** Diff between compareGraph (base) and the current graph. */
  graphDiff: GraphDiff | null;
  /** Load a snapshot for comparison against the current graph. */
  loadCompareSnapshot: (spans: StoredSpan[]) => void;
  /** Clear the comparison snapshot. */
  clearCompare: () => void;

  // ── Critical path ──────────────────────────────────────────────────────────
  /** Result of the critical-path computation, or null when hidden. */
  criticalPath: CriticalPath | null;
  /** Toggle critical-path highlight on/off (recomputes on the current graph). */
  toggleCriticalPath: () => void;

  // ── Trace rate ─────────────────────────────────────────────────────────────
  /** Timestamps of spans received in the last 5 s (for rate calculation). */
  rateWindow: number[];
  tracesPerSecond: () => number;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

// Internal type — not part of the public DashboardStore interface.
interface InternalStore extends DashboardStore {
  _accs: GraphAccumulators;
}

export const useDashboardStore = create<InternalStore>((set, get) => ({
  // ── Internal accumulators (not exposed via DashboardStore interface) ────────
  _accs: emptyAccumulators(),

  // ── Spans ──────────────────────────────────────────────────────────────────
  spans: [],

  addSpan(span) {
    set((state) => {
      const spans = [...state.spans, span];
      const rateWindow = pruneRateWindow([...state.rateWindow, span.received_at]);

      // Use incremental update when in live mode with no groupBy.
      // Fall back to full rebuild for time-travel or grouped views.
      let graph: ReturnType<typeof buildVisibleGraph>;
      if (state.timeTravel.seekTs === null && state.filter.groupBy === "none") {
        const filtered = spanPassesFilter(span, state.filter);
        if (filtered) {
          graph = applySpanIncremental(span, state._accs, state.graph);
        } else {
          graph = state.graph; // span filtered out — graph unchanged
        }
      } else {
        graph = buildVisibleGraph(spans, state.filter, state.timeTravel.seekTs);
      }

      return {
        spans,
        graph,
        graphDiff: state.compareGraph !== null ? computeGraphDiff(state.compareGraph, graph) : null,
        rateWindow,
      };
    });
  },

  loadSnapshot(incoming) {
    set((_state) => {
      // Full rebuild on snapshot load; reset accumulators.
      const accs = emptyAccumulators();
      const graph = buildVisibleGraph(incoming, _state.filter, _state.timeTravel.seekTs);
      return {
        spans: incoming,
        graph,
        _accs: accs,
        graphDiff:
          _state.compareGraph !== null ? computeGraphDiff(_state.compareGraph, graph) : null,
      };
    });
  },

  clearSpans() {
    set({
      spans: [],
      graph: { nodes: [], edges: [] },
      selectedNodeId: null,
      rateWindow: [],
      graphDiff: null,
      _accs: emptyAccumulators(),
    });
  },

  // ── Graph ──────────────────────────────────────────────────────────────────
  graph: { nodes: [], edges: [] },

  // ── Selected node ─────────────────────────────────────────────────────────
  selectedNodeId: null,

  selectNode(id) {
    set({ selectedNodeId: id });
  },

  selectedNodeSpans() {
    const { spans, selectedNodeId } = get();
    if (selectedNodeId === null) return [];
    const [agentId, ...fnParts] = selectedNodeId.split(":");
    const functionName = fnParts.join(":");
    return spans
      .filter((s) => s.source.agent_id === agentId && s.source.function_name === functionName)
      .sort((a, b) => b.received_at - a.received_at);
  },

  // ── Time-travel ────────────────────────────────────────────────────────────
  timeTravel: {
    seekTs: null,
    isPlaying: false,
    playbackSpeed: 1,
  },

  seekTo(ts) {
    set((state) => {
      const graph = buildVisibleGraph(state.spans, state.filter, ts);
      return {
        timeTravel: { ...state.timeTravel, seekTs: ts, isPlaying: false },
        graph,
        graphDiff: state.compareGraph !== null ? computeGraphDiff(state.compareGraph, graph) : null,
      };
    });
  },

  setPlaybackSpeed(speed) {
    set((state) => ({ timeTravel: { ...state.timeTravel, playbackSpeed: speed } }));
  },

  setPlaying(playing) {
    set((state) => ({ timeTravel: { ...state.timeTravel, isPlaying: playing } }));
  },

  tickPlayback() {
    const { spans, timeTravel } = get();
    if (!timeTravel.isPlaying || timeTravel.seekTs === null) return;

    const TICK_MS = 1_000;
    const nextTs = timeTravel.seekTs + TICK_MS * timeTravel.playbackSpeed;
    const maxTs = spans.length > 0 ? Math.max(...spans.map((s) => s.received_at)) : Date.now();

    if (nextTs >= maxTs) {
      set((state) => {
        const graph = buildVisibleGraph(state.spans, state.filter, null);
        return {
          timeTravel: { ...state.timeTravel, seekTs: null, isPlaying: false },
          graph,
          graphDiff:
            state.compareGraph !== null ? computeGraphDiff(state.compareGraph, graph) : null,
        };
      });
    } else {
      set((state) => {
        const graph = buildVisibleGraph(state.spans, state.filter, nextTs);
        return {
          timeTravel: { ...state.timeTravel, seekTs: nextTs },
          graph,
          graphDiff:
            state.compareGraph !== null ? computeGraphDiff(state.compareGraph, graph) : null,
        };
      });
    }
  },

  // ── Filters ────────────────────────────────────────────────────────────────
  filter: {
    agentId: null,
    functionName: "",
    tag: "",
    groupBy: "none",
    nodeFilter: "all",
  },

  setFilter(partial) {
    set((state) => {
      const filter = { ...state.filter, ...partial };
      const graph = buildVisibleGraph(state.spans, filter, state.timeTravel.seekTs);
      // Reset accumulators so they stay consistent with the new filtered view.
      return {
        filter,
        graph,
        _accs: emptyAccumulators(),
        graphDiff: state.compareGraph !== null ? computeGraphDiff(state.compareGraph, graph) : null,
      };
    });
  },

  // ── Connection status ──────────────────────────────────────────────────────
  connectionStatus: "connecting",

  setConnectionStatus(status) {
    set({ connectionStatus: status });
  },

  // ── View mode ──────────────────────────────────────────────────────────────
  viewMode: "flowchart",

  setViewMode(mode) {
    set({ viewMode: mode });
  },

  // ── Flame graph trace selection ────────────────────────────────────────────
  selectedTraceId: null,

  setSelectedTraceId(id) {
    set({ selectedTraceId: id });
  },

  // ── Node search ────────────────────────────────────────────────────────────
  nodeSearch: "",

  setNodeSearch(q) {
    set({ nodeSearch: q });
  },

  // ── Snapshot comparison ────────────────────────────────────────────────────
  compareSpans: null,
  compareGraph: null,
  graphDiff: null,

  loadCompareSnapshot(incoming) {
    set((state) => {
      const compareGraph = buildVisibleGraph(incoming, state.filter, null);
      const graphDiff = computeGraphDiff(compareGraph, state.graph);
      return { compareSpans: incoming, compareGraph, graphDiff };
    });
  },

  clearCompare() {
    set({ compareSpans: null, compareGraph: null, graphDiff: null });
  },

  // ── Critical path ──────────────────────────────────────────────────────────
  criticalPath: null,

  toggleCriticalPath() {
    set((state) => ({
      criticalPath: state.criticalPath !== null ? null : computeCriticalPath(state.graph),
    }));
  },

  // ── Trace rate ─────────────────────────────────────────────────────────────
  rateWindow: [],

  tracesPerSecond() {
    const cutoff = Date.now() - 1_000;
    return get().rateWindow.filter((t) => t >= cutoff).length;
  },
}));

// ---------------------------------------------------------------------------
// Selectors (memoisation-friendly — create outside the store)
// ---------------------------------------------------------------------------

/** Returns the node object for a given node ID. */
export function selectNode(store: DashboardStore, nodeId: string): GraphNode | undefined {
  return store.graph.nodes.find((n) => n.id === nodeId);
}

/** Returns the sorted list of unique agent IDs currently in the span list. */
export function selectAgentIds(store: DashboardStore): string[] {
  const ids = new Set(store.spans.map((s) => s.source.agent_id));
  return [...ids].sort();
}

/** Returns the earliest and latest received_at timestamps in the span list. */
export function selectTimeRange(store: DashboardStore): { min: number; max: number } | null {
  if (store.spans.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const s of store.spans) {
    if (s.received_at < min) min = s.received_at;
    if (s.received_at > max) max = s.received_at;
  }
  return { min, max };
}

/** Returns anomalous span timestamps for red ticks on the timeline. */
export function selectAnomalyTimestamps(store: DashboardStore): number[] {
  return store.spans.filter((s) => s.anomaly).map((s) => s.received_at);
}

/**
 * Returns unique trace IDs sorted by most recent span first.
 * Capped at 50 entries to keep the selector dropdown usable.
 */
export function selectTraceIds(store: DashboardStore): string[] {
  const latest = new Map<string, number>();
  for (const s of store.spans) {
    const prev = latest.get(s.trace_id) ?? 0;
    if (s.timing.started_at > prev) latest.set(s.trace_id, s.timing.started_at);
  }
  return [...latest.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)
    .slice(0, 50);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Check whether a single span passes the current filter (for incremental updates). */
function spanPassesFilter(span: StoredSpan, filter: FilterState): boolean {
  if (filter.agentId !== null && span.source.agent_id !== filter.agentId) return false;
  if (filter.functionName.trim() !== "") {
    if (!span.source.function_name.toLowerCase().includes(filter.functionName.trim().toLowerCase()))
      return false;
  }
  if (filter.tag.trim() !== "") {
    const q = filter.tag.trim().toLowerCase();
    if (
      !Object.entries(span.tags).some(
        ([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q),
      )
    )
      return false;
  }
  return true;
}

function buildVisibleGraph(
  spans: StoredSpan[],
  filter: FilterState,
  seekTs: number | null,
): GraphData {
  let visible = spans;

  // Time-travel filter.
  if (seekTs !== null) {
    visible = visible.filter((s) => s.received_at <= seekTs);
  }

  // Agent filter.
  if (filter.agentId !== null) {
    visible = visible.filter((s) => s.source.agent_id === filter.agentId);
  }

  // Function name filter (case-insensitive substring).
  if (filter.functionName.trim() !== "") {
    const q = filter.functionName.trim().toLowerCase();
    visible = visible.filter((s) => s.source.function_name.toLowerCase().includes(q));
  }

  // Tag filter (key or key=value substring match).
  if (filter.tag.trim() !== "") {
    const q = filter.tag.trim().toLowerCase();
    visible = visible.filter((s) =>
      Object.entries(s.tags).some(
        ([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q),
      ),
    );
  }

  const graph = buildGraphData(visible, filter.groupBy);

  if (filter.nodeFilter === "all") return graph;

  const kept = new Set(
    graph.nodes
      .filter((n) => {
        if (filter.nodeFilter === "errors") return n.hasError;
        if (filter.nodeFilter === "anomalies") return n.hasAnomaly;
        if (filter.nodeFilter === "slow") return n.isSlow;
        return true;
      })
      .map((n) => n.id),
  );

  return {
    nodes: graph.nodes.filter((n) => kept.has(n.id)),
    edges: graph.edges.filter((e) => kept.has(e.source) && kept.has(e.target)),
  };
}

function pruneRateWindow(window: number[]): number[] {
  const cutoff = Date.now() - 5_000;
  return window.filter((t) => t >= cutoff);
}
