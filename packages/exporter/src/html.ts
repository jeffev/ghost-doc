import type { ExportGraph, SpanInput } from "./types.js";

// ---------------------------------------------------------------------------
// Service color palette
// ---------------------------------------------------------------------------

const PALETTE: Record<string, string> = {
  Handlers: "#3182ce",
  UserService: "#805ad5",
  OrderService: "#d69e2e",
  InventoryService: "#38a169",
  PaymentService: "#e53e3e",
  NotificationService: "#ed8936",
  DatabaseService: "#4a5568",
  CacheService: "#319795",
  AuditService: "#667eea",
  SearchService: "#48bb78",
  Other: "#718096",
};

const DEFAULT_COLOR = "#718096";

function serviceOf(functionName: string): string {
  const dot = functionName.indexOf(".");
  if (dot > 0) return functionName.slice(0, dot);
  if (/^handle[A-Z]|^process[A-Z]/.test(functionName)) return "Handlers";
  return "Other";
}

function colorOf(functionName: string): string {
  return PALETTE[serviceOf(functionName)] ?? DEFAULT_COLOR;
}

// ---------------------------------------------------------------------------
// Duration formatting (same as markdown.ts)
// ---------------------------------------------------------------------------

function durationLabel(ms: number): string {
  if (ms < 1) return `${Math.round(ms * 1000)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ---------------------------------------------------------------------------
// Graph data builders for Cytoscape
// ---------------------------------------------------------------------------

interface CyNode {
  data: {
    id: string;
    label: string;
    fullName: string;
    service: string;
    agentId: string;
    file: string;
    line: number;
    description: string;
    avgDuration: number;
    p95Duration: number;
    callCount: number;
    hasError: boolean;
    hasAnomaly: boolean;
    color: string;
  };
}

interface CyEdge {
  data: {
    id: string;
    source: string;
    target: string;
    label: string;
    callCount: number;
    avgDuration: number;
  };
}

function buildCyElements(graph: ExportGraph): { nodes: CyNode[]; edges: CyEdge[] } {
  const nodes: CyNode[] = graph.nodes.map((n) => ({
    data: {
      id: n.id,
      label: n.functionName.includes(".")
        ? n.functionName.split(".").slice(1).join(".")
        : n.functionName,
      fullName: n.functionName,
      service: serviceOf(n.functionName),
      agentId: n.agentId,
      file: n.file,
      line: n.line,
      description: n.description ?? "",
      avgDuration: n.avgDurationMs,
      p95Duration: n.p95DurationMs,
      callCount: n.callCount,
      hasError: n.hasError,
      hasAnomaly: n.hasAnomaly,
      color: colorOf(n.functionName),
    },
  }));

  const edges: CyEdge[] = graph.edges.map((e, i) => ({
    data: {
      id: `e${i}`,
      source: e.fromId,
      target: e.toId,
      label: durationLabel(e.avgDurationMs),
      callCount: e.callCount,
      avgDuration: e.avgDurationMs,
    },
  }));

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Error examples for the detail panel
// ---------------------------------------------------------------------------

interface ErrorExample {
  functionName: string;
  errorType: string;
  message: string;
  stack: string;
}

function extractErrorExamples(spans: SpanInput[]): Record<string, ErrorExample> {
  const examples: Record<string, ErrorExample> = {};
  for (const span of spans) {
    if (span.error !== null && !(span.source.function_name in examples)) {
      examples[span.source.function_name] = {
        functionName: span.source.function_name,
        errorType: span.error.type,
        message: span.error.message,
        stack: span.error.stack ?? "",
      };
    }
  }
  return examples;
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function htmlTemplate(
  projectName: string,
  nodes: CyNode[],
  edges: CyEdge[],
  graph: ExportGraph,
  errorExamples: Record<string, ErrorExample>,
): string {
  const palette = JSON.stringify(PALETTE);
  const cyNodes = JSON.stringify(nodes);
  const cyEdges = JSON.stringify(edges);
  const errorData = JSON.stringify(errorExamples);
  const generatedAt = new Date(graph.generatedAt).toISOString();
  const services = [...new Set(graph.nodes.map((n) => serviceOf(n.functionName)))].sort((a, b) => {
    if (a === "Handlers") return -1;
    if (b === "Handlers") return 1;
    return a.localeCompare(b);
  });
  const legendItems = services
    .map((s) => {
      const color = PALETTE[s] ?? DEFAULT_COLOR;
      return `<button class="legend-btn" data-service="${s}" style="--c:${color}">${s}</button>`;
    })
    .join("\n      ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Ghost Doc — ${projectName}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0f1117;
    color: #e2e8f0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Header ── */
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    height: 52px;
    background: #1a202c;
    border-bottom: 1px solid #2d3748;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  header h1 {
    font-size: 14px;
    font-weight: 700;
    color: #90cdf4;
    white-space: nowrap;
  }

  header .meta {
    font-size: 11px;
    color: #718096;
    white-space: nowrap;
  }

  .spacer { flex: 1; }

  header input[type="search"] {
    background: #2d3748;
    border: 1px solid #4a5568;
    border-radius: 6px;
    color: #e2e8f0;
    font-size: 13px;
    padding: 5px 10px;
    width: 200px;
    outline: none;
  }
  header input[type="search"]:focus { border-color: #63b3ed; }
  header input[type="search"]::placeholder { color: #718096; }

  .btn-group { display: flex; gap: 4px; }

  .ctrl-btn {
    background: #2d3748;
    border: 1px solid #4a5568;
    border-radius: 5px;
    color: #a0aec0;
    cursor: pointer;
    font-size: 11px;
    padding: 4px 9px;
    transition: background .15s, color .15s, border-color .15s;
  }
  .ctrl-btn:hover { background: #4a5568; color: #e2e8f0; }
  .ctrl-btn.active { background: #2b6cb0; border-color: #63b3ed; color: #fff; }

  /* ── Main layout ── */
  .workspace {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ── Legend sidebar ── */
  #legend {
    width: 170px;
    flex-shrink: 0;
    background: #1a202c;
    border-right: 1px solid #2d3748;
    padding: 12px 8px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  #legend .legend-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: #718096;
    padding: 0 4px 6px;
  }

  .legend-btn {
    background: transparent;
    border: 1.5px solid var(--c);
    border-radius: 5px;
    color: var(--c);
    cursor: pointer;
    font-size: 11px;
    padding: 5px 8px;
    text-align: left;
    transition: background .15s, color .15s;
    width: 100%;
  }
  .legend-btn:hover { background: var(--c); color: #fff; }
  .legend-btn.active { background: var(--c); color: #fff; }

  .legend-btn .badge {
    float: right;
    background: rgba(0,0,0,.25);
    border-radius: 10px;
    font-size: 10px;
    padding: 0 5px;
  }

  /* ── Cytoscape canvas ── */
  #cy {
    flex: 1;
    background: #0f1117;
  }

  /* ── Detail panel ── */
  #detail {
    width: 320px;
    flex-shrink: 0;
    background: #1a202c;
    border-left: 1px solid #2d3748;
    overflow-y: auto;
    transform: translateX(100%);
    transition: transform .2s ease;
    display: flex;
    flex-direction: column;
  }
  #detail.open { transform: translateX(0); }

  #detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid #2d3748;
    gap: 8px;
  }

  #detail-title {
    font-size: 13px;
    font-weight: 700;
    color: #fff;
    word-break: break-all;
  }

  #detail-close {
    background: none;
    border: none;
    color: #718096;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 2px 4px;
    flex-shrink: 0;
  }
  #detail-close:hover { color: #e2e8f0; }

  #detail-body {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    flex: 1;
  }

  .detail-section-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: #718096;
    margin-bottom: 6px;
  }

  .kv-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    font-size: 12px;
  }
  .kv-key { color: #718096; white-space: nowrap; }
  .kv-val { color: #e2e8f0; word-break: break-all; }

  .badge-pill {
    display: inline-block;
    border-radius: 99px;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
  }
  .badge-error { background: #fc8181; color: #1a202c; }
  .badge-anomaly { background: #f6ad55; color: #1a202c; }

  .connection-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .conn-item {
    background: #2d3748;
    border-radius: 5px;
    cursor: pointer;
    font-size: 11px;
    padding: 5px 9px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: #a0aec0;
    transition: background .12s, color .12s;
  }
  .conn-item:hover { background: #4a5568; color: #e2e8f0; }
  .conn-item .conn-arrow { color: #718096; font-size: 10px; }

  .error-box {
    background: #2d1818;
    border: 1px solid #fc8181;
    border-radius: 6px;
    padding: 10px;
  }
  .error-type { color: #fc8181; font-size: 11px; font-weight: 700; margin-bottom: 4px; }
  .error-msg { color: #fed7d7; font-size: 11px; margin-bottom: 6px; line-height: 1.4; }
  .error-stack {
    color: #a0aec0;
    font-family: monospace;
    font-size: 10px;
    line-height: 1.4;
    max-height: 120px;
    overflow-y: auto;
    white-space: pre;
  }

  /* ── Stats bar ── */
  #stats-bar {
    height: 28px;
    background: #1a202c;
    border-top: 1px solid #2d3748;
    display: flex;
    align-items: center;
    padding: 0 14px;
    gap: 16px;
    font-size: 11px;
    color: #718096;
    flex-shrink: 0;
  }
  #stats-bar span { color: #a0aec0; }

  /* ── Empty state ── */
  .empty-hint {
    text-align: center;
    color: #4a5568;
    font-size: 13px;
    padding: 40px 20px;
  }
</style>
</head>
<body>

<header>
  <h1>Ghost Doc — ${projectName}</h1>
  <span class="meta">
    ${graph.totalSpans} spans &bull; ${graph.nodes.length} functions &bull; ${generatedAt}
  </span>
  <div class="spacer"></div>
  <input type="search" id="search-input" placeholder="Search functions…" />
  <div class="btn-group">
    <button class="ctrl-btn active" id="btn-all" title="Show all nodes">All</button>
    <button class="ctrl-btn" id="btn-errors" title="Highlight error nodes">Errors</button>
    <button class="ctrl-btn" id="btn-anomalies" title="Highlight anomaly nodes">Anomalies</button>
  </div>
  <div class="btn-group">
    <button class="ctrl-btn active" id="btn-layout-dag" title="Hierarchical layout">Hierarchy</button>
    <button class="ctrl-btn" id="btn-layout-force" title="Force-directed layout">Force</button>
  </div>
  <div class="btn-group">
    <button class="ctrl-btn active" id="btn-edge-labels" title="Toggle edge labels">Labels</button>
    <button class="ctrl-btn" id="btn-fit" title="Fit graph to screen">Fit</button>
  </div>
</header>

<div class="workspace">
  <!-- Service legend -->
  <nav id="legend">
    <div class="legend-title">Services</div>
    <button class="legend-btn active" data-service="__all__" style="--c:#4a5568">All services</button>
    ${legendItems}
  </nav>

  <!-- Graph canvas -->
  <div id="cy"></div>

  <!-- Detail panel -->
  <aside id="detail">
    <div id="detail-header">
      <div id="detail-title">Select a node</div>
      <button id="detail-close" title="Close">×</button>
    </div>
    <div id="detail-body">
      <div class="empty-hint">Click any function node to inspect it.</div>
    </div>
  </aside>
</div>

<div id="stats-bar">
  <span id="stat-visible">Showing <span id="stat-count">${graph.nodes.length}</span> / ${graph.nodes.length} functions</span>
  <span id="stat-selected"></span>
</div>

<!-- Cytoscape from CDN -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.30.2/cytoscape.min.js"></script>

<script>
// ── Embedded data ──────────────────────────────────────────────────────────
const PALETTE  = ${palette};
const CY_NODES = ${cyNodes};
const CY_EDGES = ${cyEdges};
const ERROR_EXAMPLES = ${errorData};
const TOTAL_NODES = ${graph.nodes.length};

// ── Cytoscape init ─────────────────────────────────────────────────────────
const cy = cytoscape({
  container: document.getElementById("cy"),
  elements: {
    nodes: CY_NODES,
    edges: CY_EDGES,
  },
  style: [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        "border-width": 2,
        "border-color": "data(color)",
        "border-opacity": 0.6,
        color: "#fff",
        "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        "font-size": 11,
        "font-weight": 600,
        label: "data(label)",
        "min-zoomed-font-size": 8,
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "wrap",
        "text-max-width": 120,
        width: 140,
        height: 40,
        shape: "roundrectangle",
        "overlay-opacity": 0,
        "transition-property": "opacity, border-width, border-color",
        "transition-duration": "0.15s",
      },
    },
    {
      selector: "node[?hasError]",
      style: {
        "background-color": "#c53030",
        "border-color": "#fc8181",
        "border-width": 3,
      },
    },
    {
      selector: "node[?hasAnomaly]:not([?hasError])",
      style: {
        "border-color": "#f6ad55",
        "border-width": 3,
        "border-style": "dashed",
      },
    },
    {
      selector: "node[service = 'Handlers']",
      style: {
        shape: "hexagon",
        width: 130,
        height: 48,
      },
    },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "line-color": "#4a5568",
        "target-arrow-color": "#4a5568",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.8,
        opacity: 0.7,
        width: 1.5,
        label: "data(label)",
        "font-size": 9,
        color: "#a0aec0",
        "text-background-color": "#0f1117",
        "text-background-opacity": 0.8,
        "text-background-padding": "2px",
        "overlay-opacity": 0,
        "transition-property": "opacity, line-color, width",
        "transition-duration": "0.15s",
      },
    },
    {
      selector: ".faded",
      style: { opacity: 0.1 },
    },
    {
      selector: ".highlighted",
      style: {
        opacity: 1,
        "border-width": 4,
        "border-color": "#63b3ed",
        "z-index": 10,
      },
    },
    {
      selector: "edge.highlighted",
      style: {
        "line-color": "#63b3ed",
        "target-arrow-color": "#63b3ed",
        opacity: 1,
        width: 2.5,
        "z-index": 10,
      },
    },
    {
      selector: ".selected-node",
      style: {
        "border-width": 4,
        "border-color": "#90cdf4",
        "border-style": "solid",
        "z-index": 20,
      },
    },
    {
      selector: ".hidden-node",
      style: { display: "none" },
    },
  ],
  layout: { name: "breadthfirst", directed: true, spacingFactor: 1.5, padding: 40 },
  wheelSensitivity: 0.3,
  minZoom: 0.1,
  maxZoom: 4,
});

// ── State ──────────────────────────────────────────────────────────────────
let activeFilter   = "all";       // "all" | "errors" | "anomalies"
let activeService  = "__all__";   // service name or "__all__"
let searchQuery    = "";
let edgeLabelsOn   = true;
let selectedNodeId = null;

// ── Layout helpers ─────────────────────────────────────────────────────────
function runLayout(name) {
  const opts = name === "dag"
    ? { name: "breadthfirst", directed: true, spacingFactor: 1.6, padding: 40, animate: true, animationDuration: 350 }
    : { name: "cose", nodeRepulsion: 8000, idealEdgeLength: 120, padding: 40, animate: true, animationDuration: 500, randomize: false };
  cy.layout(opts).run();
}

// ── Visibility logic ───────────────────────────────────────────────────────
function applyVisibility() {
  cy.nodes().forEach((node) => {
    const d = node.data();
    const matchesSearch = searchQuery === "" || d.fullName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter =
      activeFilter === "all" ||
      (activeFilter === "errors" && d.hasError) ||
      (activeFilter === "anomalies" && d.hasAnomaly);
    const matchesService = activeService === "__all__" || d.service === activeService;

    if (matchesSearch && matchesFilter && matchesService) {
      node.removeClass("hidden-node");
    } else {
      node.addClass("hidden-node");
    }
  });

  // Hide edges whose source or target is hidden
  cy.edges().forEach((e) => {
    const srcHidden = e.source().hasClass("hidden-node");
    const tgtHidden = e.target().hasClass("hidden-node");
    if (srcHidden || tgtHidden) {
      e.addClass("hidden-node");
    } else {
      e.removeClass("hidden-node");
    }
  });

  // Update stats
  const visible = cy.nodes().filter((n) => !n.hasClass("hidden-node")).length;
  document.getElementById("stat-count").textContent = visible;
}

// ── Hover highlight ────────────────────────────────────────────────────────
cy.on("mouseover", "node", (evt) => {
  if (selectedNodeId !== null) return; // don't override selection
  const node = evt.target;
  const connected = node.closedNeighborhood();
  cy.elements().not(connected).addClass("faded");
  connected.addClass("highlighted");
  connected.nodes().removeClass("highlighted"); // edges only
  node.addClass("highlighted");
});

cy.on("mouseout", "node", () => {
  if (selectedNodeId !== null) return;
  cy.elements().removeClass("faded highlighted");
});

// ── Click to inspect ───────────────────────────────────────────────────────
cy.on("tap", "node", (evt) => {
  const node = evt.target;
  const d    = node.data();

  // Clear previous selection
  cy.nodes().removeClass("selected-node faded highlighted");
  cy.edges().removeClass("highlighted faded");

  // Highlight neighbourhood
  const connected = node.closedNeighborhood();
  cy.elements().not(connected).addClass("faded");
  connected.edges().addClass("highlighted");
  node.addClass("selected-node");

  selectedNodeId = d.id;
  renderDetailPanel(d);
  document.getElementById("stat-selected").textContent = "Selected: " + d.fullName;
});

cy.on("tap", (evt) => {
  if (evt.target === cy) {
    // Tap on background → clear selection
    cy.elements().removeClass("faded highlighted selected-node");
    selectedNodeId = null;
    closeDetail();
    document.getElementById("stat-selected").textContent = "";
  }
});

// ── Detail panel ───────────────────────────────────────────────────────────
function renderDetailPanel(d) {
  const panel = document.getElementById("detail");
  const title = document.getElementById("detail-title");
  const body  = document.getElementById("detail-body");

  title.textContent = d.fullName;
  title.style.color = d.color;

  const badges = [
    d.hasError    ? '<span class="badge-pill badge-error">ERR</span>'    : "",
    d.hasAnomaly  ? '<span class="badge-pill badge-anomaly">ANOMALY</span>' : "",
  ].filter(Boolean).join(" ");

  // Callers and callees
  const cyNode    = cy.getElementById(d.id);
  const callers   = cyNode.incomers("node").map((n) => n.data());
  const callees   = cyNode.outgoers("node").map((n) => n.data());

  const connItem = (nd, arrow) =>
    \`<div class="conn-item" data-node-id="\${nd.id}">
      <span>\${nd.fullName}</span>
      <span class="conn-arrow">\${arrow}</span>
    </div>\`;

  const errExample = ERROR_EXAMPLES[d.fullName];
  const errorSection = errExample
    ? \`<div>
        <div class="detail-section-title">Last Error</div>
        <div class="error-box">
          <div class="error-type">\${errExample.errorType}</div>
          <div class="error-msg">\${errExample.message}</div>
          \${errExample.stack ? \`<pre class="error-stack">\${errExample.stack.split("\\n").slice(0, 8).join("\\n")}</pre>\` : ""}
        </div>
      </div>\`
    : "";

  body.innerHTML = \`
    <div>
      \${d.description ? \`<p style="font-size:12px;color:#cbd5e0;line-height:1.5;margin-bottom:8px;">\${d.description}</p>\` : ""}
      <div class="kv-grid">
        <span class="kv-key">Function</span>
        <span class="kv-val">\${d.fullName} \${badges}</span>
        <span class="kv-key">Service</span>
        <span class="kv-val" style="color:\${d.color}">\${d.service}</span>
        <span class="kv-key">Agent</span>
        <span class="kv-val">\${d.agentId}</span>
        <span class="kv-key">File</span>
        <span class="kv-val">\${d.file}:\${d.line}</span>
      </div>
    </div>
    <div>
      <div class="detail-section-title">Metrics</div>
      <div class="kv-grid">
        <span class="kv-key">Avg latency</span>
        <span class="kv-val">\${formatDuration(d.avgDuration)}</span>
        <span class="kv-key">P95 latency</span>
        <span class="kv-val">\${formatDuration(d.p95Duration)}</span>
        <span class="kv-key">Call count</span>
        <span class="kv-val">\${d.callCount}</span>
      </div>
    </div>
    \${callers.length > 0 ? \`
    <div>
      <div class="detail-section-title">Called by (\${callers.length})</div>
      <div class="connection-list">
        \${callers.map((n) => connItem(n, "→ here")).join("")}
      </div>
    </div>\` : ""}
    \${callees.length > 0 ? \`
    <div>
      <div class="detail-section-title">Calls (\${callees.length})</div>
      <div class="connection-list">
        \${callees.map((n) => connItem(n, "calls →")).join("")}
      </div>
    </div>\` : ""}
    \${errorSection}
  \`;

  // Click on connection items → navigate to that node
  body.querySelectorAll(".conn-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.nodeId;
      const target = cy.getElementById(id);
      if (target.length > 0) {
        target.trigger("tap");
        cy.animate({ fit: { eles: target.closedNeighborhood(), padding: 80 }, duration: 300 });
      }
    });
  });

  panel.classList.add("open");
}

function closeDetail() {
  document.getElementById("detail").classList.remove("open");
}

document.getElementById("detail-close").addEventListener("click", () => {
  cy.elements().removeClass("faded highlighted selected-node");
  selectedNodeId = null;
  closeDetail();
  document.getElementById("stat-selected").textContent = "";
});

// ── Duration formatter ─────────────────────────────────────────────────────
function formatDuration(ms) {
  if (ms < 1)    return Math.round(ms * 1000) + "µs";
  if (ms < 1000) return ms.toFixed(1) + "ms";
  return (ms / 1000).toFixed(2) + "s";
}

// ── Controls ───────────────────────────────────────────────────────────────
function setActiveBtn(group, activeId) {
  document.querySelectorAll(group).forEach((b) => b.classList.remove("active"));
  document.getElementById(activeId).classList.add("active");
}

document.getElementById("btn-all").addEventListener("click", () => {
  activeFilter = "all";
  setActiveBtn(".btn-group .ctrl-btn:not(#btn-layout-dag):not(#btn-layout-force):not(#btn-edge-labels):not(#btn-fit)", "btn-all");
  document.getElementById("btn-all").classList.add("active");
  document.getElementById("btn-errors").classList.remove("active");
  document.getElementById("btn-anomalies").classList.remove("active");
  applyVisibility();
});

document.getElementById("btn-errors").addEventListener("click", () => {
  activeFilter = activeFilter === "errors" ? "all" : "errors";
  document.getElementById("btn-errors").classList.toggle("active");
  if (activeFilter === "errors") document.getElementById("btn-all").classList.remove("active");
  else document.getElementById("btn-all").classList.add("active");
  document.getElementById("btn-anomalies").classList.remove("active");
  applyVisibility();
});

document.getElementById("btn-anomalies").addEventListener("click", () => {
  activeFilter = activeFilter === "anomalies" ? "all" : "anomalies";
  document.getElementById("btn-anomalies").classList.toggle("active");
  if (activeFilter === "anomalies") document.getElementById("btn-all").classList.remove("active");
  else document.getElementById("btn-all").classList.add("active");
  document.getElementById("btn-errors").classList.remove("active");
  applyVisibility();
});

document.getElementById("btn-layout-dag").addEventListener("click", () => {
  setActiveBtn("#btn-layout-dag, #btn-layout-force", "btn-layout-dag");
  runLayout("dag");
});
document.getElementById("btn-layout-force").addEventListener("click", () => {
  setActiveBtn("#btn-layout-dag, #btn-layout-force", "btn-layout-force");
  runLayout("force");
});

document.getElementById("btn-edge-labels").addEventListener("click", () => {
  edgeLabelsOn = !edgeLabelsOn;
  document.getElementById("btn-edge-labels").classList.toggle("active");
  cy.style().selector("edge").style("label", edgeLabelsOn ? "data(label)" : "").update();
});

document.getElementById("btn-fit").addEventListener("click", () => {
  cy.fit(undefined, 40);
});

// ── Search ─────────────────────────────────────────────────────────────────
document.getElementById("search-input").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  applyVisibility();
});

// ── Service legend ─────────────────────────────────────────────────────────
document.querySelectorAll(".legend-btn").forEach((btn) => {
  // Add call count badge
  const svc = btn.dataset.service;
  if (svc !== "__all__") {
    const count = CY_NODES.filter((n) => n.data.service === svc).length;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = count;
    btn.appendChild(badge);
  }

  btn.addEventListener("click", () => {
    document.querySelectorAll(".legend-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeService = svc;
    applyVisibility();
    // Focus visible nodes
    const visible = cy.nodes().filter((n) => !n.hasClass("hidden-node"));
    if (visible.length > 0) cy.fit(visible, 60);
  });
});

// ── Initial fit ────────────────────────────────────────────────────────────
cy.ready(() => { cy.fit(undefined, 40); });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

export interface HtmlExportOptions {
  projectName?: string;
}

/**
 * Generates a self-contained interactive HTML file from an ExportGraph.
 *
 * Features:
 *   - Cytoscape.js force-directed / hierarchical graph
 *   - Nodes grouped and colored by service class
 *   - Click node → detail panel (metrics, callers, callees, error example)
 *   - Hover → highlight direct connections
 *   - Search box, service legend filter, error/anomaly filter
 *   - Layout switcher (Hierarchy / Force)
 *   - Edge label toggle
 */
export function buildHtmlDoc(graph: ExportGraph, options: HtmlExportOptions = {}): string {
  const projectName = options.projectName ?? "Project";
  const { nodes, edges } = buildCyElements(graph);
  const errorExamples = extractErrorExamples(graph.spans);
  return htmlTemplate(projectName, nodes, edges, graph, errorExamples);
}
