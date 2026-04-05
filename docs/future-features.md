# Future Features

This page collects ideas and planned improvements that go beyond the current stable feature set. Items here are not committed to any release timeline — they represent directions we want to explore.

Contributions and discussion are welcome. If you want to champion one of these, open an issue on GitHub and reference this page.

---

## Language Agents

### Go Agent (`@ghost-doc/agent-go`)

A Go tracing agent using middleware and context propagation patterns. Would instrument `net/http` handlers and gRPC interceptors out of the box, with a `Trace()` wrapper for arbitrary functions via a functional API (Go does not have decorators).

### Rust Agent (`@ghost-doc/agent-rust`)

A Rust crate providing a `#[trace]` procedural macro that wraps functions and emits `TraceEvent` over a background WebSocket thread. Async-compatible via Tokio.

### ~~Java / Kotlin Agent~~ — **Done** (`packages/agent-java`)

`@Trace` annotation with Spring AOP aspect. Includes functional API (`tracer.trace(fn)`), async support via `CompletableFuture`, 50ms WS batching, ring buffer, sanitization, and sample rate. See `packages/agent-java/`.

### C# / .NET Agent (`@ghost-doc/agent-dotnet`)

A NuGet package providing a `[Trace]` attribute backed by Castle DynamicProxy or Source Generators for zero-overhead instrumentation in .NET 8+.

---

## Contractum — Contract Inference & Validation

> Full planning document: [`contractum-mock-registry.md`](contractum-mock-registry.md)

Infer behavioral contracts from recorded calls and validate future calls against them at runtime. No AI required for the core — inference is deterministic, based on observed types and values.

- Contract inference from recorded `TraceEvent[]` → JSON Schema (args + return + error shapes)
- Runtime validation with configurable `onViolation` callback
- Export contracts to YAML/JSON; import external contracts (OpenAPI)
- Dashboard "Contracts" tab: per-function contract status, live violations feed, "Freeze Contract" one-click workflow
- CLI: `ghost-doc contract infer`, `ghost-doc contract validate`, `ghost-doc contract export`

---

## Mock Registry — Session Recording & Replay

> Full planning document: [`contractum-mock-registry.md`](contractum-mock-registry.md)

Turn Ghost Doc's recorded sessions into replayable HTTP mocks and static test fixtures.

- Named session recording: `ghost-doc mock record --name my-session`
- HTTP replay server: `ghost-doc mock serve --session my-session --port 8080` (exact, round-robin, latency-preserving modes)
- Static mock generation for Jest, Vitest, and pytest
- Session diff for regression detection: `ghost-doc mock diff baseline current`
- Dashboard "Mocks" tab: session list, replay controls, export, compare
- Cross-module: validate that mocked responses comply with inferred contracts

---

## Intelligence & AI

### AI-Generated Narrative Documentation

Send the recorded call graph to an LLM (configurable: Claude, GPT-4, local Ollama) and receive a natural-language summary of what the system does, which components are central, and where bottlenecks are. Output as a Markdown section appended to the exported doc.

```bash
ghost-doc export --format markdown --ai-summary --model claude-opus-4-6
```

### API Contract Inference

When HTTP handler spans are detected (method + URL in inputs), automatically infer an OpenAPI 3.1 spec from the recorded inputs and outputs. Export via:

```bash
ghost-doc export --format openapi --output openapi.yaml
```

### Automatic Performance Regression Detection

Compare two snapshots and automatically classify regressions: functions whose P95 latency increased by more than a configurable threshold are flagged, and a report is printed to stdout (useful in CI).

```bash
ghost-doc diff baseline.json --threshold 20  # flag regressions > 20%
```

### Anomaly Explanation

When an anomaly is flagged (return type changed), send the before/after output samples to an LLM and get a human-readable explanation of what changed and why it might be a bug.

---

## Integrations

### OpenTelemetry Bridge

Accept OTLP spans over gRPC or HTTP so that any OpenTelemetry-instrumented service can send traces to Ghost Doc without a dedicated agent. Ghost Doc becomes a lightweight local OTel collector with a better UX than Jaeger for development.

