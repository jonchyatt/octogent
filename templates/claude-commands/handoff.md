---
description: Write a structured handoff snapshot for the next worker, then end the turn.
allowed-tools: Bash, Read, Glob
---

You are about to hand this tentacle off to a future worker. Context-burn is real and the next session needs to pick up exactly where you left off.

## What to do (in this order)

1. **Compute the handoff path.**
   - Directory: `${OCTOGENT_HANDOFF_DIR}` (env var injected by the Octogent runtime).
   - Filename: `handoff-<UTC-timestamp>.md` where the timestamp is `YYYYMMDDTHHMMSSZ`.
   - If `OCTOGENT_HANDOFF_DIR` is unset, fall back to `.octogent/handoffs/` under the current working directory.

2. **Capture git state.** Run these (don't fail the handoff if any fail — record what you got):
   ```bash
   git rev-parse --abbrev-ref HEAD
   git rev-parse --short HEAD
   git status --porcelain
   ```

3. **Write the handoff atomically.** Use a temp file then rename so a half-written handoff is never read by the next worker:
   ```bash
   mkdir -p "${OCTOGENT_HANDOFF_DIR:-.octogent/handoffs}"
   TS=$(date -u +%Y%m%dT%H%M%SZ)
   DIR="${OCTOGENT_HANDOFF_DIR:-.octogent/handoffs}"
   TMP="${DIR}/.handoff-${TS}.md.tmp"
   FINAL="${DIR}/handoff-${TS}.md"
   cat > "$TMP" <<'HANDOFF_EOF'
   <body — see template below>
   HANDOFF_EOF
   mv "$TMP" "$FINAL"
   ```

4. **End your turn.** Write a one-line acknowledgement (`Handoff written: handoff-<TS>.md`) and stop. Do NOT start new work.

## Required body template (fill every section, even if "(none)")

```markdown
# Handoff <UTC-timestamp>

Tentacle: <OCTOGENT_TENTACLE_ID or "(unknown)">
Octogent session: <OCTOGENT_SESSION_ID or "(unknown)">

## Completed this session
- <bullet per shipped change — what landed, where, commit SHA if known>

## In progress
- <file:line, function, what's mid-flight, what state it's in>

## Next concrete step
<single sentence — the next thing the next worker should type/do>

## Blockers / Open questions
- <bullet per blocker — name the file, the decision, who needs to answer>

## Git state
- Branch: <branch>
- HEAD: <short SHA>
- Dirty: <yes / no — paste `git status --porcelain` if yes, max ~30 lines>
```

## Rules

- **No prose narration.** The next worker will read this as a state file, not a story.
- **Paths must be absolute or repo-relative.** No "the file we were editing".
- **One handoff per invocation.** Don't append to a prior handoff — write a new file.
- **If you've shipped commits, name them.** SHAs survive; descriptions rot.
- **Atomic write or nothing.** Temp file + rename. A half-written handoff is worse than none.

---

> **Note:** This file lives at `templates/claude-commands/handoff.md` in the Octogent repo (the `.claude/` path is reserved by Claude Code's file-protection rules and can't be checked in). The runtime installs it as `<workerCwd>/.claude/commands/handoff.md` at terminal-create time so workers can invoke it as `/handoff`.
