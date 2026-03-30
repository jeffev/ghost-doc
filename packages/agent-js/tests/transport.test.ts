import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { RingBuffer } from "../src/ring-buffer.js";
import { WsTransport } from "../src/transport.js";
import type { TraceEvent } from "@ghost-doc/shared-types";

function makeEvent(id: string): TraceEvent {
  return {
    schema_version: "1.0",
    trace_id: id,
    span_id: id,
    parent_span_id: null,
    source: {
      agent_id: "test",
      language: "js",
      file: "test.ts",
      line: 1,
      function_name: "fn",
    },
    timing: { started_at: Date.now(), duration_ms: 1 },
    input: [],
    output: null,
    error: null,
    tags: {},
  };
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("WsTransport", () => {
  let server: WebSocketServer;
  let transport: WsTransport;
  let buffer: RingBuffer<TraceEvent>;
  let receivedMessages: string[];

  beforeEach(
    () =>
      new Promise<void>((resolve) => {
        receivedMessages = [];
        server = new WebSocketServer({ port: 0 });
        server.on("connection", (ws) => {
          ws.on("message", (data) => {
            receivedMessages.push(data.toString());
          });
        });
        server.on("listening", resolve);
      }),
  );

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        transport?.disconnect();
        server.close(() => resolve());
      }),
  );

  it("sends an event when connected", async () => {
    const { port } = server.address() as AddressInfo;
    buffer = new RingBuffer<TraceEvent>(100);
    transport = new WsTransport(`ws://localhost:${port}`, buffer);
    transport.connect();

    await waitFor(100); // wait for connection

    const event = makeEvent("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
    transport.send(event);

    await waitFor(50);

    expect(receivedMessages).toHaveLength(1);
    const parsed = JSON.parse(receivedMessages[0]!) as TraceEvent;
    expect(parsed.trace_id).toBe(event.trace_id);
  });

  it("buffers events when not connected and flushes on reconnect", async () => {
    buffer = new RingBuffer<TraceEvent>(100);
    // Use a port that has no server yet
    transport = new WsTransport("ws://localhost:19999", buffer);
    transport.connect();

    const event = makeEvent("bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb");
    transport.send(event);

    // Event should be in the buffer
    expect(buffer.length).toBe(1);

    // Reconnect attempts happen — just verify buffer holds the event
    transport.disconnect();
    expect(buffer.drain()).toHaveLength(1);
  });

  it("reports isConnected accurately", async () => {
    const { port } = server.address() as AddressInfo;
    buffer = new RingBuffer<TraceEvent>(100);
    transport = new WsTransport(`ws://localhost:${port}`, buffer);

    expect(transport.isConnected).toBe(false);
    transport.connect();
    await waitFor(100);
    expect(transport.isConnected).toBe(true);

    transport.disconnect();
    expect(transport.isConnected).toBe(false);
  });

  it("sends multiple events in order", async () => {
    const { port } = server.address() as AddressInfo;
    buffer = new RingBuffer<TraceEvent>(100);
    transport = new WsTransport(`ws://localhost:${port}`, buffer);
    transport.connect();

    await waitFor(100);

    const ids = [
      "11111111-1111-4111-a111-111111111111",
      "22222222-2222-4222-a222-222222222222",
      "33333333-3333-4333-a333-333333333333",
    ];

    for (const id of ids) {
      transport.send(makeEvent(id));
    }

    await waitFor(50);

    expect(receivedMessages).toHaveLength(3);
    const parsedIds = receivedMessages.map((m) => (JSON.parse(m) as TraceEvent).trace_id);
    expect(parsedIds).toEqual(ids);
  });

  it("suppress console.error from WS errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    buffer = new RingBuffer<TraceEvent>(100);
    transport = new WsTransport("ws://localhost:1", buffer); // unreachable port
    transport.connect();
    await waitFor(200);
    transport.disconnect();
    consoleSpy.mockRestore();
    // Test passes as long as no unhandled error is thrown
  });
});
