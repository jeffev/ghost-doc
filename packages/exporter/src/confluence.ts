import type { ExportGraph } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfluenceSyncOptions {
  /** Base URL of the Confluence instance (e.g. `https://yourcompany.atlassian.net/wiki`) */
  url: string;
  /** Space key (e.g. `DEV`) */
  spaceKey: string;
  /** Confluence API token (Basic auth: `email:token` base64 or Bearer token) */
  token: string;
  /** Email of the Confluence user (required for Basic auth) */
  email?: string;
  /** Optional project name used as the page title */
  projectName?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeader(options: ConfluenceSyncOptions): string {
  if (options.email) {
    const creds = Buffer.from(`${options.email}:${options.token}`).toString("base64");
    return `Basic ${creds}`;
  }
  return `Bearer ${options.token}`;
}

/**
 * Converts a Mermaid diagram to Confluence's `structured-macro` storage format.
 *
 * Note: Confluence does not have native Mermaid support. The macro below uses
 * the popular "Mermaid Diagrams for Confluence" add-on format. If the add-on
 * is not installed, the content falls back to a plain code block.
 */
function mermaidToConfluenceMacro(mermaidCode: string): string {
  return (
    `<ac:structured-macro ac:name="code">` +
    `<ac:parameter ac:name="language">mermaid</ac:parameter>` +
    `<ac:plain-text-body><![CDATA[${mermaidCode}]]></ac:plain-text-body>` +
    `</ac:structured-macro>`
  );
}

function buildConfluenceStorage(graph: ExportGraph, projectName: string): string {
  const timestamp = new Date(graph.generatedAt).toISOString();

  const mermaidMacro = mermaidToConfluenceMacro(
    graph.nodes.length > 0
      ? buildMermaidLines(graph)
      : "flowchart TD\n  empty[\"No spans recorded\"]",
  );

  const tableRows = graph.nodes
    .sort((a, b) => a.agentId.localeCompare(b.agentId) || a.functionName.localeCompare(b.functionName))
    .map(
      (n) =>
        `<tr>` +
        `<td>${escapeXml(n.functionName)}</td>` +
        `<td>${escapeXml(n.agentId)}</td>` +
        `<td><code>${escapeXml(`${n.file}:${n.line}`)}</code></td>` +
        `<td>${n.avgDurationMs}ms</td>` +
        `<td>${n.callCount}</td>` +
        `<td>${n.hasAnomaly ? "⚠ yes" : "no"}</td>` +
        `</tr>`,
    )
    .join("\n");

  return `
<h2>Ghost Doc — ${escapeXml(projectName)}</h2>
<p><em>Generated: ${timestamp} | Agents: ${escapeXml(graph.agents.join(", "))} | Spans: ${graph.totalSpans}</em></p>

<h3>Flow Diagram</h3>
${mermaidMacro}

<h3>Function Index</h3>
<table>
  <thead>
    <tr>
      <th>Function</th>
      <th>Agent</th>
      <th>File:Line</th>
      <th>Avg Duration</th>
      <th>Call Count</th>
      <th>Anomaly</th>
    </tr>
  </thead>
  <tbody>
    ${tableRows}
  </tbody>
</table>
`.trim();
}

function buildMermaidLines(graph: ExportGraph): string {
  const safeMermaidId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, "_");

  const nodeLines = graph.nodes
    .map((n) => `  ${safeMermaidId(n.id)}["${n.functionName}\\n${n.agentId}"]`)
    .join("\n");

  const edgeLines = graph.edges
    .map((e) => `  ${safeMermaidId(e.fromId)} -->|"${e.avgDurationMs}ms"| ${safeMermaidId(e.toId)}`)
    .join("\n");

  return `flowchart TD\n${nodeLines}\n${edgeLines}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

interface ConfluencePage {
  id: string;
  version: { number: number };
  title: string;
}

async function findPage(
  baseUrl: string,
  spaceKey: string,
  title: string,
  auth: string,
): Promise<ConfluencePage | null> {
  const url = `${baseUrl}/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&title=${encodeURIComponent(title)}&expand=version`;
  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Confluence API error (find): ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { results: ConfluencePage[] };
  return data.results[0] ?? null;
}

async function createPage(
  baseUrl: string,
  spaceKey: string,
  title: string,
  body: string,
  auth: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/rest/api/content`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      type: "page",
      title,
      space: { key: spaceKey },
      body: { storage: { value: body, representation: "storage" } },
    }),
  });
  if (!res.ok) throw new Error(`Confluence API error (create): ${res.status} ${await res.text()}`);
}

async function updatePage(
  baseUrl: string,
  pageId: string,
  title: string,
  body: string,
  version: number,
  auth: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/rest/api/content/${pageId}`, {
    method: "PUT",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      type: "page",
      title,
      version: { number: version + 1 },
      body: { storage: { value: body, representation: "storage" } },
    }),
  });
  if (!res.ok) throw new Error(`Confluence API error (update): ${res.status} ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

/**
 * Creates or updates a Confluence page with Ghost Doc documentation.
 *
 * Idempotent: if a page with the same title already exists in the space,
 * it is updated (version bumped) rather than duplicated.
 */
export async function syncToConfluence(
  graph: ExportGraph,
  options: ConfluenceSyncOptions,
): Promise<void> {
  const projectName = options.projectName ?? "Project";
  const pageTitle = `Ghost Doc — ${projectName}`;
  const auth = authHeader(options);
  const body = buildConfluenceStorage(graph, projectName);

  const existing = await findPage(options.url, options.spaceKey, pageTitle, auth);

  if (existing === null) {
    await createPage(options.url, options.spaceKey, pageTitle, body, auth);
  } else {
    await updatePage(options.url, existing.id, pageTitle, body, existing.version.number, auth);
  }
}
