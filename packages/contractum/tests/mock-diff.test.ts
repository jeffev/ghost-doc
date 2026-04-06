import { describe, it, expect } from "vitest";
import { diffSessions, isBreaking } from "../src/mock/diff.js";
import { makeSession, makeSessionCall } from "./fixtures.js";

describe("diffSessions", () => {
  it("detects added functions", () => {
    const before = makeSession("v1", [makeSessionCall({ function: "createOrder", sequence: 1 })]);
    const after = makeSession("v2", [
      makeSessionCall({ function: "createOrder", sequence: 1 }),
      makeSessionCall({ function: "processPayment", sequence: 2 }),
    ]);
    const diff = diffSessions(before, after);
    expect(diff.addedFunctions).toContain("processPayment");
    expect(diff.removedFunctions).toHaveLength(0);
  });

  it("detects removed functions", () => {
    const before = makeSession("v1", [
      makeSessionCall({ function: "createOrder", sequence: 1 }),
      makeSessionCall({ function: "legacyFn", sequence: 2 }),
    ]);
    const after = makeSession("v2", [makeSessionCall({ function: "createOrder", sequence: 1 })]);
    const diff = diffSessions(before, after);
    expect(diff.removedFunctions).toContain("legacyFn");
  });

  it("detects changed return shapes", () => {
    const before = makeSession("v1", [
      makeSessionCall({ function: "getUser", return: { id: "u1", name: "Alice" }, sequence: 1 }),
      makeSessionCall({ function: "getUser", return: { id: "u2", name: "Bob" }, sequence: 2 }),
    ]);
    const after = makeSession("v2", [
      // Return now includes an extra field "email"
      makeSessionCall({
        function: "getUser",
        return: { id: "u3", name: "Carol", email: "c@ex.com" },
        sequence: 1,
      }),
      makeSessionCall({
        function: "getUser",
        return: { id: "u4", name: "Dan", email: "d@ex.com" },
        sequence: 2,
      }),
    ]);
    const diff = diffSessions(before, after);
    const changed = diff.changedReturnShapes.find((c) => c.function === "getUser");
    expect(changed).toBeDefined();
  });

  it("detects changed error rate", () => {
    const before = makeSession("v1", [
      makeSessionCall({ function: "fn", error: null, sequence: 1 }),
      makeSessionCall({ function: "fn", error: null, sequence: 2 }),
    ]);
    const after = makeSession("v2", [
      makeSessionCall({
        function: "fn",
        error: { type: "Error", message: "fail" },
        return: null,
        sequence: 1,
      }),
      makeSessionCall({
        function: "fn",
        error: { type: "Error", message: "fail" },
        return: null,
        sequence: 2,
      }),
    ]);
    const diff = diffSessions(before, after);
    const changed = diff.changedErrorRate.find((c) => c.function === "fn");
    expect(changed).toBeDefined();
    expect(changed!.before).toBe(0);
    expect(changed!.after).toBe(1);
  });

  it("detects latency regression", () => {
    const before = makeSession("v1", [
      makeSessionCall({ function: "fn", durationMs: 50, sequence: 1 }),
      makeSessionCall({ function: "fn", durationMs: 60, sequence: 2 }),
    ]);
    const after = makeSession("v2", [
      makeSessionCall({ function: "fn", durationMs: 200, sequence: 1 }),
      makeSessionCall({ function: "fn", durationMs: 210, sequence: 2 }),
    ]);
    const diff = diffSessions(before, after, 0);
    const regression = diff.latencyRegression.find((r) => r.function === "fn");
    expect(regression).toBeDefined();
    expect(regression!.changePercent).toBeGreaterThan(0);
  });

  it("does not report latency improvement as regression", () => {
    const before = makeSession("v1", [
      makeSessionCall({ function: "fn", durationMs: 200, sequence: 1 }),
    ]);
    const after = makeSession("v2", [
      makeSessionCall({ function: "fn", durationMs: 50, sequence: 1 }),
    ]);
    const diff = diffSessions(before, after, 0);
    expect(diff.latencyRegression).toHaveLength(0);
  });

  it("returns empty diff for identical sessions", () => {
    const calls = [
      makeSessionCall({ function: "fn", return: { ok: true }, durationMs: 50, sequence: 1 }),
    ];
    const diff = diffSessions(makeSession("v1", calls), makeSession("v2", calls));
    expect(diff.addedFunctions).toHaveLength(0);
    expect(diff.removedFunctions).toHaveLength(0);
    expect(diff.changedReturnShapes).toHaveLength(0);
    expect(diff.changedErrorRate).toHaveLength(0);
  });
});

describe("isBreaking", () => {
  it("returns true when functions are removed", () => {
    expect(
      isBreaking({
        removedFunctions: ["legacyFn"],
        addedFunctions: [],
        changedReturnShapes: [],
        changedErrorRate: [],
        latencyRegression: [],
      }),
    ).toBe(true);
  });

  it("returns true when return shapes changed", () => {
    expect(
      isBreaking({
        removedFunctions: [],
        addedFunctions: [],
        changedReturnShapes: [{ function: "fn", before: {}, after: { type: "string" } }],
        changedErrorRate: [],
        latencyRegression: [],
      }),
    ).toBe(true);
  });

  it("returns true when latency exceeds threshold", () => {
    expect(
      isBreaking(
        {
          removedFunctions: [],
          addedFunctions: [],
          changedReturnShapes: [],
          changedErrorRate: [],
          latencyRegression: [
            { function: "fn", beforeP95Ms: 50, afterP95Ms: 200, changePercent: 300 },
          ],
        },
        20,
      ),
    ).toBe(true);
  });

  it("returns false for clean diff", () => {
    expect(
      isBreaking({
        removedFunctions: [],
        addedFunctions: ["newFn"],
        changedReturnShapes: [],
        changedErrorRate: [],
        latencyRegression: [],
      }),
    ).toBe(false);
  });
});
