/**
 * Minimal JSON Schema draft-07 subset used by Contractum.
 * Only the constructs the inference engine can emit are represented.
 */
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  format?: string;
  pattern?: string;
  oneOf?: JSONSchema[];
  description?: string;
}

// ---------------------------------------------------------------------------
// Contractum — Phase A
// ---------------------------------------------------------------------------

export interface ContractDefinition {
  version: "1.0";
  functionName: string;
  generatedAt: string;
  sampleCount: number;
  /** One schema per positional argument (index-aligned). */
  args: JSONSchema[];
  returns: JSONSchema;
  /** Observed error shapes (type + message structure). */
  errors?: JSONSchema[];
}

export interface ContractViolationDetail {
  /** JSONPath-like pointer to the violating field, e.g. "args[0].userId" */
  path: string;
  expected: string;
  received: string;
  rule: "type" | "required" | "enum" | "pattern" | "format";
}

export interface ContractViolation {
  functionName: string;
  spanId: string;
  traceId: string;
  timestamp: number;
  violations: ContractViolationDetail[];
}

// ---------------------------------------------------------------------------
// InferOptions / ValidateOptions
// ---------------------------------------------------------------------------

export interface InferOptions {
  /** Only infer a contract for this function name. */
  functionName?: string;
  /** Minimum number of samples required before emitting a contract. Default: 5 */
  minSamples?: number;
  /**
   * When true, only exact observed types are emitted (no union types).
   * When false (default), union types are allowed if multiple types were seen.
   */
  strictTypes?: boolean;
}

export interface ValidateOptions {
  onViolation?: (violation: ContractViolation) => void;
  /** When true, throws ContractViolationError on first violation. Default: false */
  throwOnViolation?: boolean;
  /** 0–1: validate only this fraction of calls. Default: 1 (all). */
  sampleRate?: number;
}

// ---------------------------------------------------------------------------
// Mock Registry — Phase B
// ---------------------------------------------------------------------------

export interface SessionCall {
  function: string;
  spanId: string;
  traceId: string;
  args: unknown[];
  return: unknown;
  durationMs: number;
  error: { type: string; message: string } | null;
  sequence: number;
}

export interface SessionSnapshot {
  session: string;
  startTime: string;
  endTime: string;
  calls: SessionCall[];
}

export interface RecordingOptions {
  /** Only record calls to these function names. */
  functions?: string[];
  /** Max calls to record per function name. */
  maxCallsPerFunction?: number;
  /** Custom filter: return false to exclude a call. */
  filter?: (call: SessionCall) => boolean;
}

export type MockMode = "exact" | "round-robin" | "latency-preserving";

export interface ServeOptions {
  mode: MockMode;
  faultInjection?: {
    /** Fraction (0–1) of calls that return a recorded error response. */
    errorRate?: number;
    /** Multiplier applied to the recorded durationMs before responding. */
    latencyFactor?: number;
  };
}

export type MockTarget = "jest" | "vitest" | "pytest";

export interface GenerateOptions {
  target: MockTarget;
  /** Include recorded timing delays in the generated mock. Default: false */
  includeTimings?: boolean;
  /** Use only the first recorded call per function. Default: false */
  oneCallPerFunction?: boolean;
}

// ---------------------------------------------------------------------------
// Session Diff — Phase B.4
// ---------------------------------------------------------------------------

export interface SessionDiff {
  addedFunctions: string[];
  removedFunctions: string[];
  changedReturnShapes: Array<{
    function: string;
    before: JSONSchema;
    after: JSONSchema;
  }>;
  changedErrorRate: Array<{
    function: string;
    before: number;
    after: number;
  }>;
  latencyRegression: Array<{
    function: string;
    beforeP95Ms: number;
    afterP95Ms: number;
    changePercent: number;
  }>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ContractViolationError extends Error {
  constructor(public readonly violation: ContractViolation) {
    super(
      `Contract violation in ${violation.functionName}: ` +
        violation.violations.map((v) => `${v.path} (${v.rule})`).join(", "),
    );
    this.name = "ContractViolationError";
  }
}

export class InsufficientSamplesError extends Error {
  constructor(
    public readonly functionName: string,
    public readonly actual: number,
    public readonly required: number,
  ) {
    super(`Insufficient samples for "${functionName}": need ${required}, got ${actual}`);
    this.name = "InsufficientSamplesError";
  }
}
