import { Client } from "@notionhq/client";
import { buildMermaidDiagram } from "./mermaid.js";
import type { ExportGraph } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotionSyncOptions {
  /** Notion integration token (starts with `secret_`) */
  token: string;
  /** ID of the Notion page where docs will be created/updated */
  pageId: string;
  /** Optional project name used as the page title prefix */
  projectName?: string;
}

// ---------------------------------------------------------------------------
// Notion block builders (subset of the Notion block API)
// ---------------------------------------------------------------------------

function headingBlock(text: string, level: 1 | 2 | 3) {
  const typeMap = { 1: "heading_1", 2: "heading_2", 3: "heading_3" } as const;
  return {
    object: "block" as const,
    type: typeMap[level],
    [typeMap[level]]: {
      rich_text: [{ type: "text" as const, text: { content: text } }],
    },
  };
}

function paragraphBlock(text: string) {
  return {
    object: "block" as const,
    type: "paragraph" as const,
    paragraph: {
      rich_text: [{ type: "text" as const, text: { content: text } }],
    },
  };
}

function codeBlock(code: string, language = "plain text") {
  return {
    object: "block" as const,
    type: "code" as const,
    code: {
      rich_text: [{ type: "text" as const, text: { content: code } }],
      language,
    },
  };
}

function tableBlock(headers: string[], rows: string[][]): object[] {
  const tableWidth = headers.length;

  const headerRow = {
    object: "block" as const,
    type: "table_row" as const,
    table_row: {
      cells: headers.map((h) => [{ type: "text" as const, text: { content: h } }]),
    },
  };

  const dataRows = rows.map((row) => ({
    object: "block" as const,
    type: "table_row" as const,
    table_row: {
      cells: row.map((cell) => [{ type: "text" as const, text: { content: cell } }]),
    },
  }));

  return [
    {
      object: "block" as const,
      type: "table" as const,
      table: {
        table_width: tableWidth,
        has_column_header: true,
        has_row_header: false,
        children: [headerRow, ...dataRows],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

/**
 * Creates or updates a Notion page with Ghost Doc flow documentation.
 *
 * Strategy: appends a new timestamped section each run (idempotent heading
 * search not feasible without full page traversal; callers can implement
 * archiving by deleting old sections via the Notion API).
 */
export async function syncToNotion(
  graph: ExportGraph,
  options: NotionSyncOptions,
): Promise<void> {
  const notion = new Client({ auth: options.token });
  const projectName = options.projectName ?? "Project";
  const timestamp = new Date(graph.generatedAt).toISOString();

  const mermaid = buildMermaidDiagram(graph);

  // Function index rows
  const tableRows = graph.nodes
    .sort((a, b) => a.agentId.localeCompare(b.agentId) || a.functionName.localeCompare(b.functionName))
    .map((n) => [
      n.functionName,
      n.agentId,
      `${n.file}:${n.line}`,
      `${n.avgDurationMs}ms`,
      String(n.callCount),
      n.hasAnomaly ? "yes" : "no",
    ]);

  const blocks: object[] = [
    headingBlock(`Ghost Doc — ${projectName}`, 2),
    paragraphBlock(
      `Generated: ${timestamp} | Agents: ${graph.agents.join(", ")} | Spans: ${graph.totalSpans}`,
    ),
    headingBlock("Flow Diagram", 3),
    // Notion does not render Mermaid natively — embed as code block.
    // Users can copy into https://mermaid.live for preview.
    codeBlock(mermaid, "plain text"),
    paragraphBlock("Paste the diagram above at https://mermaid.live to visualize it."),
    headingBlock("Function Index", 3),
    ...tableBlock(
      ["Function", "Agent", "File:Line", "Avg Duration", "Call Count", "Anomaly"],
      tableRows,
    ),
  ];

  if (graph.anomalyCount > 0) {
    const anomalyRows = graph.nodes
      .filter((n) => n.hasAnomaly)
      .map((n) => [n.functionName, n.agentId, `${n.file}:${n.line}`]);

    blocks.push(
      headingBlock("Anomalies", 3),
      paragraphBlock("Return type changes detected for the following functions:"),
      ...tableBlock(["Function", "Agent", "File:Line"], anomalyRows),
    );
  }

  await notion.blocks.children.append({
    block_id: options.pageId,
    children: blocks as Parameters<typeof notion.blocks.children.append>[0]["children"],
  });
}
