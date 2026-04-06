# Contractum & Mock Registry

Ghost Doc already records everything needed to power contract validation and realistic mock generation: real arguments, real return values, timings, error shapes, and call order. The **Contractum** and **Mock Registry** modules transform Ghost Doc from a passive observer into an active guarantor of correctness.

| Module            | What it does                                                                                                                                        |
| :---------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contractum**    | Infers behavioral contracts (JSON Schema) from recorded calls. Validates future calls against those contracts. Reports violations in the Dashboard. |
| **Mock Registry** | Turns recorded sessions into replayable mocks. Serves them over HTTP or generates static files for Jest/Vitest/pytest/Postman.                      |

---

## Dashboard

Switch to either tab using the **Contracts** or **Mocks** buttons in the dashboard header.

### Contracts tab

- **Function list** — every traced function with sample count, confidence score, and coverage-gate indicator.
- **Live / Saved toggle** — switch between contracts inferred from live spans and contracts previously saved to disk.
- **Min samples slider** — control the minimum call count required before inference runs (1–50).
- **Coverage gate slider** — set a threshold; functions below it get an ⚠ badge and a yellow border.
- **Contract detail** — the inferred JSON Schema for args, return value, and observed error shapes.
- **Confidence score** — 0–100% badge computed from sample count, type consistency, and format detection.
- **Pin contract** — lock a contract so Re-infer never overwrites it.
- **Re-infer** — re-derives the schema from all spans currently in the Hub.
- **Validate spans** — checks all spans in the Hub against the displayed contract; shows a violation count badge and a detailed feed.
- **Save** — persists the contract to `~/.ghost-doc/contracts/<functionName>.json`.
- **Schema tab** — JSON Schema with copy-to-clipboard on hover.
- **TypeScript tab** — generated TypeScript interfaces + "Download .d.ts" button.
- **Violations tab** — per-span violation details (path, rule, expected vs. received).
- **Drift tab** — compares the saved-on-disk contract with the contract inferred from current spans; highlights breaking changes.
- **Annotations tab** — free-text notes per function, stored in browser localStorage.

### Mocks tab

#### Sessions panel

- **Record session** — enter a name and click **Save** to snapshot the Hub's current spans.
- **Session list** — click any session to load it. Rename (✎), clone (⎘), or delete (✕) inline.
- **Merge** — click ⊕ to select ≥ 2 sessions and merge them into a new combined session.
- **Call table** — sequence number, function name, args, return/error value, and duration for every recorded call.
- **Timeline view** — horizontal bar chart of calls by function; click any bar to open the detail modal.
- **Call detail modal** — click any row to see the full, non-truncated JSON of args, return, and error.
- **Function filter** — filter the call table by function name.
- **Error/Success filter** — show only calls that errored or only successful calls.
- **Export mocks** — generates and downloads a static mock file (Jest, Vitest, or pytest) entirely in the browser.
- **OpenAPI ▾** — generates an OpenAPI 3.0 spec (JSON or YAML) from the recorded session.
- **Postman** — generates a Postman Collection v2.1 JSON with example requests and responses.

#### Diff panel

- **Session diff** — select a baseline and a current session, set a latency threshold, and compare: added/removed functions, changed return shapes, error rate changes, and latency regressions.

#### Server panel

- **HTTP mock server** — Start/Stop a local HTTP server that replays a recorded session.
- **Session selector** — pick which session to serve.
- **Port** — default 8080.
- **Mode** — `exact`, `round-robin`, or `latency-preserving`.
- **Fault injection** — inject error rate (0–100%) and latency factor (1–10×) for chaos testing.

---

## CLI

### Contract workflow

```bash
# 1. Infer contracts for all observed functions and print to stdout
ghost-doc contract infer

# 2. Infer and save a specific function's contract to disk
ghost-doc contract export --function createOrder --format yaml
# → ~/.ghost-doc/contracts/createOrder.yaml

# 3. Validate current Hub spans against a saved contract
ghost-doc contract validate --contract contracts/createOrder.json
```

### Mock workflow

