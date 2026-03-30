export interface SourceLocation {
  file: string;
  line: number;
  functionName: string;
}

/**
 * Parses a single V8 stack frame string into its components.
 *
 * Handles two V8 formats:
 *   "    at FunctionName (/path/to/file.ts:42:10)"
 *   "    at /path/to/file.ts:42:10"
 *   "    at Object.method (/path/to/file.ts:42:10)"
 */
export function parseV8StackFrame(frame: string): SourceLocation | null {
  const trimmed = frame.trim();

  if (!trimmed.startsWith("at ")) return null;

  // Format: "at FnName (file:line:col)"
  const namedMatch = /^at\s+(.+?)\s+\((.+):(\d+):\d+\)$/.exec(trimmed);
  if (namedMatch) {
    return {
      functionName: namedMatch[1] ?? "anonymous",
      file: namedMatch[2] ?? "unknown",
      line: parseInt(namedMatch[3] ?? "0", 10),
    };
  }

  // Format: "at file:line:col"
  const bareMatch = /^at\s+(.+):(\d+):\d+$/.exec(trimmed);
  if (bareMatch) {
    return {
      functionName: "anonymous",
      file: bareMatch[1] ?? "unknown",
      line: parseInt(bareMatch[2] ?? "0", 10),
    };
  }

  return null;
}

/**
 * Captures the source location of the caller by parsing `Error.stack`.
 *
 * @param stackOffset - Number of additional frames to skip above this function.
 *   0 = the direct caller of captureSourceLocation.
 *   1 = the caller's caller. Etc.
 */
export function captureSourceLocation(stackOffset = 0): SourceLocation {
  const err = new Error();
  const lines = err.stack?.split("\n") ?? [];

  // lines[0] = "Error"
  // lines[1] = captureSourceLocation itself
  // lines[2] = direct caller (stackOffset 0)
  // lines[2 + stackOffset] = target frame
  const targetLine = lines[2 + stackOffset];

  if (targetLine) {
    const parsed = parseV8StackFrame(targetLine);
    if (parsed) return parsed;
  }

  return { file: "unknown", line: 0, functionName: "unknown" };
}
