# Operations Notes

## Troubleshooting

- If `pnpm test` fails with missing browser APIs, ensure the `jsdom` dependency is installed.
- If workspace package resolution fails, run `pnpm install` from the repository root (not inside a subpackage).
- If Node version is older than 22, switch runtime before running commands.
- If API startup fails with a tmux error, install `tmux` and verify `tmux -V` works in your shell.

## Quality gates

- CI workflow: `.github/workflows/ci.yml`
- Triggered on push to `main` and on pull requests.
- Runs `pnpm lint`, `pnpm test`, and `pnpm build`.

## Runtime persistence notes

- Tentacle metadata is persisted at `.octogent/state/tentacles.json`.
- Runtime restores tentacles from that registry on startup and does not auto-create a default tentacle.
- Each tentacle maps to a tmux session named `octogent.<tentacleId>`.
- Orphan tmux sessions without a registry entry are ignored.
- `DELETE /api/tentacles/:tentacleId` removes both registry state and the associated tmux session.

## Known limitations (scratch baseline)

- Production backend API and auth are not implemented yet.
