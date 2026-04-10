# Octogent

Octogent is a web-first local control surface for coordinating multiple coding agents in parallel.

## Install

Octogent is being prepared for a normal public CLI flow:

```bash
npm install -g octogent
```

Current runtime requirements:

- Node.js 22+
- `claude` installed for Claude-backed terminals
- `codex` installed for Codex-backed terminals
- `git` for worktree terminals
- `gh` for GitHub pull request features
- `curl` for the current Claude hook callback flow

On startup, Octogent now runs a prerequisite preflight:

- startup fails if neither `claude` nor `codex` is installed
- startup warns when optional integrations such as `git`, `gh`, or `curl` are unavailable

## Start

From any project directory:

```bash
octogent
```

On first run, Octogent now:

- creates a local `.octogent/` scaffold automatically
- writes a stable per-project ID to `.octogent/project.json`
- stores global runtime state in `~/.octogent/projects/<project-id>/`
- chooses an available local API port starting at `8787`
- persists the actual bound API address for follow-up CLI commands
- opens the web UI automatically unless `OCTOGENT_NO_OPEN=1` is set

Useful commands:

```bash
octogent init [project-name]
octogent projects
octogent tentacle create <name>
octogent tentacle list
octogent terminal create --name "Planner"
octogent channel send <terminal-id> "message"
```

## Persistence

Octogent now separates project-local and global data intentionally:

- `.octogent/` holds local project metadata, tentacle docs, and worktrees
- `~/.octogent/projects/<project-id>/state/` holds runtime state, transcripts, monitor/cache data, and active runtime metadata
- `~/.octogent/projects.json` maps stable project IDs to local paths

This avoids collisions between unrelated repositories that share the same display name.

## Claude Integration

Claude Code hook installation is now scoped to Claude-backed terminals only.

When Octogent installs Claude hooks, it:

- writes to `.claude/settings.json` only in the relevant workspace
- merges Octogent hook entries into existing settings instead of overwriting the file
- keeps the integration local to the workspace or worktree being used by that terminal

## Contributors

For monorepo development:

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm lint
```

`pnpm dev` still runs the API and web app in workspace mode for contributors.
