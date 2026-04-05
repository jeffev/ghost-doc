import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { WebSocket, WebSocketServer } from "ws";

import { TraceEventSchema } from "@ghost-doc/shared-types";

import { AnomalyDetector, buildSpanTree } from "./correlator.js";
import { buildKeySet, sanitizeSpan } from "./sanitize.js";
import { TraceStore, type StoredSpan } from "./store.js";
import { buildGraph, buildHtmlDoc, buildMarkdownDoc } from "@ghost-doc/exporter";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HubConfig {
  /** Port for both the HTTP REST API and WebSocket server. Default: 3001 */
  port?: number;
  /** Network interface to bind to. Default: "127.0.0.1" (localhost only). */
  host?: string;
  /** Additional field names to redact during the Hub sanitization pass. */
  sanitizeKeys?: string[];
  /** Root directory for snapshot and config files. Default: ~/.ghost-doc */
  storageDir?: string;
  /**
   * Flush all traces to disk at this interval (milliseconds).
   * Traces are written as NDJSON to `<storageDir>/traces/<timestamp>.jsonl`.
   * Set to 0 or omit to disable. Default: 0
   */
  flushIntervalMs?: number;
  /**
   * Maximum number of spans a single agent connection may send per second.
   * Excess spans are silently dropped. Default: 500.
   * Set to 0 to disable rate limiting.
   */
  maxSpansPerSecond?: number;
}

// ---------------------------------------------------------------------------
// Config file shape (~/.ghost-doc/config.json)
// ---------------------------------------------------------------------------

export interface HubConfigFile {
  port?: number;
  sanitizeKeys?: string[];
  flushIntervalMs?: number;
}

/**
 * Loads optional configuration from `<storageDir>/config.json`.
 * Missing or unparseable files are silently ignored (returns `{}`).
 */
