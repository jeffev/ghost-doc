// Primary factory
export { createTracer, TRACE_ID_HEADER } from "./tracer.js";
export type { TracerConfig, TracerInstance, TraceContext } from "./tracer.js";

// Sanitization utilities (useful for manual configuration)
export { DEFAULT_SANITIZE_KEYS, sanitizeDeep } from "./sanitize.js";
export type { SanitizeConfig, SanitizerFn } from "./sanitize.js";

// Re-export shared types for consumer convenience
export type { TraceEvent, Source, Timing, ErrorInfo, Language } from "@ghost-doc/shared-types";
