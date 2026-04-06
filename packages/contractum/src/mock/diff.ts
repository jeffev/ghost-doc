import type { SessionSnapshot, SessionCall, SessionDiff, JSONSchema } from "../types.js";
import { inferFromSamples } from "../contract/infer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByFunction(calls: SessionCall[]): Map<string, SessionCall[]> {
  const groups = new Map<string, SessionCall[]>();
  for (const call of calls) {
    let arr = groups.get(call.function);
    if (arr === undefined) {
      arr = [];
      groups.set(call.function, arr);
    }
    arr.push(call);
  }
  return groups;
}

/** Compute the p95 of an array of numbers (sorted ascending). */
function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

/** Error rate: fraction of calls that have a non-null error. */
function errorRate(calls: SessionCall[]): number {
  if (calls.length === 0) return 0;
  return calls.filter((c) => c.error !== null).length / calls.length;
}

/** Simple structural equality check for JSON Schemas (via JSON serialisation). */
function schemasEqual(a: JSONSchema, b: JSONSchema): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare two SessionSnapshots and return a structured diff.
 *
 * Detects:
 * - Added / removed functions
 * - Changed return value shapes (inferred JSON Schema)
 * - Changed error rates
 * - Latency regressions (P95)
 *
 * @param before      The baseline session (e.g. last release).
 * @param after       The current session (e.g. current run).
 * @param latencyThresholdPercent  Minimum % change to report as a regression. Default: 0 (report all changes).
 */
export function diffSessions(
  before: SessionSnapshot,
  after: SessionSnapshot,
  latencyThresholdPercent = 0,
): SessionDiff {
  const beforeGroups = groupByFunction(before.calls);
  const afterGroups = groupByFunction(after.calls);

  const beforeFns = new Set(beforeGroups.keys());
  const afterFns = new Set(afterGroups.keys());

  const addedFunctions = [...afterFns].filter((f) => !beforeFns.has(f));
  const removedFunctions = [...beforeFns].filter((f) => !afterFns.has(f));

  // Functions present in both sessions
  const commonFns = [...beforeFns].filter((f) => afterFns.has(f));

  const changedReturnShapes: SessionDiff["changedReturnShapes"] = [];
  const changedErrorRate: SessionDiff["changedErrorRate"] = [];
  const latencyRegression: SessionDiff["latencyRegression"] = [];

  for (const fn of commonFns) {
    const beforeCalls = beforeGroups.get(fn)!;
    const afterCalls = afterGroups.get(fn)!;

    // --- Return shape ---
    const beforeReturns = beforeCalls.filter((c) => c.error === null).map((c) => c.return);
    const afterReturns = afterCalls.filter((c) => c.error === null).map((c) => c.return);

    if (beforeReturns.length > 0 && afterReturns.length > 0) {
      const schemaBefore = inferFromSamples(beforeReturns);
      const schemaAfter = inferFromSamples(afterReturns);
      if (!schemasEqual(schemaBefore, schemaAfter)) {
        changedReturnShapes.push({
          function: fn,
          before: schemaBefore,
          after: schemaAfter,
        });
      }
    }

    // --- Error rate ---
    const errBefore = errorRate(beforeCalls);
    const errAfter = errorRate(afterCalls);
    if (Math.abs(errBefore - errAfter) > 0.001) {
      changedErrorRate.push({
        function: fn,
        before: errBefore,
        after: errAfter,
      });
    }

    // --- Latency P95 ---
    const beforeP95Ms = p95(beforeCalls.map((c) => c.durationMs));
    const afterP95Ms = p95(afterCalls.map((c) => c.durationMs));

    if (beforeP95Ms > 0) {
      const changePercent = ((afterP95Ms - beforeP95Ms) / beforeP95Ms) * 100;
      if (changePercent > latencyThresholdPercent) {
        latencyRegression.push({
          function: fn,
          beforeP95Ms,
          afterP95Ms,
          changePercent: Math.round(changePercent * 10) / 10,
        });
      }
    }
  }

  return {
    addedFunctions,
    removedFunctions,
    changedReturnShapes,
    changedErrorRate,
    latencyRegression,
  };
}

/**
 * Returns true when the diff contains at least one breaking change:
 * a removed function, changed return shape, or significant latency regression.
 */
export function isBreaking(diff: SessionDiff, latencyThresholdPercent = 20): boolean {
  return (
    diff.removedFunctions.length > 0 ||
    diff.changedReturnShapes.length > 0 ||
    diff.latencyRegression.some((r) => r.changePercent >= latencyThresholdPercent)
  );
}
