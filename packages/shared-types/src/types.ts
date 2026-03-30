import type { z } from "zod";
import type {
  TraceEventSchema,
  SourceSchema,
  TimingSchema,
  ErrorInfoSchema,
  LanguageSchema,
} from "./schema.js";

export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Timing = z.infer<typeof TimingSchema>;
export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;
export type Language = z.infer<typeof LanguageSchema>;
