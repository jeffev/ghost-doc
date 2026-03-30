import { describe, it, expect } from "vitest";
import {
  createSnapshot,
  encodeSnapshot,
  decodeSnapshot,
  buildShareUrl,
  parseShareUrl,
} from "../src/snapshot.js";
import { makeSpan } from "./fixtures.js";

describe("createSnapshot", () => {
  it("includes a UUID id, createdAt, agents, and spans", () => {
    const spans = [
      makeSpan({ source: { agent_id: "api", language: "js", file: "a.ts", line: 1, function_name: "fn" } }),
    ];
    const snap = createSnapshot(spans);
    expect(snap.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(snap.createdAt).toBeGreaterThan(0);
    expect(snap.agents).toEqual(["api"]);
    expect(snap.spans).toHaveLength(1);
    expect(snap.tags).toEqual({});
  });

  it("collects unique agent IDs from spans", () => {
    const spans = [
      makeSpan({ source: { agent_id: "frontend", language: "js", file: "a.ts", line: 1, function_name: "fn" } }),
      makeSpan({ source: { agent_id: "backend", language: "js", file: "b.ts", line: 1, function_name: "fn" } }),
      makeSpan({ source: { agent_id: "frontend", language: "js", file: "a.ts", line: 2, function_name: "fn2" } }),
    ];
    const snap = createSnapshot(spans);
    expect(snap.agents.sort()).toEqual(["backend", "frontend"]);
  });

  it("passes through custom tags", () => {
    const snap = createSnapshot([], { env: "production", version: "1.2.3" });
    expect(snap.tags).toEqual({ env: "production", version: "1.2.3" });
  });
});

describe("encode / decode round-trip", () => {
  it("decodes what it encodes", () => {
    const spans = [makeSpan(), makeSpan()];
    const snap = createSnapshot(spans, { env: "test" });
    const encoded = encodeSnapshot(snap);
    const decoded = decodeSnapshot(encoded);

    expect(decoded.id).toBe(snap.id);
    expect(decoded.createdAt).toBe(snap.createdAt);
    expect(decoded.agents).toEqual(snap.agents);
    expect(decoded.spans).toHaveLength(2);
    expect(decoded.tags).toEqual({ env: "test" });
  });

  it("encoded string contains only base64url-safe characters", () => {
    const encoded = encodeSnapshot(createSnapshot([makeSpan()]));
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+=*$/);
  });

  it("throws on invalid base64url input", () => {
    expect(() => decodeSnapshot("!!!not-base64!!!")).toThrow();
  });

  it("throws when required fields are missing", () => {
    const partial = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url");
    expect(() => decodeSnapshot(partial)).toThrow(/missing required fields/);
  });
});

describe("share URL helpers", () => {
  it("buildShareUrl wraps with ghost-doc:// prefix", () => {
    expect(buildShareUrl("abc123")).toBe("ghost-doc://#abc123");
  });

  it("parseShareUrl extracts the encoded payload", () => {
    expect(parseShareUrl("ghost-doc://#abc123")).toBe("abc123");
  });

  it("parseShareUrl returns null for unrecognised URLs", () => {
    expect(parseShareUrl("https://example.com/#abc123")).toBeNull();
  });

  it("full round-trip: encode → share → parse → decode", () => {
    const snap = createSnapshot([makeSpan()]);
    const shareUrl = buildShareUrl(encodeSnapshot(snap));
    const extracted = parseShareUrl(shareUrl);
    expect(extracted).not.toBeNull();
    const decoded = decodeSnapshot(extracted!);
    expect(decoded.id).toBe(snap.id);
  });
});
