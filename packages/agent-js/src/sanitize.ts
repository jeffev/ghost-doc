/** Default set of field names whose values are redacted before sending to the Hub. */
export const DEFAULT_SANITIZE_KEYS: readonly string[] = [
  "password",
  "passwd",
  "token",
  "secret",
  "authorization",
  "api_key",
  "apikey",
  "apitoken",
  "api_token",
  "auth",
  "auth_token",
  "access_token",
  "refresh_token",
  "id_token",
  "bearer",
  "jwt",
  "credential",
  "credentials",
  "private_key",
  "privatekey",
  "client_secret",
  "client_id",
  "session",
  "session_id",
  "sessionid",
  "cookie",
  "set_cookie",
  "x_api_key",
  "ssn",
  "social_security",
  "credit_card",
  "card_number",
  "cvv",
  "pin",
  "bank_account",
  "routing_number",
];

/** Regex patterns applied to string *values* (not keys) to detect secrets. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  // JWT: three base64url segments separated by dots
  /^[A-Za-z0-9_-]{2,}(?:\.[A-Za-z0-9_-]{2,}){2}$/,
  // Bare credit-card: 13–19 consecutive digits (with optional spaces/dashes)
  /^\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}$/,
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
  if (config.some((k) => k.toLowerCase() === lowerKey)) return true;
  // Also redact string values that look like secrets (JWT, credit card numbers).
  if (typeof value === "string" && SECRET_VALUE_PATTERNS.some((re) => re.test(value.trim()))) {
    return true;
  }
  return false;
}
