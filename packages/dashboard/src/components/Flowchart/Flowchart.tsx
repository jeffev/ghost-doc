import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDashboardStore } from "../../store/index.js";
import type { GraphData, GraphNode } from "../../store/types.js";
import { useD3Graph, type MinimapUpdate } from "./useD3Graph.js";
import { Minimap } from "./Minimap.js";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts.js";

/**
 * Full-screen D3 force-directed flowchart.
 * Fills its container and responds to container resize via ResizeObserver.
 */
export function Flowchart(): JSX.Element {
  const rawGraph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const nodeSearch = useDashboardStore((s) => s.nodeSearch);
  const store = useDashboardStore();
  const graphDiff = useDashboardStore((s) => s.graphDiff);
  const criticalPath = useDashboardStore((s) => s.criticalPath);

  // Local hidden-node set (persists until clear or un-hide via menu).
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(new Set());

  // Filter hidden nodes out of the graph locally (no store rebuild needed).
  const graph = useMemo<GraphData>(() => {
    if (hiddenNodeIds.size === 0) return rawGraph;
    const kept = new Set(rawGraph.nodes.filter((n) => !hiddenNodeIds.has(n.id)).map((n) => n.id));
    return {
      nodes: rawGraph.nodes.filter((n) => kept.has(n.id)),
      edges: rawGraph.edges.filter(
        (e) => kept.has(e.source as string) && kept.has(e.target as string),
      ),
    };
  }, [rawGraph, hiddenNodeIds]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });

  // Tooltip state.
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

  // Context menu state (right-click on node).
  const [contextMenu, setContextMenu] = useState<{
    node: GraphNode;
    x: number;
    y: number;
  } | null>(null);

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
      setContextMenu(null);
      selectNode(nodeId === selectedNodeId ? null : nodeId);
    },
    [selectedNodeId, selectNode],
  );

  const handleNodeContextMenu = useCallback((node: GraphNode, x: number, y: number) => {
    setHoveredNode(null);
    setContextMenu({ node, x, y });
  }, []);

  const handleMinimapUpdate = useCallback((update: MinimapUpdate) => {
    setMinimapUpdate(update);
  }, []);

  const { svgRef, panToGraphPoint, fitToScreen } = useD3Graph({
    data: graph,
    width: dims.width,
    height: dims.height,
    onNodeClick: handleNodeClick,
    selectedNodeId,
    nodeSearch,
    diff: graphDiff,
    onNodeHover: setHoveredNode,
    onMinimapUpdate: handleMinimapUpdate,
    onNodeContextMenu: handleNodeContextMenu,
    criticalPath,
  });

  useKeyboardShortcuts(fitToScreen);

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

      {/* Critical path legend */}
      {criticalPath !== null && (
        <div className="absolute top-3 left-3 bg-panel/90 backdrop-blur-sm border border-purple-700 rounded-lg px-3 py-2 text-xs flex items-center gap-2 pointer-events-none">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-purple-500 flex-shrink-0" />
          <span className="text-purple-300 font-semibold">Critical path</span>
          <span className="text-gray-400">{Math.round(criticalPath.totalMs)}ms total</span>
          <span className="text-gray-600">·</span>
          <span className="text-gray-400">{criticalPath.nodeIds.size} nodes</span>
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

      {/* Node tooltip (hidden while context menu is open) */}
      {hoveredNode !== null && contextMenu === null && (
        <NodeTooltip node={hoveredNode} x={cursorPos.x} y={cursorPos.y} />
      )}

      {/* Right-click context menu */}
      {contextMenu !== null && (
        <NodeContextMenu
          node={contextMenu.node}
          screenX={contextMenu.x}
          screenY={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onFocusSubtree={() => {
            store.setNodeSearch(contextMenu.node.functionName);
            setContextMenu(null);
          }}
          onHideNode={() => {
            setHiddenNodeIds((prev) => new Set([...prev, contextMenu.node.id]));
            if (selectedNodeId === contextMenu.node.id) selectNode(null);
            setContextMenu(null);
          }}
          onCopyName={() => {
            void navigator.clipboard.writeText(contextMenu.node.functionName);
            setContextMenu(null);
          }}
          onCopyJson={() => {
            void navigator.clipboard.writeText(
              JSON.stringify(contextMenu.node.latestSpan, null, 2),
            );
            setContextMenu(null);
          }}
        />
      )}

      {/* Hidden-nodes reset banner */}
      {hiddenNodeIds.size > 0 && (
        <button
          onClick={() => setHiddenNodeIds(new Set())}
          className="absolute bottom-14 left-1/2 -translate-x-1/2 text-xs bg-panel border border-border rounded-full px-3 py-1 text-gray-400 hover:text-white hover:border-accent transition-colors"
        >
          {hiddenNodeIds.size} hidden node{hiddenNodeIds.size !== 1 ? "s" : ""} — click to restore
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NodeContextMenu
// ---------------------------------------------------------------------------

interface NodeContextMenuProps {
  node: GraphNode;
  screenX: number;
  screenY: number;
  onClose: () => void;
  onFocusSubtree: () => void;
  onHideNode: () => void;
  onCopyName: () => void;
  onCopyJson: () => void;
}

function NodeContextMenu({
  node,
  screenX,
  screenY,
  onClose,
  onFocusSubtree,
  onHideNode,
  onCopyName,
  onCopyJson,
}: NodeContextMenuProps): JSX.Element {
  // Convert screen coords to container-relative coords.
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleClick() {
      onClose();
    }
    window.addEventListener("keydown", handleKey);
    window.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  const items: { label: string; icon: string; action: () => void; danger?: boolean }[] = [
    { label: "Focus subtree", icon: "🔍", action: onFocusSubtree },
    { label: "Hide node", icon: "🙈", action: onHideNode, danger: true },
    { label: "Copy name", icon: "📋", action: onCopyName },
    { label: "Copy JSON", icon: "{ }", action: onCopyJson },
  ];

  return (
    <div
      ref={containerRef}
      className="fixed z-[100] bg-panel border border-border rounded-lg shadow-xl overflow-hidden text-xs min-w-[160px]"
      style={{ left: screenX, top: screenY }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 border-b border-border text-gray-500 font-mono truncate">
        {node.functionName}
      </div>
      {items.map(({ label, icon, action, danger }) => (
        <button
          key={label}
          onClick={action}
          className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
            danger
              ? "text-gray-400 hover:bg-anomaly/20 hover:text-anomaly"
              : "text-gray-300 hover:bg-accent/20 hover:text-white"
          }`}
        >
          <span className="text-[11px]">{icon}</span>
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NodeTooltip
// ---------------------------------------------------------------------------

function NodeTooltip({ node, x, y }: { node: GraphNode; x: number; y: number }): JSX.Element {
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
          {node.hasError && <span className="text-red-400 font-semibold">error</span>}
          {node.hasAnomaly && (
            <span
              className="text-orange-400 font-semibold cursor-help"
              title="Anomaly: function returned a different type than previous calls"
            >
              anomaly
            </span>
          )}
          {node.isSlow && <span className="text-yellow-500 font-semibold">slow</span>}
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
