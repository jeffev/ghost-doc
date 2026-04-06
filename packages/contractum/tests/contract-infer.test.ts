import { describe, it, expect } from "vitest";
import { inferContract, inferAllContracts, inferFromSamples } from "../src/contract/infer.js";
import { InsufficientSamplesError } from "../src/types.js";
import { makeTrace, makeTraces } from "./fixtures.js";

describe("inferFromSamples", () => {
  it("returns {} for empty array", () => {
    expect(inferFromSamples([])).toEqual({});
  });

  it("infers string type", () => {
    expect(
      inferFromSamples([
        "hello",
        "world",
        "foo",
        "bar",
        "baz",
        "qux",
        "quux",
        "corge",
        "grault",
        "garply",
        "waldo",
      ]),
    ).toEqual({ type: "string" });
  });

  it("infers string enum when ≤ 10 distinct values", () => {
    const schema = inferFromSamples(["pending", "confirmed", "shipped"]);
    expect(schema.enum).toEqual(expect.arrayContaining(["pending", "confirmed", "shipped"]));
  });

  it("infers number type", () => {
    const values = Array.from({ length: 20 }, (_, i) => i * 3.14);
    const schema = inferFromSamples(values);
    expect(schema.type).toBe("number");
  });

  it("infers number enum for small distinct set", () => {
    const schema = inferFromSamples([1, 2, 3]);
    expect(schema.enum).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it("infers boolean enum", () => {
    const schema = inferFromSamples([true, false, true, false]);
    expect(schema.enum).toBeDefined();
  });

  it("infers null type", () => {
    expect(inferFromSamples([null, null])).toEqual({ type: "null" });
  });

  it("infers uuid format", () => {
    const uuids = Array.from({ length: 10 }, () => "550e8400-e29b-41d4-a716-446655440000");
    const schema = inferFromSamples(uuids);
    expect(schema).toEqual({ type: "string", format: "uuid" });
  });

  it("infers email format", () => {
    const emails = Array.from({ length: 10 }, (_, i) => `user${i}@example.com`);
    const schema = inferFromSamples(emails);
    expect(schema).toEqual({ type: "string", format: "email" });
  });

  it("infers date-time format", () => {
    const dates = Array.from({ length: 10 }, () => "2026-04-05T10:00:00Z");
    const schema = inferFromSamples(dates);
    expect(schema).toEqual({ type: "string", format: "date-time" });
  });

  it("infers uri format", () => {
    const uris = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`);
    const schema = inferFromSamples(uris);
    expect(schema).toEqual({ type: "string", format: "uri" });
  });

  it("infers object schema with required fields", () => {
    const objects = Array.from({ length: 15 }, (_, i) => ({
      userId: `u_${i}`,
      amount: i * 10,
    }));
    const schema = inferFromSamples(objects);
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeDefined();
    expect(schema.required).toContain("userId");
    expect(schema.required).toContain("amount");
  });

  it("marks optional field (present in < 90% of samples)", () => {
    const objects = Array.from({ length: 10 }, (_, i) => ({
      userId: `u_${i}`,
      ...(i < 5 ? { optionalField: "x" } : {}),
    }));
    const schema = inferFromSamples(objects);
    expect(schema.required).not.toContain("optionalField");
  });

  it("infers array schema", () => {
    const arrays = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const schema = inferFromSamples(arrays);
    expect(schema.type).toBe("array");
    expect(schema.items).toBeDefined();
  });

  it("infers oneOf for mixed types", () => {
    const schema = inferFromSamples([
      "text",
      42,
      "more",
      100,
      "words",
      7,
      "data",
      99,
      "info",
      33,
      "stuff",
      0,
    ]);
    expect(schema.oneOf).toBeDefined();
    expect(schema.oneOf!.length).toBe(2);
  });

  it("nested object inference", () => {
    const objects = Array.from({ length: 10 }, (_, i) => ({
      user: { id: `u_${i}`, name: `User ${i}` },
    }));
    const schema = inferFromSamples(objects);
    expect(schema.type).toBe("object");
    expect(schema.properties?.user?.type).toBe("object");
    expect(schema.properties?.user?.properties?.id).toBeDefined();
  });
});

describe("inferContract", () => {
  it("throws InsufficientSamplesError when not enough samples", () => {
    const spans = makeTraces("createOrder", 3);
    expect(() => inferContract(spans, { functionName: "createOrder", minSamples: 5 })).toThrow(
      InsufficientSamplesError,
    );
  });

  it("infers a contract from spans", () => {
    const spans = makeTraces("createOrder", 10);
    const contract = inferContract(spans, { functionName: "createOrder", minSamples: 5 });

    expect(contract.version).toBe("1.0");
    expect(contract.functionName).toBe("createOrder");
    expect(contract.sampleCount).toBe(10);
    expect(contract.args).toHaveLength(1);
    expect(contract.returns).toBeDefined();
  });

  it("infers error schemas for errored spans", () => {
    const spans = [
      ...makeTraces("processPayment", 8),
      makeTrace({
        source: {
          agent_id: "a",
          language: "js",
          file: "f.ts",
          line: 1,
          function_name: "processPayment",
        },
        error: { type: "PaymentError", message: "Card declined", stack: "" },
        output: null,
      }),
      makeTrace({
        source: {
          agent_id: "a",
          language: "js",
          file: "f.ts",
          line: 1,
          function_name: "processPayment",
        },
        error: { type: "PaymentError", message: "Insufficient funds", stack: "" },
        output: null,
      }),
    ];
    const contract = inferContract(spans, { functionName: "processPayment", minSamples: 5 });
    expect(contract.errors).toBeDefined();
    expect(
      contract.errors!.some((e) => e.properties?.["type"]?.enum?.includes("PaymentError")),
    ).toBe(true);
  });

  it("infers arg schema from all input samples", () => {
    const spans = makeTraces("createOrder", 10);
    const contract = inferContract(spans, { functionName: "createOrder", minSamples: 5 });
    const argSchema = contract.args[0];
    expect(argSchema?.type).toBe("object");
    expect(argSchema?.properties?.userId).toBeDefined();
    expect(argSchema?.properties?.amount).toBeDefined();
  });

  it("includes generatedAt ISO timestamp", () => {
    const spans = makeTraces("fn", 5);
    const contract = inferContract(spans, { functionName: "fn", minSamples: 1 });
    expect(() => new Date(contract.generatedAt)).not.toThrow();
    expect(new Date(contract.generatedAt).getTime()).toBeGreaterThan(0);
  });
});

describe("inferAllContracts", () => {
  it("infers contracts for all functions with enough samples", () => {
    const spans = [
      ...makeTraces("fnA", 5),
      ...makeTraces("fnB", 5),
      ...makeTraces("fnC", 2), // too few — should be skipped
    ];
    const contracts = inferAllContracts(spans, { minSamples: 5 });
    const names = contracts.map((c) => c.functionName);
    expect(names).toContain("fnA");
    expect(names).toContain("fnB");
    expect(names).not.toContain("fnC");
  });
});
