# Getting Started

Ghost Doc instruments your functions at runtime and generates a live visual call graph — no annotations, no config files, no manual updates.

## Prerequisites

- **Node.js** 20+ and **npm** / **pnpm** (for the Hub and JS agent)
- **Python** 3.10+ (for the Python agent, optional)

## Step 1 — Install the Hub

The Hub is the server that aggregates traces and serves the dashboard.

```bash
npm install -g ghost-doc
# or use without installing:
npx ghost-doc start
```

## Step 2 — Start the Hub

```bash
npx ghost-doc start
# → Hub running at ws://localhost:3001/agent
# → Dashboard at http://localhost:3001
```

The dashboard opens in your browser automatically. It will update in real time as traces arrive.

## Step 3 — Instrument your code

Choose the agent for your language:

- **[JavaScript / TypeScript →](./agent-js)**
- **[Python →](./agent-python)**

## Step 4 — Generate documentation

Once you have traces, export them:

```bash
# Markdown + Mermaid (renders on GitHub)
npx ghost-doc export --format markdown --output FLOW.md

# Save a snapshot
npx ghost-doc snapshot
```

## Quick example (TypeScript)

```typescript
import { createTracer } from "@ghost-doc/agent-js";

const tracer = createTracer({ agentId: "my-app" });

class OrderService {
  @tracer.trace
  async placeOrder(userId: string, items: Item[]) {
    const user = await this.userService.getUser(userId);
    await this.inventory.reserve(items);
    return this.payment.charge(user.card, total(items));
  }
}
```

Run your app, then open `http://localhost:3001` to see the call graph.

## Quick example (Python)

```python
from ghost_doc_agent import Tracer

tracer = Tracer(agent_id="my-api")

@tracer.trace
def get_user(user_id: int) -> dict:
    """Fetches a full user record from the database."""
    return db.query("SELECT * FROM users WHERE id = ?", user_id)
```

The first line of the docstring is automatically used as the node description in the dashboard.

## Next steps

- Learn all decorator options → [Agent JS](./agent-js) / [Agent Python](./agent-python)
- Configure the Hub port, sanitization, and flush interval → [Hub & CLI](./hub)
- Export to Notion, Obsidian, or Confluence → [Exporter](./exporter)