export async function loadConfigFile(storageDir: string): Promise<HubConfigFile> {
  const filePath = path.join(storageDir, "config.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const cfg = parsed as Record<string, unknown>;
    const result: HubConfigFile = {};
    if (typeof cfg["port"] === "number") result.port = cfg["port"];
    if (Array.isArray(cfg["sanitizeKeys"])) {
      result.sanitizeKeys = (cfg["sanitizeKeys"] as unknown[]).filter(
        (k): k is string => typeof k === "string",
      );
    }
    if (typeof cfg["flushIntervalMs"] === "number") result.flushIntervalMs = cfg["flushIntervalMs"];
    return result;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Message shapes sent to Dashboard clients
// ---------------------------------------------------------------------------

interface SnapshotMessage {
  type: "trace";
  span: StoredSpan;
}

interface InitialSnapshotMessage {
  type: "snapshot";
  traces: StoredSpan[];
}

// ---------------------------------------------------------------------------
// GhostDocHub
// ---------------------------------------------------------------------------

const DEFAULT_STORAGE_DIR = path.join(os.homedir(), ".ghost-doc");

export class GhostDocHub {
  private readonly config: Required<HubConfig>;
  private readonly store: TraceStore;
  private readonly anomalyDetector: AnomalyDetector;
  private readonly sanitizeKeys: ReadonlySet<string>;

  private readonly fastify: FastifyInstance;
  private readonly wss: WebSocketServer;

  /** Active Dashboard WebSocket connections. */
  private readonly dashboardClients = new Set<WebSocket>();

  /**
   * Sliding window of trace-arrival timestamps used to compute traces/sec.
   * Only timestamps within the last 5 s are kept.
   */
  private readonly rateWindow: number[] = [];

  /** Handle returned by setInterval for the periodic disk flush (if enabled). */
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  /** True when the dashboard's static files were found and the plugin registered. */
  private hasStaticFiles = false;

  /** Per-connection sliding window: maps ws → array of arrival timestamps (ms). */
  private readonly agentRateWindows = new WeakMap<WebSocket, number[]>();

  constructor(config: HubConfig = {}) {
    this.config = {
      port: config.port ?? 3001,
      host: config.host ?? "127.0.0.1",
      sanitizeKeys: config.sanitizeKeys ?? [],
      storageDir: config.storageDir ?? DEFAULT_STORAGE_DIR,
      flushIntervalMs: config.flushIntervalMs ?? 0,
      maxSpansPerSecond: config.maxSpansPerSecond ?? 500,
    };

    this.store = new TraceStore();
    this.anomalyDetector = new AnomalyDetector();
    this.sanitizeKeys = buildKeySet(this.config.sanitizeKeys);

    this.fastify = Fastify({ logger: false });
    this.wss = new WebSocketServer({ noServer: true });

    this.registerStaticFiles();
    this.registerRoutes();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    await this.fastify.listen({
      port: this.config.port,
      host: this.config.host,
    });

    // Attach WebSocket upgrade handler to the HTTP server that Fastify owns.
    this.fastify.server.on("upgrade", (req, socket, head) => {
      const url = req.url ?? "";

      if (url === "/agent" || url.startsWith("/agent?")) {
        this.wss.handleUpgrade(req, socket as never, head, (ws) => {
          this.onAgentConnect(ws);
        });
      } else if (url === "/dashboard" || url.startsWith("/dashboard?")) {
        this.wss.handleUpgrade(req, socket as never, head, (ws) => {
          this.onDashboardConnect(ws);
        });
      } else {
        socket.destroy();
      }
    });

    // Start periodic disk flush if configured.
    if (this.config.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        void this.flushToDisk();
      }, this.config.flushIntervalMs);
    }
  }

  async stop(): Promise<void> {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    for (const client of this.dashboardClients) {
      client.close();
    }
    this.dashboardClients.clear();

    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await this.fastify.close();
  }

  /**
   * Write all current traces to `<storageDir>/traces/<timestamp>.jsonl` as NDJSON.
   * Returns the file path written.
   */
  async flushToDisk(): Promise<string> {
    const dir = path.join(this.config.storageDir, "traces");
    await fs.mkdir(dir, { recursive: true });

    const timestamp = Date.now();
    const filePath = path.join(dir, `${timestamp}.jsonl`);
    const spans = this.store.getRecent(10_000);
    const ndjson = spans.map((s) => JSON.stringify(s)).join("\n");
    await fs.writeFile(filePath, ndjson, "utf-8");

    return filePath;
  }

  // ---------------------------------------------------------------------------
  // WebSocket: Agent
  // ---------------------------------------------------------------------------

  private onAgentConnect(ws: WebSocket): void {
    this.agentRateWindows.set(ws, []);
    ws.on("message", (raw) => {
      this.handleAgentMessage(ws, raw.toString());
    });
    ws.on("error", (err) => {
      // Errors are logged at warn level; they don't crash the Hub.
      console.warn(`[hub] agent ws error: ${err.message}`);
    });
    ws.on("close", () => {
      // WeakMap cleans up automatically, but be explicit for GC friendliness.
      this.agentRateWindows.delete(ws);
    });
  }

  /**
   * Sliding-window rate limiter. Returns true if the span should be processed,
   * false if it exceeds the per-connection rate limit.
   */
  private checkRateLimit(ws: WebSocket): boolean {
    const limit = this.config.maxSpansPerSecond;
    if (limit <= 0) return true; // rate limiting disabled

    const now = Date.now();
    const window = this.agentRateWindows.get(ws);
    if (window === undefined) return true;

    // Evict timestamps older than 1 second.
    const cutoff = now - 1_000;
    let i = 0;
    while (i < window.length && (window[i] ?? 0) < cutoff) i++;
    if (i > 0) window.splice(0, i);

    if (window.length >= limit) return false; // rate exceeded — drop

    window.push(now);
    return true;
  }

  private handleAgentMessage(ws: WebSocket, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn("[hub] discarded non-JSON message from agent");
      return;
    }

    // Support both single events and batched arrays (agent batching mode).
    const events: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

    for (const event of events) {
      if (!this.checkRateLimit(ws)) continue; // rate exceeded — drop span
      this.processTraceEvent(event);
    }
  }

  private processTraceEvent(parsed: unknown): void {
    const result = TraceEventSchema.safeParse(parsed);
    if (!result.success) {
      console.warn("[hub] discarded invalid trace:", result.error.flatten().fieldErrors);
      return;
    }

    const event = result.data;
    const sanitized = sanitizeSpan(event, this.sanitizeKeys);
    // Resolve output to a definite unknown (Zod infers it as optional).
    const resolvedOutput: unknown = sanitized.output;
    const anomaly = this.anomalyDetector.check({ ...sanitized, output: resolvedOutput });

    // A trace is distributed when the same trace_id is already present from a
    // different agent.
    const existingSpans = this.store.getByTraceId(sanitized.trace_id);
    const distributed =
      existingSpans.length > 0 &&
      existingSpans.some((s) => s.source.agent_id !== sanitized.source.agent_id);

    const stored: StoredSpan = {
      ...sanitized,
      output: resolvedOutput,
      received_at: Date.now(),
      anomaly,
      distributed,
    };

    this.store.add(stored);
    this.recordRate();
    this.fanOut(stored);
  }

  // ---------------------------------------------------------------------------
  // WebSocket: Dashboard
  // ---------------------------------------------------------------------------

  private onDashboardConnect(ws: WebSocket): void {
    this.dashboardClients.add(ws);

    // Hydrate the new client with recent history.
    const recent = this.store.getRecent(200);
    if (recent.length > 0) {
      const msg: InitialSnapshotMessage = { type: "snapshot", traces: recent };
      ws.send(JSON.stringify(msg));
    }

    ws.on("close", () => this.dashboardClients.delete(ws));
    ws.on("error", (err) => {
      this.dashboardClients.delete(ws);
      console.warn(`[hub] dashboard ws error: ${err.message}`);
    });
  }

  private fanOut(span: StoredSpan): void {
    if (this.dashboardClients.size === 0) return;
    const msg: SnapshotMessage = { type: "trace", span };
    const payload = JSON.stringify(msg);

    for (const client of this.dashboardClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Static files (bundled Dashboard)
  // ---------------------------------------------------------------------------

  private registerStaticFiles(): void {
    const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
    if (!existsSync(publicDir)) return;

    this.hasStaticFiles = true;
    void this.fastify.register(fastifyStatic, {
      root: publicDir,
      prefix: "/",
      wildcard: false,
    });
  }

  // ---------------------------------------------------------------------------
  // HTTP REST routes
  // ---------------------------------------------------------------------------

  private registerRoutes(): void {
    const app = this.fastify;

    // GET /health
    app.get("/health", async () => ({
      status: "ok" as const,
      agents: this.store.agentCount,
      traces_total: this.store.totalCount,
    }));

    // GET /traces?limit=100&agent_id=frontend
    app.get<{ Querystring: { limit?: string; agent_id?: string } }>("/traces", async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? "100", 10), 1_000);
      const agentId = req.query.agent_id;
      return this.store.getRecent(limit, agentId);
    });

    // GET /traces/:traceId
    app.get<{ Params: { traceId: string } }>("/traces/:traceId", async (req, reply) => {
      const spans = this.store.getByTraceId(req.params.traceId);
      if (spans.length === 0) {
        return reply.status(404).send({ error: "trace not found" });
      }
      return buildSpanTree(spans);
    });

    // POST /snapshot
    app.post("/snapshot", async () => {
      const id = Date.now().toString();
      const dir = path.join(this.config.storageDir, "snapshots");
      await fs.mkdir(dir, { recursive: true });

      const spans = this.store.getRecent(10_000);
      const filePath = path.join(dir, `${id}.json`);
      const payload = {
        id,
        createdAt: Date.now(),
        agents: this.store.getAgentIds(),
        spans,
        tags: {},
      };
      await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");

      return { id, path: filePath, spans: spans.length };
    });

    // POST /snapshots/load — replays a snapshot into the store and broadcasts to dashboards
    app.post("/snapshots/load", async (req, reply) => {
      const body = req.body as {
        id?: string;
        spans?: StoredSpan[];
        createdAt?: number;
        agents?: string[];
        tags?: Record<string, string>;
      };

      if (!Array.isArray(body.spans)) {
        return reply.status(400).send({ error: "invalid snapshot: missing spans array" });
      }

      this.store.clear();

      for (const span of body.spans) {
        this.store.add(span);
      }

      // Broadcast the loaded spans to connected Dashboard clients
      const msg = JSON.stringify({ type: "snapshot", traces: body.spans });
      for (const client of this.dashboardClients) {
        if (client.readyState === client.OPEN) {
          client.send(msg);
        }
      }

      return { loaded: body.spans.length };
    });

    // GET /snapshots
    app.get("/snapshots", async () => {
      const dir = path.join(this.config.storageDir, "snapshots");
      try {
        const files = await fs.readdir(dir);
        return files
          .filter((f) => f.endsWith(".json"))
          .map((f) => ({ id: f.slice(0, -5), file: f }))
          .sort((a, b) => b.id.localeCompare(a.id));
      } catch {
        return [];
      }
    });

    // GET /snapshots/:id
    app.get<{ Params: { id: string } }>("/snapshots/:id", async (req, reply) => {
      const filePath = path.join(this.config.storageDir, "snapshots", `${req.params.id}.json`);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        return JSON.parse(content) as unknown;
      } catch {
        return reply.status(404).send({ error: "snapshot not found" });
      }
    });

    // GET /export?format=html|markdown&project=MyApp
    // Returns a rendered document from the current span buffer.
    app.get<{ Querystring: { format?: string; project?: string } }>(
      "/export",
      async (req, reply) => {
        const format = req.query.format ?? "html";
        const project = req.query.project ?? "Project";
        const spans = this.store.getRecent(10_000);

        if (format === "markdown") {
          const graph = buildGraph(spans as Parameters<typeof buildGraph>[0]);
          const md = buildMarkdownDoc(graph, project, {});
          void reply.header("Content-Type", "text/markdown; charset=utf-8");
          void reply.header("Content-Disposition", `attachment; filename="${project}.md"`);
          return reply.send(md);
        }

        // Default: html
        const graph = buildGraph(spans as Parameters<typeof buildGraph>[0]);
        const html = buildHtmlDoc(graph, { projectName: project });
        void reply.header("Content-Type", "text/html; charset=utf-8");
        void reply.header("Content-Disposition", `attachment; filename="${project}.html"`);
        return reply.send(html);
      },
    );

    // SPA fallback — serve index.html for any unmatched path so client-side routing works.
    // Only active when the dashboard's static files are present (hub/public exists).
    if (this.hasStaticFiles) {
      app.setNotFoundHandler(async (_req, reply) => {
        return reply.sendFile("index.html");
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Status / metrics
  // ---------------------------------------------------------------------------

  private recordRate(): void {
    const now = Date.now();
    this.rateWindow.push(now);
    // Evict entries older than 5 s.
    const cutoff = now - 5_000;
    while (this.rateWindow.length > 0 && (this.rateWindow[0] ?? 0) < cutoff) {
      this.rateWindow.shift();
    }
  }

  tracesPerSecond(): number {
    const cutoff = Date.now() - 1_000;
    return this.rateWindow.filter((t) => t >= cutoff).length;
  }

  getStatus() {
    return {
      agents: this.store.getAgentIds(),
      traces_total: this.store.totalCount,
      traces_per_second: this.tracesPerSecond(),
      dashboard_clients: this.dashboardClients.size,
    };
  }
}
