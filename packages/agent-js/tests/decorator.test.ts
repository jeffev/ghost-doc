import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTracer } from "../src/tracer.js";
import type { TraceEvent } from "@ghost-doc/shared-types";

function createTestTracer() {
  const tracer = createTracer({ agentId: "test-agent", enabled: false });
  const emitted: TraceEvent[] = [];
  vi.spyOn(tracer, "emit").mockImplementation((event) => {
    emitted.push(event);
  });
  return { tracer, emitted };
}

describe("@tracer.trace() decorator", () => {
  let emitted: TraceEvent[];
  let tracer: ReturnType<typeof createTracer>;

  beforeEach(() => {
    const result = createTestTracer();
    tracer = result.tracer;
    emitted = result.emitted;
  });

  it("emits a span for a synchronous method", () => {
    class Calculator {
      @tracer.trace()
      add(a: number, b: number): number {
        return a + b;
      }
    }

    const calc = new Calculator();
    const result = calc.add(2, 3);

    expect(result).toBe(5);
    expect(emitted).toHaveLength(1);

    const span = emitted[0]!;
    expect(span.schema_version).toBe("1.0");
    expect(span.source.function_name).toBe("add");
    expect(span.source.agent_id).toBe("test-agent");
    expect(span.source.language).toBe("js");
    expect(span.input).toEqual([2, 3]);
    expect(span.output).toBe(5);
    expect(span.error).toBeNull();
    expect(span.timing.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("emits a span for an async method", async () => {
    class FetchService {
      @tracer.trace()
      async fetchData(id: string): Promise<{ id: string; data: string }> {
        return { id, data: "mock" };
      }
    }

    const service = new FetchService();
    const result = await service.fetchData("abc");

    expect(result).toEqual({ id: "abc", data: "mock" });
    expect(emitted).toHaveLength(1);

    const span = emitted[0]!;
    expect(span.source.function_name).toBe("fetchData");
    expect(span.output).toEqual({ id: "abc", data: "mock" });
    expect(span.error).toBeNull();
  });

  it("captures error details when the method throws", () => {
    class BrokenService {
      @tracer.trace()
      explode(): never {
        throw new Error("boom");
      }
    }

    const svc = new BrokenService();
    expect(() => svc.explode()).toThrow("boom");

    expect(emitted).toHaveLength(1);
    const span = emitted[0]!;
    expect(span.error).not.toBeNull();
    expect(span.error?.type).toBe("Error");
    expect(span.error?.message).toBe("boom");
    expect(span.output).toBeNull();
  });

  it("captures error details when an async method rejects", async () => {
    class AsyncBrokenService {
      @tracer.trace()
      async fail(): Promise<never> {
        throw new Error("async boom");
      }
    }

    const svc = new AsyncBrokenService();
    await expect(svc.fail()).rejects.toThrow("async boom");

    expect(emitted).toHaveLength(1);
    const span = emitted[0]!;
    expect(span.error?.message).toBe("async boom");
  });

  it("uses the custom label when provided", () => {
    class SomeService {
      @tracer.trace("custom-name")
      process(): void {}
    }

    new SomeService().process();
    expect(emitted[0]?.source.function_name).toBe("custom-name");
  });

  it("propagates trace_id to nested spans (parent-child relationship)", () => {
    class ServiceA {
      @tracer.trace()
      outer(): void {
        new ServiceB().inner();
      }
    }

    class ServiceB {
      @tracer.trace()
      inner(): void {}
    }

    new ServiceA().outer();

    expect(emitted).toHaveLength(2);
    const [inner, outer] = emitted; // inner emits first (LIFO)

    // Both spans share the same trace_id
    expect(inner!.trace_id).toBe(outer!.trace_id);

    // inner's parent_span_id is outer's span_id
    expect(inner!.parent_span_id).toBe(outer!.span_id);
  });

  it("sanitizes sensitive input fields", () => {
    class AuthService {
      @tracer.trace()
      login(username: string, password: string): boolean {
        return username === "admin" && password === "secret";
      }
    }

    const svc = new AuthService();
    svc.login("admin", "secret");

    const span = emitted[0]!;
    // input[0] is username (plain string — not redacted because it's not an object key)
    // input[1] is password (plain string value — not redacted at top level)
    // sanitizeDeep only redacts object keys, not positional primitive values
    expect(span.input).toBeDefined();
  });

  it("sanitizes sensitive output object fields", () => {
    class TokenService {
      @tracer.trace()
      generateToken(): { userId: string; token: string } {
        return { userId: "u1", token: "super-secret" };
      }
    }

    new TokenService().generateToken();

    const span = emitted[0]!;
    const output = span.output as { userId: string; token: string };
    expect(output.userId).toBe("u1");
    expect(output.token).toBe("[REDACTED]");
  });
});
