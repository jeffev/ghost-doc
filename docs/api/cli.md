# CLI Reference

All commands are available via `npx ghost-doc <command>` or `ghost-doc <command>` if installed globally.

## `ghost-doc start`

Starts the Hub server and opens the Dashboard in the default browser.

```bash
ghost-doc start [options]
```

| Option            | Default                    | Description                           |
| :---------------- | :------------------------- | :------------------------------------ |
| `--port <n>`      | `3001`                     | Port for Hub server and Dashboard     |
| `--no-open`       | —                          | Do not open the browser automatically |
| `--config <path>` | `~/.ghost-doc/config.json` | Path to config file                   |

## `ghost-doc stop`

Gracefully shuts down a running Hub process.

```bash
ghost-doc stop
```

## `ghost-doc status`

Displays connected agents, trace count, and trace rate.

```bash
ghost-doc status
```

**Output example:**

```
Ghost Doc Hub — running on port 3001
  Agents:       2 connected (backend-api, python-service)
  Traces total: 1,847
  Trace rate:   12.4 / sec
```

## `ghost-doc export`

Exports the current call graph to a documentation format.

```bash
ghost-doc export [options]
```

| Option             | Description                                                    |
| :----------------- | :------------------------------------------------------------- |
| `--format <fmt>`   | `markdown` \| `html` \| `notion` \| `obsidian` \| `confluence` |
| `--output <path>`  | Output file path (for markdown / obsidian)                     |
| `--project <name>` | Project name used in the export header                         |
| `--agent <id>`     | Export only traces from this agent                             |
| `--since <iso>`    | Export only traces after this timestamp                        |
| `--token <t>`      | API token (Notion / Confluence)                                |
| `--page-id <id>`   | Target page ID (Notion)                                        |
| `--url <base>`     | Base URL (Confluence)                                          |
| `--space <key>`    | Space key (Confluence)                                         |
| `--vault-path <p>` | Obsidian vault path                                            |

**Examples:**

```bash
# Markdown + Mermaid
ghost-doc export --format markdown --output FLOW.md --project MyApp

# Self-contained HTML (opens in any browser)
ghost-doc export --format html --output FLOW.html --project MyApp

# Notion
ghost-doc export --format notion --token secret_xxx --page-id abc123

# Obsidian
ghost-doc export --format obsidian --vault-path ~/Notes

# Confluence
ghost-doc export --format confluence \
  --url https://myorg.atlassian.net \
  --space ENG \
  --token xxx
```

## `ghost-doc snapshot`

Saves the current in-memory trace buffer to disk.

```bash
ghost-doc snapshot [--output <path>]
```

## `ghost-doc snapshots list`

Lists all saved snapshots with their IDs, timestamps, and span counts.

## `ghost-doc load <id>`

Loads a saved snapshot into the Dashboard for time-travel replay.

```bash
ghost-doc load 2024-01-15T10-30-00-000Z
```

## `ghost-doc share <id>`

Encodes a snapshot as a base64 URL fragment for sharing.

```bash
ghost-doc share 2024-01-15T10-30-00-000Z
# → https://jeffev.github.io/ghost-doc/view#eyJ...
```

---

## Contract commands

### `ghost-doc contract infer`

Infers a behavioral contract from the Hub's recorded spans and prints it to stdout.

```bash
ghost-doc contract infer [options]
```

| Option              | Default | Description                                              |
| :------------------ | :------ | :------------------------------------------------------- |
| `--function <name>` | —       | Infer for a single function only (infers all if omitted) |
| `--min-samples <n>` | `1`     | Minimum call count required                              |
| `--format <fmt>`    | `json`  | `json` \| `yaml` \| `typescript`                         |
| `--port <n>`        | `3001`  | Hub port                                                 |

**Examples:**

```bash
# Infer contracts for all observed functions (JSON)
ghost-doc contract infer

# Infer a specific function as YAML
ghost-doc contract infer --function createOrder --format yaml

# Require at least 20 samples before inferring
ghost-doc contract infer --min-samples 20
```

---

### `ghost-doc contract validate`

Validates current Hub spans against a saved contract file and reports any violations.

```bash
ghost-doc contract validate --contract <path> [options]
```

| Option              | Default | Description                                         |
| :------------------ | :------ | :-------------------------------------------------- |
| `--contract <path>` | —       | Path to a saved `ContractDefinition` JSON/YAML file |
| `--port <n>`        | `3001`  | Hub port                                            |

**Example:**

```bash
ghost-doc contract validate --contract contracts/createOrder.json
```

---

### `ghost-doc contract export`

