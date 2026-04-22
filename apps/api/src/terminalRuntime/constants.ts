export const TERMINAL_ID_PREFIX = "terminal-";
export const TERMINAL_REGISTRY_VERSION = 3;
export const TERMINAL_REGISTRY_RELATIVE_PATH = ".octogent/state/tentacles.json";
export const TERMINAL_TRANSCRIPT_RELATIVE_PATH = ".octogent/state/transcripts";
export const TENTACLE_WORKTREE_RELATIVE_PATH = ".octogent/worktrees";
export const TENTACLE_WORKTREE_BRANCH_PREFIX = "octogent/";
export const DEFAULT_AGENT_PROVIDER = "claude-code" as const;

// Bootstrap commands per provider. The Codex default mirrors how Jon runs it
// locally — full authority, no approval prompts. Claude's equivalent is
// `--dangerously-skip-permissions` which most interactive users enable globally;
// Codex's is `--dangerously-bypass-approvals-and-sandbox`. Workers spawned
// inside Octogent inherit this mode so they act autonomously instead of
// stalling on approval prompts that no one is there to answer.
//
// Override per-host via env:
//   OCTOGENT_CODEX_CMD="codex --full-auto"        ← sandboxed auto-exec
//   OCTOGENT_CODEX_CMD="codex -a never"           ← no approvals, no sandbox change
//   OCTOGENT_CLAUDE_CMD="claude --dangerously-skip-permissions"
const DEFAULT_CODEX_CMD = "codex --dangerously-bypass-approvals-and-sandbox";
const DEFAULT_CLAUDE_CMD = "claude";

export const TERMINAL_BOOTSTRAP_COMMANDS: Record<string, string> = {
  codex: process.env.OCTOGENT_CODEX_CMD?.trim() || DEFAULT_CODEX_CMD,
  "claude-code": process.env.OCTOGENT_CLAUDE_CMD?.trim() || DEFAULT_CLAUDE_CMD,
};

// Exec-mode command prefixes (command + non-prompt flags). The prompt is
// appended as the final positional argv element by buildExecCommand. No
// shell parsing — we split on whitespace and pass argv verbatim via
// child_process.spawn({ shell: false }).
//
//   OCTOGENT_CODEX_EXEC_CMD overrides the Codex prefix
//   OCTOGENT_CLAUDE_EXEC_CMD overrides the Claude prefix
//
// When the caller supplies `roots: readonly string[]` to buildExecCommand,
// the Codex prefix's `--dangerously-bypass-approvals-and-sandbox` is
// replaced with `--sandbox workspace-write` and one `--add-dir <path>` is
// emitted per root. Without roots, bypass mode is preserved (today's
// default — full fs access, no sandbox).
//
// This split is deliberate: bypass is safe for single-repo tentacles and
// matches how Jon runs Codex locally. Introducing roots is an explicit opt-
// in to the sandboxed posture, safer AND necessary for cross-repo work
// (Phase 0.01.3 — jarvis tentacle writing to Visopscreen, sidecar, etc).
const DEFAULT_CODEX_EXEC_CMD = "codex exec --dangerously-bypass-approvals-and-sandbox";
const DEFAULT_CLAUDE_EXEC_CMD = "claude -p";

export const TERMINAL_EXEC_COMMANDS: Record<string, string> = {
  codex: process.env.OCTOGENT_CODEX_EXEC_CMD?.trim() || DEFAULT_CODEX_EXEC_CMD,
  "claude-code": process.env.OCTOGENT_CLAUDE_EXEC_CMD?.trim() || DEFAULT_CLAUDE_EXEC_CMD,
};

// Build the argv for an exec-mode spawn. Returns `{ command, args, stdin }`
// where `stdin` is the prompt string to write into the child's stdin.
//
// Why stdin instead of argv for the prompt: on Windows, `codex.cmd` must be
// launched via cmd.exe (shell=true), and Node does NOT escape argv elements
// for CMD — so prompts with spaces get tokenized mid-word. Piping the prompt
// via stdin is platform-neutral and sidesteps every quoting edge case.
//
// Codex supports `-` as the prompt positional to force stdin reading. Claude
// (`claude -p`) also accepts stdin input when the prompt arg is omitted.
//
// Provider-specific behavior:
//   codex       — `codex exec <flags> --output-last-message <outfile> -`
//                 + prompt piped on stdin
//   claude-code — `claude -p <flags>` + prompt piped on stdin
export const buildExecCommand = (
  provider: string,
  prompt: string,
  outfile: string,
  roots?: readonly string[],
): { command: string; args: string[]; stdin: string } => {
  const prefix =
    TERMINAL_EXEC_COMMANDS[provider] ??
    TERMINAL_EXEC_COMMANDS[DEFAULT_AGENT_PROVIDER] ??
    DEFAULT_CLAUDE_EXEC_CMD;
  const parts = prefix.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error(`buildExecCommand: empty command prefix for provider "${provider}".`);
  }
  const [command, ...baseArgs] = parts as [string, ...string[]];

  if (provider === "codex") {
    const withRoots = applyCodexRoots(baseArgs, roots);
    return {
      command,
      args: [...withRoots, "--output-last-message", outfile, "-"],
      stdin: prompt,
    };
  }

  // Claude exec: no prompt positional when stdin is piped. Output-side-channel
  // is a TBD — `claude -p` emits to stdout; for now we rely on transcript
  // capture. `roots` is a Codex-only primitive; Claude has no equivalent
  // sandbox flag today, so it's accepted (for API symmetry) and ignored here.
  return {
    command,
    args: baseArgs,
    stdin: prompt,
  };
};

