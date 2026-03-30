import { useMemo } from "react";
import type { GraphData, GraphDiff } from "../../store/types.js";
import type { MinimapUpdate } from "./useD3Graph.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const W = 160;
const H = 112;
const PAD = 8;
const NODE_R = 3;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MinimapProps {
  graph: GraphData;
  update: MinimapUpdate;
  canvasWidth: number;
  canvasHeight: number;
  diff: GraphDiff | null;
  onPan: (gx: number, gy: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Minimap({
  graph,
  update,
  canvasWidth,
  canvasHeight,
  diff,
  onPan,
}: MinimapProps): JSX.Element | null {
  if (graph.nodes.length === 0) return null;

  const { positions, transform } = update;

  // Compute graph bounds from known positions.
  const { minX, maxX, minY, maxY } = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const { x, y } of positions.values()) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    // Fallback when positions aren't populated yet.
    if (!isFinite(minX)) { minX = 0; maxX = canvasWidth; minY = 0; maxY = canvasHeight; }
    return { minX, maxX, minY, maxY };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions]);

  const gW = Math.max(maxX - minX, 1);
  const gH = Math.max(maxY - minY, 1);
  const drawW = W - PAD * 2;
  const drawH = H - PAD * 2;
  const scaleX = drawW / gW;
  const scaleY = drawH / gH;
  const scale = Math.min(scaleX, scaleY);

  function toMX(gx: number): number {
    return PAD + (gx - minX) * scale + (drawW - gW * scale) / 2;
  }
  function toMY(gy: number): number {
    return PAD + (gy - minY) * scale + (drawH - gH * scale) / 2;
  }

  // Viewport rectangle in minimap coordinates.
  const vpX = toMX(-transform.x / transform.k);
  const vpY = toMY(-transform.y / transform.k);
  const vpW = (canvasWidth / transform.k) * scale;
  const vpH = (canvasHeight / transform.k) * scale;

  // Click: convert minimap coords → graph coords and call onPan.
  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const gx = (mx - PAD - (drawW - gW * scale) / 2) / scale + minX;
    const gy = (my - PAD - (drawH - gH * scale) / 2) / scale + minY;
    onPan(gx, gy);
  }

  return (
    <div
      className="absolute bottom-3 right-3 rounded border border-border bg-panel/90 backdrop-blur-sm overflow-hidden"
      style={{ width: W, height: H }}
      title="Minimap — click to pan"
    >
      <svg
        width={W}
        height={H}
        onClick={handleClick}
        style={{ cursor: "crosshair", display: "block" }}
      >
        {/* Edges */}
        {graph.edges.map((edge) => {
          const src = positions.get(edge.source as string);
          const tgt = positions.get(edge.target as string);
          if (src === undefined || tgt === undefined) return null;
          return (
            <line
              key={edge.id}
              x1={toMX(src.x)}
              y1={toMY(src.y)}
              x2={toMX(tgt.x)}
              y2={toMY(tgt.y)}
              stroke="#374151"
              strokeWidth={0.8}
            />
          );
        })}

        {/* Nodes */}
        {graph.nodes.map((node) => {
          const pos = positions.get(node.id);
          if (pos === undefined) return null;
          const cx = toMX(pos.x);
          const cy = toMY(pos.y);
          const status = diff?.nodeStatus.get(node.id);
          const fill =
            status === "added" ? "#22c55e"
            : status === "faster" ? "#4ade80"
            : status === "slower" ? "#f97316"
            : node.hasError ? "#ef4444"
            : node.hasAnomaly ? "#dc2626"
            : "#6366f1";
          return (
            <circle key={node.id} cx={cx} cy={cy} r={NODE_R} fill={fill} />
          );
        })}

        {/* Viewport rectangle */}
        <rect
          x={vpX}
          y={vpY}
          width={Math.max(vpW, 4)}
          height={Math.max(vpH, 4)}
          fill="white"
          fillOpacity={0.06}
          stroke="white"
          strokeOpacity={0.3}
          strokeWidth={1}
          rx={1}
        />
      </svg>
    </div>
  );
}
