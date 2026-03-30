import { describe, it, expect } from "vitest";
import { createTracer, TRACE_ID_HEADER } from "../src/index.js";

describe("X-Trace-Id header propagation", () => {
  const tracer = createTracer({ agentId: "svc", enabled: false });

  describe("contextFromHeaders", () => {
    it("returns null when the header is absent", () => {
      expect(tracer.contextFromHeaders({})).toBeNull();
    });

    it("extracts the trace ID from lowercase header", () => {
      const ctx = tracer.contextFromHeaders({ "x-trace-id": "abc-123" });
      expect(ctx).not.toBeNull();
      expect(ctx!.traceId).toBe("abc-123");
      expect(ctx!.spanId).toBeTruthy();
    });

    it("extracts the trace ID from mixed-case header", () => {
      const ctx = tracer.contextFromHeaders({ "X-Trace-Id": "xyz-456" });
      expect(ctx?.traceId).toBe("xyz-456");
    });

    it("returns null for an empty header value", () => {
      expect(tracer.contextFromHeaders({ "x-trace-id": "   " })).toBeNull();
    });

    it("handles array header values (takes first)", () => {
      const ctx = tracer.contextFromHeaders({ "x-trace-id": ["first", "second"] });
      expect(ctx?.traceId).toBe("first");
    });

    it("generates a fresh spanId on each call (not the extracted traceId)", () => {
      const ctx1 = tracer.contextFromHeaders({ "x-trace-id": "shared-trace" });
      const ctx2 = tracer.contextFromHeaders({ "x-trace-id": "shared-trace" });
      expect(ctx1?.traceId).toBe("shared-trace");
      expect(ctx2?.traceId).toBe("shared-trace");
      expect(ctx1?.spanId).not.toBe(ctx2?.spanId);
    });
  });

  describe("injectHeaders", () => {
    it("adds nothing when there is no active context", () => {
      const headers = tracer.injectHeaders({ "Content-Type": "application/json" });
      expect(headers[TRACE_ID_HEADER]).toBeUndefined();
    });

    it("injects the trace ID when called inside runInContext", () => {
      const ctx = { traceId: "injected-trace", spanId: "span-1" };
      let headers: Record<string, string> = {};

      tracer.runInContext(ctx, () => {
        headers = tracer.injectHeaders({});
      });

      expect(headers[TRACE_ID_HEADER]).toBe("injected-trace");
    });

    it("returns the same headers object (mutates in-place)", () => {
      const ctx = { traceId: "t1", spanId: "s1" };
      const original: Record<string, string> = { Authorization: "Bearer token" };

      tracer.runInContext(ctx, () => {
        const returned = tracer.injectHeaders(original);
        expect(returned).toBe(original);
        expect(original[TRACE_ID_HEADER]).toBe("t1");
      });
    });
  });

  describe("TRACE_ID_HEADER constant", () => {
    it("is the expected value", () => {
      expect(TRACE_ID_HEADER).toBe("x-trace-id");
    });
  });
});
