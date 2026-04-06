#!/usr/bin/env node
/**
 * Ghost Doc CLI
 *
 * Commands:
 *   ghost-doc start [--port 3001] [--no-open]
 *   ghost-doc stop
 *   ghost-doc status [--port 3001]
 *   ghost-doc export --format markdown|html [--output path] [--port 3001] [--project name]
 *   ghost-doc export --format obsidian --vault-path ~/Notes [--project name]
 *   ghost-doc export --format notion --token <TOKEN> --page-id <ID> [--project name]
 *   ghost-doc export --format confluence --url <URL> --space <KEY> --token <TOKEN> [--email <EMAIL>] [--project name]
 *   ghost-doc snapshot [--port 3001]
 *   ghost-doc share <snapshot-id>
 *   ghost-doc load <encoded>
 *   ghost-doc contract infer [--function fn] [--min-samples N] [--format json-schema|typescript|yaml] [--out file]
 *   ghost-doc contract validate --contract <file> [--on-violation report|exit-1]
 *   ghost-doc contract export --function <fn> [--format yaml] [--out file]
 *   ghost-doc mock record --name <name> [--functions fn1,fn2] [--max-calls N]
 *   ghost-doc mock serve --session <name> --port 8080 [--mode exact|round-robin|latency-preserving]
 *   ghost-doc mock generate --session <name> --output <file> --target jest|vitest|pytest
 *   ghost-doc mock diff <session-a> <session-b> [--threshold N]
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Command } from "commander";
import kleur from "kleur";
import {
  exportContract,
  loadContract,
  generateMocks,
  loadSession,
  serveMocks,
  diffSessions,
  isBreaking,
} from "@ghost-doc/contractum";

import {
  buildGraph,
  buildHtmlDoc,
  buildMarkdownDoc,
  buildShareUrl,
  decodeSnapshot,
  encodeSnapshot,
  parseShareUrl,
  syncToConfluence,
  syncToNotion,
  syncToObsidian,
  type SpanInput,
} from "@ghost-doc/exporter";

import { GhostDocHub } from "./server.js";

// ---------------------------------------------------------------------------
// PID file helpers
// ---------------------------------------------------------------------------

const GHOST_DOC_DIR = path.join(os.homedir(), ".ghost-doc");
const PID_FILE = path.join(GHOST_DOC_DIR, "hub.pid");

/** Expand a leading ~ to the user's home directory (cross-platform). */
function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

async function writePid(): Promise<void> {
  await fs.mkdir(GHOST_DOC_DIR, { recursive: true });
  await fs.writeFile(PID_FILE, String(process.pid), "utf-8");
}

async function clearPid(): Promise<void> {
  await fs.rm(PID_FILE, { force: true });
}