```bash
# 1. Record current Hub spans as a named session
ghost-doc mock record --name payment-flow

# 2a. Replay the session as an HTTP mock server
ghost-doc mock serve --session payment-flow --mock-port 8080

# 2b. Generate static test mocks
ghost-doc mock generate --session payment-flow --target vitest --output __mocks__/payment.ts
ghost-doc mock generate --session payment-flow --target pytest   --output mocks/payment.py

# 3. Compare two sessions to detect regressions
ghost-doc mock diff payment-flow-baseline payment-flow-new --threshold 15

# List all saved sessions
ghost-doc mock list
```

---

## Contract inference algorithm

Contracts are derived deterministically — no AI is required.

1. Collect all recorded calls for the target function.
2. For each positional argument, inspect `typeof` and prototype chain across all samples.
3. Build a union of observed types (`string | number` if both seen).
4. Mark a field `required` if present in ≥ 90 % of samples.
5. If a field has ≤ 10 distinct values → emit as `enum`.
6. Detect common string formats at ≥ 80 % match rate: `uuid`, `email`, `date-time`, `uri`.
7. Recurse into nested objects and arrays.
8. Repeat for the return value and observed error shapes.

The result is a `ContractDefinition` envelope:

```typescript
interface ContractDefinition {
  version: "1.0";
  functionName: string;
  generatedAt: string; // ISO timestamp
  sampleCount: number;
  args: JSONSchema[]; // one schema per positional argument
  returns: JSONSchema;
  errors?: JSONSchema[]; // observed error shapes
}
```

### Confidence score

The confidence score (0–100%) is computed client-side from three factors:

| Factor           | Weight   | Description                                                                 |
| :--------------- | :------- | :-------------------------------------------------------------------------- |
| Sample count     | 0–50 pts | Saturates at 50 samples                                                     |
| Type consistency | 0–30 pts | Penalises `oneOf` (union) schemas — 5 pts per union                         |
| Format detection | 0–20 pts | Bonus when at least one field has a detected format (`uuid`, `email`, etc.) |

### Contract drift

The **Drift** tab compares the contract saved on disk with the contract freshly inferred from current spans. Each schema change is classified:

| Kind               | Breaking? |
| :----------------- | :-------- |
| `type_changed`     | Yes       |
| `required_added`   | Yes       |
| `field_removed`    | Yes       |
| `enum_changed`     | Yes       |
| `required_removed` | No        |
| `field_added`      | No        |
| `format_changed`   | No        |

---

## Mock server modes

| Mode                 | Behavior                                                                |
| :------------------- | :---------------------------------------------------------------------- |
| `exact`              | Returns responses in the exact recorded sequence. Cycles on exhaustion. |
| `round-robin`        | Returns a random response from the set recorded for that function.      |
| `latency-preserving` | Delays each response by the recorded `durationMs`.                      |

Fault injection options (available in both the dashboard Server panel and CLI):

```bash
--fault-error-rate 0.1    # 10 % of calls return a recorded error response
--fault-latency 2.0       # double the recorded latency on every call
```

---

## Session diff

`ghost-doc mock diff` (and the Diff panel in the dashboard) compares two sessions and reports:

- **Added / removed functions** — functions that appear in only one session.
- **Changed return shapes** — inferred JSON Schema changed between sessions.
- **Changed error rate** — fraction of calls that errored, per function.
- **Latency regressions** — functions whose P95 duration increased beyond the threshold (default: 20 %).

```bash
ghost-doc mock diff baseline new --threshold 20
# ⚠  Breaking changes detected.
#   Latency regressions (>20%):
#     processPayment  120ms → 195ms (+62.5%)
```

---

## Export formats

