# TraceEvent Schema

Every agent (JS or Python) emits a `TraceEvent` JSON payload for each traced function call. The Hub validates every incoming payload against this schema using Zod.

## Full schema

```typescript
interface TraceEvent {
  schema_version: "1.0";
  trace_id: string; // UUID v4 — shared across a full call chain
  span_id: string; // UUID v4 — unique per function call
  parent_span_id: string | null; // null for root spans
  source: {
    agent_id: string; // e.g. "frontend-react", "backend-python"
    language: "js" | "python";
    file: string; // absolute file path
    line: number; // line number where the function is defined
    function_name: string; // function or method name (or custom label)
    description?: string; // optional — shown in tooltip & inspector
  };
  timing: {
    started_at: number; // Unix milliseconds
    duration_ms: number; // wall-clock duration
  };
  input: unknown[]; // sanitized function arguments
  output: unknown; // sanitized return value
  error: {
    type: string; // e.g. "TypeError", "ValueError"
    message: string;
    stack: string;
  } | null;
  tags: Record<string, string>;
}
```

## Field details

### `trace_id`

Groups all spans from a single logical request into a call tree. The root span generates a new UUID; child spans inherit it from their parent.

For distributed traces across multiple agents (e.g. a JS frontend calling a Python service), pass the `trace_id` via the `X-Trace-Id` HTTP header. Both agents will emit spans under the same `trace_id`, and the Hub will correlate them into a single distributed trace.

### `parent_span_id`

`null` for the root span of a call chain. Set to the caller's `span_id` for all child spans. The Hub uses this field to build the tree structure shown in the dashboard.

### `source.description`

Optional human-readable description for this function. Shown in:

- **Node tooltip** — hover over any node in the flowchart
- **Inspector panel** — click any node to open the detail view

**JS agent:** pass as `@tracer.trace({ description: "..." })` or `tracer.wrap(fn, label, description)`.

**Python agent:** automatically extracted from the first line of the function's docstring. Override with `@tracer.trace(description="...")`.

### `input` / `output`

Serialized via `JSON.stringify` (JS) or `json.dumps` with `repr()` fallback (Python). Two layers of sanitization are applied before serialization:

1. **Key-based** — any key matching the `sanitize` blocklist (e.g. `password`, `token`, `api_key`) is replaced with `"[REDACTED]"`, recursively.
2. **Value-pattern** — string values are scanned for known secret patterns regardless of their key name: JWT strings (three Base64 segments separated by `.`) and digit sequences of 13–19 characters that match credit card formats are also replaced with `"[REDACTED]"`.

### `error`

`null` when the function returns normally. Populated when the function throws or raises an exception; the original exception is re-thrown after the span is emitted.

### `tags`

Free-form string key-value pairs. Reserved for future use by agents and the Hub. Currently emitted as `{}`.

## Validation

The Hub validates every incoming span against the Zod schema at the WebSocket boundary. Invalid payloads are logged and discarded — they never crash the Hub or affect other connected clients.

```typescript
// packages/shared-types/src/schema.ts
import { z } from "zod";

export const TraceEventSchema = z.object({
  schema_version: z.literal("1.0"),
  trace_id: z.string().uuid(),
  span_id: z.string().uuid(),
  parent_span_id: z.string().uuid().nullable(),
  source: z.object({
    agent_id: z.string().min(1),
    language: z.enum(["js", "python"]),
    file: z.string(),
    line: z.number().int().nonnegative(),
    function_name: z.string().min(1),
    description: z.string().optional(),
  }),
  timing: z.object({
    started_at: z.number(),
    duration_ms: z.number().nonnegative(),
  }),
  input: z.array(z.unknown()),
  output: z.unknown(),
  error: z
    .object({
      type: z.string(),
      message: z.string(),
      stack: z.string(),
    })
    .nullable(),
  tags: z.record(z.string()),
});
```
