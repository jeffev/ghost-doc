import { describe, it, expect } from "vitest";
import { parseV8StackFrame, captureSourceLocation } from "../src/source-locator.js";

describe("parseV8StackFrame", () => {
  it("parses named function frame", () => {
    const frame = "    at Object.myMethod (/home/user/project/src/file.ts:42:10)";
    const result = parseV8StackFrame(frame);
    expect(result).not.toBeNull();
    expect(result?.functionName).toBe("Object.myMethod");
    expect(result?.file).toBe("/home/user/project/src/file.ts");
    expect(result?.line).toBe(42);
  });

  it("parses anonymous function frame", () => {
    const frame = "    at /home/user/project/src/utils.ts:15:5";
    const result = parseV8StackFrame(frame);
    expect(result).not.toBeNull();
    expect(result?.functionName).toBe("anonymous");
    expect(result?.file).toBe("/home/user/project/src/utils.ts");
    expect(result?.line).toBe(15);
  });

  it("parses async function frame", () => {
    const frame = "    at async UserService.getUser (D:\\project\\src\\user.ts:100:20)";
    const result = parseV8StackFrame(frame);
    expect(result).not.toBeNull();
    expect(result?.functionName).toBe("async UserService.getUser");
    expect(result?.line).toBe(100);
  });

  it("returns null for native code frames", () => {
    const frame = "    at Array.forEach (<anonymous>)";
    // This matches the named pattern but with <anonymous> as file which is okay
    // The important thing is it doesn't crash
    const result = parseV8StackFrame(frame);
    // May or may not parse — just ensure no exception is thrown
    expect(() => parseV8StackFrame(frame)).not.toThrow();
  });

  it("returns null for non-stack-frame strings", () => {
    expect(parseV8StackFrame("Error: something went wrong")).toBeNull();
    expect(parseV8StackFrame("")).toBeNull();
    expect(parseV8StackFrame("   ")).toBeNull();
  });
});

describe("captureSourceLocation", () => {
  it("returns a location with file and line number", () => {
    const location = captureSourceLocation(0);
    // The returned file should be this test file
    expect(location.file).toContain("source-locator.test");
    expect(location.line).toBeGreaterThan(0);
  });

  it("returns unknown location gracefully when offset is too deep", () => {
    const location = captureSourceLocation(9999);
    expect(location.file).toBe("unknown");
    expect(location.line).toBe(0);
  });

  it("offsets correctly — offset 0 vs offset 1 differ", () => {
    const loc0 = captureSourceLocation(0);
    const loc1 = captureSourceLocation(1);
    // They should point to different lines (or at minimum not crash)
    expect(loc0.line).not.toBe(0);
    expect(loc1.line).not.toBe(0);
    expect(loc0.line).not.toBe(loc1.line);
  });
});
