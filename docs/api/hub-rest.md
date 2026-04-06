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

---

## Contracts

### `GET /contracts`

Infers contracts for all functions that have at least `min_samples` recorded calls.

**Query parameters:**

| Parameter     | Type   | Default | Description                          |
| :------------ | :----- | :------ | :----------------------------------- |
| `min_samples` | number | `10`    | Minimum call count required to infer |
| `strict`      | bool   | `false` | `true` = no union types in inference |

**Response:** Array of `ContractDefinition` objects, sorted by `functionName`.

```json
[
  {
    "version": "1.0",
    "functionName": "createOrder",
    "generatedAt": "2026-04-05T10:00:00.000Z",
    "sampleCount": 42,
    "args": [
      {
        "type": "object",
        "properties": { "userId": { "type": "string", "format": "uuid" } },
        "required": ["userId"]
      }
    ],
    "returns": {
      "type": "object",
      "properties": {
        "orderId": { "type": "string" },
        "status": { "enum": ["pending", "confirmed"] }
      }
    },
    "errors": [{ "type": "object", "properties": { "code": { "enum": ["OUT_OF_STOCK"] } } }]
  }
]
```

### `GET /contracts/:functionName`

Infers (or re-infers) a contract for a single function.

**Query parameters:** same as `GET /contracts`.

**Response:** A single `ContractDefinition` object (HTTP 404 if no spans found for the function).

### `POST /contracts/validate`

Validates recorded spans against a given contract and returns all violations.

**Request body:**

```json
{
  "contract": { ...ContractDefinition },
  "spans": [ ...StoredSpan ]
}
```

`spans` is optional — if omitted, the Hub uses all spans currently in the in-memory store for the contract's `functionName`.

**Response:**

```json
{
  "violations": [
    {
      "functionName": "createOrder",
      "spanId": "span-abc",
      "traceId": "trace-xyz",
      "timestamp": 1712300000000,
      "violations": [
        { "path": "args[0].amount", "expected": "number", "received": "string", "rule": "type" }
      ]
    }
  ],
  "count": 1
}
```

### `POST /contracts/save`

Saves an inferred contract to `~/.ghost-doc/contracts/`.

**Request body:**

```json
{
  "contract": { ...ContractDefinition },
  "format": "json"
}
```

`format` accepts `"json"`, `"yaml"`, or `"typescript"`. Defaults to `"json"`.

**Response:**

```json
{ "path": "/Users/you/.ghost-doc/contracts/createOrder.json" }
```

### `GET /contracts/saved`

Lists all contract files saved to disk.

**Response:**

```json
[{ "name": "createOrder.json", "file": "createOrder.json" }]
```

### `GET /contracts/saved/:name`

Loads a saved contract file by name (with or without `.json` extension).

**Response:** `ContractDefinition` object.

### `GET /contracts/:functionName/drift`

Compares the contract saved on disk for `functionName` with the contract freshly inferred from current Hub spans. Returns a structured diff.

**Query parameters:**

| Parameter     | Type   | Default | Description                           |
| :------------ | :----- | :------ | :------------------------------------ |
| `min_samples` | number | `1`     | Minimum samples for current inference |

**Response:**

```json
{
  "functionName": "createOrder",
  "isBreaking": true,
  "changes": [
    {
      "path": "args[0].amount",
      "kind": "type_changed",
      "before": "number",
      "after": ["number", "string"]
    }
  ],
  "saved": { ...ContractDefinition },
  "current": { ...ContractDefinition }
}
```

**Change kinds:**

| Kind               | Breaking |
| :----------------- | :------- |
| `type_changed`     | Yes      |
| `required_added`   | Yes      |
| `field_removed`    | Yes      |
| `enum_changed`     | Yes      |
| `required_removed` | No       |
| `field_added`      | No       |
| `format_changed`   | No       |

Returns HTTP 404 if no saved contract exists for the function.

---

## Mock sessions

### `GET /mock/sessions`

Lists all saved session files from `~/.ghost-doc/sessions/`.

**Response:**

```json
[
  {
    "name": "payment-flow",
    "session": "payment-flow",
    "callCount": 12,
    "startTime": "2026-04-05T10:00:00.000Z",
    "endTime": "2026-04-05T10:05:00.000Z"
  }
]
```

### `POST /mock/sessions`

Creates a new session from the Hub's current in-memory spans and saves it to disk.

**Request body:**

```json
{
  "name": "payment-flow",
  "functions": ["createOrder", "processPayment"],
  "maxCallsPerFunction": 50
}
```

`functions` and `maxCallsPerFunction` are optional. Omitting `functions` includes all traced functions.

**Response:**

```json
{ "name": "payment-flow", "path": "...", "callCount": 12 }
```

