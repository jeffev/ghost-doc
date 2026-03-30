/**
 * Integration tests: Hub WebSocket server ↔ Agent + Dashboard clients.
 *
 * A real GhostDocHub is started on a random free port for each test, a raw
 * WebSocket client emulates the Agent by sending JSON payloads, and another
 * client emulates the Dashboard by listening for broadcast messages.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { GhostDocHub } from "../src/server.js";
import { makeTrace } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let hub: GhostDocHub;
let port: number;

/** Finds a free TCP port by binding to :0 and immediately closing. */
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

/** Opens a WebSocket and waits for the "open" event. */
function connect(path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/**
 * Returns a message collector that buffers all incoming WS messages.
 * Call `next()` to get the next message in arrival order (waits if none yet).
 */
function collector(ws: WebSocket): { next: () => Promise<unknown> } {
  const queue: unknown[] = [];
  const waiters: Array<(v: unknown) => void> = [];

  ws.on("message", (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      parsed = data.toString();
    }
    const waiter = waiters.shift();
    if (waiter !== undefined) {
      waiter(parsed);
    } else {
      queue.push(parsed);
    }
  });

  return {
    next(): Promise<unknown> {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift());
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

/** Sends a message and resolves with the next incoming message on `ws`. */
function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch {
        reject(new Error("Non-JSON message received"));
      }
    });
    ws.once("error", reject);
  });
}

/** Waits up to `ms` milliseconds for a condition to be truthy. */
async function waitFor(condition: () => boolean, ms = 1_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  port = await freePort();
  hub = new GhostDocHub({ port });
  await hub.start();
});

afterEach(async () => {
  await hub.stop();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Hub WebSocket — Agent path", () => {
  it("accepts a valid trace and stores it", async () => {
    const agent = await connect("/agent");
    const trace = makeTrace();
    agent.send(JSON.stringify(trace));

    await waitFor(() => hub.getStatus().traces_total === 1);
    agent.close();

    expect(hub.getStatus().traces_total).toBe(1);
  });

  it("discards an invalid (malformed) trace without crashing", async () => {
    const agent = await connect("/agent");
    agent.send("not json at all");
    agent.send(JSON.stringify({ schema_version: "99.0", junk: true }));

    // Give the Hub a moment to process.
    await new Promise((r) => setTimeout(r, 100));
    agent.close();

    expect(hub.getStatus().traces_total).toBe(0);
  });

  it("rejects a connection to an unknown path", async () => {
    await expect(connect("/unknown")).rejects.toThrow();
  });
});

describe("Hub WebSocket — Dashboard path", () => {
  it("broadcasts each new trace to connected Dashboard clients", async () => {
    // Connect dashboard first (empty store → no initial snapshot).
    const dashboard = await connect("/dashboard");
    const col = collector(dashboard);
    const agent = await connect("/agent");
    const trace = makeTrace();

    // nextMessage is registered (via collector) before send, so no race.
    const broadcastPromise = col.next();
    agent.send(JSON.stringify(trace));

    const msg = (await broadcastPromise) as { type: string; span: { trace_id: string } };
    expect(msg.type).toBe("trace");
    expect(msg.span.trace_id).toBe(trace.trace_id);

    agent.close();
    dashboard.close();
  });

  it("sends an initial snapshot when a Dashboard reconnects", async () => {
    // Pre-populate the store.
    const agent = await connect("/agent");
    const trace = makeTrace();
    agent.send(JSON.stringify(trace));
    await waitFor(() => hub.getStatus().traces_total === 1);
    agent.close();

    // Open a raw WS and attach the collector BEFORE the "open" fires so the
    // snapshot (sent immediately on connect) is never missed.
    const wsRaw = new WebSocket(`ws://127.0.0.1:${port}/dashboard`);
    const col = collector(wsRaw);
    await new Promise<void>((resolve, reject) => {
      wsRaw.once("open", resolve);
      wsRaw.once("error", reject);
    });

    const msg = (await col.next()) as { type: string; traces: unknown[] };
    expect(msg.type).toBe("snapshot");
    expect(msg.traces.length).toBeGreaterThanOrEqual(1);
    wsRaw.close();
  });
});

describe("Hub HTTP REST API", () => {
  it("GET /health returns ok", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ok");
  });

  it("GET /traces returns stored traces", async () => {
    const agent = await connect("/agent");
    agent.send(JSON.stringify(makeTrace()));
    await waitFor(() => hub.getStatus().traces_total === 1);
    agent.close();

    const res = await fetch(`http://127.0.0.1:${port}/traces?limit=10`);
    expect(res.ok).toBe(true);
    const body = await res.json() as unknown[];
    expect(body.length).toBe(1);
  });

  it("GET /traces/:traceId returns a span tree", async () => {
    const trace = makeTrace();
    const agent = await connect("/agent");
    agent.send(JSON.stringify(trace));
    await waitFor(() => hub.getStatus().traces_total === 1);
    agent.close();

    const res = await fetch(`http://127.0.0.1:${port}/traces/${trace.trace_id}`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { roots: unknown[] };
    expect(body.roots).toHaveLength(1);
  });

  it("GET /traces/:traceId returns 404 for unknown trace", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/traces/aaaaaaaa-0000-4000-8000-000000000001`);
    expect(res.status).toBe(404);
  });

  it("POST /snapshot creates a snapshot file and returns an id", async () => {
    const agent = await connect("/agent");
    agent.send(JSON.stringify(makeTrace()));
    await waitFor(() => hub.getStatus().traces_total === 1);
    agent.close();

    const res = await fetch(`http://127.0.0.1:${port}/snapshot`, { method: "POST" });
    expect(res.ok).toBe(true);
    const body = await res.json() as { id: string; path: string };
    expect(typeof body.id).toBe("string");
    expect(body.path).toContain("snapshots");
  });
});

describe("Anomaly detection via Hub", () => {
  it("marks a span anomalous when output type changes", async () => {
    const agent = await connect("/agent");

    // First call: output is a string.
    const first = makeTrace({ output: "hello" });
    agent.send(JSON.stringify(first));
    await waitFor(() => hub.getStatus().traces_total === 1);

    // Second call (same function): output is a number → anomaly.
    const second = makeTrace({
      span_id: "cccccccc-0000-4000-8000-000000000001",
      output: 42,
    });
    agent.send(JSON.stringify(second));
    await waitFor(() => hub.getStatus().traces_total === 2);
    agent.close();

    const res = await fetch(`http://127.0.0.1:${port}/traces?limit=10`);
    const spans = await res.json() as Array<{ span_id: string; anomaly: boolean }>;

    const anomalousSpan = spans.find((s) => s.span_id === second.span_id);
    expect(anomalousSpan?.anomaly).toBe(true);
  });
});