async function readPid(): Promise<number | null> {
  try {
    const raw = await fs.readFile(PID_FILE, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hub REST helpers
// ---------------------------------------------------------------------------

async function fetchSpans(port: number, limit = 5000): Promise<SpanInput[]> {
  const url = `http://127.0.0.1:${port}/traces?limit=${limit}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    console.error(
      kleur.red("✗") +
        " Hub is not reachable — run " +
        kleur.cyan("npx ghost-doc start") +
        " first.",
    );
    process.exit(1);
  }
  if (!res.ok) {
    console.error(kleur.red("✗") + ` Hub returned HTTP ${res.status}`);
    process.exit(1);
  }
  return (await res.json()) as SpanInput[];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program.name("ghost-doc").description("Ghost Doc — black-box documentation tool").version("0.1.0");

// ── start ──────────────────────────────────────────────────────────────────

program
  .command("start")
  .description("Start the Ghost Doc Hub server")
  .option("-p, --port <number>", "Port to listen on", "3001")
  .option("--no-open", "Do not open the Dashboard in the browser")
  .action(async (opts: { port: string; open: boolean }) => {
    const port = parseInt(opts.port, 10);
    const hub = new GhostDocHub({ port });

    // Graceful shutdown on Ctrl-C
    const shutdown = async () => {
      process.stdout.write("\n");
      console.log(kleur.yellow("Shutting down Ghost Doc Hub…"));
      await hub.stop();
      await clearPid();
      process.exit(0);
    };

    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());

    try {
      await hub.start();
    } catch (err) {
      console.error(kleur.red("✗") + " Failed to start Hub:", (err as Error).message);
      process.exit(1);
    }

    await writePid();

    const baseUrl = `http://127.0.0.1:${port}`;

    console.log(
      "\n" +
        kleur.bold().white("Ghost Doc Hub") +
        " " +
        kleur.green("running") +
        "\n" +
        kleur.gray("  REST  →  ") +
        kleur.cyan(baseUrl) +
        "\n" +
        kleur.gray("  Agents →  ") +
        kleur.cyan(`ws://127.0.0.1:${port}/agent`) +
        "\n",
    );

    if (opts.open) {
      // Dynamic import keeps `open` out of the critical startup path.
      const { default: openBrowser } = await import("open");
      await openBrowser(baseUrl);
    }

    // Live status line — updates in place every second.
    setInterval(() => {
      const s = hub.getStatus();
      const agents = s.agents.length > 0 ? kleur.cyan(s.agents.join(", ")) : kleur.gray("none");
      process.stdout.write(
        `\r${kleur.gray("→")} agents: ${agents}` +
          `  traces: ${kleur.white(String(s.traces_total))}` +
          `  rate: ${kleur.green(s.traces_per_second + "/s")}` +
          `  dashboards: ${kleur.white(String(s.dashboard_clients))}  `,
      );
    }, 1_000);

    // Keep the process alive.
    await new Promise<never>(() => undefined);
  });

// ── stop ───────────────────────────────────────────────────────────────────

program
  .command("stop")
  .description("Stop the running Ghost Doc Hub")
  .action(async () => {
    const pid = await readPid();
    if (pid === null) {
      console.error(kleur.red("✗") + " Hub is not running (no PID file found).");
      process.exit(1);
    }

    try {
      process.kill(pid, "SIGTERM");
      console.log(kleur.green("✓") + ` Hub (PID ${pid}) stopped.`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        console.warn(kleur.yellow("⚠") + " Process was already gone — cleaning up PID file.");
        await clearPid();
      } else {
        console.error(kleur.red("✗") + " Could not stop Hub:", (err as Error).message);
        process.exit(1);
      }
    }
  });

// ── status ─────────────────────────────────────────────────────────────────

program
  .command("status")
  .description("Show the status of the running Hub")
  .option("-p, --port <number>", "Hub port", "3001")
  .action(async (opts: { port: string }) => {
    const url = `http://127.0.0.1:${opts.port}/health`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as {
        status: string;
        agents: number;
        traces_total: number;
      };

      console.log(kleur.green("✓") + " Ghost Doc Hub is running");
      console.log(`  Agents connected : ${kleur.cyan(String(data.agents))}`);
      console.log(`  Total traces     : ${kleur.white(String(data.traces_total))}`);
    } catch {
      console.error(
        kleur.red("✗") +
          " Hub is not reachable — run " +
          kleur.cyan("npx ghost-doc start") +
          " first.",
      );
      process.exit(1);
    }
  });

// ── export ─────────────────────────────────────────────────────────────────

program
  .command("export")
  .description("Export flow documentation from the running Hub")
  .option("-p, --port <number>", "Hub port", "3001")
  .option(
    "-f, --format <format>",
    "Output format: markdown | html | obsidian | notion | confluence",
    "markdown",
  )
  .option("-o, --output <path>", "Output file path (markdown format only)")
  .option("--project <name>", "Project name used in the document title", "Project")
  .option("--limit <number>", "Max number of spans to fetch", "5000")
  // obsidian
  .option("--vault-path <path>", "Obsidian vault root path (obsidian format)")
  // notion
  .option("--token <token>", "API token (notion / confluence formats)")
  .option("--page-id <id>", "Notion page ID (notion format)")
  // confluence
  .option("--url <url>", "Confluence base URL (confluence format)")
  .option("--space <key>", "Confluence space key (confluence format)")
  .option("--email <email>", "Confluence user email for Basic auth (confluence format)")
  .action(
    async (opts: {
      port: string;
      format: string;
      output?: string;
      project: string;
      limit: string;
      vaultPath?: string;
      token?: string;
      pageId?: string;
      url?: string;
      space?: string;
      email?: string;
    }) => {
      const port = parseInt(opts.port, 10);
      const limit = parseInt(opts.limit, 10);
      const spans = await fetchSpans(port, limit);
      const graph = buildGraph(spans);

      console.log(
        kleur.gray("→") +
          ` Building graph from ${spans.length} spans` +
          ` (${graph.nodes.length} nodes, ${graph.edges.length} edges)…`,
      );

      switch (opts.format) {
        case "markdown": {
          const md = buildMarkdownDoc(graph, opts.project, { rootPath: process.cwd() });

          if (opts.output) {
            const outPath = expandHome(opts.output);
            await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
            await fs.writeFile(outPath, md, "utf-8");
            console.log(kleur.green("✓") + " Markdown written to " + kleur.cyan(outPath));
          } else {
            // Print to stdout when no output path is given
            process.stdout.write(md + "\n");
          }
          break;
        }

        case "html": {
          const html = buildHtmlDoc(graph, { projectName: opts.project });
          const outPath = expandHome(opts.output ?? "FLOW.html");
          await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
          await fs.writeFile(outPath, html, "utf-8");
          console.log(kleur.green("✓") + " Interactive HTML written to " + kleur.cyan(outPath));
          break;
        }

        case "obsidian": {
          if (!opts.vaultPath) {
            console.error(kleur.red("✗") + " --vault-path is required for obsidian format.");
            process.exit(1);
          }
          const filePath = await syncToObsidian(graph, {
            vaultPath: expandHome(opts.vaultPath),
            projectName: opts.project,
            rootPath: process.cwd(),
          });
          console.log(kleur.green("✓") + " Written to Obsidian vault: " + kleur.cyan(filePath));
          break;
        }

        case "notion": {
          if (!opts.token || !opts.pageId) {
            console.error(
              kleur.red("✗") + " --token and --page-id are required for notion format.",
            );
            process.exit(1);
          }
          await syncToNotion(graph, {
            token: opts.token,
            pageId: opts.pageId,
            projectName: opts.project,
          });
          console.log(kleur.green("✓") + " Notion page updated.");
          break;
        }

        case "confluence": {
          if (!opts.url || !opts.space || !opts.token) {
            console.error(
              kleur.red("✗") + " --url, --space, and --token are required for confluence format.",
            );
            process.exit(1);
          }
          await syncToConfluence(graph, {
            url: opts.url,
            spaceKey: opts.space,
            token: opts.token,
            ...(opts.email !== undefined ? { email: opts.email } : {}),
            projectName: opts.project,
          });
          console.log(kleur.green("✓") + " Confluence page created/updated.");
          break;
        }

        default:
          console.error(
            kleur.red("✗") +
              ` Unknown format "${opts.format}". Use: markdown | html | obsidian | notion | confluence`,
          );
          process.exit(1);
      }
    },
  );

// ── snapshot ────────────────────────────────────────────────────────────────

program
  .command("snapshot")
  .description("Save a snapshot of the current trace buffer to disk")
  .option("-p, --port <number>", "Hub port", "3001")
  .action(async (opts: { port: string }) => {
    const port = parseInt(opts.port, 10);
    const url = `http://127.0.0.1:${port}/snapshot`;

    let res: Response;
    try {
      res = await fetch(url, { method: "POST" });
    } catch {
      console.error(
        kleur.red("✗") +
          " Hub is not reachable — run " +
          kleur.cyan("npx ghost-doc start") +
          " first.",
      );
      process.exit(1);
    }

    if (!res.ok) {
      console.error(kleur.red("✗") + ` Hub returned HTTP ${res.status}`);
      process.exit(1);
    }

    const data = (await res.json()) as { id: string; path: string; spans: number };
    console.log(kleur.green("✓") + " Snapshot saved");
    console.log(`  ID      : ${kleur.cyan(data.id)}`);
    console.log(`  Path    : ${kleur.gray(data.path)}`);
    console.log(`  Spans   : ${kleur.white(String(data.spans))}`);
    console.log(`\n  ${kleur.gray("To share:")} ghost-doc share ${kleur.cyan(data.id)}`);
  });

// ── share ───────────────────────────────────────────────────────────────────

program
  .command("share <snapshot-id>")
  .description("Encode a snapshot as a shareable URL fragment")
  .action(async (snapshotId: string) => {
    const snapshotsDir = path.join(GHOST_DOC_DIR, "snapshots");
    const filePath = path.join(snapshotsDir, `${snapshotId}.json`);

    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      console.error(kleur.red("✗") + ` Snapshot not found: ${filePath}`);
      process.exit(1);
    }

    const snapshot = JSON.parse(raw) as object;
    const encoded = encodeSnapshot(snapshot as Parameters<typeof encodeSnapshot>[0]);
    const shareUrl = buildShareUrl(encoded);

    console.log(kleur.green("✓") + " Share URL generated");
    console.log("");
    console.log(shareUrl);
    console.log("");
    console.log(kleur.gray("  Recipient can load this with: ghost-doc load <encoded>"));
  });