/**
 * Swap Codex exec args to honor `roots` when provided:
 *  - Strip `--dangerously-bypass-approvals-and-sandbox` (if present).
 *  - Prepend `--sandbox workspace-write`.
 *  - Append one `--add-dir <path>` per root.
 * When `roots` is undefined or empty, args pass through unchanged (bypass
 * mode preserved — today's default).
 *
 * Exported for testability + reuse by buildResumeCommand.
 */
export const applyCodexRoots = (
  baseArgs: readonly string[],
  roots: readonly string[] | undefined,
): string[] => {
  if (!roots || roots.length === 0) return [...baseArgs];
  const stripped = baseArgs.filter((a) => a !== "--dangerously-bypass-approvals-and-sandbox");
  const rootFlags: string[] = [];
  for (const r of roots) rootFlags.push("--add-dir", r);
  return ["--sandbox", "workspace-write", ...stripped, ...rootFlags];
};

// Build the argv for resuming a prior exec session with a new prompt.
// Parallel to buildExecCommand but uses `codex exec resume <sessionId>`
// when a session UUID is available (safe under shared-cwd), or `--last`
// when not (worktree-only — coordinator gates this).
//
// Empirically verified 2026-04-22: same session UUID across turns, prior
// context carries (Codex recalled a word from turn 1 without re-reading
// the file in turn 2).
//
// Hard-coded invocation shape — we do NOT parse/mutate the user's
// OCTOGENT_CODEX_EXEC_CMD prefix here. If the user customized the exec
// prefix with extra flags, resume still uses the canonical Codex
// invocation. The tradeoff (bespoke exec flags not honored on resume)
// is worth the safety (no fragile argv splicing around a user-supplied
// string).
//
// Claude-code has no direct resume analog yet — the coordinator refuses
// to respawn claude-code workers entirely (MED-2). If this function is
// somehow called for claude-code, we fall back to buildExecCommand so
// the caller still gets a valid argv, but the coordinator path should
// never reach here.
export const buildResumeCommand = (
  provider: string,
  prompt: string,
  outfile: string,
  sessionId?: string,
  roots?: readonly string[],
): { command: string; args: string[]; stdin: string } => {
  if (provider === "codex") {
    const resumeTarget = sessionId && sessionId.length > 0 ? sessionId : "--last";
    // Roots-honoring version of the canonical resume invocation. We NEVER parse
    // OCTOGENT_CODEX_EXEC_CMD here (see comment above) — the resume invocation
    // is hard-coded. Roots, when provided, follow the same applyCodexRoots
    // transform as buildExecCommand.
    const hardcodedArgs = roots && roots.length > 0
      ? applyCodexRoots([], roots)
      : ["--dangerously-bypass-approvals-and-sandbox"];
    return {
      command: "codex",
      args: [
        "exec",
        "resume",
        resumeTarget,
        ...hardcodedArgs,
        "--output-last-message",
        outfile,
        "-",
      ],
      stdin: prompt,
    };
  }

  // Claude fallback (unreachable from coordinator post-MED-2 but safe if
  // called directly). No resume primitive; fresh exec loses context. Roots
  // ignored for Claude (no equivalent sandbox flag).
  return buildExecCommand(provider, prompt, outfile, roots);
};

// Hard ceiling on exec-mode worker runtime. Protects against hung workers
// (network stall, runaway model, broken prompt) that would otherwise hold
// a session slot indefinitely. Fires killSession when elapsed. Override
// per-process via OCTOGENT_EXEC_TIMEOUT_MS.
export const TERMINAL_EXEC_TIMEOUT_MS =
  Number.parseInt(process.env.OCTOGENT_EXEC_TIMEOUT_MS ?? "", 10) || 10 * 60 * 1000;

// Hard ceiling on how many auto-respawn turns the exec turn coordinator will
// drive for a single terminal. Protects against runaway ping-pong (e.g., two
// exec workers channel-messaging each other in a loop — no human in the
// loop, API cost unbounded). Escalates the terminal to DEAD when the limit
// is hit. Override per-process via OCTOGENT_EXEC_MAX_TURNS.
export const TERMINAL_EXEC_MAX_TURNS =
  Number.parseInt(process.env.OCTOGENT_EXEC_MAX_TURNS ?? "", 10) || 50;

export const TERMINAL_SESSION_IDLE_GRACE_MS = 5 * 60 * 1000;
export const TERMINAL_SCROLLBACK_MAX_BYTES = 512 * 1024;
export const TERMINAL_MAX_CONCURRENT_SESSIONS = 32;
export const DEFAULT_TERMINAL_INACTIVITY_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
