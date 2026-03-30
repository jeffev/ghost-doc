import { captureSourceLocation } from "./source-locator.js";
import { executeWithTrace } from "./decorator.js";
import type { TracerInstance } from "./tracer.js";
import type { Source } from "@ghost-doc/shared-types";

/**
 * Returns a `wrap` function bound to the given tracer.
 * Assigned to `tracer.wrap`.
 *
 * Wraps any plain function (arrow functions, imported functions, etc.) for tracing.
 *
 * ```ts
 * const fetchUser = tracer.wrap(
 *   async (id: string) => db.users.findById(id),
 *   "fetchUser",
 * );
 * ```
 */
export function createWrap(tracer: TracerInstance) {
  return function wrap<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn,
    label?: string,
    description?: string,
  ): (...args: TArgs) => TReturn {
    const fnName = label ?? (fn.name || "anonymous");
    // stackOffset 1: skip this wrap() frame to get the caller's location.
    const wrapLocation = captureSourceLocation(1);

    const source: Source = {
      agent_id: tracer._config.agentId,
      language: "js",
      file: wrapLocation.file,
      line: wrapLocation.line,
      function_name: fnName,
      ...(description !== undefined && { description }),
    };

    return function wrapped(...args: TArgs): TReturn {
      return executeWithTrace(tracer, source, () => fn(...args), args);
    };
  };
}
