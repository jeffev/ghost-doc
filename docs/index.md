---
layout: home

hero:
  name: "👻 Ghost Doc"
  text: "Your code's black box."
  tagline: Observe how your functions actually behave at runtime and turn that into visual documentation — automatically, without a single written comment.
  image:
    src: /favicon.svg
    alt: Ghost Doc
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Live Demo
      link: /demo.html
    - theme: alt
      text: GitHub
      link: https://github.com/jeffev/ghost-doc

features:
  - icon: 🔍
    title: Zero-annotation observability
    details: Add @trace to any function — sync, async, class method, or arrow function — and Ghost Doc captures everything automatically. No manual documentation required.

  - icon: 🌐
    title: Real-time flowchart
    details: Watch your call graph build itself as your application runs. The D3-powered dashboard shows every function, edge, timing, and error in real time.

  - icon: 🕵️
    title: Deep-dive inspector
    details: Click any node to see its inputs, outputs, duration stats, P95 latency, and error details per call. Anomalies are highlighted automatically.

  - icon: ⏱️
    title: Time-travel debugger
    details: Scrub back in time to see exactly what your system looked like at any moment. Replay at 0.5x, 1x, 2x, or 10x speed.

  - icon: 🐍
    title: Python & TypeScript
    details: Identical decorator API for both languages. The Python agent auto-extracts your docstring as the node description — no extra configuration.

  - icon: 📤
    title: Export anywhere
    details: Export your call graph to Markdown + Mermaid, Notion, Obsidian, or Confluence. All formats are updated automatically as your code evolves.
---

## How it works

```bash
# 1. Start the Hub — serves the dashboard at http://localhost:3001
npx ghost-doc start
```

```typescript
// 2. Instrument your code
import { createTracer } from "@ghost-doc/agent-js";

const tracer = createTracer({ agentId: "my-api" });

class UserService {
  @tracer.trace
  async getUser(id: string) {
    return db.find(id);
  }
}
```

```bash
# 3. Export your call graph as documentation
npx ghost-doc export --format markdown --output FLOW.md
```

Open `http://localhost:3001` to see the live call graph — that's it.

---

## Install

::: code-group

```bash [npm]
npm install ghost-doc          # Hub + CLI
npm install @ghost-doc/agent-js # JavaScript / TypeScript agent
```

```bash [pnpm]
pnpm add ghost-doc
pnpm add @ghost-doc/agent-js
```

```bash [pip]
pip install ghost-doc-agent    # Python agent
```

:::
