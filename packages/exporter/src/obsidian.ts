import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildMarkdownDoc } from "./markdown.js";
import type { ExportGraph } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ObsidianSyncOptions {
  /** Absolute path to the Obsidian vault root (e.g. `~/Notes`) */
  vaultPath: string;
  /** Project name — used as the filename and document title */
  projectName?: string;
  /** Workspace root for relative file paths in the generated doc (typically `process.cwd()`) */
  rootPath?: string;
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

/**
 * Writes Ghost Doc flow documentation into an Obsidian vault.
 *
 * Output path: `<vaultPath>/Ghost-Doc/<projectName>.md`
 *
 * Uses standard Mermaid code fences (` ```mermaid `) which Obsidian renders
 * natively when the "Mermaid" core plugin is enabled (default since v0.14).
 *
 * The file is overwritten on each run — previous content is replaced.
 */
export async function syncToObsidian(
  graph: ExportGraph,
  options: ObsidianSyncOptions,
): Promise<string> {
  const projectName = options.projectName ?? "Project";
  const homeDir = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~";
  const vaultPath = options.vaultPath.replace(/^~[/\\]/, homeDir + path.sep).replace(/^~$/, homeDir);

  const targetDir = path.join(vaultPath, "Ghost-Doc");
  await fs.mkdir(targetDir, { recursive: true });

  const filePath = path.join(targetDir, `${projectName}.md`);
  const mdOptions = options.rootPath !== undefined ? { rootPath: options.rootPath } : {};
  const content = buildMarkdownDoc(graph, projectName, mdOptions);

  await fs.writeFile(filePath, content, "utf-8");

  return filePath;
}
