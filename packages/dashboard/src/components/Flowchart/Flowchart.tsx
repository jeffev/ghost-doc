import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDashboardStore } from "../../store/index.js";
import type { GraphNode } from "../../store/types.js";
import { useD3Graph, type MinimapUpdate } from "./useD3Graph.js";
import { Minimap } from "./Minimap.js";

/**
 * Full-screen D3 force-directed flowchart.
 * Fills its container and responds to container resize via ResizeObserver.
 */
export function Flowchart(): JSX.Element {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const nodeSearch = useDashboardStore((s) => s.nodeSearch);
  const graphDiff = useDashboardStore((s) => s.graphDiff);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });

  // Tooltip state.
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

  // Minimap update state (throttled by useD3Graph at ~10 fps).
  const [minimapUpdate, setMinimapUpdate] = useState<MinimapUpdate>({
    positions: new Map(),
    transform: { x: 0, y: 0, k: 1 },
  });

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setDims({ width, height });
    });
    ro.observe(el);
    setDims({ width: el.clientWidth, height: el.clientHeight });

    return () => ro.disconnect();
  }, []);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      selectNode(nodeId === selectedNodeId ? null : nodeId);
    },
    [selectedNodeId, selectNode],
  );

  const handleMinimapUpdate = useCallback((update: MinimapUpdate) => {
    setMinimapUpdate(update);
  }, []);

  const { svgRef, panToGraphPoint } = useD3Graph({
    data: graph,
    width: dims.width,
    height: dims.height,
    onNodeClick: handleNodeClick,
    selectedNodeId,
    nodeSearch,
    diff: graphDiff,
    onNodeHover: setHoveredNode,
    onMinimapUpdate: handleMinimapUpdate,
  });

  const isEmpty = graph.nodes.length === 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-canvas overflow-hidden"
      onMouseMove={(e) => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
    >
      <svg
        ref={svgRef as React.RefObject<SVGSVGElement>}
        width={dims.width}
        height={dims.height}
        className="absolute inset-0"
      />

      {/* Empty state */}
      {isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
          <p className="text-4xl mb-3">👻</p>
          <p className="text-gray-500 text-sm">
            Waiting for traces… instrument your code with{" "}
            <code className="text-accent font-mono">@trace</code>
          </p>
        </div>
      )}

      {/* Diff legend */}
      {graphDiff !== null && <DiffLegend removedCount={graphDiff.removedCount} />}

      {/* Minimap */}
      {!isEmpty && (
        <Minimap
          graph={graph}
          update={minimapUpdate}
          canvasWidth={dims.width}
          canvasHeight={dims.height}
          diff={graphDiff}
          onPan={panToGraphPoint}
        />
      )}

      {/* Node tooltip */}
      {hoveredNode !== null && (
        <NodeTooltip node={hoveredNode} x={cursorPos.x} y={cursorPos.y} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NodeTooltip
// ---------------------------------------------------------------------------

function NodeTooltip({
  node,
  x,
  y,
}: {
  node: GraphNode;
  x: number;
  y: number;
}): JSX.Element {
  // Offset so the tooltip doesn't sit under the cursor.
  const offsetX = 14;
  const offsetY = -10;

  return (
    <div
      className="absolute pointer-events-none z-50 bg-panel border border-border rounded-lg px-3 py-2 shadow-lg text-xs max-w-xs"
      style={{ left: x + offsetX, top: y + offsetY }}
    >
      <p className="font-mono font-semibold text-white truncate">{node.functionName}</p>

      {node.latestSpan.source.description !== undefined && (
        <p className="text-gray-400 italic mt-0.5">{node.latestSpan.source.description}</p>
      )}

      <p className="text-gray-500 mt-1 truncate">{node.file}</p>

      <div className="flex gap-3 mt-1.5 text-gray-400">
        <span>
          <span className="text-gray-600">calls </span>
          {node.callCount}
        </span>
        <span>
          <span className="text-gray-600">avg </span>
          {Math.round(node.avgDurationMs)}ms
        </span>
        <span>
          <span className="text-gray-600">p95 </span>
          {Math.round(node.p95DurationMs)}ms
        </span>
      </div>

      {(node.hasError || node.hasAnomaly || node.isSlow) && (
        <div className="flex gap-2 mt-1.5">
          {node.hasError && (
            <span className="text-red-400 font-semibold">error</span>
          )}
          {node.hasAnomaly && (
            <span className="text-orange-400 font-semibold">anomaly</span>
          )}
          {node.isSlow && (
            <span className="text-yellow-500 font-semibold">slow</span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffLegend
// ---------------------------------------------------------------------------

const DIFF_ENTRIES = [
  { color: "#22c55e", label: "Added" },
  { color: "#4ade80", label: "Faster" },
  { color: "#f97316", label: "Slower" },
  { color: "#6366f1", label: "Unchanged" },
] as const;

function DiffLegend({ removedCount }: { removedCount: number }): JSX.Element {
  return (
    <div className="absolute top-3 left-3 bg-panel/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-xs flex flex-col gap-1.5">
      <p className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">
        Snapshot diff
      </p>
      {DIFF_ENTRIES.map(({ color, label }) => (
        <div key={label} className="flex items-center gap-2 text-gray-300">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
          {label}
        </div>
      ))}
      {removedCount > 0 && (
        <div className="flex items-center gap-2 text-gray-500 italic">
          <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 border border-gray-600" />
          {removedCount} removed
        </div>
      )}
    </div>
  );
}
