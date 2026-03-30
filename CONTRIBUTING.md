# Contributing to Ghost Doc

Thank you for your interest in contributing! This document covers everything you need to get started.

## Prerequisites

- **Node.js** 20+
- **pnpm** 10+ (`npm install -g pnpm`)
- **Python** 3.10+ (for agent-python work)

## Getting started

```bash
git clone https://github.com/YOUR_ORG/ghost-doc.git
cd ghost-doc
pnpm install
```

## Repository structure

```
packages/
  shared-types/   # Zod TraceEvent schema — shared by all packages
  agent-js/       # TypeScript tracer (@trace decorator + tracer.wrap)
  agent-python/   # Python tracer (@tracer.trace decorator)
  hub/            # Fastify server + CLI (npx ghost-doc)
  dashboard/      # React + D3 real-time UI (bundled into hub/public)
  exporter/       # Markdown / Notion / Obsidian / Confluence export
  sample-app/     # Demo e-commerce app used for integration testing
```

## Running the stack locally

```bash
# Terminal 1 — start Hub + Dashboard
pnpm --filter ghost-doc dev

# Terminal 2 — run the sample app (generates traces)
pnpm --filter @ghost-doc/sample-app dev
```

The dashboard is available at `http://localhost:3001`.

## Development scripts

| Command | Description |
| :--- | :--- |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all test suites |
| `pnpm lint` | ESLint across the monorepo |
| `pnpm typecheck` | TypeScript type-check without emitting |
| `pnpm demo:build` | Full production build including dashboard copy |

### Per-package

```bash
pnpm --filter @ghost-doc/agent-js test
pnpm --filter ghost-doc build
```

### Python agent

```bash
cd packages/agent-python
pip install -e ".[dev]"
pytest
```

## Commit convention

We use [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must match:

```
<type>(<scope>): <subject>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

Examples:
```
feat(agent-js): add batching mode for trace emission
fix(hub): prevent fan-out crash on malformed span
docs: update Python quickstart with docstring example
```

The pre-commit hook enforces this via `commitlint`. If your commit is rejected, check the message format.

## Versioning and changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning.

When your PR introduces a user-visible change, add a changeset:

```bash
pnpm changeset
```

Select the affected packages, choose the bump type (`patch` / `minor` / `major`), and write a short summary. Commit the generated `.changeset/*.md` file alongside your code changes.

> Internal packages (`@ghost-doc/dashboard`, `@ghost-doc/sample-app`) are not published — skip them in the changeset prompt.

## Pull request checklist

- [ ] Tests pass: `pnpm test`
- [ ] No type errors: `pnpm typecheck`
- [ ] No lint errors: `pnpm lint`
- [ ] Changeset added (if user-facing change)
- [ ] Docs updated if the public API changed

## Project architecture

See [DOCS.md](DOCS.md) for the detailed architecture reference and [ROADMAP.md](ROADMAP.md) for planned work.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
