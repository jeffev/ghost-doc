/**
 * Hub-level sanitization — a second defensive pass applied to every incoming
 * span before it touches the store or is forwarded to Dashboard clients.
 *
 * Uses the same blocklist approach as the JS agent so that sensitive fields
 * that slipped through (e.g. from non-JS agents with weaker client-side
 * sanitization) are still redacted.
 */

const REDACTED = "[REDACTED]";

/** Default set of field names redacted at Hub boundary (lowercase, exact match). */
export const HUB_DEFAULT_SANITIZE_KEYS: readonly string[] = [
  "password",
  "passwd",
  "token",
  "secret",
  "authorization",
  "auth",
  "api_key",
  "apikey",
  "credential",
  "private_key",
  "access_token",
  "refresh_token",
  "ssn",
  "credit_card",
  "card_number",
];

/**
 * Deep-walks `value`, replacing the value of any key whose lowercase form
 * appears in `keys` with `"[REDACTED]"`.
 *
 * Returns a new value; the original is never mutated.
 * Handles circular references by substituting `"[Circular]"`.
 */
export function sanitizeDeep(value: unknown, keys: ReadonlySet<string>): unknown {
  return walk(value, keys, new WeakSet());
}

function walk(value: unknown, keys: ReadonlySet<string>, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => walk(item, keys, seen));
    seen.delete(value);
    return result;
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const k of Object.keys(obj)) {
    result[k] = keys.has(k.toLowerCase()) ? REDACTED : walk(obj[k], keys, seen);
  }

  seen.delete(value);
  return result;
}

/**
 * Builds a unified key set from the Hub defaults and any extra keys supplied
 * by the operator config.
 */
export function buildKeySet(extraKeys: readonly string[]): ReadonlySet<string> {
  return new Set([...HUB_DEFAULT_SANITIZE_KEYS, ...extraKeys.map((k) => k.toLowerCase())]);
}

/**
 * Returns a copy of `span` with `input` and `output` deep-sanitized.
 */
export function sanitizeSpan<T extends { input: unknown[]; output?: unknown }>(
  span: T,
  keys: ReadonlySet<string>,
): T {
  return {
    ...span,
    input: span.input.map((v) => sanitizeDeep(v, keys)) as unknown[],
    output: sanitizeDeep(span.output, keys),
  };
}
