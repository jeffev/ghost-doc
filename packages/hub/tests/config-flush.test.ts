/**
 * Tests for:
 * - loadConfigFile: reads ~/.ghost-doc/config.json and returns parsed values
 * - GhostDocHub.flushToDisk: writes current spans as NDJSON to ~/.ghost-doc/traces/
 * - flushIntervalMs: periodic disk flush via setInterval
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { WebSocket } from "ws";
import { GhostDocHub, loadConfigFile } from "../src/server.js";
import { makeTrace } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") return reject(new Error("bad address"));
      srv.close(() => resolve(addr.port));
    });
  });
}

function connect(port: number, path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

async function waitFor(condition: () => boolean, ms = 1_500): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Creates a temporary directory and schedules cleanup. */
async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ghost-doc-test-"));
}

// ---------------------------------------------------------------------------
// loadConfigFile
// ---------------------------------------------------------------------------

describe("loadConfigFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await tempDir();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns empty object when config.json is absent", async () => {
    const cfg = await loadConfigFile(dir);
    expect(cfg).toEqual({});
  });

  it("parses port, sanitizeKeys, and flushIntervalMs", async () => {
    const content = JSON.stringify({
      port: 4242,
      sanitizeKeys: ["apiKey", "secret"],
      flushIntervalMs: 30_000,
    });
    await fs.writeFile(path.join(dir, "config.json"), content, "utf-8");

    const cfg = await loadConfigFile(dir);
    expect(cfg.port).toBe(4242);
    expect(cfg.sanitizeKeys).toEqual(["apiKey", "secret"]);
    expect(cfg.flushIntervalMs).toBe(30_000);
  });

  it("ignores invalid JSON gracefully", async () => {
    await fs.writeFile(path.join(dir, "config.json"), "NOT JSON", "utf-8");
    const cfg = await loadConfigFile(dir);
    expect(cfg).toEqual({});
  });

  it("ignores non-object JSON values", async () => {
    await fs.writeFile(path.join(dir, "config.json"), '"just a string"', "utf-8");
    const cfg = await loadConfigFile(dir);
    expect(cfg).toEqual({});
  });

  it("ignores non-string entries in sanitizeKeys", async () => {
    const content = JSON.stringify({ sanitizeKeys: ["valid", 42, null, "also-valid"] });
    await fs.writeFile(path.join(dir, "config.json"), content, "utf-8");
    const cfg = await loadConfigFile(dir);
    expect(cfg.sanitizeKeys).toEqual(["valid", "also-valid"]);
  });
});

// ---------------------------------------------------------------------------
// flushToDisk
// ---------------------------------------------------------------------------

describe("GhostDocHub.flushToDisk", () => {
  let hub: GhostDocHub;
  let port: number;
  let storageDir: string;

  beforeEach(async () => {
    port = await freePort();
    storageDir = await tempDir();
    hub = new GhostDocHub({ port, storageDir });
    await hub.start();
  });

  afterEach(async () => {
    await hub.stop();
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  it("creates a .jsonl file in <storageDir>/traces/", async () => {
    // Add a span first.
    const agent = await connect(port, "/agent");
    agent.send(JSON.stringify(makeTrace()));
    await waitFor(() => hub.getStatus().traces_total === 1);
    agent.close();

    const filePath = await hub.flushToDisk();
    expect(filePath).toContain("traces");
    expect(filePath.endsWith(".jsonl")).toBe(true);

    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]!) as { span_id: string };
    expect(typeof parsed.span_id).toBe("string");
  });

  it("writes each span on its own line (NDJSON format)", async () => {
    const agent = await connect(port, "/agent");
    agent.send(JSON.stringify(makeTrace()));
    agent.send(JSON.stringify(makeTrace()));
    await waitFor(() => hub.getStatus().traces_total === 2);
    agent.close();

    const filePath = await hub.flushToDisk();
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    // Each line must be valid JSON.
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("creates the traces directory if it does not exist", async () => {
    const tracesDir = path.join(storageDir, "traces");
    // Verify it doesn't exist yet.
    await expect(fs.access(tracesDir)).rejects.toThrow();

    await hub.flushToDisk();

    await expect(fs.access(tracesDir)).resolves.toBeUndefined();
  });
});
