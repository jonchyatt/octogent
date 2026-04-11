# Installation

Octogent is a local Node.js project with a local API and web UI.

## Requirements

- Node.js `22+`
- `claude` for the supported workflow
- `git` for worktree terminals
- `gh` for GitHub pull request features
- `curl` for the current Claude hook callback flow

The current docs are Claude Code-first. Some provider plumbing exists in the codebase, but it is not the supported story yet.

## Local development install

```bash
pnpm install
```

## Global CLI install

```bash
npm install -g octogent
```

## First run behavior

Running `octogent` inside a project directory will:

- create `.octogent/` if it does not exist
- write a stable project ID to `.octogent/project.json`
- register the project under `~/.octogent/projects.json`
- move runtime state to `~/.octogent/projects/<project-id>/state/`
- choose an open local API port starting at `8787`
- open the browser unless `OCTOGENT_NO_OPEN=1`

## Startup rules

- startup fails if neither `claude` nor another supported provider binary is available
- startup warns when optional integrations like `git`, `gh`, or `curl` are missing

## Next step

- [Quickstart](quickstart.md)
