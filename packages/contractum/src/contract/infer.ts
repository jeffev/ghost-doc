import type { TraceEvent } from "@ghost-doc/shared-types";
import type { JSONSchema, ContractDefinition, InferOptions } from "../types.js";
import { InsufficientSamplesError } from "../types.js";

// ---------------------------------------------------------------------------
// Regex heuristics for string format detection
// ---------------------------------------------------------------------------

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
const RE_URI = /^https?:\/\//i;

const FORMAT_CHECKS: Array<{ format: string; re: RegExp }> = [
  { format: "uuid", re: RE_UUID },
  { format: "email", re: RE_EMAIL },
  { format: "date-time", re: RE_ISO_DATE },
  { format: "uri", re: RE_URI },
];

const FORMAT_MATCH_THRESHOLD = 0.8; // 80% of samples must match to emit format
const REQUIRED_THRESHOLD = 0.9; // 90% presence → required
const ENUM_MAX_DISTINCT = 10;

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

function getType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function groupByType(values: unknown[]): Map<string, unknown[]> {
  const groups = new Map<string, unknown[]>();
  for (const v of values) {
    const t = getType(v);
    let arr = groups.get(t);
    if (arr === undefined) {
      arr = [];
      groups.set(t, arr);
    }
    arr.push(v);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Core inference
// ---------------------------------------------------------------------------

/**
 * Infer a JSON Schema from an array of observed values (all samples of one
 * argument position or one return-value slot).
 */
export function inferFromSamples(values: unknown[], strictTypes = false): JSONSchema {
  if (values.length === 0) return {};

  const groups = groupByType(values);
  const types = [...groups.keys()];

  // Single type path
  if (types.length === 1) {
    const type = types[0]!;
    const typed = groups.get(type)!;
    return inferHomogeneous(type, typed, strictTypes);
  }

  // Multiple types observed
  if (strictTypes) {
    // In strict mode, pick the most common type and ignore outliers
    let dominant = types[0]!;
    let max = 0;
    for (const [t, arr] of groups) {
      if (arr.length > max) {
        max = arr.length;
        dominant = t;
      }
    }
    return inferHomogeneous(dominant, groups.get(dominant)!, strictTypes);
  }

  // Union via oneOf
  const branches: JSONSchema[] = [];
  for (const [t, arr] of groups) {
    branches.push(inferHomogeneous(t, arr, strictTypes));
  }
  if (branches.length === 1) return branches[0]!;
  return { oneOf: branches };
}

function inferHomogeneous(type: string, values: unknown[], strictTypes: boolean): JSONSchema {
  switch (type) {
    case "null":
      return { type: "null" };
    case "boolean":
      return enumOrType("boolean", values);
    case "number":
      return enumOrType("number", values);
    case "string":
      return inferStringSchema(values as string[]);
    case "object":
      return inferObjectSchema(values as Record<string, unknown>[], strictTypes);
    case "array":
      return inferArraySchema(values as unknown[][], strictTypes);
    default:
      return { type: "string" };
  }
}

/**
 * If ≤ ENUM_MAX_DISTINCT distinct primitive values are observed, emit an enum.
 * Otherwise emit a plain type schema.
 */
function enumOrType(typeName: string, values: unknown[]): JSONSchema {
  const distinct = new Set(values.map((v) => JSON.stringify(v)));
  if (distinct.size <= ENUM_MAX_DISTINCT) {
    return { enum: [...distinct].map((s) => JSON.parse(s) as unknown) };
  }
  return { type: typeName };
}

function inferStringSchema(values: string[]): JSONSchema {
  // Format detection takes priority over enum — a field of UUIDs is more
  // useful as { type: "string", format: "uuid" } than an enum of those UUIDs.
  for (const { format, re } of FORMAT_CHECKS) {
    const matchCount = values.filter((v) => re.test(v)).length;
    if (matchCount / values.length >= FORMAT_MATCH_THRESHOLD) {
      return { type: "string", format };
    }
  }

  // Enum check: small set of distinct non-formatted strings
  const distinct = new Set(values);
  if (distinct.size <= ENUM_MAX_DISTINCT) {
    return { enum: [...distinct] };
  }

  return { type: "string" };
}

function inferObjectSchema(objects: Record<string, unknown>[], strictTypes: boolean): JSONSchema {
  // Collect all keys and values across all samples
  const keyValues = new Map<string, unknown[]>();
  const keyPresence = new Map<string, number>();

  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      let arr = keyValues.get(key);
      if (arr === undefined) {
        arr = [];
        keyValues.set(key, arr);
      }
      arr.push((obj as Record<string, unknown>)[key]);
      keyPresence.set(key, (keyPresence.get(key) ?? 0) + 1);
    }
  }

  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];

  for (const [key, vals] of keyValues) {
    properties[key] = inferFromSamples(vals, strictTypes);
    const presence = (keyPresence.get(key) ?? 0) / objects.length;
    if (presence >= REQUIRED_THRESHOLD) {
      required.push(key);
    }
  }

  const schema: JSONSchema = { type: "object", properties };
  if (required.length > 0) schema.required = required.sort();
  return schema;
}

