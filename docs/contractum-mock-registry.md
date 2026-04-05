# Contractum & Mock Registry — Feature Planning

> **Status:** Backlog — not committed to a release timeline.
> Depends on: Phase 0–4 complete (Hub store, Agent traces, Exporter pipeline).

Ghost Doc already records everything needed to power contract validation and realistic mock generation: real arguments, real return values, timings, error shapes, call order, and distributed trace context. These two modules transform Ghost Doc from a **passive observer** into an **active guarantor of correctness**.

---

## Overview

| Module            | What it does                                                                                                                                       |
| :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contractum**    | Infers behavioral contracts from recorded calls. Validates future calls against those contracts. Reports violations in real-time to the Dashboard. |
| **Mock Registry** | Turns recorded sessions into replayable mocks. Serves them over HTTP or generates static mock files for Jest/Vitest/pytest.                        |

Both modules share the same data source: the Hub's in-memory trace store and saved snapshots.

---

## Phase A — Contractum

### A.1 — Contract Inference

**Input:** Recorded `TraceEvent[]` from the Hub store.
**Output:** A JSON Schema describing the expected inputs and output of a function.

```typescript
// ghostDoc.contract.infer(options?)
interface InferOptions {
  functionName?: string; // omit to infer for all traced functions
  minSamples?: number; // minimum calls required (default: 10)
  strictTypes?: boolean; // true = exact types; false = union types allowed
  outputFormat?: "json-schema" | "typescript" | "yaml";
}

const contract = await ghostDoc.contract.infer({
  functionName: "createOrder",
  minSamples: 5,
  outputFormat: "json-schema",
});
```

**Inference algorithm (deterministic, no AI):**

1. Collect all recorded calls for the target function.
2. For each positional/named argument, inspect `typeof` and prototype chain across all samples.
3. Build union of observed types (`string | number` if both seen).
4. Mark a field as `required: true` if present in ≥ 90% of samples.
5. If a field has ≤ 10 distinct values across all samples → emit as `enum`.
6. Apply heuristics for common patterns: UUID, email, ISO date, URL → emit as `format` or `pattern`.
7. Recurse into nested objects and arrays.
8. Repeat steps 2–7 for the return value.
9. Wrap everything in a `ContractDefinition` envelope.

**ContractDefinition schema:**

```typescript
interface ContractDefinition {
  version: "1.0";
  functionName: string;
  generatedAt: string; // ISO timestamp
  sampleCount: number;
  args: JSONSchema[]; // one schema per positional arg
  returns: JSONSchema;
  errors?: JSONSchema[]; // observed error shapes
}
```

---

### A.2 — Contract Validation (Runtime)

Intercepts future calls of the target function (already instrumented by the Agent) and compares args/return against the contract schema.

```typescript
interface ValidateOptions {
  onViolation?: (violation: ContractViolation) => void;
  throwOnViolation?: boolean; // default: false — report only
  sampleRate?: number; // 0–1, validate only x% of calls (perf guard)
}

ghostDoc.contract.validate(contract, {
  onViolation: (v) => ghostDoc.report("contract-violation", v),
});

interface ContractViolation {
  functionName: string;
  spanId: string;
  traceId: string;
  timestamp: number;
  violations: Array<{
    path: string; // e.g. "args[0].userId"
    expected: string; // e.g. "string"
    received: string; // e.g. "number"
    rule: "type" | "required" | "enum" | "pattern" | "format";
  }>;
}
```

Violations are emitted to the Hub as a new event type (`contract-violation`) and appear in the Dashboard as alert indicators on the relevant node.

---

### A.3 — Contract Export & Import

```typescript
// Export to disk
await ghostDoc.contract.export("user-service-contract.yaml", "yaml");
await ghostDoc.contract.export("contracts/", { splitByFunction: true });

// Load external contract (e.g. hand-written or from OpenAPI)
ghostDoc.contract.load(externalSchema);

// CLI equivalents
// npx ghost-doc contract infer --function createOrder --out contract.json
// npx ghost-doc contract validate --contract contract.json --on-violation report
// npx ghost-doc contract export --format yaml --out contracts/
```

---

### A.4 — Dashboard: Contracts Tab

New tab in the Dashboard alongside Flowchart / Flame Graph:

