# Usage Guide

## Run local app

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:5173`.

`pnpm dev` starts both the web app and API service. By default the API listens on `127.0.0.1:8787` and the web app proxies `/api` traffic to it.
Terminal persistence requires `tmux` to be installed and available on `PATH`.

## Active Agents dashboard deck

- The left sidebar shows `Active Agents` grouped by tentacle.
- Each tentacle section lists its current agents and state badges.
- Show/hide from the top bar sidebar icon toggle button.
- Resize on desktop by dragging the sidebar right border.
- The `Active Agents` sidebar footer includes a retro terminal-style Codex token usage bar (`5h`, `week`, `credits`) that refreshes every 1 minute.
- Codex usage is sourced from local Codex OAuth credentials (`~/.codex/auth.json` or `CODEX_HOME/auth.json`) through `GET /api/codex/usage`.

## Create tentacles

- Use the top bar `New tentacle` button to spawn a new tentacle.
- Fresh workspaces start with no tentacles; create the first tentacle from the top bar.
- Tentacles keep unique incremental ids (`tentacle-1`, `tentacle-2`, ...) for internal routing, plus a separate display name you can edit.
- New tentacles appear with the default name selected inline so you can type a new name immediately.
- Rename by clicking a tentacle header name or the right-side `Rename` button, then edit inline (`Enter` to save, `Escape` to cancel).
- Minimize from the right-side `Minimize` button in the tentacle header.
- Maximize minimized tentacles from `Maximize` buttons in the `Active Agents` sidebar.
- Delete from the right-side `Delete` button in the tentacle header (with an in-app confirmation dialog).
- Each new tentacle starts with a root coding terminal session bootstrapped with `codex`.
- Tentacle metadata and tmux sessions persist across API restarts, so existing tentacles reconnect to the same terminal session.
- The board keeps each tentacle column above a minimum width and scrolls horizontally when columns exceed available space.
- Resize neighboring tentacles with the divider between columns (drag with pointer or use focused divider with arrow keys).

## Run quality checks

```bash
pnpm test
pnpm lint
pnpm build
```
