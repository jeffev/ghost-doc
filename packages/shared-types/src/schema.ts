import { z } from "zod";

export const LanguageSchema = z.enum([
  "js",
  "python",
  "go",
  "rust",
  "java",
  "csharp",
  "other",
]);

export const SourceSchema = z.object({
  agent_id: z.string().min(1),
  language: LanguageSchema,
  file: z.string(),
  line: z.number().int().nonnegative(),
  function_name: z.string(),
  /** Optional human-readable description of what this function does. */
  description: z.string().optional(),
});

export const TimingSchema = z.object({
  /** Unix epoch milliseconds at the start of the call */
  started_at: z.number().positive(),
  /** Total wall-clock duration in milliseconds */
  duration_ms: z.number().nonnegative(),
});

export const ErrorInfoSchema = z.object({
  type: z.string(),
  message: z.string(),
  stack: z.string(),
});

export const TraceEventSchema = z.object({
  schema_version: z.literal("1.0"),
  /** Unique ID for the entire call chain (shared across nested spans) */
  trace_id: z.string().uuid(),
  /** Unique ID for this specific function invocation */
  span_id: z.string().uuid(),
  /** span_id of the caller, or null for the root span */
  parent_span_id: z.string().uuid().nullable(),
  source: SourceSchema,
  timing: TimingSchema,
  /** Sanitized function arguments */
  input: z.array(z.unknown()),
  /** Sanitized return value */
  output: z.unknown(),
  /** Error details if the function threw, otherwise null */
  error: ErrorInfoSchema.nullable(),
  /** Arbitrary key-value metadata */
  tags: z.record(z.string(), z.string()),
});