- **Function list** — each traced function with: inferred contract status (yes/no/loading), violation count (last 24h), last validated timestamp.
- **Contract detail panel** — shows the full JSON Schema for args and return. Click any field to see observed samples.
- **Violations feed** — real-time stream of `ContractViolation` events. Click to jump to the span in the inspector.
- **"Generate Contract" button** — triggers `contract.infer()` from the inspector panel of any function node.

---

## Phase B — Mock Registry

### B.1 — Recording Sessions

Ghost Doc already records calls. This phase adds explicit session management:

```typescript
interface RecordingOptions {
  functions?: string[]; // restrict to specific function names
  maxCallsPerFunction?: number; // default: unlimited
  includeSensitiveFields?: boolean; // default: false (uses existing sanitizer)
  filter?: (call: TraceEvent) => boolean;
}

ghostDoc.mock.startRecording("payment-flow", options);
// ... app runs, calls are captured ...
const snapshot = await ghostDoc.mock.stopRecording();
// Saves to ~/.ghost-doc/sessions/payment-flow-<timestamp>.json
```

**Session snapshot format (YAML):**

```yaml
session: payment-flow
startTime: 2026-04-03T10:00:00Z
endTime: 2026-04-03T10:05:00Z
calls:
  - function: createOrder
    spanId: span_abc
    traceId: trace_xyz
    args: [{ userId: "u_123", amount: 99.99 }]
    return: { orderId: "ord_456", status: "pending" }
    durationMs: 42
    error: null
    sequence: 1
  - function: processPayment
    spanId: span_def
    traceId: trace_xyz
    args: [{ orderId: "ord_456", method: "credit" }]
    return: { transactionId: "tx_789" }
    durationMs: 210
    error: null
    sequence: 2
```

**CLI:**

```bash
npx ghost-doc mock record --name payment-flow --duration 30s
npx ghost-doc mock record --name payment-flow --functions createOrder,processPayment
```

---

### B.2 — Mock Server (HTTP Replay)

Serves a saved session as an HTTP API, replaying responses in the recorded order:

```typescript
interface ServeOptions {
  mode: "exact" | "round-robin" | "latency-preserving";
  faultInjection?: {
    errorRate?: number; // 0–1: fraction of calls that return a recorded error
    latencyFactor?: number; // e.g. 2.0 = double the recorded latency
  };
}

await ghostDoc.mock.serve(8080, "payment-flow", {
  mode: "exact",
  faultInjection: { errorRate: 0.05 },
});
```

**Mode details:**

| Mode                 | Behavior                                                                |
| :------------------- | :---------------------------------------------------------------------- |
| `exact`              | Returns responses in the exact recorded sequence. Cycles on exhaustion. |
| `round-robin`        | Returns a random response from the recorded set for that function.      |
| `latency-preserving` | Delays each response by the recorded `durationMs` before responding.    |

**CLI:**

```bash
npx ghost-doc mock serve --session payment-flow --port 8080 --mode exact
npx ghost-doc mock serve --session payment-flow --port 8080 --fault-error-rate 0.1
```

---

### B.3 — Static Mock Generation (Unit Tests)

Generates mock files for test frameworks from a recorded session:

```typescript
await ghostDoc.mock.generate("payment-flow", "__mocks__/payment.ts", {
  target: "jest" | "vitest" | "pytest",
  includeTimings: false,
  oneCallPerFunction: true, // use first recorded call only
});
```

**Jest/Vitest output example:**

```typescript
// __mocks__/payment.ts — auto-generated by ghost-doc mock generate
export const mockCreateOrder = vi.fn().mockResolvedValue({
  orderId: "ord_456",
  status: "pending",
});

export const mockProcessPayment = vi.fn().mockResolvedValue({
  transactionId: "tx_789",
});
```

**pytest output example:**

```python
# __mocks__/payment.py — auto-generated by ghost-doc mock generate
def mock_create_order(*args, **kwargs):
    return {"orderId": "ord_456", "status": "pending"}

def mock_process_payment(*args, **kwargs):
    return {"transactionId": "tx_789"}
```

**CLI:**

```bash
npx ghost-doc mock generate --session payment-flow --output ./__mocks__/payment.ts --target jest
npx ghost-doc mock generate --session payment-flow --output ./mocks/payment.py --target pytest
```

---

### B.4 — Session Diff (Regression Detection)

Compares two sessions and reports behavioral differences:

