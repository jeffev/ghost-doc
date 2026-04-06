import { describe, it, expect, vi } from "vitest";
import { validateCall, validateCalls, validateValue } from "../src/contract/validate.js";
import { inferContract } from "../src/contract/infer.js";
import { ContractViolationError } from "../src/types.js";
import type { ContractDefinition } from "../src/types.js";
import { makeTrace, makeTraces } from "./fixtures.js";

// ---------------------------------------------------------------------------
// validateValue (unit-level)
// ---------------------------------------------------------------------------

describe("validateValue", () => {
  it("passes when value matches type", () => {
    expect(validateValue("hello", { type: "string" })).toHaveLength(0);
    expect(validateValue(42, { type: "number" })).toHaveLength(0);
    expect(validateValue(true, { type: "boolean" })).toHaveLength(0);
    expect(validateValue(null, { type: "null" })).toHaveLength(0);
  });

  it("reports type violation", () => {
    const v = validateValue(42, { type: "string" }, "arg");
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("type");
    expect(v[0]!.path).toBe("arg");
  });

  it("passes enum check", () => {
    expect(validateValue("pending", { enum: ["pending", "confirmed"] })).toHaveLength(0);
  });

  it("reports enum violation", () => {
    const v = validateValue("unknown", { enum: ["pending", "confirmed"] }, "status");
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("enum");
  });

  it("passes uuid format", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(validateValue(uuid, { type: "string", format: "uuid" })).toHaveLength(0);
  });

  it("reports uuid format violation", () => {
    const v = validateValue("not-a-uuid", { type: "string", format: "uuid" }, "id");
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("format");
  });

  it("passes email format", () => {
    expect(validateValue("user@example.com", { type: "string", format: "email" })).toHaveLength(0);
  });

  it("reports required field violation", () => {
    const schema = {
      type: "object" as const,
      required: ["userId"],
      properties: { userId: { type: "string" as const } },
    };
    const v = validateValue({ name: "Jeff" }, schema, "arg[0]");
    expect(v.some((x) => x.rule === "required" && x.path === "arg[0].userId")).toBe(true);
  });

  it("passes required field check", () => {
    const schema = {
      type: "object" as const,
      required: ["userId"],
      properties: { userId: { type: "string" as const } },
    };
    expect(validateValue({ userId: "u_1" }, schema)).toHaveLength(0);
  });

  it("recurses into nested object properties", () => {
    const schema = {
      type: "object" as const,
      properties: {
        user: {
          type: "object" as const,
          properties: {
            age: { type: "number" as const },
          },
        },
      },
    };
    const v = validateValue({ user: { age: "not-a-number" } }, schema, "arg");
    expect(v.some((x) => x.path === "arg.user.age")).toBe(true);
  });

  it("recurses into array items", () => {
    const schema = {
      type: "array" as const,
      items: { type: "string" as const },
    };
    const v = validateValue(["ok", 42, "also-ok"], schema, "list");
    expect(v.some((x) => x.path === "list[1]" && x.rule === "type")).toBe(true);
  });

  it("passes oneOf when first branch matches", () => {
    const schema = {
      oneOf: [{ type: "string" as const }, { type: "number" as const }],
    };
    expect(validateValue("hello", schema)).toHaveLength(0);
    expect(validateValue(42, schema)).toHaveLength(0);
  });

  it("reports oneOf violation when no branch matches", () => {
    const schema = {
      oneOf: [{ type: "string" as const }, { type: "number" as const }],
    };
    const v = validateValue(true, schema, "val");
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("type");
  });
});

// ---------------------------------------------------------------------------
// validateCall
// ---------------------------------------------------------------------------

