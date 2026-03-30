import { describe, it, expect, beforeEach } from "vitest";
import { TraceStore } from "../src/store.js";
import { makeStored } from "./fixtures.js";

describe("TraceStore", () => {
  let store: TraceStore;

  beforeEach(() => {
    store = new TraceStore(10);
  });

  it("starts empty", () => {
    expect(store.totalCount).toBe(0);
    expect(store.agentCount).toBe(0);
  });

  it("add() increments totalCount", () => {
    store.add(makeStored());
    store.add(makeStored());
    expect(store.totalCount).toBe(2);
  });

  it("getBySpanId returns the correct span", () => {
    const span = makeStored();
    store.add(span);
    expect(store.getBySpanId(span.span_id)).toEqual(span);
  });

  it("getBySpanId returns undefined for unknown id", () => {
    expect(store.getBySpanId("no-such-id")).toBeUndefined();
  });

  it("getByTraceId returns all spans with that trace_id", () => {
    const traceId = "aaaaaaaa-0000-4000-8000-000000000001";
    const s1 = makeStored({ trace_id: traceId, span_id: "bbbbbbbb-0000-4000-8000-000000000001" });
    const s2 = makeStored({ trace_id: traceId, span_id: "bbbbbbbb-0000-4000-8000-000000000002" });
    const other = makeStored();
    store.add(s1);
    store.add(s2);
    store.add(other);

    const result = store.getByTraceId(traceId);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.span_id)).toContain(s1.span_id);
    expect(result.map((s) => s.span_id)).toContain(s2.span_id);
  });

  it("getByAgentId filters by agent", () => {
    store.add(makeStored({ source: { agent_id: "frontend", language: "js", file: "f.ts", line: 1, function_name: "fn" } }));
    store.add(makeStored({ source: { agent_id: "backend", language: "python", file: "b.py", line: 2, function_name: "fn2" } }));

    expect(store.getByAgentId("frontend")).toHaveLength(1);
    expect(store.getByAgentId("backend")).toHaveLength(1);
  });

  it("getRecent returns spans in reverse insertion order", () => {
    const spans = Array.from({ length: 5 }, (_, i) =>
      makeStored({ span_id: `bbbbbbbb-0000-4000-8000-00000000000${i + 1}` }),
    );
    for (const s of spans) store.add(s);

    const recent = store.getRecent(5);
    expect(recent[0]?.span_id).toBe(spans[4]?.span_id);
    expect(recent[4]?.span_id).toBe(spans[0]?.span_id);
  });

  it("getRecent respects the limit parameter", () => {
    for (let i = 0; i < 8; i++) store.add(makeStored());
    expect(store.getRecent(3)).toHaveLength(3);
  });

  it("evicts oldest span when capacity is exceeded", () => {
    const first = makeStored({ span_id: "cccccccc-0000-4000-8000-000000000001" });
    store.add(first);
    // Fill to capacity and overflow by one.
    for (let i = 0; i < 10; i++) store.add(makeStored());

    // The first span should have been evicted.
    expect(store.getBySpanId(first.span_id)).toBeUndefined();
    expect(store.totalCount).toBe(11);
  });

  it("markAnomaly sets anomaly flag on stored span", () => {
    const span = makeStored();
    store.add(span);
    store.markAnomaly(span.span_id);
    expect(store.getBySpanId(span.span_id)?.anomaly).toBe(true);
  });

  it("clear() resets all state", () => {
    store.add(makeStored());
    store.clear();
    expect(store.totalCount).toBe(0);
    expect(store.agentCount).toBe(0);
    expect(store.getRecent()).toHaveLength(0);
  });
});
