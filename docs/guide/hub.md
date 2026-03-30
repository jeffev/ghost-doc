# Hub & CLI

The Hub is the central server that aggregates traces from all agents, serves the real-time dashboard, and exposes a REST API for snapshots and exports.

## Installation

```bash
npm install -g ghost-doc
# or run without installing:
npx ghost-doc <command>
```

## Starting the Hub

```bash
# Start Hub + open Dashboard in browser
npx ghost-doc start

# Custom port
npx ghost-doc start --port 4000

# Start without opening the browser
npx ghost-doc start --no-open
```

The Hub listens on **port 3001** by default and serves both the WebSocket API and the dashboard at the same port.

- **Agent endpoint:** `ws://localhost:3001/agent`
- **Dashboard endpoint:** `ws://localhost:3001/dashboard`
- **Dashboard UI:** `http://localhost:3001`
- **REST API:** `http://localhost:3001/health`, `/traces`, `/snapshots`

## CLI commands

| Command | Description |
| :--- | :--- |
| `ghost-doc start` | Start Hub + Dashboard |
| `ghost-doc stop` | Graceful shutdown |
| `ghost-doc status` | Show connected agents and trace count |
| `ghost-doc export` | Export traces (see [Exporter](./exporter)) |
| `ghost-doc snapshot` | Save current traces to disk |

## Configuration file

The Hub reads `~/.ghost-doc/config.json` on startup:

```json
{
  "port": 3001,
  "sanitizeKeys": ["password", "token", "secret", "api_key"],
  "flushIntervalMs": 30000
}
```

| Key | Default | Description |
| :--- | :--- | :--- |
| `port` | `3001` | HTTP and WebSocket port |
| `sanitizeKeys` | `["password","token","secret","authorization","api_key"]` | Keys redacted at Hub boundary (defense-in-depth) |
| `flushIntervalMs` | `30000` | Interval to flush traces to `~/.ghost-doc/traces/` |

## REST API overview

See the full reference → [Hub REST API](/api/hub-rest).

| Endpoint | Description |
| :--- | :--- |
| `GET /health` | `{ status, agents, traces_total }` |
| `GET /traces` | Last N traces (`?limit=100&agent_id=frontend`) |
| `GET /traces/:trace_id` | Full call tree for a distributed trace |
| `POST /snapshot` | Save trace buffer to disk |
| `GET /snapshots` | List saved snapshots |
| `GET /snapshots/:id` | Load a specific snapshot |

## Trace storage

- **In-memory:** circular buffer, keeps last **10,000 spans**
- **On-disk flush:** `~/.ghost-doc/traces/<timestamp>.jsonl` every `flushIntervalMs` milliseconds
- **Snapshots:** `~/.ghost-doc/snapshots/<id>.json` on demand

## Dashboard

The Hub bundles the pre-built dashboard and serves it as static files from `hub/public`. No separate server or build step is needed in production.

In development (working from the monorepo), start the dashboard Vite dev server:

```bash
pnpm --filter @ghost-doc/dashboard dev
# → http://localhost:8080
```