describe("validateCall", () => {
  function buildContract(): ContractDefinition {
    const spans = makeTraces("createOrder", 10);
    return inferContract(spans, { functionName: "createOrder", minSamples: 5 });
  }

  it("returns null when call matches contract", () => {
    const contract = buildContract();
    const span = makeTrace({
      source: {
        agent_id: "a",
        language: "js",
        file: "f.ts",
        line: 1,
        function_name: "createOrder",
      },
      input: [{ userId: "u_5", amount: 50 }],
      output: { orderId: "ord_5", status: "pending" },
    });
    const result = validateCall(span, contract);
    expect(result).toBeNull();
  });

  it("returns violation when arg type is wrong", () => {
    const contract: ContractDefinition = {
      version: "1.0",
      functionName: "createOrder",
      generatedAt: new Date().toISOString(),
      sampleCount: 10,
      args: [
        {
          type: "object",
          properties: { userId: { type: "string" }, amount: { type: "number" } },
          required: ["userId", "amount"],
        },
      ],
      returns: { type: "object" },
    };
    const span = makeTrace({
      input: [{ userId: 42, amount: 99 }], // userId should be string
    });
    const result = validateCall(span, contract);
    expect(result).not.toBeNull();
    expect(result!.violations.some((v) => v.path.includes("userId"))).toBe(true);
  });

  it("calls onViolation callback", () => {
    const contract: ContractDefinition = {
      version: "1.0",
      functionName: "createOrder",
      generatedAt: new Date().toISOString(),
      sampleCount: 10,
      args: [{ type: "string" }],
      returns: {},
    };
    const span = makeTrace({ input: [42] }); // number instead of string
    const onViolation = vi.fn();
    validateCall(span, contract, { onViolation });
    expect(onViolation).toHaveBeenCalledOnce();
  });

  it("throws ContractViolationError when throwOnViolation = true", () => {
    const contract: ContractDefinition = {
      version: "1.0",
      functionName: "createOrder",
      generatedAt: new Date().toISOString(),
      sampleCount: 10,
      args: [{ type: "string" }],
      returns: {},
    };
    const span = makeTrace({ input: [42] });
    expect(() => validateCall(span, contract, { throwOnViolation: true })).toThrow(
      ContractViolationError,
    );
  });

  it("skips return validation when span has error", () => {
    const contract: ContractDefinition = {
      version: "1.0",
      functionName: "fn",
      generatedAt: new Date().toISOString(),
      sampleCount: 5,
      args: [],
      returns: { type: "string" },
    };
    const span = makeTrace({
      error: { type: "Error", message: "boom", stack: "" },
      output: null, // not a string, but should be ignored
    });
    const result = validateCall(span, contract);
    expect(result).toBeNull();
  });

  it("respects sampleRate = 0 by skipping all", () => {
    const contract: ContractDefinition = {
      version: "1.0",
      functionName: "fn",
      generatedAt: new Date().toISOString(),
      sampleCount: 5,
      args: [{ type: "string" }],
      returns: {},
    };
    const span = makeTrace({ input: [42] }); // violation, but sampled out
    // With sampleRate = 0, random() > 0 always → always skipped
    const results = Array.from({ length: 20 }, () =>
      validateCall(span, contract, { sampleRate: 0 }),
    );
    expect(results.every((r) => r === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateCalls
// ---------------------------------------------------------------------------

describe("validateCalls", () => {
  it("only validates spans matching the contract's functionName", () => {
    const contract: ContractDefinition = {
      version: "1.0",
      functionName: "createOrder",
      generatedAt: new Date().toISOString(),
      sampleCount: 5,
      args: [{ type: "string" }],
      returns: {},
    };

    const spans = [
      makeTrace({
        source: {
          agent_id: "a",
          language: "js",
          file: "f.ts",
          line: 1,
          function_name: "createOrder",
        },
        input: [42],
      }), // violation
      makeTrace({
        source: {
          agent_id: "a",
          language: "js",
          file: "f.ts",
          line: 1,
          function_name: "processPayment",
        },
        input: [42],
      }), // different fn — ignored
    ];

    const violations = validateCalls(spans, contract);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.functionName).toBe("createOrder");
  });
});
