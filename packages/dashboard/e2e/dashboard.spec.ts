/**
 * E2E tests for the Ghost Doc Dashboard.
 *
 * Each test:
 *  1. Starts a real GhostDocHub on a random free port.
 *  2. Injects the hub URL into the page via localStorage so the Dashboard
 *     WebSocket hook connects to the test Hub instead of the default :3001.
 *  3. Sends trace events directly over WebSocket from the test process.
 *  4. Asserts that the Dashboard reacts (node appears, inspector opens, etc.).
 *
 * The Dashboard must be built and served by Playwright's webServer (see
 * playwright.config.ts) before these tests run.
 */

import { test, expect } from "@playwright/test";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { GhostDocHub } from "../../hub/src/server.js";
import type { TraceEvent } from "../../shared-types/src/index.js";

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

function connectWs(port: number, path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function makeTrace(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    schema_version: "1.0",
    trace_id: randomUUID(),
    span_id: randomUUID(),
    parent_span_id: null,
    source: {
      agent_id: "e2e-agent",
      language: "js",
      file: "e2e.ts",
      line: 1,
      function_name: "handleRequest",
    },
    timing: { started_at: Date.now(), duration_ms: 42 },
    input: [{ method: "GET", url: "/api/users", headers: {} }],
    output: [{ id: 1, name: "Alice" }],
    error: null,
    tags: {},
    ...overrides,
  };
}

async function waitFor(condition: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let hub: GhostDocHub;
let hubPort: number;

test.beforeEach(async () => {
  hubPort = await freePort();
  hub = new GhostDocHub({ port: hubPort });
  await hub.start();
});

test.afterEach(async () => {
  await hub.stop();
});

test("Dashboard shows empty-state ghost when no traces are present", async ({ page }) => {
  // Redirect the Dashboard's WebSocket to the test Hub.
  await page.addInitScript((port) => {
    window.localStorage.setItem("ghost-doc-hub-url", `ws://127.0.0.1:${port}/dashboard`);
  }, hubPort);

  await page.goto("/");
  await expect(page.getByText("Waiting for traces")).toBeVisible();
});

test("A traced function node appears in the flowchart after an agent emits a span", async ({
  page,
}) => {
  await page.addInitScript((port) => {
    window.localStorage.setItem("ghost-doc-hub-url", `ws://127.0.0.1:${port}/dashboard`);
  }, hubPort);

  await page.goto("/");

  // Wait for the Dashboard to be connected to the test Hub.
  await expect(page.locator("text=Connected")).toBeVisible({ timeout: 5_000 });

  // Send a span from the test Hub.
  const agent = await connectWs(hubPort, "/agent");
  const span = makeTrace({ source: { agent_id: "e2e-agent", language: "js", file: "e2e.ts", line: 1, function_name: "handleRequest" } });
  agent.send(JSON.stringify(span));

  await waitFor(() => hub.getStatus().traces_total === 1);

  // The flowchart should now render the node — D3 renders SVG text with the
  // function name (truncated to 12 chars: "handleReques…").
  await expect(page.locator("svg text").filter({ hasText: /handleReques/i })).toBeVisible({
    timeout: 5_000,
  });

  agent.close();
});

test("Clicking a node opens the Inspector with function details", async ({ page }) => {
  await page.addInitScript((port) => {
    window.localStorage.setItem("ghost-doc-hub-url", `ws://127.0.0.1:${port}/dashboard`);
  }, hubPort);

  await page.goto("/");
  await expect(page.locator("text=Connected")).toBeVisible({ timeout: 5_000 });

  const agent = await connectWs(hubPort, "/agent");
  const span = makeTrace();
  agent.send(JSON.stringify(span));
  await waitFor(() => hub.getStatus().traces_total === 1);

  // Click the node.
  const node = page.locator("svg g.node").first();
  await expect(node).toBeVisible({ timeout: 5_000 });
  await node.click();

  // Inspector should show the function name.
  await expect(page.locator("text=handleRequest")).toBeVisible({ timeout: 3_000 });
  // Inspector should show the agent badge.
  await expect(page.locator("text=e2e-agent")).toBeVisible();

  agent.close();
});

test("Inspector shows Copy as curl button for HTTP handler spans", async ({ page }) => {
  await page.addInitScript((port) => {
    window.localStorage.setItem("ghost-doc-hub-url", `ws://127.0.0.1:${port}/dashboard`);
  }, hubPort);

  await page.goto("/");
  await expect(page.locator("text=Connected")).toBeVisible({ timeout: 5_000 });

  const agent = await connectWs(hubPort, "/agent");
  // Input includes an HTTP request object — triggers "Copy as curl" detection.
  const span = makeTrace({
    input: [{ method: "POST", url: "/api/items", headers: { Authorization: "Bearer tok" }, body: { name: "test" } }],
  });
  agent.send(JSON.stringify(span));
  await waitFor(() => hub.getStatus().traces_total === 1);

  // Open inspector.
  await page.locator("svg g.node").first().click();
  // Expand the first span row.
  await page.locator(".cursor-pointer").first().click();

  await expect(page.locator("text=Copy as curl")).toBeVisible({ timeout: 3_000 });
  agent.close();
});

test("Clear button removes all nodes from the flowchart", async ({ page }) => {
  await page.addInitScript((port) => {
    window.localStorage.setItem("ghost-doc-hub-url", `ws://127.0.0.1:${port}/dashboard`);
  }, hubPort);

  await page.goto("/");
  await expect(page.locator("text=Connected")).toBeVisible({ timeout: 5_000 });

  const agent = await connectWs(hubPort, "/agent");
  agent.send(JSON.stringify(makeTrace()));
  await waitFor(() => hub.getStatus().traces_total === 1);

  // Wait for the node to appear, then clear.
  await expect(page.locator("svg g.node").first()).toBeVisible({ timeout: 5_000 });
  await page.locator("button", { hasText: "Clear" }).click();

  await expect(page.getByText("Waiting for traces")).toBeVisible({ timeout: 3_000 });
  agent.close();
});
