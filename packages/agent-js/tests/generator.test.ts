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

describe("@tracer.trace() — generator functions", () => {
  let emitted: TraceEvent[];
  let tracer: ReturnType<typeof createTracer>;

  beforeEach(() => {
    const result = createTestTracer();
    tracer = result.tracer;
    emitted = result.emitted;
  });

  it("emits a span after a sync generator is fully consumed", () => {
    class NumberStream {
      @tracer.trace()
      *range(from: number, to: number): Generator<number> {
        for (let i = from; i <= to; i++) yield i;
      }
    }

    const stream = new NumberStream();
    const values = [...stream.range(1, 3)];

    expect(values).toEqual([1, 2, 3]);
    expect(emitted).toHaveLength(1);

    const span = emitted[0]!;
    expect(span.source.function_name).toBe("range");
    expect(span.input).toEqual([1, 3]);
    // output = array of all yielded values
    expect(span.output).toEqual([1, 2, 3]);
    expect(span.error).toBeNull();
  });

  it("yields values transparently (pass-through behaviour)", () => {
    class Seq {
      @tracer.trace()
      *doubles(n: number): Generator<number> {
        for (let i = 0; i < n; i++) yield i * 2;
      }
    }

    const values: number[] = [];
    for (const v of new Seq().doubles(4)) values.push(v);
    expect(values).toEqual([0, 2, 4, 6]);
  });

  it("emits an error span when the generator throws", () => {
    class Broken {
      @tracer.trace()
      *fail(): Generator<number> {
        yield 1;
        throw new Error("gen error");
      }
    }

    const gen = new Broken().fail();
    expect(gen.next().value).toBe(1);
    expect(() => gen.next()).toThrow("gen error");

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.error?.message).toBe("gen error");
    expect(emitted[0]!.output).toBeNull();
  });

  it("does NOT emit before the generator is fully consumed", () => {
    class Lazy {
      @tracer.trace()
      *count(): Generator<number> {
        yield 1;
        yield 2;
        yield 3;
      }
    }

    const gen = new Lazy().count();
    gen.next(); // consume first value only
    expect(emitted).toHaveLength(0); // not yet emitted
    gen.next();
    gen.next(); // done
    expect(emitted).toHaveLength(1);
  });

  it("emits a span after an async generator is fully consumed", async () => {
    class AsyncStream {
      @tracer.trace()
      async *asyncRange(n: number): AsyncGenerator<number> {
        for (let i = 0; i < n; i++) yield i;
      }
    }

    const values: number[] = [];
    for await (const v of new AsyncStream().asyncRange(3)) values.push(v);

    expect(values).toEqual([0, 1, 2]);
    expect(emitted).toHaveLength(1);

    const span = emitted[0]!;
    expect(span.source.function_name).toBe("asyncRange");
    expect(span.output).toEqual([0, 1, 2]);
    expect(span.error).toBeNull();
  });

  it("emits an error span when the async generator throws", async () => {
    class AsyncBroken {
      @tracer.trace()
      async *fail(): AsyncGenerator<number> {
        yield 10;
        throw new Error("async gen error");
      }
    }

    const gen = new AsyncBroken().fail();
    await gen.next(); // consume first value
    await expect(gen.next()).rejects.toThrow("async gen error");

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.error?.message).toBe("async gen error");
  });
});
