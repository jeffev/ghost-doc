# CLI Reference

All commands are available via `npx ghost-doc <command>` or `ghost-doc <command>` if installed globally.

## `ghost-doc start`

Starts the Hub server and opens the Dashboard in the default browser.

```bash
ghost-doc start [options]
```

| Option            | Default                    | Description                           |
| :---------------- | :------------------------- | :------------------------------------ |
| `--port <n>`      | `3001`                     | Port for Hub server and Dashboard     |
| `--no-open`       | —                          | Do not open the browser automatically |
| `--config <path>` | `~/.ghost-doc/config.json` | Path to config file                   |

## `ghost-doc stop`

Gracefully shuts down a running Hub process.

```bash
ghost-doc stop
```

## `ghost-doc status`

Displays connected agents, trace count, and trace rate.

```bash
ghost-doc status
```

**Output example:**

```
Ghost Doc Hub — running on port 3001
  Agents:       2 connected (backend-api, python-service)
  Traces total: 1,847
  Trace rate:   12.4 / sec
```

## `ghost-doc export`

Exports the current call graph to a documentation format.

```bash
ghost-doc export [options]
```

| Option             | Description                                                    |
| :----------------- | :------------------------------------------------------------- |
| `--format <fmt>`   | `markdown` \| `html` \| `notion` \| `obsidian` \| `confluence` |
| `--output <path>`  | Output file path (for markdown / obsidian)                     |
| `--project <name>` | Project name used in the export header                         |
| `--agent <id>`     | Export only traces from this agent                             |
| `--since <iso>`    | Export only traces after this timestamp                        |
| `--token <t>`      | API token (Notion / Confluence)                                |
| `--page-id <id>`   | Target page ID (Notion)                                        |
| `--url <base>`     | Base URL (Confluence)                                          |
| `--space <key>`    | Space key (Confluence)                                         |
| `--vault-path <p>` | Obsidian vault path                                            |

**Examples:**

```bash
# Markdown + Mermaid
ghost-doc export --format markdown --output FLOW.md --project MyApp

# Self-contained HTML (opens in any browser)
ghost-doc export --format html --output FLOW.html --project MyApp

# Notion
ghost-doc export --format notion --token secret_xxx --page-id abc123

# Obsidian
ghost-doc export --format obsidian --vault-path ~/Notes

# Confluence
ghost-doc export --format confluence \
  --url https://myorg.atlassian.net \
  --space ENG \
  --token xxx
```

## `ghost-doc snapshot`

Saves the current in-memory trace buffer to disk.

```bash
ghost-doc snapshot [--output <path>]
```

## `ghost-doc snapshots list`

Lists all saved snapshots with their IDs, timestamps, and span counts.

## `ghost-doc load <id>`

Loads a saved snapshot into the Dashboard for time-travel replay.

```bash
ghost-doc load 2024-01-15T10-30-00-000Z
```

## `ghost-doc share <id>`

Encodes a snapshot as a base64 URL fragment for sharing.

```bash
ghost-doc share 2024-01-15T10-30-00-000Z
# → https://jeffev.github.io/ghost-doc/view#eyJ...
```
