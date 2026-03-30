import { useHubSocket } from "./hooks/useHubSocket.js";
import { useDashboardStore } from "./store/index.js";
import { Header } from "./components/Header/Header.js";
import { Flowchart } from "./components/Flowchart/Flowchart.js";
import { FlameGraph } from "./components/FlameGraph/FlameGraph.js";
import { Inspector } from "./components/Inspector/Inspector.js";
import { Timeline } from "./components/Timeline/Timeline.js";

/**
 * Root layout:
 *
 * ┌──────────────────────────────── Header ────────────────────────────────┐
 * │                                                                         │
 * │   Flowchart / FlameGraph (fills space)  │   Inspector (right panel)    │
 * │                                         │                              │
 * ├─────────────────────────────── Timeline ───────────────────────────────┤
 */
export function App(): JSX.Element {
  useHubSocket();
  const viewMode = useDashboardStore((s) => s.viewMode);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {viewMode === "flowchart" ? <Flowchart /> : <FlameGraph />}
        <Inspector />
      </div>
      <Timeline />
    </div>
  );
}
