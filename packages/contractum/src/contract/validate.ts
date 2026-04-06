import type { TraceEvent } from "@ghost-doc/shared-types";
import type {
  JSONSchema,
  ContractDefinition,
  ContractViolation,
  ContractViolationDetail,
  ValidateOptions,
} from "../types.js";
import { ContractViolationError } from "../types.js";

// ---------------------------------------------------------------------------
// Regex (same as infer.ts — kept here to avoid cross-module coupling)
// ---------------------------------------------------------------------------

const FORMAT_REGEX: Record<string, RegExp> = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  "date-time": /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/,
  uri: /^https?:\/\//i,
};

// ---------------------------------------------------------------------------
// Core schema validator (recursive)
// ---------------------------------------------------------------------------

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Validate `value` against `schema`.
 * Returns an array of violation details found at `path`.
 */
function checkSchema(value: unknown, schema: JSONSchema, path: string): ContractViolationDetail[] {
  const violations: ContractViolationDetail[] = [];

  // enum check (takes priority)
  if (schema.enum !== undefined) {
    const found = schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value));
    if (!found) {
      violations.push({
        path,
        expected: `one of ${JSON.stringify(schema.enum)}`,
        received: JSON.stringify(value),
        rule: "enum",
      });
    }
    return violations; // enum is exhaustive — no further checks
  }

  // oneOf check
  if (schema.oneOf !== undefined) {
    const anyPasses = schema.oneOf.some((sub) => checkSchema(value, sub, path).length === 0);
    if (!anyPasses) {
      violations.push({
        path,
        expected: `one of ${schema.oneOf.length} schemas`,
        received: typeOf(value),
        rule: "type",
      });
    }
    return violations;
  }

  // type check
  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!allowed.includes(actual)) {
      violations.push({
        path,
        expected: allowed.join(" | "),
        received: actual,
        rule: "type",
      });
      return violations; // no point checking sub-properties if type is wrong
    }

    // format check (strings only)
    if (actual === "string" && schema.format !== undefined) {
      const re = FORMAT_REGEX[schema.format];
      if (re !== undefined && !re.test(value as string)) {
        violations.push({
          path,
          expected: `string(format: ${schema.format})`,
          received: value as string,
          rule: "format",
        });
      }
    }

    // pattern check (strings only)
    if (actual === "string" && schema.pattern !== undefined) {
      const re = new RegExp(schema.pattern);
      if (!re.test(value as string)) {
        violations.push({
          path,
          expected: `string matching /${schema.pattern}/`,
          received: value as string,
          rule: "pattern",
        });
      }
    }

    // object: check required + recurse into properties
    if (actual === "object" && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;

      if (schema.required !== undefined) {
        for (const key of schema.required) {
          if (!(key in obj)) {
            violations.push({
              path: `${path}.${key}`,
              expected: "present",
              received: "missing",
              rule: "required",
            });
          }
        }
      }

      if (schema.properties !== undefined) {
        for (const [key, subSchema] of Object.entries(schema.properties)) {
          if (key in obj) {
            violations.push(...checkSchema(obj[key], subSchema, `${path}.${key}`));
          }
        }
      }
    }

    // array: recurse into items
    if (actual === "array" && schema.items !== undefined) {
      for (let i = 0; i < (value as unknown[]).length; i++) {
        violations.push(...checkSchema((value as unknown[])[i], schema.items, `${path}[${i}]`));
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a single span against a ContractDefinition.
 * Returns a ContractViolation if any violations are found, otherwise null.
 */
export function validateCall(
  span: TraceEvent,
  contract: ContractDefinition,
  opts: ValidateOptions = {},
): ContractViolation | null {
  const { sampleRate = 1, onViolation, throwOnViolation = false } = opts;

  // Probabilistic sampling guard
  if (sampleRate < 1 && Math.random() > sampleRate) return null;

  const allViolations: ContractViolationDetail[] = [];

  // Validate each positional argument
  for (let i = 0; i < contract.args.length; i++) {
    const schema = contract.args[i]!;
    const value = span.input[i];
    allViolations.push(...checkSchema(value, schema, `args[${i}]`));
  }

  // Validate return value (only when no error)
  if (span.error === null) {
    allViolations.push(...checkSchema(span.output, contract.returns, "return"));
  }

  if (allViolations.length === 0) return null;

  const violation: ContractViolation = {
    functionName: contract.functionName,
    spanId: span.span_id,
    traceId: span.trace_id,
    timestamp: span.timing.started_at,
    violations: allViolations,
  };

  onViolation?.(violation);

  if (throwOnViolation) {
    throw new ContractViolationError(violation);
  }

  return violation;
}

/**
 * Validate an array of spans against a contract.
 * Returns all violations found (one per violating span).
 */
export function validateCalls(
  spans: TraceEvent[],
  contract: ContractDefinition,
  opts: ValidateOptions = {},
): ContractViolation[] {
  const relevant = spans.filter((s) => s.source.function_name === contract.functionName);
  const violations: ContractViolation[] = [];

  for (const span of relevant) {
    const v = validateCall(span, contract, opts);
    if (v !== null) violations.push(v);
  }

  return violations;
}

/**
 * Exposed for testing: directly validate a value against a JSONSchema.
 * Returns violation details found.
 */
export function validateValue(
  value: unknown,
  schema: JSONSchema,
  path = "value",
): ContractViolationDetail[] {
  return checkSchema(value, schema, path);
}
