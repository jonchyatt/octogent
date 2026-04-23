# Context-burn hook (Phase 10.5.2)

Long-running Claude-code tentacles (multi-day builds) burn through their context window mid-work. Two complementary mechanisms keep work resumable:

| Mechanism | Trigger | Latency | Reliability |
|---|---|---|---|
| `/handoff` slash command | Worker invokes manually when it notices slow-down | Worker-paced | High — worker chooses the moment |
| `PreCompact` hook | Claude Code fires automatically just before auto-compaction | Late (~95% by default) | High — built into Claude Code |
| Server-side turn threshold | Octogent runtime counts `UserPromptSubmit` events; injects burn message after N turns | ~30% proxy | Medium — turn count is a rough proxy for context, but it doesn't depend on PreCompact firing |

The runtime installs all three when it spawns a `claude-code` worker. Workers don't need to opt in.

## Wiring (what `installHooksInDirectory` does)

For every `.claude` directory under a Claude-backed worker's cwd, the hook installer:

1. Writes `<cwd>/.claude/commands/handoff.md` (the slash-command spec — see `templates/claude-commands/handoff.md`).
2. Adds a `PreCompact` entry to `<cwd>/.claude/settings.json` `hooks` block:
   ```json
   {
     "PreCompact": [
       {
         "matcher": "*",
         "hooks": [
           {
             "type": "command",
             "command": "curl -s -X POST \"$OCTOGENT_API_ORIGIN/api/hooks/pre-compact?octogent_session=$OCTOGENT_SESSION_ID\" -H 'Content-Type: application/json' -d @- || true",
             "timeout": 5
           }
         ]
       }
     ]
   }
   ```
3. (Implicit, via `ptyEnvironment`) injects two env vars into the worker's PTY:
   - `OCTOGENT_TENTACLE_ID` — the tentacle the slash command should namespace its handoff under.
   - `OCTOGENT_HANDOFF_DIR` — absolute path the slash command writes into. The runtime guarantees this dir exists before the worker spawns.

## Server-side flow (what the API does)

When the API receives `POST /api/hooks/pre-compact?octogent_session=<id>`:

1. Resolve the session.
2. Mark the terminal as "context-burn-warned" so the threshold injector doesn't re-fire.
3. Inject a synthetic burn message via `writeInput`:
   ```
   [Octogent runtime: context-burn threshold reached. Run /handoff to write a handoff snapshot, then end your turn.]
   ```
4. Claude treats the injected text as a user prompt, runs `/handoff`, writes the handoff file, ends the turn naturally.

The `UserPromptSubmit` hook handler keeps a per-session turn counter. When the count crosses `OCTOGENT_HANDOFF_TURN_THRESHOLD` (default 25, override per-process), the same synthetic message fires once. The flag set in step 2 above is shared between the two paths so a single handoff event never fires twice.

## What we deliberately do NOT do

- **Force-kill the worker.** The hook politely asks Claude to invoke `/handoff` and end the turn. Claude's own response handles exit. Any path that calls `killSession` here would leave the handoff half-written and break the next worker's resume.
- **Apply to Codex exec-mode workers.** They're single-turn and exit at end of prompt — no context-burn surface. The hook installer skips non-`claude-code` providers.
- **Stitch multiple handoffs.** On respawn, the runtime reads the most recent handoff only. Older handoffs stay on disk for forensic value but aren't fed to the new worker.
- **Auto-respawn after handoff.** Phase 10.5.2 leaves respawn to Jon. The handoff file exists; the next time Jon starts a worker on this tentacle, the runtime preambles it.

## Resume preamble (what the next worker sees)

When `createTerminal` notices `<projectStateDir>/tentacles/<tentacleId>/handoff-*.md` files exist, it picks the most recent (by mtime, ties broken by filename), reads the body, and prepends to the new worker's `initialPrompt`:

```
# Prior handoff
<full body of the most recent handoff-*.md>

# Resume from this state:
<the operator-supplied initial prompt>
```

The next worker's first turn opens with the prior session's state already in context — no re-discovery needed.