### `GET /mock/sessions/:name`

Loads the full session snapshot for a given session name.

**Response:** `SessionSnapshot` object:

```json
{
  "session": "payment-flow",
  "startTime": "2026-04-05T10:00:00.000Z",
  "endTime": "2026-04-05T10:05:00.000Z",
  "calls": [
    {
      "function": "createOrder",
      "spanId": "span-abc",
      "traceId": "trace-xyz",
      "args": [{ "userId": "u_123", "amount": 99.99 }],
      "return": { "orderId": "ord_456", "status": "pending" },
      "durationMs": 42,
      "error": null,
      "sequence": 1
    }
  ]
}
```

### `DELETE /mock/sessions/:name`

Deletes a saved session file from disk.

**Response:** `{ "deleted": "payment-flow-1712300000000.json" }`

### `POST /mock/sessions/:name/clone`

Clones an existing session under a new name.

**Request body:**

```json
{ "name": "payment-flow-copy" }
```

**Response:**

```json
{ "name": "payment-flow-copy-1712300000000", "session": "payment-flow-copy", "callCount": 12 }
```

### `PATCH /mock/sessions/:name`

Renames an existing session. The old file is deleted and a new one is created.

**Request body:**

```json
{ "name": "payment-flow-v2" }
```

**Response:**

```json
{ "name": "payment-flow-v2-1712300000000", "session": "payment-flow-v2" }
```

### `POST /mock/sessions/merge`

Merges two or more sessions into a new combined session. Calls are re-sequenced in chronological order.

**Request body:**

```json
{
  "sessions": ["payment-flow-a", "payment-flow-b"],
  "name": "payment-flow-merged"
}
```

**Response:**

```json
{ "name": "payment-flow-merged-1712300000000", "session": "payment-flow-merged", "callCount": 24 }
```

### `POST /mock/sessions/diff`

Compares two sessions and returns a structured diff.

**Request body:**

```json
{
  "before": "payment-flow-baseline",
  "after": "payment-flow-new",
  "threshold": 20
}
```

`threshold` is the minimum latency increase (%) to flag as a regression. Default: `0`.

**Response:**

```json
{
  "diff": {
    "addedFunctions": ["refundOrder"],
    "removedFunctions": [],
    "changedReturnShapes": [
      { "function": "createOrder", "before": { ... }, "after": { ... } }
    ],
    "changedErrorRate": [],
    "latencyRegression": [
      { "function": "processPayment", "beforeP95Ms": 120, "afterP95Ms": 195, "changePercent": 62.5 }
    ]
  },
  "breaking": true,
  "before": "payment-flow-baseline",
  "after": "payment-flow-new",
  "threshold": 20
}
```

### `GET /mock/sessions/:name/openapi`

Generates an OpenAPI 3.0 specification from a recorded session. Each function becomes a `POST` endpoint with recorded examples.

**Query parameters:**

| Parameter | Type   | Default | Description      |
| :-------- | :----- | :------ | :--------------- |
| `format`  | string | `json`  | `json` or `yaml` |

**Response:** OpenAPI 3.0 spec as JSON (default) or YAML (`Content-Type: text/yaml`).

---

## HTTP mock server

### `GET /mock/server/status`

Returns the current state of the HTTP mock server.

**Response:**

```json
{ "running": false }
```

or when running:

```json
{
  "running": true,
  "url": "http://127.0.0.1:8080",
  "session": "payment-flow",
  "port": 8080,
  "mode": "exact"
}
```

### `POST /mock/server/start`

Starts an HTTP mock server that replays a saved session. Only one server can run at a time.

**Request body:**

```json
{
  "session": "payment-flow",
  "port": 8080,
  "mode": "exact",
  "faultErrorRate": 0.1,
  "faultLatency": 2.0
}
```

| Field            | Type   | Default   | Description                                           |
| :--------------- | :----- | :-------- | :---------------------------------------------------- |
| `session`        | string | —         | Session name (required)                               |
| `port`           | number | `8080`    | Port to listen on                                     |
| `mode`           | string | `"exact"` | `exact` \| `round-robin` \| `latency-preserving`      |
| `faultErrorRate` | number | —         | Fraction (0–1) of calls that return an error response |
| `faultLatency`   | number | —         | Latency multiplier applied to recorded durations      |

**Response:**

```json
{
  "running": true,
  "url": "http://127.0.0.1:8080",
  "session": "payment-flow",
  "port": 8080,
  "mode": "exact"
}
```

Returns HTTP 409 if a server is already running.

### `POST /mock/server/stop`

Stops the running HTTP mock server.

**Response:** `{ "stopped": true }`

Returns HTTP 404 if no server is running.

---

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