```typescript
const diff = await ghostDoc.mock.diff("payment-old", "payment-new");

interface SessionDiff {
  addedFunctions: string[];
  removedFunctions: string[];
  changedReturnShapes: Array<{
    function: string;
    before: JSONSchema;
    after: JSONSchema;
  }>;
  changedErrorRate: Array<{
    function: string;
    before: number; // fraction of calls that errored
    after: number;
  }>;
  latencyRegression: Array<{
    function: string;
    beforeP95Ms: number;
    afterP95Ms: number;
    changePercent: number;
  }>;
}
```

**CLI:**

```bash
npx ghost-doc mock diff payment-old payment-new
npx ghost-doc mock diff payment-old payment-new --threshold 20  # flag latency regressions > 20%
```

---

### B.5 — Dashboard: Mocks Tab

New tab in the Dashboard:

- **Session list** — all recorded sessions with start/end time, call count, size.
- **Per-session detail** — table of calls (function, sequence, duration, error).
- **"Start Recording" button** — live recording toggle.
- **"Replay" button** — starts mock server on configurable port.
- **"Export Mocks" button** — triggers `mock.generate()` for a target framework.
- **"Compare" button** — opens session diff against another session or the current live data.

---

## Phase C — Cross-Module Integration

### C.1 — Validate Mocks Against Contracts

After generating a mock session, automatically validate that all mocked responses comply with the inferred contract:

```typescript
const contract = await ghostDoc.contract.infer({ functionName: "createOrder" });
const calls = await ghostDoc.mock.exportCalls("payment-flow");
const violations = ghostDoc.contract.validateCalls(calls, contract);

if (violations.length > 0) {
  ghostDoc.report("mock-contract-mismatch", violations);
  // Shown as a warning badge on the session in the Mocks tab
}
```

This detects cases where a recorded session was captured during a period when the function behaved unusually — the mock would then propagate incorrect behavior into tests.

### C.2 — "Freeze Contract" workflow

One-click workflow from the Dashboard inspector:

1. User clicks a function node → inspector panel opens.
2. User clicks **"Freeze Contract"**.
3. Ghost Doc: infers contract from recorded calls → saves to `contracts/<function-name>.json` → activates runtime validation → adds a lock icon to the node.
4. Future violations are immediately visible in the Dashboard.

### C.3 — CI Integration

```bash
# In CI: validate that the current run's calls comply with the frozen contract
npx ghost-doc contract validate --contract contracts/ --on-violation exit-1

# In CI: diff current session against baseline
npx ghost-doc mock diff baseline --session current --threshold 20 --on-regression exit-1
```

---

## Implementation Notes

### Data dependencies (already available)

| Needed                                          | Source                                             |
| :---------------------------------------------- | :------------------------------------------------- |
| Recorded calls (args, returns, errors, timings) | Hub in-memory store + snapshot files               |
| Call order and parent-child relationships       | `sequence` + `parent_span_id` in `TraceEvent`      |
| Sanitized values                                | Existing sanitizer layer (Agent + Hub double-pass) |
| Function metadata (file, line, agent)           | `source` field in `TraceEvent`                     |

### No new Agent changes needed for Phases A and B

All inference and mock generation works off the already-recorded `TraceEvent[]`. The Agent does not need to be modified — it already captures everything required.

The only Agent change needed for **A.2 (runtime validation)** is a hook to intercept post-call results, which can be added as an optional plugin to the existing `traceFunction` wrapper.

### Schema inference is deterministic

No AI is required for the core inference algorithm. The `json-schema` output is derived deterministically from observed types and values. AI (LLM) can be layered on top later to:

- Generate natural-language descriptions of contracts.
- Detect semantic anomalies (value looks like a UUID but schema says plain string).
- Suggest contract refinements from failing cases.

### Sensitive data

The mock server and static mock generator operate exclusively on sanitized values (already redacted by the sanitizer before storage). No additional redaction logic is needed.

---

## API Surface Summary