| Format                      | How to access                                       |
| :-------------------------- | :-------------------------------------------------- |
| **Jest** mock               | Dashboard → Mocks → Export mocks ▾ → Jest           |
| **Vitest** mock             | Dashboard → Mocks → Export mocks ▾ → Vitest         |
| **pytest** fixture          | Dashboard → Mocks → Export mocks ▾ → pytest         |
| **OpenAPI 3.0 JSON**        | Dashboard → Mocks → OpenAPI ▾ → JSON                |
| **OpenAPI 3.0 YAML**        | Dashboard → Mocks → OpenAPI ▾ → YAML                |
| **Postman Collection v2.1** | Dashboard → Mocks → Postman                         |
| **TypeScript .d.ts**        | Dashboard → Contracts → TypeScript → Download .d.ts |

---

## CI integration

```bash
# Validate that recorded calls still comply with the frozen contract
ghost-doc contract validate --contract contracts/createOrder.json

# Detect regressions between a baseline session and a new one
ghost-doc mock diff baseline current --threshold 20
```

Both commands exit with a non-zero code when violations or breaking changes are found, making them suitable for CI gates.

---

## REST API

All endpoints are served by the Hub. See [Hub REST API](./api/hub-rest.md) for the full reference.

### Contracts

| Method | Path                             | Description                             |
| :----- | :------------------------------- | :-------------------------------------- |
| `GET`  | `/contracts`                     | Infer contracts for all functions       |
| `GET`  | `/contracts/:functionName`       | Infer contract for one function         |
| `GET`  | `/contracts/:functionName/drift` | Diff current inferred vs saved contract |
| `POST` | `/contracts/validate`            | Validate spans; returns violations      |
| `POST` | `/contracts/save`                | Save inferred contract to disk          |
| `GET`  | `/contracts/saved`               | List saved contracts                    |
| `GET`  | `/contracts/saved/:name`         | Load a saved contract                   |

### Mock sessions

| Method   | Path                           | Description                         |
| :------- | :----------------------------- | :---------------------------------- |
| `GET`    | `/mock/sessions`               | List saved sessions                 |
| `POST`   | `/mock/sessions`               | Create a session from current spans |
| `GET`    | `/mock/sessions/:name`         | Load a full session snapshot        |
| `DELETE` | `/mock/sessions/:name`         | Delete a session                    |
| `POST`   | `/mock/sessions/:name/clone`   | Clone a session under a new name    |
| `PATCH`  | `/mock/sessions/:name`         | Rename a session                    |
| `POST`   | `/mock/sessions/merge`         | Merge multiple sessions into one    |
| `POST`   | `/mock/sessions/diff`          | Diff two sessions                   |
| `GET`    | `/mock/sessions/:name/openapi` | Export session as OpenAPI 3.0 spec  |

### HTTP mock server

| Method | Path                  | Description                              |
| :----- | :-------------------- | :--------------------------------------- |
| `GET`  | `/mock/server/status` | Check if the mock server is running      |
| `POST` | `/mock/server/start`  | Start the HTTP mock server for a session |
| `POST` | `/mock/server/stop`   | Stop the running HTTP mock server        |

---

## Storage

| Artifact  | Location                  | Format                   |
| :-------- | :------------------------ | :----------------------- |
| Contracts | `~/.ghost-doc/contracts/` | JSON / YAML / TypeScript |
| Sessions  | `~/.ghost-doc/sessions/`  | JSON                     |

The storage directory can be overridden in `~/.ghost-doc/config.json` via the `storageDir` key.

---

## Backlog

The following features are planned but not yet committed to a release:

- **D.1** Consumer-driven contract testing (multiple consumers declare expectations against one provider)
- **D.2** Invariant rules / negative contracts (`args[0].amount > 0`)
- **D.3** ~~Contract drift tracking~~ ✅ implemented
- **D.4** ~~Contract confidence score~~ ✅ implemented
- **D.5** Scenario-based mocks (activate named override scenarios without separate session files)
- **D.6** Stateful mocks (responses that evolve with call state)
- **D.7** ~~OpenAPI / AsyncAPI export~~ ✅ implemented
- **D.8** Mock warming — generate synthetic but schema-valid calls when no recording exists
- **D.9** Distributed contract validation (cross-service contract checks via `traceId`)
- **D.10** Coverage gate — ✅ implemented (dashboard slider + per-function badge)

---

_Last updated: 2026-04-06_
