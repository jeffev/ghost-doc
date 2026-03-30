---
"ghost-doc": minor
"@ghost-doc/agent-js": minor
"@ghost-doc/exporter": minor
"@ghost-doc/shared-types": minor
---

Initial public release of Ghost Doc 0.1.0.

Ghost Doc is a black-box documentation library that observes real code behavior and generates visual and text documentation automatically — no annotations, no config files, no manual updates.

**What's included:**

- `ghost-doc` — Hub server + CLI (`npx ghost-doc start`) with bundled real-time dashboard on port 3001
- `@ghost-doc/agent-js` — TypeScript tracer with `@trace` decorator and `tracer.wrap()` for plain functions; supports sync, async, and generator functions
- `ghost-doc-agent` (Python) — Python tracer with `@tracer.trace` decorator; auto-extracts docstrings as descriptions
- `@ghost-doc/exporter` — Export call graphs to Markdown/Mermaid, Notion, Obsidian, and Confluence
- `@ghost-doc/shared-types` — Shared Zod-validated `TraceEvent` schema