Infers a contract and saves it to a file on disk (via Hub's `POST /contracts/save`).

```bash
ghost-doc contract export [options]
```

| Option              | Default | Description                      |
| :------------------ | :------ | :------------------------------- |
| `--function <name>` | —       | Function to infer (required)     |
| `--format <fmt>`    | `json`  | `json` \| `yaml` \| `typescript` |
| `--port <n>`        | `3001`  | Hub port                         |

**Example:**

```bash
ghost-doc contract export --function processPayment --format yaml
# → Saved to ~/.ghost-doc/contracts/processPayment.yaml
```

---

## Mock commands

### `ghost-doc mock record`

Saves the Hub's current spans as a named session.

```bash
ghost-doc mock record --name <name> [options]
```

| Option                      | Default | Description                          |
| :-------------------------- | :------ | :----------------------------------- |
| `--name <name>`             | —       | Session name (required)              |
| `--functions <fn1,fn2,...>` | —       | Restrict to specific function names  |
| `--max-calls <n>`           | —       | Maximum calls per function to record |
| `--port <n>`                | `3001`  | Hub port                             |

**Examples:**

```bash
# Record everything currently in the Hub
ghost-doc mock record --name payment-flow

# Record only two specific functions
ghost-doc mock record --name checkout --functions createOrder,processPayment
```

---

### `ghost-doc mock serve`

Starts an HTTP mock server that replays a recorded session.

```bash
ghost-doc mock serve --session <name> [options]
```

| Option                   | Default       | Description                                                   |
| :----------------------- | :------------ | :------------------------------------------------------------ |
| `--session <name>`       | —             | Session name to replay (required)                             |
| `--mock-port <n>`        | `8080`        | Port for the mock HTTP server                                 |
| `--mode <m>`             | `round-robin` | `exact` \| `round-robin` \| `latency-preserving`              |
| `--fault-error-rate <f>` | —             | Fraction (0–1) of calls that return a recorded error response |
| `--fault-latency <f>`    | —             | Latency multiplier (e.g. `2.0` = double the recorded delay)   |
| `--port <n>`             | `3001`        | Hub port (to load session from)                               |

**Mode details:**

| Mode                 | Behavior                                                                |
| :------------------- | :---------------------------------------------------------------------- |
| `exact`              | Returns responses in the exact recorded sequence. Cycles on exhaustion. |
| `round-robin`        | Returns a random response from the set recorded for that function.      |
| `latency-preserving` | Delays each response by the recorded `durationMs`.                      |

**Examples:**

```bash
# Serve the payment-flow session on port 8080
ghost-doc mock serve --session payment-flow --mock-port 8080

# Inject 10% error rate
ghost-doc mock serve --session payment-flow --fault-error-rate 0.1

# Double all latencies
ghost-doc mock serve --session payment-flow --mode latency-preserving --fault-latency 2.0
```

---

### `ghost-doc mock generate`

Generates a static mock file (Jest, Vitest, or pytest) from a recorded session.

```bash
ghost-doc mock generate --session <name> [options]
```

| Option             | Default  | Description                               |
| :----------------- | :------- | :---------------------------------------- |
| `--session <name>` | —        | Session name (required)                   |
| `--target <t>`     | `vitest` | `jest` \| `vitest` \| `pytest`            |
| `--output <path>`  | —        | Output file (prints to stdout if omitted) |
| `--port <n>`       | `3001`   | Hub port                                  |

**Examples:**

```bash
# Generate a Vitest mock file
ghost-doc mock generate --session payment-flow --target vitest --output __mocks__/payment.ts

# Generate a pytest fixture file
ghost-doc mock generate --session payment-flow --target pytest --output mocks/payment.py
```

**Vitest output example:**

```typescript
// auto-generated by ghost-doc — session: payment-flow
import { vi } from "vitest";

export const mockCreateOrder = vi
  .fn()
  .mockResolvedValueOnce({ orderId: "ord_456", status: "pending" })
  .mockResolvedValueOnce({ orderId: "ord_457", status: "confirmed" });
```

---

### `ghost-doc mock diff`

Compares two saved sessions and reports behavioral differences (added/removed functions, changed return shapes, error rate changes, latency regressions).

```bash
ghost-doc mock diff <session-a> <session-b> [options]
```

| Option            | Default | Description                             |
| :---------------- | :------ | :-------------------------------------- |
| `--threshold <n>` | `20`    | Latency regression threshold in percent |
| `--port <n>`      | `3001`  | Hub port                                |

**Example:**

```bash
ghost-doc mock diff payment-flow-baseline payment-flow-new --threshold 15
```

**Output example:**

```
Session diff: payment-flow-baseline → payment-flow-new
  Added functions:    refundOrder
  Removed functions:  (none)
  Changed return shapes:
    createOrder — return shape changed
  Latency regressions (>15%):
    processPayment  120ms → 195ms (+62.5%)
⚠  Breaking changes detected.
```

---

### `ghost-doc mock list`

Lists all saved sessions.

```bash
ghost-doc mock list [--port <n>]
```

**Output example:**

```
Saved sessions:
  payment-flow     12 calls  2026-04-05 10:00
  checkout-happy    8 calls  2026-04-05 11:30
```

---

### `ghost-doc mock clone`

Clones a saved session under a new name.

```bash
ghost-doc mock clone --session <name> --name <new-name> [--port <n>]
```

**Example:**

```bash
ghost-doc mock clone --session payment-flow --name payment-flow-v2
```

---

### `ghost-doc mock rename`

Renames a saved session.

```bash
ghost-doc mock rename --session <name> --name <new-name> [--port <n>]
```

**Example:**

```bash
ghost-doc mock rename --session payment-flow --name payment-flow-baseline
```

---

### `ghost-doc mock merge`

Merges two or more saved sessions into a new combined session.

```bash
ghost-doc mock merge --sessions <a>,<b>[,<c>...] --name <new-name> [--port <n>]
```

**Example:**

```bash
ghost-doc mock merge --sessions happy-path,error-cases --name combined-suite
```
