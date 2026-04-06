import { useHubSocket } from "./hooks/useHubSocket.js";
import { useDashboardStore } from "./store/index.js";
import { Header } from "./components/Header/Header.js";
import { Flowchart } from "./components/Flowchart/Flowchart.js";
import { FlameGraph } from "./components/FlameGraph/FlameGraph.js";
import { Inspector } from "./components/Inspector/Inspector.js";
import { Timeline } from "./components/Timeline/Timeline.js";
import { ContractsTab } from "./components/Contracts/ContractsTab.js";
import { MocksTab } from "./components/Mocks/MocksTab.js";
import type { GraphData } from "./store/types.js";

/**
 * Root layout:
 *
 * ┌──────────────────────────────── Header ────────────────────────────────┐
 * ├──────────────────────────────── StatsBar ───────────────────────────────┤
 * │                                                                         │
 * │   Flowchart / FlameGraph (fills space)  │   Inspector (right panel)    │
 * │                                         │                              │
 * ├─────────────────────────────── Timeline ───────────────────────────────┤
 */
export function App(): JSX.Element {
  useHubSocket();
  const viewMode = useDashboardStore((s) => s.viewMode);
  const graph = useDashboardStore((s) => s.graph);

  const isGraphView = viewMode === "flowchart" || viewMode === "flamegraph";

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <Header />
      {isGraphView && <StatsBar graph={graph} />}
      <div className="flex flex-1 overflow-hidden">
        {viewMode === "flowchart" && (
          <>
            <Flowchart />
            <Inspector />
          </>
        )}
        {viewMode === "flamegraph" && (
          <>
            <FlameGraph />
            <Inspector />
          </>
        )}
        {viewMode === "contracts" && <ContractsTab />}
        {viewMode === "mocks" && <MocksTab />}
      </div>
      {isGraphView && <Timeline />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatsBar — slim always-visible health metrics
// ---------------------------------------------------------------------------

function StatsBar({ graph }: { graph: GraphData }): JSX.Element | null {
  if (graph.nodes.length === 0) return null;

  const totalCalls = graph.nodes.reduce((s, n) => s + n.callCount, 0);
  const errorNodes = graph.nodes.filter((n) => n.hasError).length;
  const anomalyNodes = graph.nodes.filter((n) => n.hasAnomaly).length;
  const slowNodes = graph.nodes.filter((n) => n.isSlow).length;

  const weightedLatency =
    totalCalls > 0
      ? graph.nodes.reduce((s, n) => s + n.avgDurationMs * n.callCount, 0) / totalCalls
      : 0;

  return (
    <div className="flex items-center gap-4 px-4 py-1 bg-panel border-b border-border text-xs text-gray-500 flex-shrink-0">
      <Stat label="calls" value={totalCalls.toLocaleString()} />
      <Stat label="functions" value={graph.nodes.length} />
      <Stat label="avg latency" value={`${Math.round(weightedLatency)}ms`} />
      {errorNodes > 0 && <Stat label="errors" value={errorNodes} className="text-red-400" />}
      {anomalyNodes > 0 && (
        <Stat label="anomalies" value={anomalyNodes} className="text-orange-400" />
      )}
      {slowNodes > 0 && <Stat label="slow" value={slowNodes} className="text-yellow-500" />}
    </div>
  );
}

function Stat({
  label,
  value,
  className = "text-gray-400",
}: {
  label: string;
  value: string | number;
  className?: string;
}): JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <span className="text-gray-600">{label}</span>
      <span className={`font-mono font-semibold ${className}`}>{value}</span>
    </span>
  );
}
