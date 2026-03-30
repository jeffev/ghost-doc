import { describe, it, expect } from "vitest";
import { sanitizeDeep, DEFAULT_SANITIZE_KEYS } from "../src/sanitize.js";

describe("sanitizeDeep", () => {
  describe("with string[] blocklist", () => {
    it("redacts matching top-level keys", () => {
      const input = { username: "alice", password: "secret123" };
      const result = sanitizeDeep(input, ["password"]) as typeof input;
      expect(result.username).toBe("alice");
      expect(result.password).toBe("[REDACTED]");
    });

    it("redacts matching keys case-insensitively", () => {
      const input = { PASSWORD: "abc", Token: "xyz", apikey: "key" };
      const result = sanitizeDeep(input, ["password", "token", "apikey"]) as typeof input;
      expect(result.PASSWORD).toBe("[REDACTED]");
      expect(result.Token).toBe("[REDACTED]");
      expect(result.apikey).toBe("[REDACTED]");
    });

    it("redacts nested keys", () => {
      const input = { user: { name: "bob", token: "abc123" } };
      const result = sanitizeDeep(input, ["token"]) as { user: { name: string; token: string } };
      expect(result.user.name).toBe("bob");
      expect(result.user.token).toBe("[REDACTED]");
    });

    it("redacts keys inside arrays of objects", () => {
      const input = [{ id: 1, secret: "shh" }, { id: 2, secret: "also-shh" }];
      const result = sanitizeDeep(input, ["secret"]) as typeof input;
      expect(result[0]?.id).toBe(1);
      expect(result[0]?.secret).toBe("[REDACTED]");
      expect(result[1]?.secret).toBe("[REDACTED]");
    });

    it("does not mutate the original object", () => {
      const input = { password: "original" };
      sanitizeDeep(input, ["password"]);
      expect(input.password).toBe("original");
    });

    it("passes through non-object primitives unchanged", () => {
      expect(sanitizeDeep(42, ["x"])).toBe(42);
      expect(sanitizeDeep("hello", [])).toBe("hello");
      expect(sanitizeDeep(null, [])).toBe(null);
      expect(sanitizeDeep(true, [])).toBe(true);
    });

    it("handles empty blocklist (nothing redacted)", () => {
      const input = { password: "abc", token: "xyz" };
      const result = sanitizeDeep(input, []) as typeof input;
      expect(result.password).toBe("abc");
      expect(result.token).toBe("xyz");
    });
  });

  describe("circular reference handling", () => {
    it("replaces circular references with '[Circular]'", () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj["self"] = obj;
      const result = sanitizeDeep(obj, []) as Record<string, unknown>;
      expect(result["a"]).toBe(1);
      expect(result["self"]).toBe("[Circular]");
    });
  });

  describe("with SanitizerFn", () => {
    it("calls the function for each key and uses its return value", () => {
      const input = { username: "alice", password: "secret" };
      const sanitizer = (key: string, value: unknown) =>
        key === "password" ? "[REDACTED]" : value;

      const result = sanitizeDeep(input, sanitizer) as typeof input;
      expect(result.username).toBe("alice");
      expect(result.password).toBe("[REDACTED]");
    });
  });

  describe("DEFAULT_SANITIZE_KEYS", () => {
    it("redacts common sensitive field names", () => {
      const input = {
        id: 1,
        password: "p@ssw0rd",
        token: "abc",
        secret: "shh",
        authorization: "Bearer xyz",
        api_key: "key123",
        ssn: "123-45-6789",
      };
      const result = sanitizeDeep(input, [...DEFAULT_SANITIZE_KEYS]) as Record<string, unknown>;
      expect(result["id"]).toBe(1);
      expect(result["password"]).toBe("[REDACTED]");
      expect(result["token"]).toBe("[REDACTED]");
      expect(result["secret"]).toBe("[REDACTED]");
      expect(result["authorization"]).toBe("[REDACTED]");
      expect(result["api_key"]).toBe("[REDACTED]");
      expect(result["ssn"]).toBe("[REDACTED]");
    });
  });
});
