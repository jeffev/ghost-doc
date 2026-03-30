import { captureSourceLocation } from "./source-locator.js";
import { newTraceId, newSpanId, buildSpan, captureError } from "./span.js";
import type { TracerInstance, TraceContext } from "./tracer.js";
import type { Source } from "@ghost-doc/shared-types";

/**
 * Returns a TC39-style method decorator factory bound to the given tracer.
 *
 * The returned function is assigned to `tracer.trace` and used as:
 *
 * ```ts
 * class MyService {
 *   @tracer.trace()
 *   syncMethod(x: number): string { ... }
 *
 *   @tracer.trace("custom-label")
 *   async asyncMethod(): Promise<void> { ... }
 * }
 * ```
 *
 * Handles: synchronous functions, async functions (Promise-returning), and errors.
 */
export function createMethodDecorator(tracer: TracerInstance) {
  return function trace(label?: string, description?: string) {
    // Capture definition location at decoration time (class load), not call time.
    // stackOffset 1: skip this trace() function frame.
    const definitionLocation = captureSourceLocation(1);

    return function <This, Args extends unknown[], Return>(
      originalMethod: (this: This, ...args: Args) => Return,
      context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
    ): (this: This, ...args: Args) => Return {
      const fnName = label ?? String(context.name);

      const source: Source = {
        agent_id: tracer._config.agentId,
        language: "js",
        file: definitionLocation.file,
        line: definitionLocation.line,
        function_name: fnName,
        ...(description !== undefined && { description }),
      };

      function replacementMethod(this: This, ...args: Args): Return {
        return executeWithTrace(tracer, source, () => originalMethod.apply(this, args), args);
      }

      return replacementMethod;
    };
  };
}

/**
 * Core execution wrapper shared by the decorator and the function wrapper.
 * Captures timing, input, output, and errors, then emits a TraceEvent.
 */
export function executeWithTrace<TArgs extends unknown[], TReturn>(
  tracer: TracerInstance,
  source: Source,
  fn: () => TReturn,
  args: TArgs,
): TReturn {
  const existingCtx = tracer.currentContext();
  const traceId = existingCtx?.traceId ?? newTraceId();
  const spanId = newSpanId();
  const parentSpanId = existingCtx?.spanId ?? null;

  const startedAt = Date.now();
  const startPerf = performance.now();

  const sanitizedInput = tracer.sanitize(Array.from(args as unknown[])) as unknown[];

  const emit = (output: unknown, error: ReturnType<typeof captureError> | null): void => {
    tracer.emit(
      buildSpan({
        traceId,
        spanId,
        parentSpanId,
        source,
        startedAt,
        durationMs: performance.now() - startPerf,
        input: sanitizedInput,
        output: error ? null : tracer.sanitize(output),
        error,
      }),
    );
  };

  const execute = (): TReturn => {
    let result: TReturn;

    try {
      result = fn();
    } catch (err) {
      emit(null, captureError(err));
      throw err;
    }

    if (isPromiseLike(result)) {
      return (result as Promise<unknown>).then(
        (resolved) => {
          emit(resolved, null);
          return resolved;
        },
        (err: unknown) => {
          emit(null, captureError(err));
          throw err;
        },
      ) as unknown as TReturn;
    }

    // Sync generator — wrap to capture all yielded values before emitting.
    if (isGeneratorObject(result)) {
      return wrapGenerator(result as Generator, emit) as unknown as TReturn;
    }

    // Async generator — wrap to capture all yielded values before emitting.
    if (isAsyncGeneratorObject(result)) {
      return wrapAsyncGenerator(result as AsyncGenerator, emit) as unknown as TReturn;
    }

    emit(result, null);
    return result;
  };

  // Always run inside a fresh context so that any nested traced calls
  // correctly see THIS span as their parent (not the grandparent).
  const newCtx: TraceContext = { traceId, spanId };
  return tracer.runInContext(newCtx, execute);
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "then" in value &&
    typeof (value as Record<string, unknown>)["then"] === "function"
  );
}

function isGeneratorObject(value: unknown): value is Generator {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string | symbol, unknown>;
  return (
    typeof obj["next"] === "function" &&
    typeof obj["return"] === "function" &&
    typeof obj["throw"] === "function" &&
    typeof obj[Symbol.iterator] === "function" &&
    !Array.isArray(value)
  );
}

function isAsyncGeneratorObject(value: unknown): value is AsyncGenerator {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string | symbol, unknown>;
  return (
    typeof obj["next"] === "function" &&
    typeof obj["return"] === "function" &&
    typeof obj["throw"] === "function" &&
    typeof obj[Symbol.asyncIterator] === "function"
  );
}

type EmitFn = (output: unknown, error: ReturnType<typeof captureError> | null) => void;

/**
 * Wraps a sync generator so that all yielded values are collected and a single
 * span is emitted when the generator completes (or errors).
 */
function wrapGenerator(gen: Generator, emit: EmitFn): Generator {
  const yielded: unknown[] = [];
  return (function* (): Generator {
    try {
      let step = gen.next();
      while (!step.done) {
        yielded.push(step.value);
        const sent: unknown = yield step.value;
        step = gen.next(sent as never);
      }
      emit(yielded, null);
      return step.value;
    } catch (err) {
      emit(null, captureError(err));
      throw err;
    }
  })();
}

/**
 * Wraps an async generator so that all yielded values are collected and a single
 * span is emitted when the generator completes (or errors).
 */
function wrapAsyncGenerator(gen: AsyncGenerator, emit: EmitFn): AsyncGenerator {
  const yielded: unknown[] = [];
  return (async function* (): AsyncGenerator {
    try {
      let step = await gen.next();
      while (!step.done) {
        yielded.push(step.value);
        const sent: unknown = yield step.value;
        step = await gen.next(sent as never);
      }
      emit(yielded, null);
      return step.value;
    } catch (err) {
      emit(null, captureError(err));
      throw err;
    }
  })();
}
