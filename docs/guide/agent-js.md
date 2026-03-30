# JavaScript / TypeScript Agent

`@ghost-doc/agent-js` is a zero-config TypeScript tracer that captures function calls and sends them to the Hub.

## Installation

```bash
npm install @ghost-doc/agent-js
# or
pnpm add @ghost-doc/agent-js
```

## Creating a tracer

```typescript
import { createTracer } from "@ghost-doc/agent-js";

const tracer = createTracer({
  agentId: "my-api",                        // shown as the agent badge in the dashboard
  hubUrl: "ws://localhost:3001/agent",       // default
  sanitize: ["password", "token", "secret"], // keys redacted before sending
  enabled: true,                             // false = decorators become no-ops
});
```

## `@tracer.trace` decorator

Works on class methods — sync, async, and generator functions.

```typescript
class UserService {
  // No options — function name auto-used as node label
  @tracer.trace
  getUser(id: string) { ... }

  // Custom label (shown in dashboard instead of method name)
  @tracer.trace({ label: "user.lookup" })
  getUser(id: string) { ... }

  // Custom description (shown in node tooltip and inspector)
  @tracer.trace({ description: "Fetches a full user record from the primary replica" })
  async getUser(id: string) { ... }

  // Label + description
  @tracer.trace({ label: "user.lookup", description: "Loads user from DB" })
  async getUser(id: string) { ... }

  // Async — identical API
  @tracer.trace
  async fetchProfile(userId: string) { ... }

  // Generator — identical API
  @tracer.trace
  *streamEvents(cursor: string) { ... }
}
```

## `tracer.wrap()` for plain functions

Use `wrap()` for arrow functions and module-level functions that can't use decorators.

```typescript
const getUser = tracer.wrap(
  async (id: string) => db.find(id),
  "user.lookup",                              // label (optional)
  "Fetches a user from the primary database", // description (optional)
);

// Works identically to the decorator
const result = await getUser("u1");
```

## What is captured

Every traced call emits a `TraceEvent` span containing:

| Field | Description |
| :--- | :--- |
| `trace_id` | UUID shared across a full call chain |
| `span_id` | UUID unique to this function call |
| `parent_span_id` | Links to the caller's span |
| `source.file` | Absolute file path |
| `source.line` | Line number where the function is defined |
| `source.function_name` | Function or method name (or custom label) |
| `source.description` | Optional description for tooltip / inspector |
| `timing.started_at` | Unix millisecond timestamp |
| `timing.duration_ms` | Wall-clock duration |
| `input` | Sanitized function arguments |
| `output` | Sanitized return value |
| `error` | Error type, message, and stack (if thrown) |

## Sanitization

Fields are redacted **before leaving your process**. The default blocklist:

```typescript
["password", "token", "secret", "authorization", "api_key"]
```

Custom list:

```typescript
const tracer = createTracer({
  agentId: "api",
  sanitize: ["password", "ssn", "credit_card", "token", "api_key"],
});
```

Deep objects are walked recursively. Matching keys are replaced with `"[REDACTED]"`.

## Offline buffering

If the Hub is unreachable, traces are stored in a ring buffer (500 spans by default) and flushed automatically on reconnect.

## Disabling tracing

```typescript
const tracer = createTracer({
  agentId: "api",
  enabled: process.env.NODE_ENV !== "test", // no-op in tests
});
```

## Requirements

- Node.js 18+ or a modern browser (ESM)
- TypeScript 5.2+ with `"experimentalDecorators": false` (TC39 Stage 3 decorators)
