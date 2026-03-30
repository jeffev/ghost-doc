import { useRef, useState, useEffect, useCallback } from "react";
import { useDashboardStore, selectTraceIds } from "../../store/index.js";
import { useFlameData, type FlameData, type FlameSpan } from "./useFlameData.js";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 24;
const MIN_CANVAS_WIDTH = 600;

// ---------------------------------------------------------------------------
// Agent color palette (deterministic hash)
// ---------------------------------------------------------------------------

const PALETTE = [
  "#7c3aed", // violet
  "#2563eb", // blue
  "#059669", // emerald
  "#d97706", // amber
  "#0891b2", // cyan
  "#65a30d", // lime
  "#9333ea", // purple
  "#0284c7", // sky
];

function agentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) & 0xffff;
  }
  return PALETTE[hash % PALETTE.length]!;
}

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 1) return "";
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "…";
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FlameGraph(): JSX.Element {
  const store = useDashboardStore();
  const traceIds = selectTraceIds(store);

  // Resolve the active trace: explicit selection → auto (latest).
  const activeTraceId = store.selectedTraceId ?? traceIds[0] ?? null;

  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(MIN_CANVAS_WIDTH);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? MIN_CANVAS_WIDTH;
      setCanvasWidth(Math.max(w - 2, MIN_CANVAS_WIDTH)); // -2 for border
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const flameData = useFlameData(store.spans, activeTraceId);

  const handleSpanClick = useCallback(
    (fs: FlameSpan) => {
      store.selectNode(`${fs.agentId}:${fs.functionName}`);
    },
    [store],
  );

  if (traceIds.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        No traces yet — instrument your code with{" "}
        <code className="mx-1 px-1 py-0.5 bg-border rounded font-mono text-xs">@trace</code>
        and start your app.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-panel flex-shrink-0">
        <span className="text-xs text-gray-500">Trace</span>
        <select
          value={activeTraceId ?? ""}
          onChange={(e) => store.setSelectedTraceId(e.target.value || null)}
          className="text-xs bg-canvas border border-border rounded px-2 py-1 text-gray-300 font-mono focus:outline-none focus:border-accent"
          aria-label="Select trace"
        >
          {traceIds.map((id, i) => (
            <option key={id} value={id}>
              {id.slice(0, 8)}… {i === 0 ? "(latest)" : ""}
            </option>
          ))}
        </select>

        {flameData && (
          <span className="text-xs text-gray-600">
            {flameData.spans.length} spans &middot;{" "}
            {flameData.totalDurationMs < 1
              ? `${(flameData.totalDurationMs * 1000).toFixed(0)} µs`
              : `${flameData.totalDurationMs.toFixed(2)} ms`}
          </span>
        )}

        {/* Agent color legend */}
        {flameData && (
          <AgentLegend agentIds={[...new Set(flameData.spans.map((s) => s.agentId))]} />
        )}
      </div>

      {/* ── Canvas ───────────────────────────────────────────────────────── */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-canvas">
        {flameData ? (
          <FlameCanvas
            data={flameData}
            canvasWidth={canvasWidth}
            selectedNodeId={store.selectedNodeId}
            onSpanClick={handleSpanClick}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            Select a trace above.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG canvas
// ---------------------------------------------------------------------------

function FlameCanvas({
  data,
  canvasWidth,
  selectedNodeId,
  onSpanClick,
}: {
  data: FlameData;
  canvasWidth: number;
  selectedNodeId: string | null;
  onSpanClick: (fs: FlameSpan) => void;
}): JSX.Element {
  const svgHeight = (data.maxDepth + 1) * ROW_HEIGHT + 8;

  return (
    <svg
      width={canvasWidth}
      height={svgHeight}
      className="block"
      aria-label="Flame graph"
    >
      {data.spans.map((fs) => (
        <SpanRect
          key={fs.spanId}
          fs={fs}
          canvasWidth={canvasWidth}
          isSelected={selectedNodeId === `${fs.agentId}:${fs.functionName}`}
          onClick={onSpanClick}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Individual span rectangle
// ---------------------------------------------------------------------------

function SpanRect({
  fs,
  canvasWidth,
  isSelected,
  onClick,
}: {
  fs: FlameSpan;
  canvasWidth: number;
  isSelected: boolean;
  onClick: (fs: FlameSpan) => void;
}): JSX.Element {
  const x = fs.xFrac * canvasWidth;
  const w = Math.max(fs.widthFrac * canvasWidth, 1);
  const y = fs.depth * ROW_HEIGHT;

  const baseColor = fs.hasError
    ? "#dc2626"
    : fs.anomaly
      ? "#f97316"
      : agentColor(fs.agentId);

  const CHARS_PER_PX = 7; // approximate monospace char width at 11px
  const labelMaxChars = Math.floor(w / CHARS_PER_PX) - 1;
  const showLabel = labelMaxChars >= 2;

  const durationLabel =
    fs.durationMs < 1
      ? `${(fs.durationMs * 1000).toFixed(0)} µs`
      : `${fs.durationMs.toFixed(2)} ms`;

  return (
    <g
      onClick={() => onClick(fs)}
      style={{ cursor: "pointer" }}
      role="button"
      aria-label={`${fs.functionName} — ${durationLabel}`}
    >
      <title>{[
        fs.functionName,
        fs.span.source.description,
        `agent: ${fs.agentId}`,
        `file: ${fs.file}`,
        `duration: ${durationLabel}`,
        fs.hasError ? "⚠ error" : null,
        fs.anomaly ? "⚠ anomaly" : null,
      ].filter(Boolean).join("\n")}</title>

      <rect
        x={x}
        y={y}
        width={w}
        height={ROW_HEIGHT - 1}
        fill={baseColor}
        fillOpacity={isSelected ? 1 : 0.78}
        stroke={isSelected ? "white" : "rgba(0,0,0,0.35)"}
        strokeWidth={isSelected ? 1.5 : 0.5}
        rx={2}
      />

      {showLabel && (
        <text
          x={x + 4}
          y={y + ROW_HEIGHT / 2 + 4}
          fontSize={11}
          fontFamily="ui-monospace, monospace"
          fill="white"
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {truncate(fs.functionName, labelMaxChars)}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Agent color legend
// ---------------------------------------------------------------------------

function AgentLegend({ agentIds }: { agentIds: string[] }): JSX.Element {
  return (
    <div className="flex items-center gap-3 ml-2">
      {agentIds.map((id) => (
        <span key={id} className="flex items-center gap-1 text-xs text-gray-400">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: agentColor(id) }}
          />
          {id}
        </span>
      ))}
    </div>
  );
}
