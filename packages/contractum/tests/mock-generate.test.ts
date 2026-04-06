import { describe, it, expect } from "vitest";
import { generateMocks } from "../src/mock/generate.js";
import { makeSession, makeSessionCall } from "./fixtures.js";

describe("generateMocks — jest", () => {
  it("generates a single mockResolvedValue for one call", () => {
    const session = makeSession("test", [
      makeSessionCall({
        function: "createOrder",
        return: { orderId: "ord_1", status: "pending" },
        sequence: 1,
      }),
    ]);
    const output = generateMocks(session, { target: "jest" });
    expect(output).toContain("mockCreateOrder");
    expect(output).toContain("mockResolvedValue");
    expect(output).toContain("ord_1");
  });

  it("generates mockResolvedValueOnce chain for multiple calls", () => {
    const session = makeSession("test", [
      makeSessionCall({ function: "getStatus", return: { status: "pending" }, sequence: 1 }),
      makeSessionCall({ function: "getStatus", return: { status: "confirmed" }, sequence: 2 }),
    ]);
    const output = generateMocks(session, { target: "jest" });
    expect(output).toContain("mockResolvedValueOnce");
  });

  it("generates mockRejectedValue for errored call", () => {
    const session = makeSession("test", [
      makeSessionCall({
        function: "processPayment",
        return: null,
        error: { type: "PaymentError", message: "Declined" },
        sequence: 1,
      }),
    ]);
    const output = generateMocks(session, { target: "jest" });
    expect(output).toContain("mockRejectedValue");
    expect(output).toContain("PaymentError");
  });

  it("respects oneCallPerFunction = true", () => {
    const session = makeSession("test", [
      makeSessionCall({ function: "fn", return: "first", sequence: 1 }),
      makeSessionCall({ function: "fn", return: "second", sequence: 2 }),
    ]);
    const output = generateMocks(session, { target: "jest", oneCallPerFunction: true });
    expect(output).toContain("first");
    expect(output).not.toContain("mockResolvedValueOnce");
  });

  it("includes timing delay when includeTimings = true", () => {
    const session = makeSession("test", [
      makeSessionCall({ function: "slowFn", return: "ok", durationMs: 200, sequence: 1 }),
    ]);
    const output = generateMocks(session, { target: "jest", includeTimings: true });
    expect(output).toContain("setTimeout");
    expect(output).toContain("200");
  });
});

describe("generateMocks — vitest", () => {
  it("imports vi from vitest", () => {
    const session = makeSession("test", [
      makeSessionCall({ function: "fn", return: "ok", sequence: 1 }),
    ]);
    const output = generateMocks(session, { target: "vitest" });
    expect(output).toContain('from "vitest"');
    expect(output).toContain("vi.fn()");
  });
});

describe("generateMocks — pytest", () => {
  it("generates a def for each function", () => {
    const session = makeSession("test", [
      makeSessionCall({
        function: "createOrder",
        return: { orderId: "ord_1" },
        sequence: 1,
      }),
    ]);
    const output = generateMocks(session, { target: "pytest" });
    expect(output).toContain("def mock_create_order");
    expect(output).toContain("ord_1");
  });

  it("generates a raising def for errored call", () => {
    const session = makeSession("test", [
      makeSessionCall({
        function: "processPayment",
        return: null,
        error: { type: "PaymentError", message: "Declined" },
        sequence: 1,
      }),
    ]);
    const output = generateMocks(session, { target: "pytest" });
    expect(output).toContain("raise Exception");
    expect(output).toContain("PaymentError");
  });

  it("generates a counter-based multi-response def", () => {
    const session = makeSession("test", [
      makeSessionCall({ function: "getStatus", return: { status: "pending" }, sequence: 1 }),
      makeSessionCall({ function: "getStatus", return: { status: "confirmed" }, sequence: 2 }),
    ]);
    const output = generateMocks(session, { target: "pytest" });
    expect(output).toContain("_get_status_calls");
    expect(output).toContain("pending");
    expect(output).toContain("confirmed");
  });

  it("converts camelCase function names to snake_case", () => {
    const session = makeSession("test", [
      makeSessionCall({ function: "processPayment", return: "ok", sequence: 1 }),
    ]);
    const output = generateMocks(session, { target: "pytest" });
    expect(output).toContain("mock_process_payment");
  });
});