function inferArraySchema(arrays: unknown[][], strictTypes: boolean): JSONSchema {
  // Flatten all elements from all array samples to infer item schema
  const allElements = arrays.flat();
  const schema: JSONSchema = { type: "array" };
  if (allElements.length > 0) {
    schema.items = inferFromSamples(allElements, strictTypes);
  }
  return schema;
}

// ---------------------------------------------------------------------------
// Error shape inference
// ---------------------------------------------------------------------------

function inferErrorSchemas(spans: TraceEvent[]): JSONSchema[] | undefined {
  const errored = spans.filter((s) => s.error !== null);
  if (errored.length === 0) return undefined;

  // Group by error type
  const byType = new Map<string, string[]>();
  for (const s of errored) {
    if (s.error === null) continue;
    let msgs = byType.get(s.error.type);
    if (msgs === undefined) {
      msgs = [];
      byType.set(s.error.type, msgs);
    }
    msgs.push(s.error.message);
  }

  return [...byType.entries()].map(([type, _messages]) => ({
    type: "object",
    properties: {
      type: { enum: [type] },
      message: { type: "string" },
    },
    required: ["type", "message"],
  }));
}

// ---------------------------------------------------------------------------
// Public: inferContract
// ---------------------------------------------------------------------------

/**
 * Infers a ContractDefinition from an array of recorded TraceEvents.
 *
 * @param spans  All trace events to analyse (Hub store output).
 * @param opts   Inference options.
 * @throws InsufficientSamplesError if fewer than minSamples calls were found.
 */
export function inferContract(spans: TraceEvent[], opts: InferOptions = {}): ContractDefinition {
  const { functionName, minSamples = 5, strictTypes = false } = opts;

  // Filter to the target function
  const relevant = functionName
    ? spans.filter((s) => s.source.function_name === functionName)
    : spans;

  const targetName = functionName ?? relevant[0]?.source.function_name ?? "unknown";

  if (relevant.length < minSamples) {
    throw new InsufficientSamplesError(targetName, relevant.length, minSamples);
  }

  // Determine max argument count across all samples
  const maxArgs = Math.max(...relevant.map((s) => s.input.length), 0);

  // Infer schema per positional argument
  const argSchemas: JSONSchema[] = [];
  for (let i = 0; i < maxArgs; i++) {
    const argValues = relevant.filter((s) => i < s.input.length).map((s) => s.input[i]);
    argSchemas.push(inferFromSamples(argValues, strictTypes));
  }

  // Infer return value schema
  const outputs = relevant.filter((s) => s.error === null).map((s) => s.output);
  const returnSchema = outputs.length > 0 ? inferFromSamples(outputs, strictTypes) : {};

  // Infer error shapes
  const errors = inferErrorSchemas(relevant);

  const contract: ContractDefinition = {
    version: "1.0",
    functionName: targetName,
    generatedAt: new Date().toISOString(),
    sampleCount: relevant.length,
    args: argSchemas,
    returns: returnSchema,
  };
  if (errors !== undefined) contract.errors = errors;

  return contract;
}

/**
 * Infer contracts for every distinct function_name in `spans`.
 * Functions with fewer than minSamples are silently skipped.
 */
export function inferAllContracts(
  spans: TraceEvent[],
  opts: Omit<InferOptions, "functionName"> = {},
): ContractDefinition[] {
  const functionNames = [...new Set(spans.map((s) => s.source.function_name))];
  const results: ContractDefinition[] = [];

  for (const name of functionNames) {
    try {
      results.push(inferContract(spans, { ...opts, functionName: name }));
    } catch (err) {
      if (err instanceof InsufficientSamplesError) continue;
      throw err;
    }
  }

  return results;
}