| Module     | Method                                   | Description                                      |
| :--------- | :--------------------------------------- | :----------------------------------------------- |
| `contract` | `infer(options)`                         | Generate JSON Schema from recorded calls         |
| `contract` | `validate(contract, options)`            | Validate future calls at runtime                 |
| `contract` | `validateCalls(calls, contract)`         | Validate a call array (used for mock validation) |
| `contract` | `export(filename, format)`               | Save contract to disk                            |
| `contract` | `load(definition)`                       | Load external contract (OpenAPI, hand-written)   |
| `mock`     | `startRecording(name, options)`          | Begin a named recording session                  |
| `mock`     | `stopRecording()`                        | End session and save to disk                     |
| `mock`     | `serve(port, session, options)`          | Start HTTP mock server (replay mode)             |
| `mock`     | `generate(session, outputFile, options)` | Generate Jest/Vitest/pytest mock file            |
| `mock`     | `diff(sessionA, sessionB)`               | Compare two sessions for behavioral regressions  |
| `mock`     | `exportCalls(session)`                   | Return call array for programmatic use           |

---

## Dependency on Existing Roadmap

```
Phase 2 (Hub — in-memory store, snapshots)
    └── Phase A (Contractum — reads from store)
    └── Phase B (Mock Registry — reads from store)
            └── Phase C (Integration — A + B together)
                    └── Phase 5 (Hardening — security + perf for new surface)
```

Phases A and B are **independent** and can be developed in parallel.
Phase C requires both A and B to be at least partially complete.

---

## Phase D — Future Features (Backlog)

> These are not committed to any release. Listed for planning purposes.

---

### D.1 — Consumer-Driven Contract Testing (Contractum)

Multiple consumers declare what they expect from a provider. Contractum validates that the provider satisfies all consumers — using already-recorded traces, without separate infrastructure.

```typescript
ghostDoc.contract.defineConsumer("checkout-service", {
  expects: "createOrder",
  requiredFields: ["orderId", "status"],
  allowedStatuses: ["pending", "confirmed"],
});

const report = await ghostDoc.contract.verifyConsumers("createOrder");
// Reports which consumers are satisfied or broken
```

**CLI:**

```bash
npx ghost-doc contract verify-consumers --function createOrder
```

---

### D.2 — Invariant Rules / Negative Contracts (Contractum)

Complements the type schema with rules that must _never_ be true, regardless of type. Evaluated at the same point as runtime validation (A.2).

```typescript
ghostDoc.contract.addInvariant("processPayment", {
  rule: "args[0].amount > 0",
  description: "Amount must be positive",
  severity: "error",
});

ghostDoc.contract.addInvariant("createOrder", {
  rule: '!return.orderId.startsWith("test_")',
  description: "No test IDs in production",
  severity: "warning",
});
```

Violations emit the same `ContractViolation` event as A.2, with `rule: 'invariant'`.

---

### D.3 — Contract Drift Tracking (Contractum)

Automatically snapshots inferred contracts on each deploy or recording session. Detects when the schema has drifted relative to a baseline:

```
Function: createOrder
  args[0].currency   → NEW field (not in baseline contract)
  return.eta         → REMOVED field
  return.status      → enum expanded: added "processing"
```

Dashboard shows a timeline of contract drift per function. Integrates with CI via:

```bash
npx ghost-doc contract drift --baseline contracts/baseline/ --on-breaking exit-1
```

---

### D.4 — Contract Confidence Score (Contractum)

Each contract exposes a score (0–100) based on: sample count, type variance across samples, error scenario coverage, and field presence consistency. Low-confidence contracts are flagged in the Dashboard as "fragile" and excluded from CI gates until the score reaches a configurable threshold.

```typescript
interface ContractDefinition {
  // ... existing fields ...
  confidence: {
    score: number; // 0–100
    factors: {
      sampleCount: number;
      typeVariance: number; // 0 = fully consistent, 1 = maximally varied
      errorCoverage: number; // fraction of functions with at least one error sample
    };
    verdict: "strong" | "acceptable" | "fragile";
  };
}
```

---

### D.5 — Scenario-Based Mocks (Mock Registry)

Groups calls into named, activatable scenarios without requiring separate sessions. Scenarios override specific function responses while keeping everything else from the base session.

```typescript
ghostDoc.mock.defineScenario("payment-flow", "timeout", {
  override: {
    processPayment: {
      error: { code: "TIMEOUT", message: "Gateway timed out" },
      durationMs: 30000,
    },
  },
});

ghostDoc.mock.defineScenario("payment-flow", "happy-path", {
  override: {}, // no overrides — uses recorded responses as-is
});

// In tests:
ghostDoc.mock.activateScenario("payment-flow", "timeout");
```

**CLI:**

```bash
npx ghost-doc mock serve --session payment-flow --scenario timeout --port 8080
```

---

