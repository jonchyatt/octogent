# Octogent

Octogent is a web-first command surface for running and coordinating multiple coding agents in parallel.

This repository is currently a scratch baseline built with:

- TypeScript + Node.js 22+
- pnpm workspace
- Vite + React frontend
- ports-and-adapters core package
- Vitest and Biome

Current UI baseline includes:

- a left dashboard deck for `Active Agents`
- tentacle-grouped agent listings in that deck
- keyboard/mouse-resizable and toggleable sidebar behavior
- `New tentacle` creation from the top bar with immediate inline naming
- in-place tentacle rename from each column header (stable id + editable name)
- tentacle delete action from each column header
- tentacle minimize from header and maximize from the `Active Agents` sidebar
- minimum-width tentacle columns with horizontal scrolling when space is constrained
- draggable tentacle splitters that resize adjacent panes

## Quickstart

```bash
pnpm install
pnpm start
```

Open `http://localhost:5173`.

In dev mode:

- `apps/api` runs on `http://127.0.0.1:8787`.
- `apps/web` runs on `http://localhost:5173` and proxies `/api` and terminal websocket traffic to `apps/api`.
- `apps/api` requires `tmux` on `PATH` for terminal persistence.
- Runtime endpoints:
  - `GET /api/agent-snapshots`
  - `POST /api/tentacles` (`{ "name"?: string }`)
  - `PATCH /api/tentacles/:tentacleId` (`{ "name": string }`)
  - `DELETE /api/tentacles/:tentacleId`
  - `WS /api/terminals/:tentacleId/ws`

Set `VITE_OCTOGENT_API_ORIGIN` to route runtime calls directly to an external backend.

## Common workflows

```bash
pnpm test
pnpm lint
pnpm build
pnpm format
```

GitHub Actions runs the same `lint`, `test`, and `build` checks on pushes to `main` and on pull requests.

## Repo layout

- `apps/web` - web UI shell
- `apps/api` - runtime API service with tmux-backed persistent tentacle terminals
- `packages/core` - application/domain/ports/adapters core logic
- `docs` - contributor and architecture documentation
- `context` - long-term project context and decisions
