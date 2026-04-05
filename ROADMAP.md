# Ghost Doc — Development Roadmap

> Black-box documentation library that observes real code behavior and generates visual/text documentation automatically.

---

## Architecture Decision Records (Pre-Development)

Before writing code, these decisions must be locked:

| Decision                | Choice                                  | Rationale                                                    |
| :---------------------- | :-------------------------------------- | :----------------------------------------------------------- |
| Trace wire format       | JSON over WebSocket                     | Language-agnostic, human-readable, tooling-rich              |
| Hub transport           | WebSocket (ws://) + HTTP REST           | WS for live stream, REST for snapshots/export                |
| Dashboard framework     | React + D3.js                           | D3 owns the flowchart canvas; React owns the inspector panel |
| Hub runtime             | Node.js (standalone CLI binary)         | Ships as `npx ghost-doc` with zero config                    |
| Agent (JS)              | TypeScript decorators + Proxy API       | Works on class methods and plain functions                   |
| Agent (Python)          | `functools.wraps` decorator factory     | Compatible with sync and async functions                     |
| Trace schema versioning | `schema_version` field on every payload | Forward compatibility without breaking old agents            |
| Sanitization strategy   | Allowlist field names (not blocklist)   | Safer default; blocks unknown sensitive fields               |

---

## Phase 0 — Foundation (Week 1–2)

**Goal:** Shared contracts and monorepo scaffold. Zero features, zero bugs.

### 0.1 — Monorepo Setup

- [x] Init monorepo with `pnpm workspaces`
- [x] Packages: `packages/agent-js`, `packages/agent-python`, `packages/hub`, `packages/dashboard`, `packages/exporter`, `packages/shared-types`
- [x] Shared ESLint + Prettier config
- [x] Shared tsconfig base
- [x] Git hooks: pre-commit lint + type-check (husky + lint-staged + commitlint)

### 0.2 — Shared Trace Schema (`packages/shared-types`)

Define the single JSON contract that ALL agents must emit and the Hub must accept:

```typescript
// TraceEvent — every agent emits this
{
  schema_version: "1.0",
  trace_id: string,          // UUID v4 — unique per call chain
  span_id: string,           // UUID v4 — unique per function call
  parent_span_id: string | null,
  source: {
    agent_id: string,        // e.g. "frontend-react", "backend-python"
    language: "js" | "python" | "go" | ...,
    file: string,
    line: number,
    function_name: string,
    description?: string,    // optional — shown in tooltip & inspector
  },
  timing: {
    started_at: number,      // Unix ms
    duration_ms: number,
  },
  input: unknown[],          // sanitized arguments
  output: unknown,           // sanitized return value
  error: {
    type: string,
    message: string,
    stack: string,
  } | null,
  tags: Record<string, string>,
}
```

- [x] Write schema as Zod schema (validates at Hub boundary)
- [x] Generate JSON Schema from Zod for cross-language validation
- [x] Publish `@ghost-doc/shared-types` as internal workspace package

### 0.3 — CI/CD Skeleton

- [x] GitHub Actions: lint → type-check → test on PR (`ci.yml`)
- [x] GitHub Actions: publish to npm on push to `main` (`publish.yml`) using Changesets
- [x] Changesets for versioning (`ghost-doc` hub+dashboard as main publishable package)
- [x] Conventional commits enforced via commitlint

---

## Phase 1 — The Agent (Week 3–5)

**Goal:** A working JS agent that sends traces. Python agent follows same API.

### 1.1 — Agent JS (`packages/agent-js`)

#### Core Tracer

- [x] `createTracer(config)` factory — returns a configured tracer instance
- [x] Config: `{ agentId, hubUrl, enabled, sanitize: string[] }`
- [x] Transport layer: WebSocket client with auto-reconnect (exponential backoff)
- [x] Offline buffer: stores traces in memory (ring buffer, max 500) when Hub is unreachable, flushes on reconnect
- [ ] Trace ID propagation: reads/writes `X-Trace-Id` header (for HTTP contexts)

#### `@trace` Decorator

- [x] TypeScript method decorator `@trace(label?, description?)`
- [x] Captures: function name, file path, line number (via `Error.stack` parse)
- [x] Captures: serialized arguments and return value
- [x] Captures: `performance.now()` timing
- [x] Handles: async functions (awaits result before sending)
- [x] Handles: thrown errors (captures error, re-throws)
- [x] Handles: sync and async generator functions

#### `traceFunction` Wrapper (non-decorator style)

- [x] `const tracedFn = tracer.wrap(fn, label?, description?)` for plain functions and arrow functions
- [x] Same capture behavior as decorator

#### Sanitization

- [x] `sanitize: ["password", "token", "secret", "authorization"]` default list
- [x] Deep object walk: replaces matching keys with `"[REDACTED]"`
- [x] Custom sanitizer function support: `sanitize: (key, value) => ...`

#### Tests

- [x] Unit: each capture type (sync, async, error, generator)
- [x] Unit: sanitization (nested objects, arrays, edge cases)
- [x] Integration: agent → real Hub WebSocket → trace received

---

### 1.2 — Agent Python (`packages/agent-python`)

#### Core Tracer

- [x] `Tracer(agent_id, hub_url, sanitize=[])` class
- [x] WebSocket client: `websockets` library, async-first, sync wrapper available
- [x] Same offline buffer logic as JS agent

#### `@trace` Decorator

- [x] `@tracer.trace` decorator for sync functions
- [x] `@tracer.trace` decorator for async (`async def`) functions
- [x] Captures: `inspect.getfile()` + `inspect.getsourcelines()` for file/line
- [x] Captures: `*args, **kwargs` serialized via `json.dumps` with fallback `repr()`
- [x] Captures: `time.perf_counter()` timing
- [x] Auto-extracts first line of docstring (`fn.__doc__`) as `description` when none is explicitly provided

#### Tests

- [x] `pytest` suite mirroring JS agent tests
- [ ] Cross-agent integration: JS agent + Python agent → Hub → both traces visible

---

## Phase 2 — The Hub (Week 6–8)

**Goal:** A reliable local server that aggregates, correlates, and streams traces.

### 2.1 — Hub Server (`packages/hub`)

#### WebSocket Server

- [x] Accepts connections from Agents on `ws://localhost:3001/agent`
- [x] Accepts connections from Dashboard on `ws://localhost:3001/dashboard`
- [x] Validates every incoming trace against Zod schema — invalid traces are logged and discarded (never crash)
- [x] Fan-out: every validated trace is broadcast to all connected Dashboard clients

#### HTTP REST API

- [x] `GET /health` — returns `{ status: "ok", agents: number, traces_total: number }`
- [x] `GET /traces` — returns last N traces (queryable: `?limit=100&agent_id=frontend`)
- [x] `GET /traces/:trace_id` — returns full call tree for a distributed trace
- [x] `POST /snapshot` — saves current trace buffer to `~/.ghost-doc/snapshots/<timestamp>.json`
- [x] `GET /snapshots` — lists saved snapshots
- [x] `GET /snapshots/:id` — loads a specific snapshot

#### Trace Correlation Engine

- [x] Groups spans by `trace_id` into a tree structure (parent_span_id → children)
- [x] Detects cross-agent calls: when `trace_id` matches across agents → marks as distributed trace
- [x] Detects anomalies: tracks return type per function; flags when type changes → adds `anomaly: true` to span

#### In-Memory Store

- [x] Circular buffer: keeps last 10,000 spans in memory
- [x] Indexed by: `trace_id`, `span_id`, `agent_id`, `function_name`
- [x] Configurable periodic flush to disk (`~/.ghost-doc/traces/`) via `flushIntervalMs`

#### Data Sanitization Layer

- [x] Second pass sanitization at Hub boundary (defense-in-depth)
- [x] Configurable via `~/.ghost-doc/config.json` (`sanitizeKeys`, `port`, `flushIntervalMs`)

#### Static Dashboard Serving

- [x] Hub serves pre-built dashboard from `hub/public` via `@fastify/static`
- [x] SPA fallback: all unmatched routes return `index.html` for client-side routing
- [x] Dashboard WebSocket URL derived from `window.location` in production (no hardcoded host)
- [x] `pnpm copy-dashboard` script copies `dashboard/dist` to `hub/public`

#### CLI Entry Point

- [x] `npx ghost-doc start` — starts Hub + opens Dashboard in browser at `http://localhost:3001`
- [x] `npx ghost-doc start --port 3001 --no-open`
- [x] `npx ghost-doc stop` — graceful shutdown
- [x] `npx ghost-doc status` — shows connected agents and trace count
- [x] Colored terminal output: connected agents, trace rate/sec

#### Tests

- [x] Unit: trace validation (valid, invalid, malformed)
- [x] Unit: correlation engine (simple tree, cross-agent, anomaly detection)
- [x] Integration: Hub ↔ Agent WebSocket round-trip
- [ ] Load test: 1,000 traces/sec without dropping (k6 or autocannon)

---

## Phase 3 — The Dashboard (Week 9–13)

**Goal:** A real-time visual interface that makes trace data understandable.

### 3.1 — Project Setup

- [x] Vite + React + TypeScript
- [x] D3.js for flowchart canvas
- [x] Zustand for state management (trace store, time-travel state)
- [x] Tailwind CSS for UI
- [x] Vitest + React Testing Library

### 3.2 — WebSocket Client

- [x] Connects to `ws://localhost:3001/dashboard`
- [x] Auto-reconnect with status indicator (green/yellow/red dot in header)
- [x] Appends incoming traces to Zustand store

### 3.3 — Real-Time Flowchart

- [x] D3 force-directed graph: nodes = functions, edges = calls
- [x] Node renders: function name, agent badge (color per agent), call count
- [x] Node tooltip: shows description (from `@trace` / docstring), call stats, file path
- [x] Edge renders: arrow direction = call direction, label = duration_ms
- [x] Incremental update: new nodes/edges animate in (no full re-render)
- [x] Zoom + pan (D3 zoom behavior)
- [x] Node grouping: collapse/expand by agent or source file (Group by dropdown)
- [x] Node search: highlight matching nodes, dim others, auto-pan to first match
- [x] Node filter: remove non-matching nodes entirely from the graph

#### Anomaly Visualization

- [x] Normal node: neutral color
- [x] Anomaly node: red border + pulsing indicator
- [x] Error node: red fill + error icon
- [x] Slow node (> P95 duration across visible graph): orange dashed border

### 3.4 — Time-Travel Debugger

- [x] Timeline bar at bottom: tick = 1 second, scrubable
- [x] "Live" button: snaps to current time
- [x] Scrub past: re-renders flowchart as it was at that timestamp
- [x] Playback speed: 0.5x, 1x, 2x, 10x
- [x] Marks anomalies as red ticks on timeline

### 3.5 — Deep-Dive Inspector (Right Panel)

Triggered by clicking any node in the flowchart:

- [x] Function signature (name, file:line)
- [x] Description (from `@trace` or auto-extracted from Python docstring)
- [x] Agent badge and anomaly/error indicators
- [x] Call count, avg duration, P95 duration, duration sparkline
- [x] All recorded calls for this function (list, newest first)
- [x] Per-call detail: input args (formatted JSON), output (formatted JSON), duration, timestamp
- [x] Error detail: type, message, full stack trace
- [x] "Copy as curl" (detects HTTP handler spans by inspecting input args)
- [x] "Copy trace JSON" button

### 3.6 — Header / Controls

- [x] Connected agents list with online/offline status
- [x] Trace rate counter (traces/sec)
- [x] Clear button (wipes in-memory store)
- [x] Search / filter: by agent, by function name
- [x] Flame graph / Flowchart view toggle
- [x] Snapshot comparison (Compare… button, diff colors)
- [x] Minimap (click-to-pan, shows viewport indicator)

### 3.7 — Tests

- [x] Unit: Zustand store reducers (trace append, time-travel seek)
- [x] Unit: anomaly detection logic
- [x] Component: Inspector panel renders correctly per trace type
- [ ] E2E (Playwright): Hub running → agent emits trace → Dashboard shows node

---

## Phase 4 — The Exporter (Week 14–15)

**Goal:** Turn the live graph into permanent, shareable documentation.

### 4.1 — Exporter Core (`packages/exporter`)

#### Markdown + Mermaid Export

- [x] Takes current trace graph (nodes + edges) as input
- [x] Generates Mermaid `flowchart TD` syntax
- [x] Wraps in Markdown template:
  - Title, generated timestamp, agent list
  - Mermaid code block (renders natively on GitHub)
  - Function index table (name, file, avg duration, call count)
  - Anomalies section (if any)
- [x] CLI: `npx ghost-doc export --format markdown --output docs/FLOW.md`

#### Snapshot Share

- [x] `npx ghost-doc snapshot` — saves `~/.ghost-doc/snapshots/<id>.json`
- [x] Snapshot includes: full trace tree + metadata (agents, timestamp, tags)
- [x] `npx ghost-doc share <snapshot-id>` — outputs a base64-encoded URL fragment that can be opened with `ghost-doc load`
- [x] `npx ghost-doc load <encoded>` — restores snapshot into Dashboard (time-travel from snapshot)

#### Wiki-Sync (Notion)

- [x] `ghost-doc export --format notion --token <NOTION_TOKEN> --page-id <ID>`
- [x] Creates/updates a Notion page with Mermaid block + function table
- [x] Idempotent: re-running updates the same page, doesn't create duplicates

#### Wiki-Sync (Obsidian)

- [x] `ghost-doc export --format obsidian --vault-path ~/Notes`
- [x] Writes `Ghost-Doc/<project-name>.md` into the vault
- [x] Uses Obsidian-compatible Mermaid block

#### Wiki-Sync (Confluence)

- [x] `ghost-doc export --format confluence --url <BASE> --space <KEY> --token <TOKEN>`
- [x] Converts Mermaid to Confluence macro format

### 4.2 — Tests

- [x] Unit: Mermaid generator (simple graph, cross-agent, anomaly annotation)
- [x] Unit: snapshot encode/decode round-trip
- [x] Integration: full export pipeline from trace store → `.md` file

---

## Phase 5 — Hardening & DX (Week 16–18)

**Goal:** Production-quality ergonomics, security, and performance.

### 5.1 — Security

- [ ] Threat model: Hub is local-only by default (`127.0.0.1`, no external binding)
- [ ] Optional auth token for Hub WebSocket (`--auth-token`)
- [ ] Sanitization audit: red-team test with intentionally poisoned payloads
- [ ] Dependency audit: `npm audit` + `pip audit` in CI

### 5.2 — Performance

- [ ] Agent JS: trace emission is non-blocking (never delays the original function)
- [ ] Agent JS: batching mode — buffer 50ms of traces, send as array (reduces WS frames)
- [ ] Hub: measure and optimize fan-out under 500 concurrent Dashboard connections
- [ ] Dashboard: D3 graph virtual renders nodes outside viewport (large graphs)
- [ ] Dashboard: debounce re-renders to 60fps max

### 5.3 — Developer Experience

- [ ] `npx ghost-doc init` — interactive setup wizard (detects framework, generates config file)
- [ ] VSCode extension: highlights `@trace`-decorated functions in the editor
- [ ] Source map support: JS agent resolves minified stack traces
- [ ] Agent JS: zero-config mode (auto-connects to `localhost:3001` if no config provided)
- [ ] Meaningful error messages: "Hub not reachable — run `npx ghost-doc start` first"

### 5.4 — Documentation

- [ ] `docs/` site (VitePress or Docusaurus)
- [ ] Getting Started: 5-minute quickstart
- [ ] API Reference: all `@trace` options, Hub config, CLI flags
- [ ] Integration guides: Next.js, FastAPI, Express, NestJS
- [ ] Architecture deep-dive: trace schema, correlation algorithm, sanitization model

---

## Phase 6 — Public Release (Week 19–20)

**Goal:** Publish packages and establish public presence.

### 6.1 — Package Publishing

- [x] `ghost-doc` (Hub + CLI + bundled Dashboard) published to npm — package name: `ghost-doc`
- [x] `@ghost-doc/agent-js` published to npm
- [x] GitHub Actions publish workflow (`publish.yml`) using Changesets action
- [x] Changesets configured: `access: "public"`, hub as primary publishable package
- [ ] Publish `ghost-doc-agent` Python agent to PyPI
- [ ] Semantic versioning: bump to `0.1.0` final release
- [ ] Provenance: npm `--provenance` flag for supply-chain transparency

### 6.2 — Launch Assets

- [ ] Demo GIF/video: 60-second screencast showing full flow
- [ ] README badge wall: npm version, PyPI version, CI status, license
- [ ] CONTRIBUTING.md
- [ ] Issue templates: bug report, feature request

---

## Milestone Summary

| Phase | Deliverable                                     | Week    |
| :---- | :---------------------------------------------- | :------ |
| **0** | Monorepo + shared types                         | 1–2     |
| **1** | JS Agent + Python Agent                         | 3–5     |
| **2** | Hub (server + CLI)                              | 6–8     |
| **3** | Dashboard (flowchart + inspector + time-travel) | 9–13    |
| **4** | Exporter (Markdown + Snapshot + Wiki-Sync)      | 14–15   |
| **5** | Hardening, perf, DX, docs                       | 16–18   |
| **6** | Public release                                  | 19–20   |
| **7** | Contractum + Mock Registry                      | Backlog |

---

## Dependency Graph (what blocks what)

```
Phase 0 (shared-types)
    ├── Phase 1 (Agent JS + Python)  [needs TraceEvent schema]
    │       └── Phase 2 (Hub)        [needs Agent to test against]
    │               ├── Phase 3 (Dashboard)       [needs Hub WebSocket]
    │               ├── Phase 4 (Exporter)        [needs Hub REST API]
    │               ├── Phase 7.A (Contractum)    [needs Hub store]
    │               └── Phase 7.B (Mock Registry) [needs Hub store + snapshots]
    │                       └── Phase 7.C (Integration) [needs 7.A + 7.B]
    └── Phase 5 (Hardening)          [needs Phases 1–4 complete]
            └── Phase 6 (Release)
```

**Phases 3 and 4 can run in parallel once Phase 2 is done.**
**Phases 7.A and 7.B are independent and can run in parallel after Phase 2.**

---

## Phase 7 — Contractum & Mock Registry (Backlog)

**Goal:** Transform Ghost Doc from passive observer into an active platform for contract enforcement and realistic test simulation. Full planning → [`docs/contractum-mock-registry.md`](docs/contractum-mock-registry.md)

### 7.A — Contractum (Contract Inference & Validation)

- [ ] `ghostDoc.contract.infer(options)` — generate JSON Schema from recorded calls (deterministic, no AI)
- [ ] `ghostDoc.contract.validate(contract, options)` — intercept future calls and report violations
- [ ] `ghostDoc.contract.validateCalls(calls, contract)` — validate a call array (used by mock validation)
- [ ] `ghostDoc.contract.export(filename, format)` — save contract to disk (JSON / YAML / TypeScript)
- [ ] `ghostDoc.contract.load(definition)` — import external contracts (OpenAPI, hand-written)
- [ ] CLI: `ghost-doc contract infer | validate | export`
- [ ] Dashboard: Contracts tab — function list, contract schema viewer, live violations feed
- [ ] Dashboard: "Freeze Contract" one-click workflow from inspector panel

### 7.B — Mock Registry (Session Recording & Replay)

- [ ] `ghostDoc.mock.startRecording(name, options)` / `stopRecording()` — explicit named sessions
- [ ] `ghostDoc.mock.serve(port, session, options)` — HTTP mock server (exact / round-robin / latency-preserving)
- [ ] `ghostDoc.mock.generate(session, outputFile, options)` — static mock files for Jest / Vitest / pytest
- [ ] `ghostDoc.mock.diff(sessionA, sessionB)` — behavioral regression detection between sessions
- [ ] `ghostDoc.mock.exportCalls(session)` — raw call array for programmatic use
- [ ] CLI: `ghost-doc mock record | serve | generate | diff`
- [ ] Dashboard: Mocks tab — session list, replay controls, export, compare

### 7.C — Cross-Module Integration

- [ ] Validate mock sessions against inferred contracts (detect mocks that propagate broken behavior)
- [ ] CI commands: `ghost-doc contract validate --on-violation exit-1`, `ghost-doc mock diff --on-regression exit-1`
- [ ] Dashboard: lock icon on "frozen" contract nodes, warning badge on non-compliant mock sessions

**Dependency:** Requires Phase 2 (Hub store + snapshots) complete. Phases 7.A and 7.B are independent and can run in parallel.

---

## Phase 8 — Future Features (Backlog)

Ideas and directions beyond the current roadmap. Not committed to any release timeline.
See the full breakdown → [`docs/future-features.md`](docs/future-features.md)

### Language Agents

- [ ] Go agent (`@ghost-doc/agent-go`) — middleware + context propagation
- [ ] Rust agent — `#[trace]` procedural macro via Tokio
- [x] Java/Kotlin agent — `@Trace` annotation + Spring AOP (`packages/agent-java`)
- [ ] C# / .NET agent — `[Trace]` attribute via Source Generators

### Intelligence & AI

- [ ] AI-generated narrative documentation (LLM summarizes the call graph)
- [ ] API contract inference → OpenAPI 3.1 export from HTTP handler spans
- [ ] Automated performance regression detection (`ghost-doc diff baseline.json`)
- [ ] Anomaly explanation via LLM (what changed, why it might be a bug)

### Integrations

- [ ] OpenTelemetry bridge (accept OTLP spans — Ghost Doc as a local OTel collector)
- [ ] GitHub Actions integration (trace on PR, post diff comment, fail on regression)
- [ ] Slack / Discord / webhook alerts based on configurable rules
- [ ] VSCode extension (gutter decorations, hover cards, inline call stats)
- [ ] Linear / JIRA auto-ticket on error span detection
- [ ] Database query auto-instrumentation (Prisma, TypeORM, Drizzle, pg, mongoose)

### Dashboard & UX

#### Graph visualization

- [ ] Edge width scaled by `callCount` — hot paths visually obvious without inspection
- [ ] Critical path highlighting — longest cumulative-duration path highlighted on demand
- [ ] Node size / color intensity encoding by `avgDuration` relative to graph-wide P95
- [ ] "Slow" filter button — shows nodes whose P95 exceeds graph-wide threshold (alongside Errors / Anomalies)
- [ ] Incoming vs outgoing edge color differentiation on node selection
- [ ] Dynamic legend generation from trace data (no more hardcoded service buttons)
- [ ] Hover tooltip with `avgDuration`, `callCount`, error/anomaly badges (no click required)
- [ ] Keyboard shortcuts: `Esc` close panel, `F` fit, `L` labels, arrow-key node navigation
- [ ] Path between two nodes — highlight shortest/most-called route across service hops
- [ ] Right-click context menu: Focus subtree, Hide node, Copy name, Copy JSON, Pin node
- [ ] Multi-select services in legend (e.g. PaymentService + DatabaseService simultaneously)

#### Detail panel

- [ ] "Copy JSON" button — copies full node data to clipboard
- [ ] "Copy as curl" for HTTP handler spans (already in ROADMAP §3.5)
- [ ] Duration sparkline replacing plain avg/P95 text (already in ROADMAP §3.5)

#### Stats bar

- [ ] Total visible call count (sum of `callCount` for visible nodes)
- [ ] Error rate (% of visible nodes with `hasError`)
- [ ] Weighted average latency across visible graph

#### Other

- [ ] Heatmap view (call density over time per function)
- [ ] Trace search & query (JSONPath-style queries across span inputs/outputs)
- [ ] Saved filters / named views (commit to version control)
- [ ] Custom dashboard layouts (drag-and-drop, watched nodes)
- [ ] Light mode
- [ ] Trace tagging UI (add custom tags from the inspector)

### Performance & Scale

- [ ] Tail-based sampling (emit only error traces or slow traces after buffering)
- [ ] Multi-hub federation (sub-hubs aggregate into a root hub)
- [ ] Span batching in agent-js (50ms buffer, single WS frame)
- [ ] SQLite persistence layer for the Hub (survive restarts)

### Security & Privacy

- [ ] Hub authentication token (`--auth-token`)
- [ ] TLS / HTTPS / WSS support for remote Hub deployments
- [ ] Secrets scanning audit report (`ghost-doc audit`)

### Developer Experience

- [ ] Environment-aware configuration (`environments` map in tracer config; auto-reads `NODE_ENV` / `APP_ENV` / `GHOST_DOC_ENV`)
- [ ] Project-level `ghost-doc.config.ts` file (shared across team, committed to version control)
- [ ] `ghost-doc init` interactive setup wizard (framework detection)
- [ ] Source map support in agent-js (resolve `.ts` file/line from compiled output)
- [ ] Framework auto-instrumentation plugins (Next.js, NestJS, FastAPI, Django)
- [ ] Test run correlation (tag spans with current test name via Jest/pytest plugin)

### Export Targets

- [ ] Atlassian Connect OAuth (replace Confluence Basic Auth)
- [ ] Docusaurus / VitePress plugin (embed call graph in static docs at build time)
- [ ] PDF export
- [ ] Figma / Miro export

---

## Tech Stack Summary

| Layer        | Technology                                           |
| :----------- | :--------------------------------------------------- |
| Monorepo     | pnpm workspaces + Changesets                         |
| Agent JS     | TypeScript, `ws`, `reflect-metadata`                 |
| Agent Python | Python 3.10+, `websockets`, `asyncio`                |
| Hub          | Node.js, `ws`, `fastify`, Zod                        |
| Dashboard    | React 18, TypeScript, D3.js, Zustand, Tailwind, Vite |
| Exporter     | TypeScript, `@notionhq/client`, file I/O             |
| Testing      | Vitest, Playwright, pytest, k6                       |
| CI/CD        | GitHub Actions, Changesets                           |
| Docs         | VitePress                                            |
