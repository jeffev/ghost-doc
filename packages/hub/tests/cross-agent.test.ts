/**
 * Cross-agent integration test.
 *
 * Simulates a JS agent and a Python agent both connecting to the Hub and
 * sending spans that share the same trace_id. Verifies that:
 * 1. Both spans are stored with their respective agent_ids.
 * 2. The second span is flagged as `distributed: true` (different agent, same trace).
 * 3. The trace tree returned by GET /traces/:traceId includes both spans.
 * 4. Both spans are visible in the Dashboard broadcast stream.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { GhostDocHub } from "../src/server.js";
import { makeTrace } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Helpers (duplicated from integration.test.ts to keep tests self-contained)
// ---------------------------------------------------------------------------

let hub: GhostDocHub;
let port: number;

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

function connect(path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

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
      if (queue.length > 0) return Promise.resolve(queue.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

async function waitFor(condition: () => boolean, ms = 1_500): Promise<void> {
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

describe("Cross-agent distributed tracing", () => {
  it("stores spans from JS and Python agents with different agent_ids", async () => {
    const sharedTraceId = randomUUID();

    // JS agent span (root)
    const jsSpan = makeTrace({
      trace_id: sharedTraceId,
      span_id: randomUUID(),
      parent_span_id: null,
      source: {
        agent_id: "frontend-js",
        language: "js",
        file: "api.ts",
        line: 10,
        function_name: "callPythonService",
      },
    });

    // Python agent span (child — shares the same trace_id)
    const pythonSpan = makeTrace({
      trace_id: sharedTraceId,
      span_id: randomUUID(),
      parent_span_id: jsSpan.span_id,
      source: {
        agent_id: "backend-python",
        language: "python",
        file: "service.py",
        line: 42,
        function_name: "process_request",
      },
    });

    const jsAgent = await connect("/agent");
    const pyAgent = await connect("/agent");

    jsAgent.send(JSON.stringify(jsSpan));
    await waitFor(() => hub.getStatus().traces_total === 1);

    pyAgent.send(JSON.stringify(pythonSpan));
    await waitFor(() => hub.getStatus().traces_total === 2);

    jsAgent.close();
    pyAgent.close();

    // Retrieve all traces.
    const res = await fetch(`http://127.0.0.1:${port}/traces?limit=100`);
    const spans = await res.json() as Array<{
      span_id: string;
      source: { agent_id: string };
      distributed: boolean;
    }>;

    const jsStored = spans.find((s) => s.source.agent_id === "frontend-js");
    const pyStored = spans.find((s) => s.source.agent_id === "backend-python");

    expect(jsStored).toBeDefined();
    expect(pyStored).toBeDefined();
  });

  it("flags the second span as distributed when agent_ids differ", async () => {
    const sharedTraceId = randomUUID();

    const jsSpan = makeTrace({
      trace_id: sharedTraceId,
      span_id: randomUUID(),
      source: {
        agent_id: "frontend-js",
        language: "js",
        file: "a.ts",
        line: 1,
        function_name: "send",
      },
    });

    const pySpan = makeTrace({
      trace_id: sharedTraceId,
      span_id: randomUUID(),
      parent_span_id: jsSpan.span_id,
      source: {
        agent_id: "backend-python",
        language: "python",
        file: "b.py",
        line: 5,
        function_name: "receive",
      },
    });

    const jsAgent = await connect("/agent");
    jsAgent.send(JSON.stringify(jsSpan));
    await waitFor(() => hub.getStatus().traces_total === 1);

    const pyAgent = await connect("/agent");
    pyAgent.send(JSON.stringify(pySpan));
    await waitFor(() => hub.getStatus().traces_total === 2);

    jsAgent.close();
    pyAgent.close();

    const res = await fetch(`http://127.0.0.1:${port}/traces?limit=100`);
    const spans = await res.json() as Array<{
      source: { agent_id: string };
      distributed: boolean;
    }>;

    const pyStored = spans.find((s) => s.source.agent_id === "backend-python");
    expect(pyStored?.distributed).toBe(true);
  });

  it("GET /traces/:traceId returns spans from both agents in the tree", async () => {
    const sharedTraceId = randomUUID();
    const jsSpanId = randomUUID();

    const jsSpan = makeTrace({
      trace_id: sharedTraceId,
      span_id: jsSpanId,
      parent_span_id: null,
      source: { agent_id: "svc-a", language: "js", file: "a.ts", line: 1, function_name: "fnA" },
    });

    const pySpan = makeTrace({
      trace_id: sharedTraceId,
      span_id: randomUUID(),
      parent_span_id: jsSpanId,
      source: { agent_id: "svc-b", language: "python", file: "b.py", line: 1, function_name: "fnB" },
    });

    const a = await connect("/agent");
    const b = await connect("/agent");

    a.send(JSON.stringify(jsSpan));
    await waitFor(() => hub.getStatus().traces_total === 1);
    b.send(JSON.stringify(pySpan));
    await waitFor(() => hub.getStatus().traces_total === 2);

    a.close();
    b.close();

    const res = await fetch(`http://127.0.0.1:${port}/traces/${sharedTraceId}`);
    expect(res.ok).toBe(true);

    const tree = await res.json() as {
      roots: Array<{ span: { source: { agent_id: string } }; children: unknown[] }>;
    };

    // Root span is from svc-a.
    expect(tree.roots).toHaveLength(1);
    const root = tree.roots[0]!;
    expect(root.span.source.agent_id).toBe("svc-a");
    // Child span is from svc-b.
    expect(root.children).toHaveLength(1);
    const child = root.children[0] as { span: { source: { agent_id: string } } };
    expect(child.span.source.agent_id).toBe("svc-b");
  });

  it("Dashboard receives broadcasts from both agents in real time", async () => {
    const sharedTraceId = randomUUID();

    const dashboard = await connect("/dashboard");
    const col = collector(dashboard);

    const jsAgent = await connect("/agent");
    const pyAgent = await connect("/agent");

    const jsSpan = makeTrace({
      trace_id: sharedTraceId,
      span_id: randomUUID(),
      source: { agent_id: "js-svc", language: "js", file: "f.ts", line: 1, function_name: "fn" },
    });
    const pySpan = makeTrace({
      trace_id: sharedTraceId,
      span_id: randomUUID(),
      parent_span_id: jsSpan.span_id,
      source: { agent_id: "py-svc", language: "python", file: "g.py", line: 1, function_name: "fn" },
    });

    const p1 = col.next();
    jsAgent.send(JSON.stringify(jsSpan));
    const m1 = await p1 as { type: string; span: { source: { agent_id: string } } };
    expect(m1.type).toBe("trace");
    expect(m1.span.source.agent_id).toBe("js-svc");

    const p2 = col.next();
    pyAgent.send(JSON.stringify(pySpan));
    const m2 = await p2 as { type: string; span: { source: { agent_id: string } } };
    expect(m2.type).toBe("trace");
    expect(m2.span.source.agent_id).toBe("py-svc");

    jsAgent.close();
    pyAgent.close();
    dashboard.close();
  });
});
