import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const HANDOFF_SLASH_COMMAND_FILENAME = "handoff.md";

// Phase 10.9.9a — auto-compact is ALWAYS destructive in a multi-turn
// worker (ratified Jarvis-side, see
// `memory/feedback/feedback_auto_compact_is_always_destructive.md`).
//
// Previously "30" which told Claude Code to auto-compact at 30% used, pairing
// with the PreCompact hook that injected `/handoff`. Problem: the auto-compact
// step itself scrambled the context window BEFORE the hook ran — the handoff
// was written from a compacted, lossy snapshot. S38/S39 Phase 10.8/10.9 Octogent
// commits shipped under this regime are drift-suspect.
//
// Fix: set the override to "99" so Claude's auto-compact effectively never
// fires, plus set `DISABLE_AUTOCOMPACT=1` (the canonical kill-switch Claude
// Code honors end-to-end). Worker handoffs move to external context-window
// monitoring (Phase 10.9.9c, pending). Until 10.9.9c lands, workers run until
// the full 1M window saturates OR the exec timeout fires — both are less
// destructive than a mid-turn compact.
export const HANDOFF_AUTO_COMPACT_PERCENT = "99";
export const HANDOFF_DISABLE_AUTOCOMPACT = "1";
export const CONTEXT_BURN_PROMPT_TEXT =
  "CONTEXT BURN THRESHOLD REACHED. Invoke /handoff now and exit.";
export const CONTEXT_BURN_PROMPT = `${CONTEXT_BURN_PROMPT_TEXT}\n`;

export const HANDOFF_SLASH_COMMAND_BODY = `---
description: Write a structured handoff snapshot for the next worker, then end the turn.
allowed-tools: Bash, Read, Glob
---

You are handing this Octogent tentacle to a future worker. Write one durable handoff file, then end your turn naturally.

## Steps

1. Resolve the handoff directory.
   - Prefer \`$OCTOGENT_HANDOFF_DIR\`.
   - If it is unset, use \`.octogent/tentacles/$OCTOGENT_TENTACLE_ID\` from the current workspace.
   - If \`$OCTOGENT_TENTACLE_ID\` is also unset, use \`.octogent/tentacles/unknown\`.

2. Capture git state. Do not fail the handoff if one command fails; record what you can.
   \`\`\`bash
   git rev-parse --abbrev-ref HEAD
   git rev-parse --short HEAD
   git status --porcelain
   \`\`\`

3. Write \`handoff-<UTC-basic-ISO-timestamp>.md\` atomically in the handoff directory. Use a temp file in the same directory, then rename it.
   \`\`\`bash
   TENTACLE_ID="\${OCTOGENT_TENTACLE_ID:-unknown}"
   DIR="\${OCTOGENT_HANDOFF_DIR:-.octogent/tentacles/\${TENTACLE_ID}}"
   mkdir -p "$DIR"
   TS="$(date -u +%Y%m%dT%H%M%SZ)"
   TMP="$DIR/.handoff-$TS.md.tmp"
   FINAL="$DIR/handoff-$TS.md"
   cat > "$TMP" <<'HANDOFF_EOF'
   <filled body from the template below>
   HANDOFF_EOF
   mv "$TMP" "$FINAL"
   \`\`\`

4. Reply with exactly one line: \`Handoff written: handoff-<timestamp>.md\`. Do not start new work and do not stop or kill the process yourself.

## Required Handoff Body

\`\`\`markdown
# Handoff <UTC timestamp>

Tentacle: <OCTOGENT_TENTACLE_ID or "(unknown)">
Octogent session: <OCTOGENT_SESSION_ID or "(unknown)">

## Completed this session
- <what is done, with files and commit SHAs when available>

## In progress
- <what is mid-flight, with file/function and current state>

## Next concrete step
<single sentence>

## Blockers / Open questions
- <blocker or "(none)">

## Git state
- Branch: <branch>
- HEAD: <short SHA>
- Dirty files:
  <"(none)" or git status --porcelain output>
\`\`\`

## Rules

- Fill every section.
- Use concrete file paths, function names, command outputs, and commit SHAs where possible.
- Write a new handoff file for each invocation; do not append to an old one.
- Atomic write is required: temp file plus rename.
`;

export const getTentacleHandoffDirectoryPath = (
  workspaceCwd: string,
  tentacleId: string,
): string => join(workspaceCwd, ".octogent", "tentacles", tentacleId);

export const ensureTentacleHandoffDirectory = (
  workspaceCwd: string,
  tentacleId: string,
): string => {
  const dir = getTentacleHandoffDirectoryPath(workspaceCwd, tentacleId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

export type PriorHandoff = {
  filename: string;
  absolutePath: string;
  body: string;
  mtimeMs: number;
};

export const readMostRecentHandoff = (handoffDir: string): PriorHandoff | null => {
  if (!existsSync(handoffDir)) {
    return null;
  }

  let entries: string[];
  try {
    entries = readdirSync(handoffDir);
  } catch {
    return null;
  }

  let best: { filename: string; absolutePath: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    if (!entry.startsWith("handoff-") || !entry.endsWith(".md")) {
      continue;
    }

    const absolutePath = join(handoffDir, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(absolutePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }

    if (
      !best ||
      stat.mtimeMs > best.mtimeMs ||
      (stat.mtimeMs === best.mtimeMs && entry > best.filename)
    ) {
      best = { filename: entry, absolutePath, mtimeMs: stat.mtimeMs };
    }
  }

  if (!best) {
    return null;
  }

  try {
    return {
      filename: best.filename,
      absolutePath: best.absolutePath,
      body: readFileSync(best.absolutePath, "utf8"),
      mtimeMs: best.mtimeMs,
    };
  } catch {
    return null;
  }
};

export const composeInitialPromptWithPriorHandoff = (
  originalPrompt: string,
  priorHandoff: PriorHandoff | null,
): string => {
  if (!priorHandoff) {
    return originalPrompt;
  }

  return `# Prior handoff\n${priorHandoff.body.trimEnd()}\n\n# Resume from this state:\n${originalPrompt}`;
};
