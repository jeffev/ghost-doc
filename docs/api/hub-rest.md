# Hub REST API

All endpoints are served by the Hub on `http://localhost:3001` (or your configured port).

## `GET /health`

Returns Hub status and basic metrics.

**Response:**

```json
{
  "status": "ok",
  "agents": 2,
  "traces_total": 1847
}
```

## `GET /traces`

Returns the most recent traces from the in-memory buffer.

**Query parameters:**

| Parameter       | Type   | Default | Description                       |
| :-------------- | :----- | :------ | :-------------------------------- |
| `limit`         | number | `100`   | Maximum number of spans to return |
| `agent_id`      | string | —       | Filter by agent ID                |
| `function_name` | string | —       | Filter by function name           |

**Example:**

```
GET /traces?limit=50&agent_id=backend-api
```

**Response:** Array of `TraceEvent` objects, newest first.

## `GET /traces/:trace_id`

Returns the full call tree for a single distributed trace.

**Response:**

```json
{
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "root": { ...TraceEvent },
  "children": [
    {
      ...TraceEvent,
      "children": [ ...TraceEvent ]
    }
  ],
  "agents": ["backend-api", "python-service"],
  "duration_ms": 142,
  "error": null
}
```

## `POST /snapshot`

Saves the current trace buffer to `~/.ghost-doc/snapshots/<timestamp>.json`.

**Response:**

```json
{
  "id": "2024-01-15T10-30-00-000Z",
  "path": "/Users/you/.ghost-doc/snapshots/2024-01-15T10-30-00-000Z.json",
  "spans": 1847
}
```

## `GET /snapshots`

Lists all saved snapshots.

**Response:**

```json
[
  {
    "id": "2024-01-15T10-30-00-000Z",
    "path": "...",
    "created_at": "2024-01-15T10:30:00.000Z",
    "spans": 1847
  }
]
```

## `GET /snapshots/:id`

Loads a specific snapshot. The response is identical to the on-disk JSON format and can be loaded into the Dashboard for time-travel replay.

## `GET /export`

Exports the current call graph as a self-contained document. The dashboard's **Export** button uses this endpoint.

**Query parameters:**

| Parameter | Type   | Default    | Description                             |
| :-------- | :----- | :--------- | :-------------------------------------- |
| `format`  | string | `markdown` | `html` or `markdown`                    |
| `project` | string | `Project`  | Project name used in the document title |

**Example:**

```
GET /export?format=html&project=MyApp
```

**Response:** The raw document content with the appropriate `Content-Type` (`text/html` or `text/markdown`). The browser triggers a file download when accessed via the dashboard UI.

## WebSocket endpoints

| Endpoint                        | Direction       | Description                                             |
| :------------------------------ | :-------------- | :------------------------------------------------------ |
| `ws://localhost:3001/agent`     | Agent → Hub     | Agents connect here to stream `TraceEvent` spans        |
| `ws://localhost:3001/dashboard` | Hub → Dashboard | Dashboard connects here to receive live span broadcasts |

### Agent rate limiting

The Hub enforces a per-connection sliding-window rate limit (default: **500 spans/second**). If an agent exceeds this limit, excess spans are dropped and the Hub sends a JSON message:

```json
{ "type": "rate_limit_exceeded" }
```

The limit is configurable via `maxSpansPerSecond` in `~/.ghost-doc/config.json`.