### GitHub Actions Integration

A first-party `ghost-doc-action` that:

- Runs the sample app (or the user's app) during CI
- Captures traces and exports a Markdown doc
- Posts a PR comment with a diff against the baseline snapshot from `main`
- Fails the build if a performance regression exceeds the configured threshold

### Slack / Discord / Webhook Alerts

Define alert rules in `~/.ghost-doc/config.json` that trigger when conditions are met during a live session:

```json
{
  "alerts": [
    { "if": "p95 > 500ms", "function": "db.query", "notify": "slack://webhook-url" },
    { "if": "anomaly_count > 5", "notify": "webhook://https://example.com/hook" }
  ]
}
```

### VSCode Extension

A companion VSCode extension that:

- Decorates `@trace`-annotated functions in the editor gutter with their live call count and avg duration
- Shows a hover card with the last recorded input/output
- Opens the dashboard inspector panel for a function directly from the editor

### Linear / JIRA Integration

When an error span is detected, automatically create a bug ticket in Linear or JIRA with the full stack trace, inputs, and a link to the snapshot.

### Database Query Tracing (Auto-Instrumentation)

Monkey-patch popular database clients (Prisma, TypeORM, Drizzle, `pg`, `mongoose`, `redis`) to emit child spans for every query without requiring `@trace` on each call. The span would include the query string (sanitized) and row count.

---

## Dashboard & UX

### Graph: Edge Width Encoding by Call Count

All edges currently render at a fixed `1.5px` width regardless of frequency. Scale edge width proportionally to `callCount` (e.g. 1px → 5px range) so hot paths — like the `AuditService.log → DatabaseService.execute` edge with 49 calls — are immediately visible without inspecting individual edges.

### Graph: Critical Path Highlighting

No current way to surface the highest-latency execution chain. A "Critical Path" button would compute the longest cumulative-duration path through the directed graph (e.g. `handleCheckout → processOrder → reserveStock` ≈ 340ms) and highlight it in a distinct color. The most valuable debugging feature for performance investigations.

### Graph: Node Size / Color Encoding by Latency

All nodes share the same fixed `140×40` shape regardless of how slow they are. Encode `avgDuration` (relative to graph-wide P95) as node height or background intensity, making outliers visible at a glance without clicking.

### Graph: "Slow Nodes" Filter

The anomaly detection flags type changes, but there is no filter for latency outliers. Add a "Slow" toggle button (alongside Errors / Anomalies) that shows only nodes whose `p95Duration` exceeds the graph-wide P95 threshold. `handleCheckout` at 607ms P95 is currently invisible without manual filtering.

### Graph: Incoming vs Outgoing Edge Color on Selection

When a node is selected, all neighboring edges highlight in the same blue. Differentiate direction: outgoing edges ("calls →") in green, incoming edges ("← called by") in a distinct color, making the data-flow direction readable at a glance.

### Graph: Dynamic Legend Generation from Data

The service legend sidebar is hardcoded in HTML. If a new service appears in trace data without a matching `<button>`, it is silently omitted. Generate legend buttons dynamically from the actual node dataset so new agents/services surface automatically.

### Graph: Hover Tooltip with Key Stats

Hovering a node currently only highlights its neighborhood — no data is shown until the user clicks. Add a lightweight tooltip showing `avgDuration`, `callCount`, and error/anomaly badges on hover, so key metrics are accessible without opening the full detail panel.

### Graph: Keyboard Navigation

- `Esc` — close detail panel and clear selection (currently requires clicking ×)
- `F` — fit graph to screen
- `L` — toggle edge labels
- `Arrow keys` — navigate between connected nodes when a node is selected

### Graph: Path Between Two Nodes

Allow selecting a source and a target node to highlight the shortest (or most-called) path between them. Useful for tracing how a handler reaches a specific database call across multiple service hops.

### Graph: Right-Click Context Menu

Right-clicking a node opens a context menu with quick actions: "Focus subtree", "Hide node", "Copy function name", "Copy JSON", "Pin node". Avoids requiring the full detail panel for simple operations.

### Detail Panel: "Copy JSON" Button

The inspector panel shows node data but provides no way to copy it. A "Copy JSON" button copies `JSON.stringify(nodeData, null, 2)` to the clipboard, enabling quick pasting into bug reports or documentation.

### Detail Panel: "Copy as curl" for HTTP Handlers

When a traced function is an HTTP handler (detectable by `method` + `url` in recorded inputs), generate a `curl` command from the last recorded input and show a "Copy as curl" button. Already listed in ROADMAP §3.5 but not yet implemented.

### Detail Panel: Duration Sparkline

Replace the plain `avgDuration` / `P95` text metrics with a small inline sparkline chart showing duration distribution across all recorded calls. Makes it immediately clear whether latency is stable or highly variable. Already listed in ROADMAP §3.5.

### Stats Bar: Richer Metrics

The current stats bar shows only visible/total node count. Add: total visible call count (sum of `callCount` for visible nodes), error rate (% of visible nodes with `hasError`), and weighted average latency across the visible graph.

### Multi-Select Services in Legend

The legend currently supports only one active service at a time (or "All"). Add multi-select so users can isolate, for example, `PaymentService` + `DatabaseService` together to see only payment-related database interactions.

### Heatmap View

A third visualization mode (alongside Flowchart and Flame Graph) that shows function call density over time as a 2D heatmap: X-axis = time, Y-axis = function, color intensity = call rate. Useful for spotting periodic spikes.

### Trace Search & Query

A full-text search bar that queries across all recorded span inputs and outputs, not just function names. Supports JSONPath-style queries:

```
input.userId == "u_123"
output.status == 404
error.type == "TimeoutError"
```

### Saved Filters / Views

Named filter presets that can be saved to `~/.ghost-doc/views.json` and restored from a dropdown in the header. Teams can commit shared views to version control.

### Custom Dashboard Layouts

A drag-and-drop layout editor that lets users pin specific functions as "watched nodes" in a sidebar, rearrange panels, and save layouts per project.

### Light Mode

A light color scheme for the dashboard (currently dark-only), toggled from the header.

### Trace Tagging UI

Allow users to add custom tags to spans directly from the inspector panel, stored locally and included in exports.

---

## Performance & Scale

### Tail-Based Sampling

Instead of dropping traces at the start (head sampling), buffer all traces for a configurable window and only emit complete traces that match criteria — e.g., traces containing errors or traces above P95 latency. This preserves the most interesting traces while still reducing volume.

```ts
const tracer = createTracer({
  agentId: "api",
  sampling: { strategy: "tail", bufferMs: 5000, emitIf: ["error", "slow"] },
});
```

### Multi-Hub Federation

Multiple Hubs (one per service/team) connect to a root Hub that aggregates all traces into a single cross-team call graph. Each sub-hub retains full local functionality; the root Hub provides the global view.

### Span Batching (Agent JS)

Buffer spans for up to 50ms and send them as a JSON array in a single WebSocket frame. Reduces frame overhead on high-throughput services without increasing latency perceptibly.

### Hub Persistence Layer (SQLite)

Replace the in-memory circular buffer with an optional SQLite backend so trace history survives Hub restarts. Enables querying historical data without replaying snapshots.

```bash
ghost-doc start --storage sqlite --db ~/.ghost-doc/traces.db
```

---

## Security & Privacy

### Hub Authentication Token

Protect the Hub WebSocket and REST API with a bearer token so Ghost Doc can be used on shared machines or remote hosts without exposing traces to other users on the same network.

```bash
ghost-doc start --auth-token my-secret
```

Agents pass the token via the `Authorization: Bearer` header on the WebSocket handshake.

### TLS / HTTPS Support

Allow the Hub to serve over `https://` and `wss://` for deployments on remote hosts (e.g., a shared dev server). The Hub would accept a path to a PEM certificate and key.

### Secrets Scanning Audit Report

A CLI command that replays all stored traces through the sanitizer and reports how many values would have been redacted, which keys triggered redaction, and which were caught by value-pattern detection. Useful for auditing sanitizer coverage before a security review.

```bash
ghost-doc audit --snapshot 2024-01-15T10-30-00-000Z
```

---

## Developer Experience

### Environment-Aware Configuration

Built-in support for per-environment tracer behavior without manual `process.env` checks in every project. A dedicated `environments` map in the tracer config (or a separate `ghost-doc.config.ts` file) would let you define different settings per environment and have the agent pick the right profile automatically.

**Proposed API — JavaScript:**

```ts
const tracer = createTracer({
  agentId: "my-api",
  environments: {
    development: { enabled: true, sampleRate: 1.0 },
    staging: { enabled: true, sampleRate: 0.1 },
    test: { enabled: false },
    production: { enabled: false },
  },
  // Falls back to NODE_ENV; override with GHOST_DOC_ENV
});
```

**Proposed API — Python:**

```python
tracer = Tracer(
    agent_id="my-api",
    environments={
        "development": {"enabled": True,  "sample_rate": 1.0},
        "staging":     {"enabled": True,  "sample_rate": 0.1},
        "test":        {"enabled": False},
        "production":  {"enabled": False},
    },
    # Reads APP_ENV or GHOST_DOC_ENV; falls back to "development"
)
```

**Proposed `ghost-doc.config.ts` (project-level):**

```ts
// ghost-doc.config.ts — committed to version control, shared across the team
export default {
  agentId: "my-api",
  hubUrl: "ws://localhost:3001/agent",
  environments: {
    development: { enabled: true, sampleRate: 1.0, hubUrl: "ws://localhost:3001/agent" },
    staging: { enabled: true, sampleRate: 0.05, hubUrl: "ws://staging-hub:3001/agent" },
    test: { enabled: false },
    production: { enabled: false },
  },
};
```

The active environment would be resolved in priority order:

1. `GHOST_DOC_ENV` environment variable
2. `NODE_ENV` / `APP_ENV` (language-specific)
3. Falls back to `"development"`

### `ghost-doc init` Setup Wizard

An interactive CLI wizard that detects the project framework (Next.js, Express, FastAPI, NestJS, etc.) and generates a ready-to-use tracer config and example instrumented file.

```bash
npx ghost-doc init
# → Detected: Next.js + TypeScript
# → Created: ghost-doc.config.ts
# → Added @trace to: app/api/route.ts (3 handlers)
```

### Source Map Support (Agent JS)

Resolve minified/transpiled stack traces to original TypeScript source locations using the project's source maps. Spans would show the `.ts` file and line number instead of the compiled `.js` output.

### Framework Auto-Instrumentation

Drop-in plugins that instrument entire frameworks without per-function decorators:

- `ghost-doc/next` — traces all Next.js API route handlers and Server Actions
- `ghost-doc/nestjs` — traces all NestJS controllers and providers via a module
- `ghost-doc/fastapi` — traces all FastAPI route handlers via a middleware class
- `ghost-doc/django` — traces all Django views via a middleware

### Test Run Correlation

When running tests, tag all spans with the current test name (via a Jest/pytest plugin). The dashboard gains a "test runs" dimension — you can filter the call graph to see exactly which functions a given test exercises.

---

## Export Targets

### JIRA / Confluence Cloud (OAuth)

Replace the current Confluence Basic Auth approach with OAuth 2.0 (the Atlassian Connect standard), enabling one-click authorization without API token management.

### Docusaurus / VitePress Plugin

A plugin for static site generators that embeds the live call graph (as a static HTML snapshot) directly into a documentation page at build time.

### PDF Export

Generate a print-ready PDF of the call graph and function index — useful for architecture review meetings and compliance documentation.

### Figma / Miro Export

Export the call graph as structured shapes to a Figma file or Miro board, allowing design and product teams to annotate the architecture without needing to run the tool themselves.

---

_Last updated: 2026-04-03_
