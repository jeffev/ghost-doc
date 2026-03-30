/** Default set of field names whose values are redacted before sending to the Hub. */
export const DEFAULT_SANITIZE_KEYS: readonly string[] = [
  "password",
  "passwd",
  "token",
  "secret",
  "authorization",
  "api_key",
  "apikey",
  "auth",
  "credential",
  "private_key",
  "ssn",
  "credit_card",
];

/**
 * Custom sanitizer function.
 * Receives the key and value; returns the (possibly redacted) value.
 */
export type SanitizerFn = (key: string, value: unknown) => unknown;

/**
 * - `string[]` — blocklist of key names to redact (case-insensitive)
 * - `SanitizerFn` — custom function called for every key in every object
 */
export type SanitizeConfig = string[] | SanitizerFn;

const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";

/**
 * Deep-clone `value` while sanitizing matching keys.
 * Does not mutate the original value.
 * Handles circular references by replacing them with the string `"[Circular]"`.
 */
export function sanitizeDeep(value: unknown, config: SanitizeConfig): unknown {
  const seen = new WeakSet<object>();
  return walk(value, config, seen);
}

function walk(value: unknown, config: SanitizeConfig, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return CIRCULAR;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => walk(item, config, seen));
    seen.delete(value);
    return result;
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const rawValue = obj[key];
    const sanitizedValue = shouldRedact(key, rawValue, config)
      ? REDACTED
      : walk(rawValue, config, seen);
    result[key] = sanitizedValue;
  }

  seen.delete(value);
  return result;
}

function shouldRedact(key: string, value: unknown, config: SanitizeConfig): boolean {
  if (typeof config === "function") {
    return config(key, value) === REDACTED;
  }
  const lowerKey = key.toLowerCase();
  return config.some((k) => k.toLowerCase() === lowerKey);
}