// ── load ────────────────────────────────────────────────────────────────────

program
  .command("load <encoded>")
  .description("Load a shared snapshot into the running Dashboard")
  .option("-p, --port <number>", "Hub port", "3001")
  .option("-o, --output <path>", "Write decoded snapshot to file instead of sending to Hub")
  .action(async (encoded: string, opts: { port: string; output?: string }) => {
    // Strip the ghost-doc:// prefix if a full share URL was pasted
    const payload = parseShareUrl(encoded) ?? encoded;

    let snapshot: ReturnType<typeof decodeSnapshot>;
    try {
      snapshot = decodeSnapshot(payload);
    } catch (err) {
      console.error(kleur.red("✗") + " Failed to decode snapshot: " + (err as Error).message);
      process.exit(1);
    }

    if (opts.output) {
      const outPath = expandHome(opts.output);
      await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
      await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2), "utf-8");
      console.log(kleur.green("✓") + " Snapshot written to " + kleur.cyan(outPath));
      return;
    }

    // POST the snapshot to the Hub's /snapshots/load endpoint so the
    // Dashboard can time-travel into it.
    const port = parseInt(opts.port, 10);
    const url = `http://127.0.0.1:${port}/snapshots/load`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
    } catch {
      console.error(
        kleur.red("✗") +
          " Hub is not reachable — run " +
          kleur.cyan("npx ghost-doc start") +
          " first.",
      );
      process.exit(1);
    }

    if (!res.ok) {
      console.error(kleur.red("✗") + ` Hub returned HTTP ${res.status}`);
      process.exit(1);
    }

    console.log(
      kleur.green("✓") +
        ` Snapshot loaded (${snapshot.spans.length} spans). Open the Dashboard to explore.`,
    );
  });