### D.6 — Stateful Mocks (Mock Registry)

Mock responses that evolve with state — the response depends on prior calls within the same session. Useful for testing polling loops, async flows, and multi-step processes.

```yaml
# In session definition:
- function: getOrderStatus
  stateMachine:
    initial: pending
    responses:
      pending: { status: "pending" }
      confirmed: { status: "confirmed" }
      shipped: { status: "shipped", trackingUrl: "https://..." }
    transitions:
      - after: 2000ms → confirmed
      - after: 10000ms → shipped
```

```typescript
await ghostDoc.mock.serve(8080, "payment-flow", {
  mode: "stateful",
  resetStateOnRestart: true,
});
```

---

### D.7 — OpenAPI / AsyncAPI Export (Mock Registry)

Exports a recorded session as an OpenAPI 3.1 spec (REST) or AsyncAPI 2.x spec (events/WebSocket), bridging Ghost Doc with API gateways, documentation tools, and client generators.

```bash
npx ghost-doc mock export --session payment-flow --format openapi  --out openapi.yaml
npx ghost-doc mock export --session events-flow  --format asyncapi --out asyncapi.yaml
```

```typescript
await ghostDoc.mock.exportSpec("payment-flow", {
  format: "openapi" | "asyncapi",
  outputFile: "openapi.yaml",
  baseUrl: "https://api.example.com",
});
```

---

### D.8 — Mock Warming / Synthetic Data Generation (Mock Registry)

When no recorded session exists (or the sample count is insufficient), generates synthetic but schema-valid calls derived from the inferred contract. Useful for bootstrapping a mock server before any real traffic has been captured.

```typescript
await ghostDoc.mock.warm("createOrder", {
  from: "contract", // uses inferred contract as schema
  count: 50, // generate 50 synthetic calls
  saveAs: "synthetic-orders", // store as a regular session
  seed: 42, // deterministic output
});
```

Synthetic values respect all inferred constraints: `enum` values, `format` hints (UUID, email, ISO date), required fields, and nested object shapes.

---

### D.9 — Distributed Contract Validation (Cross-Module)

Uses the shared `traceId` to validate cross-service calls. Each service publishes its contract to the Hub; when `ServiceA` calls `ServiceB`, the Hub automatically validates the outgoing args and incoming response against `ServiceB`'s published contract.

```typescript
// ServiceB registers its contract with the Hub
ghostDoc.contract.publish("createOrder", contract, { public: true });

// ServiceA — no code changes needed; Hub validates via trace context
// Violations appear in the Dashboard attributed to the calling span
```

Requires Hub 2.x multi-agent support (already on the roadmap).

---

### D.10 — Coverage Gate (CI Integration)

Blocks CI if a function with an active contract has fewer than N recorded samples in the current session — prevents contracts inferred from insufficient data from reaching production.

```bash
npx ghost-doc contract coverage --min-samples 20 --on-insufficient exit-1
```

```typescript
interface CoverageReport {
  functions: Array<{
    name: string;
    sampleCount: number;
    hasContract: boolean;
    verdict: "sufficient" | "insufficient" | "no-contract";
  }>;
  totalInsufficient: number;
}
```

Also surfaced in the Dashboard's Contracts tab as a coverage indicator per function.

---

### Phase D — Priority Matrix

| Feature                     | Value  | Complexity | Depends on   |
| :-------------------------- | :----- | :--------- | :----------- |
| D.4 — Confidence Score      | Medium | Low        | A.1          |
| D.2 — Invariant Rules       | High   | Low        | A.2          |
| D.5 — Scenario Mocks        | High   | Medium     | B.1–B.2      |
| D.7 — OpenAPI Export        | Medium | Low        | B.1          |
| D.10 — Coverage Gate        | Medium | Low        | A.1, C.3     |
| D.3 — Contract Drift        | Medium | Medium     | A.1, A.3     |
| D.8 — Mock Warming          | Medium | Medium     | A.1, B.1     |
| D.6 — Stateful Mocks        | High   | High       | B.2          |
| D.1 — Consumer-Driven       | High   | High       | A.1–A.2      |
| D.9 — Distributed Contracts | High   | High       | C.1, Hub 2.x |

Low-complexity, high-value candidates to prioritize: **D.2**, **D.4**, **D.5**, **D.7**, **D.10**.

---

_Created: 2026-04-03 — Future features added: 2026-04-03_
