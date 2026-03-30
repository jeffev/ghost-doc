# Exporter

The Exporter converts your live call graph into permanent, shareable documentation.

## Markdown + Mermaid

Generates a Markdown file with an embedded Mermaid flowchart that renders natively on GitHub, GitLab, and most wiki platforms.

```bash
npx ghost-doc export --format markdown --output FLOW.md
npx ghost-doc export --format markdown --output FLOW.md --project MyApp
```

The output includes:
- **Mermaid flowchart** — nodes labeled with function names; edges labeled with avg duration
- **Function index table** — name, file, call count, avg duration, anomaly flag
- **Anomalies section** — any functions with detected type-change anomalies

## Snapshots

Save the current trace buffer to disk and restore it later.

```bash
# Save
npx ghost-doc snapshot
# → Saved to ~/.ghost-doc/snapshots/2024-01-15T10-30-00.json

# List saved snapshots
npx ghost-doc snapshots list

# Load a snapshot into the Dashboard (time-travel from snapshot)
npx ghost-doc load <snapshot-id>
```

## Snapshot sharing

Encode a snapshot as a URL fragment that anyone can open:

```bash
npx ghost-doc share <snapshot-id>
# → https://jeffev.github.io/ghost-doc/view#<base64-encoded-data>

npx ghost-doc load <encoded-url>
# → Restores snapshot into Dashboard
```

## Notion

```bash
npx ghost-doc export \
  --format notion \
  --token <NOTION_TOKEN> \
  --page-id <PAGE_ID>
```

Creates or updates a Notion page with the Mermaid block and function table. Re-running updates the same page (idempotent).

## Obsidian

```bash
npx ghost-doc export \
  --format obsidian \
  --vault-path ~/Notes
```

Writes `Ghost-Doc/<project-name>.md` into your Obsidian vault with an Obsidian-compatible Mermaid block.

## Confluence

```bash
npx ghost-doc export \
  --format confluence \
  --url https://your-org.atlassian.net \
  --space KEY \
  --token <CONFLUENCE_TOKEN>
```

Converts the Mermaid diagram to Confluence macro format and creates or updates the page.

## Filtering exports

All export commands accept:

| Flag | Description |
| :--- | :--- |
| `--project <name>` | Project name in the export header |
| `--agent <id>` | Export only traces from this agent |
| `--since <iso-date>` | Export only traces after this timestamp |
| `--output <path>` | Output file path (Markdown / Obsidian) |
