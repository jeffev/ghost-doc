import { useEffect, useRef, useCallback, type RefObject } from "react";
import * as d3 from "d3";
import type { GraphData, GraphNode, GraphEdge, GraphDiff } from "../../store/types.js";
import { agentColor } from "../../colors.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MinimapUpdate {
  positions: Map<string, { x: number; y: number }>;
  transform: { x: number; y: number; k: number };
}

export interface UseD3GraphOptions {
  data: GraphData;
  width: number;
  height: number;
  onNodeClick: (nodeId: string) => void;
  selectedNodeId: string | null;
  /** Highlights matching nodes without filtering; auto-pans to first match. */
  nodeSearch: string;
  /** When set, colorizes nodes by their diff status. */
  diff: GraphDiff | null;
  /** Called when the pointer enters or leaves a node. */
  onNodeHover: (node: GraphNode | null) => void;
  /** Called (throttled ~10 fps) with current node positions and zoom transform. */
  onMinimapUpdate: (update: MinimapUpdate) => void;
}

export interface UseD3GraphResult {
  svgRef: RefObject<SVGSVGElement | null>;
  /** Smoothly pan the main view to center on a graph-space coordinate. */
  panToGraphPoint: (gx: number, gy: number) => void;
  /** Fit all nodes into view with a smooth transition. */
  fitToScreen: () => void;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function nodeFill(node: GraphNode, diff: GraphDiff | null): string {
  if (diff !== null) {
    const status = diff.nodeStatus.get(node.id);
    if (status === "added") return "#14532d";
    if (status === "faster") return "#0f3d1f";
    if (status === "slower") return "#4a1515";
  }
  if (node.hasError) return "#7f1d1d";
  return "#1a1d27";
}

function nodeRingStroke(
  node: GraphNode,
  selectedNodeId: string | null,
  diff: GraphDiff | null,
): string {
  if (node.id === selectedNodeId) return "#ffffff";
  if (diff !== null) {
    const status = diff.nodeStatus.get(node.id);
    if (status === "added") return "#22c55e";
    if (status === "faster") return "#4ade80";
    if (status === "slower") return "#f97316";
  }
  if (node.hasError) return "#ef4444";
  if (node.hasAnomaly) return "#ef4444";
  if (node.isSlow) return "#f97316";
  return "transparent";
}

function nodeOpacity(node: GraphNode, nodeSearch: string): number {
  if (nodeSearch.trim() === "") return 1;
  return node.functionName.toLowerCase().includes(nodeSearch.toLowerCase()) ? 1 : 0.2;
}

function ringDashArray(node: GraphNode, diff: GraphDiff | null): string {
  if (node.hasAnomaly && !node.hasError) return "4 2";
  if (node.isSlow && !node.hasError && !node.hasAnomaly) return "2 2";
  if (diff?.nodeStatus.get(node.id) === "slower") return "3 2";
  return "none";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useD3Graph({
  data,
  width,
  height,
  onNodeClick,
  selectedNodeId,
  nodeSearch,
  diff,
  onNodeHover,
  onMinimapUpdate,
}: UseD3GraphOptions): UseD3GraphResult {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const zoomTransformRef = useRef({ x: 0, y: 0, k: 1 });
  const initialized = useRef(false);
  const minimapTickCounter = useRef(0);

  // Stable callback refs — avoid stale closures in D3 event handlers.
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeHoverRef = useRef(onNodeHover);
  const onMinimapUpdateRef = useRef(onMinimapUpdate);
  onNodeClickRef.current = onNodeClick;
  onNodeHoverRef.current = onNodeHover;
  onMinimapUpdateRef.current = onMinimapUpdate;

  // ── Stable pan function (reads from refs) ──────────────────────────────────
  const panToGraphPoint = useCallback((gx: number, gy: number) => {
    if (svgRef.current === null || zoomBehaviorRef.current === null) return;
    d3.select(svgRef.current)
      .transition()
      .duration(450)
      .call(zoomBehaviorRef.current.translateTo as never, gx, gy);
  }, []);

  // ── Fit all nodes into view ────────────────────────────────────────────────
  const fitToScreen = useCallback(() => {
    if (svgRef.current === null || zoomBehaviorRef.current === null || simRef.current === null)
      return;
    const nodes = simRef.current.nodes();
    if (nodes.length === 0) return;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    const PAD = 80;
    const { clientWidth: w, clientHeight: h } = svgRef.current;
    const graphW = maxX - minX + PAD * 2;
    const graphH = maxY - minY + PAD * 2;
    const k = Math.min(w / graphW, h / graphH, 2);
    const tx = w / 2 - (k * (minX + maxX)) / 2;
    const ty = h / 2 - (k * (minY + maxY)) / 2;

    d3.select(svgRef.current)
      .transition()
      .duration(500)
      .call(zoomBehaviorRef.current.transform as never, d3.zoomIdentity.translate(tx, ty).scale(k));
  }, []);

  // ── Initial SVG setup (runs once on mount) ─────────────────────────────────
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const defs = svg.append("defs");

    // Arrow-head marker.
    defs
      .append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 22)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#4b5563");

    // Search glow filter — applied to circles of matching nodes.
    const glowFilter = defs
      .append("filter")
      .attr("id", "search-glow")
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");
    glowFilter.append("feGaussianBlur").attr("stdDeviation", 5).attr("result", "blur");
    const merge = glowFilter.append("feMerge");
    merge.append("feMergeNode").attr("in", "blur");
    merge.append("feMergeNode").attr("in", "SourceGraphic");

    // Zoom layer.
    const g = svg.append("g").attr("class", "zoom-layer");

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr("transform", event.transform.toString());
        zoomTransformRef.current = {
          x: event.transform.x,
          y: event.transform.y,
          k: event.transform.k,
        };
        // Emit minimap update on every zoom/pan event.
        const positions = new Map<string, { x: number; y: number }>();
        (simRef.current?.nodes() ?? []).forEach((n) => {
          positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
        });
        onMinimapUpdateRef.current({ positions, transform: zoomTransformRef.current });
      });

    zoomBehaviorRef.current = zoomBehavior;
    d3.select(svgRef.current as SVGSVGElement).call(zoomBehavior);

    g.append("g").attr("class", "edges");
    g.append("g").attr("class", "nodes");

    initialized.current = true;
  }, []);

  // ── Data update (nodes/edges/simulation) ───────────────────────────────────
  useEffect(() => {
    if (!initialized.current || svgRef.current === null) return;

    const svg = d3.select(svgRef.current);
    const g = svg.select<SVGGElement>("g.zoom-layer");
    const edgesG = g.select<SVGGElement>("g.edges");
    const nodesG = g.select<SVGGElement>("g.nodes");

    simRef.current?.stop();

    // Preserve positions across data updates.
    const existing = new Map<string, { x: number; y: number }>();
    (simRef.current?.nodes() ?? []).forEach((n) => {
      if (n.x !== undefined && n.y !== undefined) existing.set(n.id, { x: n.x, y: n.y });
    });

    const nodes: GraphNode[] = data.nodes.map((n) => {
      const pos = existing.get(n.id);
      const node: GraphNode = { ...n };
      if (pos !== undefined) {
        node.x = pos.x;
        node.y = pos.y;
      }
      return node;
    });

    const edges: GraphEdge[] = data.edges.map((e) => ({ ...e }));

    const sim = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphEdge>(edges)
          .id((d) => d.id)
          .distance(140),
      )
      .force("charge", d3.forceManyBody<GraphNode>().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<GraphNode>(50))
      .alphaDecay(0.03);

    simRef.current = sim;

    // ── Edges ─────────────────────────────────────────────────────────────────
    const edgeSel = edgesG
      .selectAll<SVGGElement, GraphEdge>("g.edge")
      .data(edges, (d) => d.id)
      .join(
        (enter) => {
          const eg = enter.append("g").attr("class", "edge");
          eg.append("line")
            .attr("stroke", "#4b5563")
            .attr("stroke-width", 1.5)
            .attr("marker-end", "url(#arrowhead)");
          eg.append("text")
            .attr("fill", "#6b7280")
            .attr("font-size", "10px")
            .attr("text-anchor", "middle");
          return eg;
        },
        (update) => update,
        (exit) => exit.remove(),
      );

    // ── Nodes ─────────────────────────────────────────────────────────────────
    const nodeSel = nodesG
      .selectAll<SVGGElement, GraphNode>("g.node")
      .data(nodes, (d) => d.id)
      .join(
        (enter) => {
          const ng = enter
            .append("g")
            .attr("class", "node")
            .style("cursor", "pointer")
            .call(
              d3
                .drag<SVGGElement, GraphNode>()
                .on("start", (event, d) => {
                  if (!event.active) sim.alphaTarget(0.3).restart();
                  d.fx = d.x ?? null;
                  d.fy = d.y ?? null;
                })
                .on("drag", (event, d) => {
                  d.fx = event.x;
                  d.fy = event.y;
                })
                .on("end", (event, d) => {
                  if (!event.active) sim.alphaTarget(0);
                  d.fx = null;
                  d.fy = null;
                }),
            )
            .on("click", (_event, d) => onNodeClickRef.current(d.id))
            .on("mouseenter", (_event, d) => onNodeHoverRef.current(d))
            .on("mouseleave", () => onNodeHoverRef.current(null));

          ng.append("circle").attr("r", 28).attr("stroke-width", 2);

          ng.append("circle")
            .attr("class", "ring")
            .attr("r", 33)
            .attr("fill", "none")
            .attr("stroke-width", 2.5);

          ng.append("text")
            .attr("class", "label")
            .attr("text-anchor", "middle")
            .attr("dy", "0.35em")
            .attr("fill", "#e5e7eb")
            .attr("font-size", "11px")
            .attr("font-family", "monospace")
            .style("pointer-events", "none");

          ng.append("text")
            .attr("class", "badge")
            .attr("text-anchor", "middle")
            .attr("dy", "0.35em")
            .attr("y", 44)
            .attr("fill", "#9ca3af")
            .attr("font-size", "9px")
            .style("pointer-events", "none");

          return ng;
        },
        (update) => update,
        (exit) => exit.remove(),
      );

    // Apply per-node visual attributes.
    nodeSel
      .select<SVGCircleElement>("circle:first-of-type")
      .attr("fill", (d) => nodeFill(d, diff))
      .attr("stroke", (d) => agentColor(d.agentId));

    nodeSel
      .select<SVGCircleElement>("circle.ring")
      .attr("stroke", (d) => nodeRingStroke(d, selectedNodeId, diff))
      .attr("stroke-dasharray", (d) => ringDashArray(d, diff));

    nodeSel.select<SVGTextElement>("text.label").text((d) => truncate(d.functionName, 12));
    nodeSel.select<SVGTextElement>("text.badge").text((d) => `×${d.callCount}`);

    applySearchHighlight(nodeSel, nodeSearch);

    // ── Simulation tick ────────────────────────────────────────────────────────
    sim.on("tick", () => {
      edgeSel
        .select<SVGLineElement>("line")
        .attr("x1", (d) => (d.source as unknown as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as unknown as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as unknown as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as unknown as GraphNode).y ?? 0);

      edgeSel
        .select<SVGTextElement>("text")
        .attr("x", (d) =>
          midpoint((d.source as unknown as GraphNode).x, (d.target as unknown as GraphNode).x),
        )
        .attr("y", (d) =>
          midpoint((d.source as unknown as GraphNode).y, (d.target as unknown as GraphNode).y),
        )
        .text((d) => `${Math.round(d.avgDurationMs)}ms`);

      nodeSel.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

      // Throttle minimap to ~10 fps.
      minimapTickCounter.current++;
      if (minimapTickCounter.current % 6 === 0) {
        const positions = new Map<string, { x: number; y: number }>();
        nodes.forEach((n) => positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 }));
        onMinimapUpdateRef.current({ positions, transform: zoomTransformRef.current });
      }
    });

    return () => {
      sim.stop();
    };
  }, [data, width, height]);

  // ── Selection ring update (no simulation rebuild) ──────────────────────────
  useEffect(() => {
    if (!initialized.current || svgRef.current === null) return;
    d3.select(svgRef.current)
      .selectAll<SVGCircleElement, GraphNode>("circle.ring")
      .attr("stroke", (d) => nodeRingStroke(d, selectedNodeId, diff));
  }, [selectedNodeId]);

  // ── Diff color update ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!initialized.current || svgRef.current === null) return;
    const root = d3.select(svgRef.current);
    root
      .selectAll<SVGCircleElement, GraphNode>("circle:first-of-type")
      .attr("fill", (d) => nodeFill(d, diff));
    root
      .selectAll<SVGCircleElement, GraphNode>("circle.ring")
      .attr("stroke", (d) => nodeRingStroke(d, selectedNodeId, diff))
      .attr("stroke-dasharray", (d) => ringDashArray(d, diff));
  }, [diff]);

  // ── Search highlight + auto-pan ────────────────────────────────────────────
  useEffect(() => {
    if (!initialized.current || svgRef.current === null) return;

    const nodeSel = d3.select(svgRef.current).selectAll<SVGGElement, GraphNode>("g.node");

    applySearchHighlight(nodeSel, nodeSearch);

    if (nodeSearch.trim() !== "") {
      const first = (simRef.current?.nodes() ?? []).find((n) =>
        n.functionName.toLowerCase().includes(nodeSearch.toLowerCase()),
      );
      if (first?.x !== undefined && first.y !== undefined) {
        panToGraphPoint(first.x, first.y);
      }
    }
  }, [nodeSearch, panToGraphPoint]);

  return { svgRef, panToGraphPoint, fitToScreen };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function applySearchHighlight(
  nodeSel: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>,
  nodeSearch: string,
): void {
  nodeSel.attr("opacity", (d) => nodeOpacity(d, nodeSearch));
  nodeSel
    .select<SVGCircleElement>("circle:first-of-type")
    .attr("filter", (d) =>
      nodeSearch.trim() !== "" && d.functionName.toLowerCase().includes(nodeSearch.toLowerCase())
        ? "url(#search-glow)"
        : null,
    );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

function midpoint(a: number | undefined, b: number | undefined): number {
  return ((a ?? 0) + (b ?? 0)) / 2;
}
