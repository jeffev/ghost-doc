# 👻 Ghost Doc

> **Your code's black box.** Ghost Doc observes how your functions actually behave at runtime and turns that into visual documentation — automatically, without a single written comment.

[![CI](https://github.com/jeffev/ghost-doc/actions/workflows/ci.yml/badge.svg)](https://github.com/jeffev/ghost-doc/actions/workflows/ci.yml)
[![npm ghost-doc](https://img.shields.io/npm/v/ghost-doc?label=ghost-doc)](https://www.npmjs.com/package/ghost-doc)
[![npm agent-js](https://img.shields.io/npm/v/@ghost-doc/agent-js?label=%40ghost-doc%2Fagent-js)](https://www.npmjs.com/package/@ghost-doc/agent-js)
[![PyPI](https://img.shields.io/pypi/v/ghost-doc-agent)](https://pypi.org/project/ghost-doc-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#license)

---

## What is Ghost Doc?

Most documentation is written once and never updated. Ghost Doc takes a different approach: instead of asking developers to describe what their code does, it watches what the code actually does and draws the map for you.

Instrument your functions with a single decorator. Start your app. Ghost Doc captures every call — arguments, return values, timing, errors, and call order — and streams them to a local dashboard where your architecture is rendered as a live, interactive flowchart. When you're ready, export it to Markdown, Notion, Obsidian, or Confluence with one command.

```
User clicks button
  → handleSubmit()        42 ms
    → validateForm()       3 ms
    → createOrder()       38 ms
      → db.insert()       31 ms  ← anomaly detected
```

---

## Features

- **Zero-config instrumentation** — one decorator, one import, done
- **Real-time flowchart** — D3-powered live call graph with zoom, pan, drag, and time-travel
- **Flame graph view** — visualize call stack depth and execution time per trace
- **Node search & highlight** — find any function instantly; matching nodes glow and the view auto-pans
- **Description tooltips** — hover any node to see its call stats and the optional description you provided
- **Snapshot comparison** — load any saved snapshot to diff it against the live graph (added / faster / slower)
- **Minimap** — always-visible overview with click-to-pan navigation
- **Distributed tracing** — trace requests across multiple services and languages simultaneously
- **Anomaly detection** — automatically flags when a function's return type changes unexpectedly
- **Deep-dive inspector** — click any node to see every recorded call: inputs, outputs, stack traces, and a duration histogram
- **Time-travel debugger** — scrub back through history to replay your app's state at any moment
- **Privacy-first** — passwords, tokens, JWTs, and credit card numbers redacted before leaving your process — by key name and by value pattern
- **Head-based sampling** — emit only a fraction of calls to reduce bandwidth on high-traffic services
- **Keyboard shortcuts** — `F` fits the graph, `Esc` closes the inspector, `Space` toggles time-travel, and more
- **One-click export** — download self-contained HTML or Markdown directly from the dashboard header
- **HTTP middleware** — drop-in Express and Fastify middleware for automatic distributed trace propagation
- **Contract inference** — automatically derive behavioral contracts (JSON Schema) from recorded calls; re-infer as your API evolves
- **Contract validation** — validate future calls against frozen contracts and see violations highlighted in the Dashboard
- **Mock generation** — export any recorded session as ready-to-use Jest, Vitest, or pytest mock files with one command
- **Mock HTTP server** — replay a recorded session as a live HTTP service for integration tests (`exact`, `round-robin`, or `latency-preserving` modes)
- **Session diff** — compare two recorded sessions to detect breaking return-shape changes, error-rate shifts, and latency regressions
- **Language-agnostic** — JavaScript/TypeScript and Python agents today; Go, Rust, Java, C#, and others can implement the open wire format
- **Export anywhere** — Markdown/Mermaid, self-contained HTML, Notion, Obsidian, or Confluence

---

## Quick Start

### Running from the monorepo

> The npm and PyPI packages are not yet published. Follow these steps to run Ghost Doc locally from the source.

**Prerequisites:** Node.js 20+, pnpm 10+, Python 3.10+ (optional, for the Python agent)

```bash
git clone https://github.com/your-org/ghost-doc.git
cd ghost-doc
pnpm install

# Build the packages that the Hub depends on
pnpm demo:build
```

Start the Hub (it serves the dashboard on the same port):

```bash
pnpm ghost-doc start
# → Hub + Dashboard at http://localhost:3001
```

Open `http://localhost:3001` in your browser.

> **Dev mode (hot-reload):** If you're working on the dashboard source, run the Vite dev server in parallel instead:
>
> ```bash
> # Terminal 1 — Hub
> pnpm ghost-doc start
> # Terminal 2 — Dashboard dev server (hot-reload, http://localhost:8080)
> pnpm --filter @ghost-doc/dashboard dev
> ```

### Instrument your code

**JavaScript / TypeScript**

```ts
import { createTracer } from "@ghost-doc/agent-js";

const tracer = createTracer({ agentId: "my-app" });

class OrderService {
  @tracer.trace()
  async createOrder(userId: string, items: CartItem[]) {
    return db.orders.create({ userId, items });
  }

  @tracer.trace("payment.charge", "Charges the user's card via Stripe")
  async chargeCard(orderId: string, amount: number) {
    return stripe.charges.create({ amount, orderId });
  }
}

// For plain functions and arrow functions:
const fetchUser = tracer.wrap(
  async (id: string) => db.users.findById(id),
  "fetchUser",
  "Fetches a user record from the database",
);
```

**Python**

```python
from ghost_doc_agent import Tracer

tracer = Tracer(agent_id="my-app")

@tracer.trace
def get_user(user_id: int) -> dict:
    """Fetches a full user record from the primary database."""
    return db.query("SELECT * FROM users WHERE id = ?", user_id)

@tracer.trace(description="Validates the JWT and returns the decoded payload")
async def verify_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY)
```

> **Python tip:** The agent automatically extracts the first line of a function's docstring as its description. You only need `description=` when you want to override the docstring or when the function has no docstring.

Every instrumented function call is captured in real time. The dashboard updates live as you interact with your application.

---

## Installation

### Hub & CLI

The Hub is the local server that aggregates traces from all your agents, exposes a REST API, and broadcasts updates to the dashboard via WebSocket.

```bash
# Once published to npm:
npx ghost-doc start

# Or install globally:
npm install -g ghost-doc
ghost-doc start

# From the monorepo (current):
pnpm ghost-doc start
```

The Hub listens on port **3001** by default and serves the dashboard as static files on the same port. Open `http://localhost:3001` to access the dashboard.

### Agent — JavaScript / TypeScript

```bash
npm install @ghost-doc/agent-js
# or
pnpm add @ghost-doc/agent-js
```

Requires TypeScript 5+ with `"experimentalDecorators": false` (uses the TC39 Stage 3 decorator standard).

### Agent — Python

```bash
pip install ghost-doc-agent
```

Requires Python 3.10+.

---

## Usage

### Creating a tracer

**JavaScript**

```ts
import { createTracer } from "@ghost-doc/agent-js";

const tracer = createTracer({
  agentId: "frontend", // identifies this agent in the dashboard
  hubUrl: "ws://localhost:3001/agent", // default, can be omitted
  enabled: process.env.NODE_ENV !== "test",
  sanitize: ["password", "token", "secret", "authorization"],
  sampleRate: 1.0, // 0.0–1.0; default 1.0 emits every call
});
```

**Python**

```python
from ghost_doc_agent import Tracer

tracer = Tracer(
    agent_id="api-service",
    hub_url="ws://localhost:3001/agent",  # default
    sanitize=frozenset({"password", "token", "secret"}),
    enabled=True,
    sample_rate=1.0,                      # 0.0–1.0; default 1.0 emits every call
)
```

---

### The `@trace` decorator

Decorate any method or function to start capturing it.

**JavaScript**

```ts
class UserService {
  // Minimal — uses the method name as the label
  @tracer.trace()
  getUser(id: string) { ... }

  // Custom label
  @tracer.trace("user.lookup")
  getUser(id: string) { ... }

  // Label + description (shown in the inspector tooltip and flame graph)
  @tracer.trace("user.lookup", "Fetches a user from the primary database replica")
  getUser(id: string) { ... }
}
```

**Python**

```python
# Minimal — no parentheses needed; the docstring is used as the description automatically
@tracer.trace
def get_user(user_id: int):
    """Fetches a user from the primary database replica."""
    ...

# Custom label (docstring still auto-extracted as description)
@tracer.trace(label="user.lookup")
def get_user(user_id: int):
    """Fetches a user from the primary database replica."""
    ...

# Explicit description — overrides the docstring
@tracer.trace(label="user.lookup", description="Fetches a user from the primary database replica")
def get_user(user_id: int): ...

# Works with async functions too
@tracer.trace
async def send_email(to: str, subject: str):
    """Sends a confirmation email asynchronously."""
    ...
```

> **Docstring auto-extraction:** When a Python function has a docstring, the agent uses its first line as the description automatically. Pass `description=` explicitly to override it.

---

### `tracer.wrap()` — for plain functions

Use `wrap` when you can't use a decorator: arrow functions, imported functions, third-party callbacks.

**JavaScript**

```ts
// Arrow function
const validateSchema = tracer.wrap(
  (data: unknown) => schema.parse(data),
  "validateSchema",
  "Validates request payload against the Zod schema",
);

// Third-party function
const runQuery = tracer.wrap(db.execute.bind(db), "db.execute");
```

---

### Sanitization

Ghost Doc sanitizes sensitive data before it ever leaves your process. The default blocklist covers the most common credential and secret fields:

```
password, token, secret, authorization, api_key, bearer, jwt,
access_token, refresh_token, session, cookie, client_secret,
cvv, pin, private_key, passphrase, auth, credentials,
x-api-key, x-auth-token
```

In addition, the sanitizer detects **secret values by pattern** — JWT strings and sequences of 13–19 digits (credit card numbers) are redacted regardless of their key name.

```ts
// Default behavior — covers the most common cases
const tracer = createTracer({ agentId: "api" });

// Custom blocklist (merged with defaults)
const tracer = createTracer({
  agentId: "api",
  sanitize: ["password", "token", "ssn", "creditCard", "apiKey"],
});

// Custom function — full control
const tracer = createTracer({
  agentId: "api",
  sanitize: (key, value) => {
    if (key === "email") return "[email]";
    return value; // pass through everything else
  },
});
```

---

### Distributed tracing across services

When a request spans multiple services, Ghost Doc links them automatically using the `X-Trace-Id` HTTP header.

The easiest setup uses the built-in middleware helpers:

**Express:**

```ts
import express from "express";
import { createTracer, createExpressMiddleware } from "@ghost-doc/agent-js";

const tracer = createTracer({ agentId: "inventory-service" });
const app = express();

app.use(createExpressMiddleware(tracer));
// All route handlers automatically inherit the incoming trace context.
```

**Fastify:**

```ts
import Fastify from "fastify";
import { createTracer, createFastifyPlugin } from "@ghost-doc/agent-js";

const tracer = createTracer({ agentId: "inventory-service" });
const fastify = Fastify();

await fastify.register(createFastifyPlugin(tracer));
```

For manual propagation, forward the header yourself:

```ts
import { createTracer, TRACE_ID_HEADER } from "@ghost-doc/agent-js";

const tracer = createTracer({ agentId: "api-gateway" });

// Outgoing request — propagate the active trace ID downstream
@tracer.trace()
async function callInventoryService(productId: string) {
  return fetch(`http://inventory/product/${productId}`, {
    headers: { [TRACE_ID_HEADER]: tracer.currentTraceId() ?? "" },
  });
}
```

The dashboard automatically draws cross-service edges and labels them as distributed traces.

---

## Dashboard

The Hub serves the dashboard as static files on the **same port as the API (default: 3001)**. Just start the Hub and open `http://localhost:3001`.

```bash
pnpm ghost-doc start
# → Hub + Dashboard at http://localhost:3001
```

For dashboard development with hot-reload, run the Vite dev server alongside the Hub:

```bash
# Terminal 1 — Hub
pnpm ghost-doc start

# Terminal 2 — Dashboard dev server (http://localhost:8080)
pnpm --filter @ghost-doc/dashboard dev
```

---

### Flowchart view

The default view. Each instrumented function becomes a node; arrows show call direction with average duration labels.

**Visual cues**

| Visual              | Meaning                                        |
| ------------------- | ---------------------------------------------- |
| Red fill / red ring | Function threw an error                        |
| Dashed ring         | Anomaly detected (return type changed)         |
| Orange dashed ring  | Function is in the top 5% slowest (P95)        |
| Colored node border | Agent identity (consistent color per agent ID) |

**Controls**

- Scroll to zoom; drag background to pan; drag nodes to pin them
- **Group by** dropdown — collapse nodes by agent or by source file
- **Highlight node…** — type any string to dim non-matching nodes and glow matches; view auto-pans to the first result
- **Filter function…** — removes non-matching nodes entirely from the graph
- Hover any node to see a tooltip with call stats and the function's description

**Keyboard shortcuts**

| Key       | Action                                   |
| --------- | ---------------------------------------- |
| `Esc`     | Close the inspector panel                |
| `F`       | Fit the graph to the screen              |
| `/`       | Focus the function filter input          |
| `V`       | Toggle between Flowchart and Flame graph |
| `Space`   | Play / pause time-travel                 |
| `Shift+C` | Clear all traces                         |

**Minimap**

A fixed overview is always visible in the bottom-right corner. It shows all nodes as colored dots (respecting diff colors when a comparison is active) and a white rectangle indicating the current viewport. Click anywhere on the minimap to pan the main view to that position.

---

### Flame graph view

Switch to the flame graph using the **Flame** toggle in the header. Select any trace from the dropdown to see its full call stack:

- X-axis = time (relative to the trace start)
- Y-axis = call stack depth
- Width = duration
- Color = agent (consistent across both views)
- Click any span to open it in the inspector

---

### Contracts tab

Switch to **Contracts** in the header to inspect inferred behavioral contracts.

- **Function list** — every traced function with its sample count and error indicator.
- **Contract detail** — the JSON Schema for args, return value, and observed error shapes.
- **Re-infer** — re-derives the schema from all spans currently in the Hub.
- **Validate spans** — checks Hub spans against the displayed contract and shows a violation feed with `path / rule / expected / received` details.

### Mocks tab

Switch to **Mocks** to manage recorded sessions.

- **Record session** — enter a name and click **Save** to snapshot the Hub's current spans.
- **Session list** — click any session to view its call table (sequence, function, args, return/error, duration). Delete sessions you no longer need.
- **Export mocks** — generates and downloads a static Jest, Vitest, or pytest mock file directly in the browser.

---

### Snapshot comparison

Compare any two states of your application side by side — useful for before/after performance analysis, deployment validation, or spotting regressions.

**To compare:**

1. When your app is in a known baseline state, save a snapshot:

   ```bash
   pnpm ghost-doc snapshot
   # → Saved to ~/.ghost-doc/snapshots/<id>.json
   ```

   The snapshot file is plain JSON and can be committed to version control or shared with teammates.

2. Continue using your app (or deploy a new version).

3. In the dashboard header, click **Compare…** and select the baseline snapshot JSON file.

The flowchart immediately shows a color-coded diff:

| Color        | Meaning                                       |
| ------------ | --------------------------------------------- |
| Green node   | Function is new (not in the baseline)         |
| Bright green | Function is at least 10% faster than baseline |
| Orange       | Function is at least 10% slower than baseline |
| Default      | Within ±10% of baseline (unchanged)           |

A legend appears in the top-left of the flowchart, including a count of functions that existed in the baseline but are no longer present. Click **Clear diff** in the header to exit comparison mode.

You can also decode a shared snapshot to a local file and then load it with the Compare button:

```bash
ghost-doc load <encoded> --output baseline.json
# → Then use Compare… in the dashboard to load baseline.json
```

---

### Inspector panel

Click any node in either view to open the inspector:

- Function signature, agent badge, source file and line number
- Description (if provided via `@trace`)
- Total call count, average and P95 duration, duration histogram
- Full call history (newest first) — expand any call to see inputs, outputs, and errors
- Error detail: type, message, and full stack trace
- **Copy as curl** — if the span looks like an HTTP handler, generates a ready-to-run curl command
- **Copy trace JSON** — copies the raw span payload

---

### Time-travel debugger

The timeline bar at the bottom of the screen lets you scrub through history:

- Red ticks = anomaly events
- Drag the playhead or click anywhere on the bar to seek
- Use **0.5×**, **1×**, **2×**, **10×** to control playback speed
- Click **Live** to snap back to real time

---

## CLI Reference

```
ghost-doc start [options]              Start the Hub server
ghost-doc stop                         Gracefully stop the Hub
ghost-doc status [options]             Show Hub health and trace count

ghost-doc export [options]             Export the current trace graph
ghost-doc snapshot [options]           Save current trace buffer to disk
ghost-doc share <snapshot-id>          Encode a snapshot as a shareable URL
ghost-doc load <encoded> [options]     Decode and replay a shared snapshot

ghost-doc contract infer [options]     Infer a JSON Schema contract from recorded calls
ghost-doc contract validate [options]  Validate Hub spans against a saved contract
ghost-doc contract export [options]    Infer and save a contract to disk

ghost-doc mock record [options]        Save current Hub spans as a named session
ghost-doc mock serve [options]         Start an HTTP mock server from a session
ghost-doc mock generate [options]      Generate Jest / Vitest / pytest mock files
ghost-doc mock diff <a> <b>            Compare two sessions for regressions
ghost-doc mock list                    List saved sessions
```

### `ghost-doc start`

| Flag                  | Default | Description                                          |
| --------------------- | ------- | ---------------------------------------------------- |
| `-p, --port <number>` | `3001`  | Port for the Hub REST API and WebSocket server       |
| `--no-open`           | —       | Do not open `http://localhost:<port>` in the browser |

### `ghost-doc status`

| Flag                  | Default | Description       |
| --------------------- | ------- | ----------------- |
| `-p, --port <number>` | `3001`  | Hub port to query |

### `ghost-doc export`

| Flag                  | Default                 | Description                                                    |
| --------------------- | ----------------------- | -------------------------------------------------------------- |
| `-p, --port <number>` | `3001`                  | Hub port to pull traces from                                   |
| `-f, --format <fmt>`  | `markdown`              | `markdown` \| `html` \| `obsidian` \| `notion` \| `confluence` |
| `-o, --output <path>` | `FLOW.md` / `FLOW.html` | Output file path (markdown and html only)                      |
| `--project <name>`    | `Project`               | Project name used in the document title                        |
| `--limit <number>`    | `5000`                  | Maximum number of spans to fetch                               |
| `--vault-path <path>` | —                       | Obsidian vault root (obsidian format)                          |
| `--token <token>`     | —                       | API token (notion / confluence)                                |
| `--page-id <id>`      | —                       | Target page ID (notion)                                        |
| `--url <url>`         | —                       | Confluence base URL                                            |
| `--space <key>`       | —                       | Confluence space key                                           |
| `--email <email>`     | —                       | Confluence user email for Basic auth                           |

**Examples**

```bash
# Markdown — renders natively on GitHub
ghost-doc export --format markdown --output docs/FLOW.md

# Self-contained HTML — open in any browser, no dependencies
ghost-doc export --format html --output docs/FLOW.html

# Sync to Notion
ghost-doc export --format notion --token secret_xxx --page-id abc123

# Write to Obsidian vault
ghost-doc export --format obsidian --vault-path ~/Notes

# Sync to Confluence
ghost-doc export --format confluence \
  --url https://your-org.atlassian.net \
  --space ENG \
  --token your_api_token \
  --email you@example.com
```

### `ghost-doc snapshot`

Saves the Hub's current trace buffer (up to 10,000 spans) to `~/.ghost-doc/snapshots/<timestamp>.json`.

```bash
ghost-doc snapshot
# ✓ Snapshot saved
#   ID   : 1710000000000
#   Path : /Users/you/.ghost-doc/snapshots/1710000000000.json
#   Spans: 342
```

### `ghost-doc contract`

```bash
# Infer contracts for all observed functions
ghost-doc contract infer

# Infer a single function as YAML
ghost-doc contract infer --function createOrder --format yaml

# Infer and save to disk
ghost-doc contract export --function createOrder --format yaml

# Validate Hub spans against a saved contract
ghost-doc contract validate --contract contracts/createOrder.json
```

### `ghost-doc mock`

```bash
# Record current Hub spans as a named session
ghost-doc mock record --name payment-flow

# Replay as an HTTP mock server on port 8080
ghost-doc mock serve --session payment-flow --mock-port 8080

# Generate a Vitest mock file
ghost-doc mock generate --session payment-flow --target vitest --output __mocks__/payment.ts

# Generate a pytest fixture file
ghost-doc mock generate --session payment-flow --target pytest --output mocks/payment.py

# Compare two sessions for regressions (flag latency increases > 20%)
ghost-doc mock diff baseline new --threshold 20

# List saved sessions
ghost-doc mock list
```

### `ghost-doc share` / `ghost-doc load`

Create a self-contained shareable URL from a saved snapshot:

```bash
# Encode
ghost-doc share 1710000000000
# → ghost-doc://v1/<base64url-encoded-payload>

# Decode into the running dashboard (via Hub /snapshots/load endpoint)
ghost-doc load "ghost-doc://v1/<payload>"

# Or decode to a file (useful for the dashboard Compare button)
ghost-doc load "ghost-doc://v1/<payload>" --output baseline.json
```

---

## Hub configuration file

For persistent settings, create `~/.ghost-doc/config.json`:

```jsonc
{
  "port": 3001,
  "sanitizeKeys": ["password", "token", "apiKey", "ssn"],
  "flushIntervalMs": 60000, // flush traces to disk every 60 s (0 = disabled)
}
```

| Key                 | Type     | Default | Description                                                                                                      |
| ------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `port`              | number   | `3001`  | Hub listen port                                                                                                  |
| `sanitizeKeys`      | string[] | `[]`    | Additional field names to redact (merged with agent's list)                                                      |
| `flushIntervalMs`   | number   | `0`     | Interval in ms to flush traces to `~/.ghost-doc/traces/`. `0` disables flushing                                  |
| `maxSpansPerSecond` | number   | `500`   | Per-agent rate limit. Spans beyond this rate are dropped and the agent receives a `rate_limit_exceeded` message. |

Traces are written as NDJSON to `~/.ghost-doc/traces/<timestamp>.jsonl`.

---

## Architecture

Ghost Doc is a monorepo with seven packages:

```
packages/
├── shared-types      # Zod schema + TypeScript types for TraceEvent (wire format)
├── agent-js          # TypeScript tracing agent (@trace decorator, tracer.wrap)
├── agent-python      # Python tracing agent (@tracer.trace decorator)
├── hub               # Aggregation server + CLI (Node.js, Fastify, ws)
├── contractum        # Contract inference, validation, mock generation & session diff
├── dashboard         # Real-time web UI (React 18, D3, Zustand, Tailwind, Vite)
└── exporter          # Export engine (Markdown, HTML, Notion, Obsidian, Confluence)
```

### Wire format

Every agent emits a `TraceEvent` JSON payload over WebSocket to `ws://localhost:3001/agent`:

```jsonc
{
  "schema_version": "1.0",
  "trace_id": "uuid-v4", // shared across all spans in one call chain
  "span_id": "uuid-v4", // unique to this function invocation
  "parent_span_id": "uuid-v4", // null for root spans
  "source": {
    "agent_id": "api-server",
    "language": "js",
    "file": "src/services/user.ts",
    "line": 42,
    "function_name": "getUser",
    "description": "Fetches a user from the database", // optional
  },
  "timing": {
    "started_at": 1710000000000, // Unix milliseconds
    "duration_ms": 38.4,
  },
  "input": [{ "id": "123" }],
  "output": { "id": "123", "name": "Alice" },
  "error": null,
  "tags": {},
}
```

The Hub validates every payload against the Zod schema. Invalid payloads are logged and discarded — the Hub never crashes on bad input.

The dashboard connects to `ws://localhost:3001/dashboard` and receives the same payloads in real time.

### Adding a new language agent

Any process that can open a WebSocket and send JSON can act as a Ghost Doc agent:

1. Connect to `ws://<hub-host>:3001/agent`
2. Emit `TraceEvent` JSON messages (schema above)
3. Use `schema_version: "1.0"` and UUID v4 format for all IDs

---

## Hub REST API

| Method   | Path                       | Description                                                       |
| -------- | -------------------------- | ----------------------------------------------------------------- |
| `GET`    | `/health`                  | Server status, connected agent count, total traces                |
| `GET`    | `/traces`                  | Recent spans (`?limit=100&agent_id=frontend`)                     |
| `GET`    | `/traces/:trace_id`        | Full span tree for a distributed trace                            |
| `POST`   | `/snapshot`                | Save current buffer to `~/.ghost-doc/snapshots/`                  |
| `GET`    | `/snapshots`               | List saved snapshots                                              |
| `GET`    | `/snapshots/:id`           | Load a specific snapshot by ID                                    |
| `POST`   | `/snapshots/load`          | Push a snapshot body into the Hub and broadcast to all dashboards |
| `GET`    | `/export`                  | Export call graph (`?format=html\|markdown&project=Name`)         |
| `GET`    | `/contracts`               | Infer contracts for all functions (`?min_samples=10`)             |
| `GET`    | `/contracts/:functionName` | Infer contract for a single function                              |
| `POST`   | `/contracts/validate`      | Validate spans against a contract; returns violations             |
| `POST`   | `/contracts/save`          | Save an inferred contract to disk                                 |
| `GET`    | `/contracts/saved`         | List saved contract files                                         |
| `GET`    | `/mock/sessions`           | List saved mock sessions                                          |
| `POST`   | `/mock/sessions`           | Create a session from current Hub spans                           |
| `GET`    | `/mock/sessions/:name`     | Load a full session snapshot                                      |
| `DELETE` | `/mock/sessions/:name`     | Delete a saved session                                            |

---

## Supported Languages

### Official agents

| Language                | Package                     | Status    |
| ----------------------- | --------------------------- | --------- |
| JavaScript / TypeScript | `@ghost-doc/agent-js` (npm) | ✅ Stable |
| Python                  | `ghost-doc-agent` (PyPI)    | ✅ Stable |

### Community / planned agents

The wire format is an open JSON-over-WebSocket protocol. Any language that can open a WebSocket connection can act as a Ghost Doc agent. The following `language` values are accepted by the Hub's schema:

| Value      | Intended use            |
| ---------- | ----------------------- |
| `"js"`     | JavaScript / TypeScript |
| `"python"` | Python                  |
| `"go"`     | Go                      |
| `"rust"`   | Rust                    |
| `"java"`   | Java / Kotlin           |
| `"csharp"` | C# / .NET               |
| `"other"`  | Anything else           |

To build an agent for a new language, see the [Wire format](#wire-format) section and the [Adding a new language agent](#adding-a-new-language-agent) guide above. We welcome community-maintained agents — open an issue to list yours here.

---

## Contributing

Contributions are welcome. Please open an issue before submitting a large pull request so we can discuss the approach.

### Project setup

```bash
# Requires Node.js 20+ and pnpm 10+
git clone https://github.com/your-org/ghost-doc.git
cd ghost-doc
pnpm install
```

### Running the full stack locally

```bash
# Build all packages including the dashboard (required before first run and after schema changes)
pnpm demo:build

# Terminal 1 — Hub (also serves the dashboard at http://localhost:3001)
pnpm ghost-doc start

# Terminal 2 — Sample app (optional, generates live traces)
pnpm --filter @ghost-doc/sample-app start
```

For dashboard development with hot-reload, run the Vite dev server in place of opening port 3001:

```bash
# Terminal 2 — Dashboard dev server (http://localhost:8080, connects to Hub on 3001)
pnpm --filter @ghost-doc/dashboard dev
```

After modifying `shared-types`, rebuild before restarting:

```bash
pnpm --filter @ghost-doc/shared-types build
```

### Running checks

```bash
pnpm lint          # ESLint
pnpm typecheck     # TypeScript (all packages)
pnpm test          # Vitest (JS) + pytest (Python)
pnpm test:py       # Python tests only
```

### Commit convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Examples:

```
feat(agent-js): add support for generator functions
fix(hub): prevent crash on malformed parent_span_id
docs: update distributed tracing example
```

Commit messages are enforced via `commitlint` on every commit.

---

## License

MIT © Ghost Doc Contributors

---

<p align="center">
  Built with the belief that the best documentation is the code running in production.
</p>
