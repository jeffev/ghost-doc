/**
 * @ghost-doc/contractum
 *
 * Phase A — Contractum: infer behavioral contracts from recorded spans,
 * validate future calls against them, export/import in multiple formats.
 *
 * Phase B — Mock Registry: turn recorded sessions into replayable mocks,
 * serve them over HTTP, generate static test files, diff sessions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  JSONSchema,
  ContractDefinition,
  ContractViolation,
  ContractViolationDetail,
  InferOptions,
  ValidateOptions,
  SessionCall,
  SessionSnapshot,
  RecordingOptions,
  ServeOptions,
  MockMode,
  GenerateOptions,
  MockTarget,
  SessionDiff,
} from "./types.js";

export { ContractViolationError, InsufficientSamplesError } from "./types.js";

// ---------------------------------------------------------------------------
// Phase A — Contractum
// ---------------------------------------------------------------------------

export { inferContract, inferAllContracts, inferFromSamples } from "./contract/infer.js";

export { validateCall, validateCalls, validateValue } from "./contract/validate.js";

export { exportContract, loadContract } from "./contract/export.js";
export type { ContractFormat } from "./contract/export.js";

// ---------------------------------------------------------------------------
// Phase B — Mock Registry
// ---------------------------------------------------------------------------

export {
  spansToSession,
  sessionToJson,
  sessionToYaml,
  loadSession,
  serveMocks,
} from "./mock/session.js";

export type { MockServer } from "./mock/session.js";

export { generateMocks } from "./mock/generate.js";

export { diffSessions, isBreaking } from "./mock/diff.js";