// ---------------------------------------------------------------------------
// Shared helper: require hub reachability, exit 1 if not
// ---------------------------------------------------------------------------

async function requireHub(port: number): Promise<void> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    console.error(
      kleur.red("✗") +
        " Hub is not reachable — run " +
        kleur.cyan("npx ghost-doc start") +
        " first.",
    );
    process.exit(1);
  }
}

async function hubGet<T>(port: number, endpoint: string): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    console.error(
      kleur.red("✗") +
        ` Hub returned HTTP ${res.status}: ${String(body["error"] ?? body["message"] ?? "")}`,
    );
    process.exit(1);
  }
  return res.json() as Promise<T>;
}

async function hubPost<T>(port: number, endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    console.error(
      kleur.red("✗") +
        ` Hub returned HTTP ${res.status}: ${String(b["error"] ?? b["message"] ?? "")}`,
    );
    process.exit(1);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// contract — subcommand group
// ---------------------------------------------------------------------------

const contractCmd = program
  .command("contract")
  .description("Infer, validate, and export behavioral contracts from recorded spans");

// ghost-doc contract infer
contractCmd
  .command("infer")
  .description("Infer a JSON Schema contract from recorded spans")
  .option("-p, --port <number>", "Hub port", "3001")
  .option("--function <name>", "Only infer for this function name")
  .option("--min-samples <n>", "Minimum calls required", "5")
  .option("--format <fmt>", "Output format: json-schema | typescript | yaml", "json-schema")
  .option("--out <file>", "Write output to file instead of stdout")
  .action(
    async (opts: {
      port: string;
      function?: string;
      minSamples: string;
      format: string;
      out?: string;
    }) => {
      const port = parseInt(opts.port, 10);
      await requireHub(port);

      const qs = new URLSearchParams({ min_samples: opts.minSamples });
      const endpoint = opts.function
        ? `/contracts/${encodeURIComponent(opts.function)}?${qs}`
        : `/contracts?${qs}`;

      const result = await hubGet<unknown>(port, endpoint);
      const contracts = Array.isArray(result) ? result : [result];

      if (contracts.length === 0) {
        console.log(kleur.yellow("⚠") + " No functions with enough samples found.");
        return;
      }

      let output = "";
      for (const c of contracts) {
        output += exportContract(
          loadContract(c),
          opts.format as "json-schema" | "typescript" | "yaml",
        );
        output += "\n";
      }

      if (opts.out) {
        await fs.mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
        await fs.writeFile(opts.out, output, "utf-8");
        console.log(kleur.green("✓") + " Contract written to " + kleur.cyan(opts.out));
      } else {
        process.stdout.write(output);
      }
    },
  );

// ghost-doc contract validate
contractCmd
  .command("validate")
  .description("Validate recent spans in the Hub against a saved contract")
  .option("-p, --port <number>", "Hub port", "3001")
  .requiredOption("--contract <file>", "Path to a contract JSON file")
  .option(
    "--on-violation <action>",
    'What to do on violations: "report" (default) or "exit-1"',
    "report",
  )
  .action(async (opts: { port: string; contract: string; onViolation: string }) => {
    const port = parseInt(opts.port, 10);
    await requireHub(port);

    let contractData: unknown;
    try {
      contractData = JSON.parse(await fs.readFile(expandHome(opts.contract), "utf-8"));
    } catch (err) {
      console.error(kleur.red("✗") + " Could not read contract file: " + (err as Error).message);
      process.exit(1);
    }

    const contract = loadContract(contractData);

    const result = await hubPost<{ violations: unknown[]; count: number }>(
      port,
      "/contracts/validate",
      { contract },
    );

    if (result.count === 0) {
      console.log(kleur.green("✓") + " No violations found.");
      return;
    }

    console.log(kleur.red("✗") + ` ${result.count} violation(s) found:`);
    for (const v of result.violations) {
      const vio = v as {
        functionName: string;
        spanId: string;
        violations: Array<{ path: string; rule: string; expected: string; received: string }>;
      };
      console.log(`\n  ${kleur.cyan(vio.functionName)} — span ${kleur.gray(vio.spanId)}`);
      for (const d of vio.violations) {
        console.log(
          `    ${kleur.yellow(d.path)} [${d.rule}] expected ${kleur.white(d.expected)}, got ${kleur.red(d.received)}`,
        );
      }
    }

    if (opts.onViolation === "exit-1") process.exit(1);
  });

// ghost-doc contract export
contractCmd
  .command("export")
  .description("Infer and save a contract to disk")
  .option("-p, --port <number>", "Hub port", "3001")
  .requiredOption("--function <name>", "Function name to infer from")
  .option("--format <fmt>", "Output format: json-schema | typescript | yaml", "json-schema")
  .option("--out <file>", "Output file path")
  .action(async (opts: { port: string; function: string; format: string; out?: string }) => {
    const port = parseInt(opts.port, 10);
    await requireHub(port);

    const contract = await hubGet<unknown>(port, `/contracts/${encodeURIComponent(opts.function)}`);

    const output = exportContract(
      loadContract(contract),
      opts.format as "json-schema" | "typescript" | "yaml",
    );
    const outPath =
      opts.out ??
      `${opts.function}.${opts.format === "yaml" ? "yaml" : opts.format === "typescript" ? "ts" : "json"}`;

    await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await fs.writeFile(outPath, output, "utf-8");
    console.log(kleur.green("✓") + ` Contract exported to ${kleur.cyan(outPath)}`);
  });

// ---------------------------------------------------------------------------
// mock — subcommand group
// ---------------------------------------------------------------------------

const mockCmd = program
  .command("mock")
  .description("Record sessions, serve HTTP mocks, generate test files, diff sessions");

// ghost-doc mock record
mockCmd
  .command("record")
  .description("Save current Hub spans as a named mock session")
  .option("-p, --port <number>", "Hub port", "3001")
  .requiredOption("--name <name>", "Session name")
  .option("--functions <list>", "Comma-separated list of function names to include")
  .option("--max-calls <n>", "Max calls per function to record")
  .action(async (opts: { port: string; name: string; functions?: string; maxCalls?: string }) => {
    const port = parseInt(opts.port, 10);
    await requireHub(port);

    const body: Record<string, unknown> = { name: opts.name };
    if (opts.functions) body["functions"] = opts.functions.split(",").map((s) => s.trim());
    if (opts.maxCalls) body["maxCallsPerFunction"] = parseInt(opts.maxCalls, 10);

    const result = await hubPost<{
      saved: string;
      name: string;
      callCount: number;
      startTime: string;
      endTime: string;
    }>(port, "/mock/sessions", body);

    console.log(kleur.green("✓") + " Session recorded");
    console.log(`  Name      : ${kleur.cyan(result.name)}`);
    console.log(`  Calls     : ${kleur.white(String(result.callCount))}`);
    console.log(`  Saved     : ${kleur.gray(result.saved)}`);
    console.log(
      `\n  ${kleur.gray("To replay:")} ghost-doc mock serve --session ${kleur.cyan(result.name)} --port 8080`,
    );
  });

// ghost-doc mock serve
mockCmd
  .command("serve")
  .description("Start an HTTP mock server replaying a saved session")
  .option("-p, --port <number>", "Hub port (to find sessions dir)", "3001")
  .requiredOption("--session <name>", "Session name to replay")
  .option("--mock-port <number>", "Port for the mock HTTP server", "8080")
  .option("--mode <mode>", "Replay mode: exact | round-robin | latency-preserving", "exact")
  .option("--fault-error-rate <n>", "Fraction (0–1) of calls that return a recorded error")
  .option("--fault-latency <n>", "Latency multiplier (e.g. 2.0 = double recorded delay)")
  .action(
    async (opts: {
      port: string;
      session: string;
      mockPort: string;
      mode: string;
      faultErrorRate?: string;
      faultLatency?: string;
    }) => {
      const hubPort = parseInt(opts.port, 10);
      await requireHub(hubPort);

      const session = await hubGet<unknown>(
        hubPort,
        `/mock/sessions/${encodeURIComponent(opts.session)}`,
      );
      const loaded = loadSession(session);

      const mockPort = parseInt(opts.mockPort, 10);
      const faultInjection: { errorRate?: number; latencyFactor?: number } = {};
      if (opts.faultErrorRate) faultInjection.errorRate = parseFloat(opts.faultErrorRate);
      if (opts.faultLatency) faultInjection.latencyFactor = parseFloat(opts.faultLatency);
      const hasFault = Object.keys(faultInjection).length > 0;

      const server = await serveMocks(mockPort, loaded, {
        mode: opts.mode as "exact" | "round-robin" | "latency-preserving",
        ...(hasFault ? { faultInjection } : {}),
      });

      console.log(kleur.green("✓") + " Mock server running at " + kleur.cyan(server.url));
      console.log(
        kleur.gray(
          `  Session: ${loaded.session}  Calls: ${loaded.calls.length}  Mode: ${opts.mode}`,
        ),
      );
      console.log(kleur.gray("  Press Ctrl+C to stop."));

      const shutdown = async () => {
        await server.stop();
        process.exit(0);
      };
      process.on("SIGINT", () => void shutdown());
      process.on("SIGTERM", () => void shutdown());

      // Keep alive
      await new Promise<never>(() => undefined);
    },
  );

// ghost-doc mock generate
mockCmd
  .command("generate")
  .description("Generate a static mock file (Jest / Vitest / pytest) from a saved session")
  .option("-p, --port <number>", "Hub port", "3001")
  .requiredOption("--session <name>", "Session name")
  .requiredOption("--output <file>", "Output file path")
  .option("--target <target>", "Target framework: jest | vitest | pytest", "vitest")
  .option("--one-call", "Use only the first recorded call per function", false)
  .action(
    async (opts: {
      port: string;
      session: string;
      output: string;
      target: string;
      oneCall: boolean;
    }) => {
      const port = parseInt(opts.port, 10);
      await requireHub(port);

      const session = await hubGet<unknown>(
        port,
        `/mock/sessions/${encodeURIComponent(opts.session)}`,
      );
      const loaded = loadSession(session);

      const code = generateMocks(loaded, {
        target: opts.target as "jest" | "vitest" | "pytest",
        oneCallPerFunction: opts.oneCall,
      });

      const mockOut = expandHome(opts.output);
      await fs.mkdir(path.dirname(path.resolve(mockOut)), { recursive: true });
      await fs.writeFile(mockOut, code, "utf-8");
      console.log(
        kleur.green("✓") +
          ` ${opts.target} mocks written to ${kleur.cyan(mockOut)}` +
          kleur.gray(` (${loaded.calls.length} calls)`),
      );
    },
  );

// ghost-doc mock diff
mockCmd
  .command("diff <session-a> <session-b>")
  .description("Compare two sessions and report behavioral differences")
  .option("-p, --port <number>", "Hub port", "3001")
  .option("--threshold <n>", "Latency regression threshold %", "20")
  .option("--on-regression <action>", '"report" (default) or "exit-1"', "report")
  .action(
    async (
      sessionA: string,
      sessionB: string,
      opts: { port: string; threshold: string; onRegression: string },
    ) => {
      const port = parseInt(opts.port, 10);
      await requireHub(port);

      const [rawA, rawB] = await Promise.all([
        hubGet<unknown>(port, `/mock/sessions/${encodeURIComponent(sessionA)}`),
        hubGet<unknown>(port, `/mock/sessions/${encodeURIComponent(sessionB)}`),
      ]);

      const a = loadSession(rawA);
      const b = loadSession(rawB);
      const threshold = parseInt(opts.threshold, 10);
      const diff = diffSessions(a, b, 0);
      const breaking = isBreaking(diff, threshold);

      console.log(`\nDiff: ${kleur.cyan(a.session)} → ${kleur.cyan(b.session)}\n`);

      if (diff.addedFunctions.length > 0) {
        console.log(kleur.green("+ Added functions:"), diff.addedFunctions.join(", "));
      }
      if (diff.removedFunctions.length > 0) {
        console.log(kleur.red("- Removed functions:"), diff.removedFunctions.join(", "));
      }
      if (diff.changedReturnShapes.length > 0) {
        console.log(kleur.yellow("~ Changed return shapes:"));
        for (const c of diff.changedReturnShapes) {
          console.log(`  ${kleur.white(c.function)}`);
          console.log(`    before: ${JSON.stringify(c.before)}`);
          console.log(`    after : ${JSON.stringify(c.after)}`);
        }
      }
      if (diff.changedErrorRate.length > 0) {
        console.log(kleur.yellow("~ Changed error rates:"));
        for (const c of diff.changedErrorRate) {
          const pct = (c.after * 100).toFixed(1);
          console.log(`  ${kleur.white(c.function)}: ${(c.before * 100).toFixed(1)}% → ${pct}%`);
        }
      }
      if (diff.latencyRegression.length > 0) {
        console.log(kleur.yellow("~ Latency regressions:"));
        for (const r of diff.latencyRegression) {
          const flag = r.changePercent >= threshold ? kleur.red("⚠") : kleur.gray("");
          console.log(
            `  ${flag} ${kleur.white(r.function)}: P95 ${r.beforeP95Ms}ms → ${r.afterP95Ms}ms (+${r.changePercent}%)`,
          );
        }
      }

      if (
        diff.addedFunctions.length === 0 &&
        diff.removedFunctions.length === 0 &&
        diff.changedReturnShapes.length === 0 &&
        diff.changedErrorRate.length === 0 &&
        diff.latencyRegression.length === 0
      ) {
        console.log(kleur.green("✓") + " No differences detected.");
      }

      if (breaking && opts.onRegression === "exit-1") {
        console.error(kleur.red("\n✗ Breaking changes detected — exiting with code 1."));
        process.exit(1);
      }
    },
  );

// ghost-doc mock list
mockCmd
  .command("list")
  .description("List all saved mock sessions")
  .option("-p, --port <number>", "Hub port", "3001")
  .action(async (opts: { port: string }) => {
    const port = parseInt(opts.port, 10);
    await requireHub(port);

    const sessions = await hubGet<
      Array<{ name: string; session: string; callCount: number; startTime: string }>
    >(port, "/mock/sessions");

    if (sessions.length === 0) {
      console.log(kleur.gray("No sessions saved yet."));
      console.log(kleur.gray("  Run: ghost-doc mock record --name my-session"));
      return;
    }

    console.log(`\n${kleur.bold("Saved sessions:")}\n`);
    for (const s of sessions) {
      console.log(
        `  ${kleur.cyan(s.name)}  ${kleur.gray(s.session)}  ${kleur.white(String(s.callCount))} calls  ${kleur.gray(s.startTime)}`,
      );
    }
  });

program.parse(process.argv);
