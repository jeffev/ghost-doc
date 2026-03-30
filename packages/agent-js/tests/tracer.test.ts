import { describe, it, expect, vi } from "vitest";
import { createTracer } from "../src/tracer.js";
import type { TraceEvent } from "@ghost-doc/shared-types";

describe("createTracer", () => {
  it("returns a TracerInstance with expected shape", () => {
    const tracer = createTracer({ agentId: "my-app", enabled: false });
    expect(typeof tracer.emit).toBe("function");
    expect(typeof tracer.trace).toBe("function");
    expect(typeof tracer.wrap).toBe("function");
    expect(typeof tracer.disconnect).toBe("function");
    expect(typeof tracer.sanitize).toBe("function");
    tracer.disconnect();
  });

  it("applies default configuration values", () => {
    const tracer = createTracer({ agentId: "defaults-test", enabled: false });
    expect(tracer._config.hubUrl).toBe("ws://localhost:3001/agent");
    expect(tracer._config.bufferSize).toBe(500);
    expect(tracer._config.enabled).toBe(false);
    tracer.disconnect();
  });

  it("does not call transport.send when enabled: false", () => {
    const tracer = createTracer({ agentId: "disabled", enabled: false });
    const sendSpy = vi.spyOn(tracer._transport, "send");

    const event: TraceEvent = {
      schema_version: "1.0",
      trace_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      span_id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      parent_span_id: null,
      source: {
        agent_id: "disabled",
        language: "js",
        file: "test.ts",
        line: 1,
        function_name: "test",
      },
      timing: { started_at: Date.now(), duration_ms: 0 },
      input: [],
      output: null,
      error: null,
      tags: {},
    };

    tracer.emit(event);
    expect(sendSpy).not.toHaveBeenCalled();
    tracer.disconnect();
  });

  it("currentContext returns undefined outside a trace", () => {
    const tracer = createTracer({ agentId: "ctx-test", enabled: false });
    expect(tracer.currentContext()).toBeUndefined();
    tracer.disconnect();
  });

  it("currentContext returns context inside runInContext", () => {
    const tracer = createTracer({ agentId: "ctx-test2", enabled: false });
    const ctx = { traceId: "trace-1", spanId: "span-1" };

    tracer.runInContext(ctx, () => {
      expect(tracer.currentContext()).toEqual(ctx);
    });

    // After runInContext, context is cleared
    expect(tracer.currentContext()).toBeUndefined();
    tracer.disconnect();
  });

  it("sanitize uses configured key list", () => {
    const tracer = createTracer({
      agentId: "sanitize-test",
      enabled: false,
      sanitize: ["secret_key"],
    });

    const result = tracer.sanitize({ secret_key: "abc", safe: "ok" }) as Record<string, unknown>;
    expect(result["secret_key"]).toBe("[REDACTED]");
    expect(result["safe"]).toBe("ok");
    tracer.disconnect();
  });
});
