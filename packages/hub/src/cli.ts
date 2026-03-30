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
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Command } from "commander";
import kleur from "kleur";

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

program
  .name("ghost-doc")
  .description("Ghost Doc — black-box documentation tool")
  .version("0.1.0");

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
            await fs.mkdir(path.dirname(path.resolve(opts.output)), { recursive: true });
            await fs.writeFile(opts.output, md, "utf-8");
            console.log(kleur.green("✓") + " Markdown written to " + kleur.cyan(opts.output));
          } else {
            // Print to stdout when no output path is given
            process.stdout.write(md + "\n");
          }
          break;
        }

        case "html": {
          const html = buildHtmlDoc(graph, { projectName: opts.project });
          const outPath = opts.output ?? "FLOW.html";
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
            vaultPath: opts.vaultPath,
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
    console.log(
      `\n  ${kleur.gray("To share:")} ghost-doc share ${kleur.cyan(data.id)}`,
    );
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
      console.error(
        kleur.red("✗") + ` Snapshot not found: ${filePath}`,
      );
      process.exit(1);
    }

    const snapshot = JSON.parse(raw) as object;
    const encoded = encodeSnapshot(snapshot as Parameters<typeof encodeSnapshot>[0]);
    const shareUrl = buildShareUrl(encoded);

    console.log(kleur.green("✓") + " Share URL generated");
    console.log("");
    console.log(shareUrl);
    console.log("");
    console.log(
      kleur.gray(
        "  Recipient can load this with: ghost-doc load <encoded>",
      ),
    );
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
      await fs.mkdir(path.dirname(path.resolve(opts.output)), { recursive: true });
      await fs.writeFile(opts.output, JSON.stringify(snapshot, null, 2), "utf-8");
      console.log(kleur.green("✓") + " Snapshot written to " + kleur.cyan(opts.output));
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

program.parse(process.argv);
