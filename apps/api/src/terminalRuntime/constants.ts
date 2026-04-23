import { basename, extname } from "node:path";

export const TERMINAL_ID_PREFIX = "terminal-";
export const TERMINAL_REGISTRY_VERSION = 3;
export const TERMINAL_REGISTRY_RELATIVE_PATH = ".octogent/state/tentacles.json";
export const TERMINAL_TRANSCRIPT_RELATIVE_PATH = ".octogent/state/transcripts";
export const TENTACLE_WORKTREE_RELATIVE_PATH = ".octogent/worktrees";
export const TENTACLE_WORKTREE_BRANCH_PREFIX = "octogent/";
export const DEFAULT_AGENT_PROVIDER = "codex" as const;

// Provider resolution must never silently change one model family into another.
// Codex-labelled workers must run Codex, not a hidden Claude fallback.
export const resolveAgentProvider = (provider: string): string => provider;

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
//   OCTOGENT_KIMI_CMD="kimi --yolo"               ← interactive auto-approve
const DEFAULT_CODEX_CMD = "codex --dangerously-bypass-approvals-and-sandbox";
const DEFAULT_CLAUDE_CMD = "claude";
const DEFAULT_KIMI_CMD = "kimi --yolo";
const DEFAULT_OPENCLAW_CMD = "openclaw tui";

export const TERMINAL_BOOTSTRAP_COMMANDS: Record<string, string> = {
  codex: process.env.OCTOGENT_CODEX_CMD?.trim() || DEFAULT_CODEX_CMD,
  "claude-code": process.env.OCTOGENT_CLAUDE_CMD?.trim() || DEFAULT_CLAUDE_CMD,
  kimi: process.env.OCTOGENT_KIMI_CMD?.trim() || DEFAULT_KIMI_CMD,
  openclaw: process.env.OCTOGENT_OPENCLAW_CMD?.trim() || DEFAULT_OPENCLAW_CMD,
};

// Exec-mode command prefixes (command + non-prompt flags). The prompt is
// appended as the final positional argv element by buildExecCommand. No
// shell parsing — we split on whitespace and pass argv verbatim via
// child_process.spawn({ shell: false }).
//
//   OCTOGENT_CODEX_EXEC_CMD overrides the Codex prefix
//   OCTOGENT_CLAUDE_EXEC_CMD overrides the Claude prefix
//   OCTOGENT_KIMI_EXEC_CMD overrides the Kimi prefix
//
// When the caller supplies `roots: readonly string[]` to buildExecCommand,
// providers that support `--add-dir` (currently Codex and Kimi) keep their
// configured autonomy posture and receive one `--add-dir` per root. Roots
// expand writable scope; they do not silently tighten the provider into a
// different sandbox mode.
const DEFAULT_CODEX_EXEC_CMD = "codex exec --dangerously-bypass-approvals-and-sandbox";
const DEFAULT_CLAUDE_EXEC_CMD = "claude -p --dangerously-skip-permissions";
const DEFAULT_KIMI_EXEC_CMD = "kimi --print";
const DEFAULT_OPENCLAW_EXEC_CMD = "openclaw agent --json";

export const TERMINAL_EXEC_COMMANDS: Record<string, string> = {
  codex: process.env.OCTOGENT_CODEX_EXEC_CMD?.trim() || DEFAULT_CODEX_EXEC_CMD,
  "claude-code": process.env.OCTOGENT_CLAUDE_EXEC_CMD?.trim() || DEFAULT_CLAUDE_EXEC_CMD,
  kimi: process.env.OCTOGENT_KIMI_EXEC_CMD?.trim() || DEFAULT_KIMI_EXEC_CMD,
  openclaw: process.env.OCTOGENT_OPENCLAW_EXEC_CMD?.trim() || DEFAULT_OPENCLAW_EXEC_CMD,
};

// Default resolution for openclaw.mjs on Windows — used by the .cmd-shim
// bypass in the openclaw exec branch (see buildExecCommand below). Computed
// at module load; undefined on non-Windows or if APPDATA is unset (which
// means we skip the bypass and fall back to the .cmd argv path).
const DEFAULT_OPENCLAW_MJS_PATH: string | undefined = (() => {
  if (process.platform !== "win32") return undefined;
  const appData = process.env.APPDATA;
  if (!appData || appData.length === 0) return undefined;
  return `${appData}\\npm\\node_modules\\openclaw\\openclaw.mjs`;
})();

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
//   kimi        — `kimi --print <flags>` + prompt piped on stdin
//   openclaw    — `openclaw agent --json --agent <id> --session-id <id>
//                 --message <prompt>` via argv (no stdin support yet).
//                 On Windows, bypasses the `openclaw.cmd` shim to avoid the
//                 `%*` argv-reexpansion bug that tokenizes prompts with
//                 spaces — spawns `node.exe openclaw.mjs ...` directly with
//                 `useShell=false`. Caller must honor `useShell` override.
export const buildExecCommand = (
  provider: string,
  prompt: string,
  outfile: string,
  roots?: readonly string[],
): { command: string; args: string[]; stdin: string; useShell?: boolean } => {
  const effectiveProvider = resolveAgentProvider(provider);
  const prefix =
    TERMINAL_EXEC_COMMANDS[effectiveProvider] ??
    TERMINAL_EXEC_COMMANDS[DEFAULT_AGENT_PROVIDER] ??
    DEFAULT_CLAUDE_EXEC_CMD;
  const parts = prefix.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error(`buildExecCommand: empty command prefix for provider "${effectiveProvider}".`);
  }
  const [command, ...baseArgs] = parts as [string, ...string[]];

  if (effectiveProvider === "codex") {
    const withRoots = applyCodexRoots(baseArgs, roots);
    return {
      command,
      args: [...withRoots, "--output-last-message", outfile, "-"],
      stdin: prompt,
    };
  }

  if (effectiveProvider === "kimi") {
    return {
      command,
      args: applyCodexRoots(baseArgs, roots),
      stdin: prompt,
    };
  }

  if (effectiveProvider === "openclaw") {
    const agentId = process.env.OCTOGENT_OPENCLAW_AGENT_ID?.trim() || "octogent-kimi";
    const sessionId = basename(outfile, extname(outfile));
    const openclawArgs = [
      ...baseArgs,
      "--agent",
      agentId,
      "--session-id",
      sessionId,
      "--message",
      prompt,
    ];

    // Windows .cmd-shim argv-quoting bypass.
    //
    // On Windows, `openclaw.cmd` is an npm shim that invokes node with `%*`
    // re-expansion. cmd.exe's `%*` does NOT preserve the outer quoting Node
    // placed on argv elements containing spaces — so a prompt like
    // `"Reply with spaces"` arrives at commander as 3 positional args
    // (`Reply`, `with`, `spaces`), and openclaw's `agent` subcommand rejects
    // with "too many arguments for 'agent'" (S42/S43 smoke #3 failure).
    //
    // Fix: skip the .cmd shim entirely. Spawn node.exe directly against
    // `openclaw.mjs` with `useShell=false` so cmd.exe is never involved in
    // argv quoting. Requires `spawnExecChild` to honor `useShell` override.
    //
    // Only triggered when:
    //   - process.platform === "win32"
    //   - command is the default "openclaw" (user didn't override
    //     OCTOGENT_OPENCLAW_EXEC_CMD with a custom path)
    //   - DEFAULT_OPENCLAW_MJS_PATH resolved (APPDATA set)
    //
    // Override the default openclaw.mjs path via `OCTOGENT_OPENCLAW_MJS_PATH`
    // for non-standard npm global install locations.
    if (
      process.platform === "win32" &&
      command === "openclaw" &&
      DEFAULT_OPENCLAW_MJS_PATH !== undefined
    ) {
      const mjsOverride = process.env.OCTOGENT_OPENCLAW_MJS_PATH?.trim();
      const mjsPath =
        mjsOverride && mjsOverride.length > 0 ? mjsOverride : DEFAULT_OPENCLAW_MJS_PATH;
      return {
        command: process.execPath,
        args: [mjsPath, ...openclawArgs],
        stdin: "",
        useShell: false,
      };
    }

    return {
      command,
      args: openclawArgs,
      stdin: "",
    };
  }

  // Claude exec: no prompt positional when stdin is piped. Output-side-channel
  // is a TBD — `claude -p` emits to stdout; for now we rely on transcript
  // capture. Claude has no `--add-dir` equivalent today, so `roots` is
  // accepted (for API symmetry) and ignored here.
  return {
    command,
    args: baseArgs,
    stdin: prompt,
  };
};

/**
 * Extend exec args to honor `roots` for providers that support `--add-dir`:
 *  - Append one `--add-dir <path>` per root.
 * When `roots` is undefined or empty, args pass through unchanged.
 *
 * Exported for testability + reuse by Codex exec/resume and Kimi exec.
 */
export const applyCodexRoots = (
  baseArgs: readonly string[],
  roots: readonly string[] | undefined,
): string[] => {
  if (!roots || roots.length === 0) return [...baseArgs];
  const rootFlags: string[] = [];
  for (const r of roots) rootFlags.push("--add-dir", r);
  return [...baseArgs, ...rootFlags];
};

/**
 * Phase 0.01.3.2 — compute the effective `roots` list for a new terminal.
 *
 * Policy:
 *  - If `userRoots` is undefined or empty → return `undefined`. The terminal
 *    gets no `roots` field, preserving today's bypass-mode default. This is
 *    deliberate: silent policy-tightening is destructive (feedback
 *    `feedback_additive_not_destructive.md`), so bypass stays the default.
 *  - If `userRoots` is non-empty → the tentacle's project root is prepended
 *    as the baseline writable area (so providers that honor `roots` can
 *    touch the main repo from the worktree). User-supplied paths are
 *    APPENDED after the project root. Duplicates are removed while
 *    preserving first-seen order.
 *
 * Why project root is auto-included: a tentacle with explicit roots but
 * without its own project root in the list can't do useful work —
 * git operations, package installs, anything touching the repo beyond the
 * worktree-dir workdir would fail. Making project root an invariant
 * baseline lets `--roots` do what callers actually want ("I need to write
 * to THIS other repo too") without them having to remember to re-list
 * their own.
 */
export const computeEffectiveRoots = (
  projectRoot: string,
  userRoots: readonly string[] | undefined,
): readonly string[] | undefined => {
  if (!userRoots || userRoots.length === 0) return undefined;
  const seen = new Set<string>();
  const effective: string[] = [];
  const push = (p: string) => {
    if (p.length === 0 || seen.has(p)) return;
    seen.add(p);
    effective.push(p);
  };
  push(projectRoot);
  for (const r of userRoots) push(r);
  return effective;
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
): { command: string; args: string[]; stdin: string; useShell?: boolean } => {
  const effectiveProvider = resolveAgentProvider(provider);
  if (effectiveProvider === "codex") {
    const resumeTarget = sessionId && sessionId.length > 0 ? sessionId : "--last";
    // Phase 10.9.7 — strip --sandbox / bypass flags from resume args.
    //
    // `codex exec resume` does not accept `--sandbox` or
    // `--dangerously-bypass-approvals-and-sandbox`. Passing either causes
    // codex to exit immediately with "unknown flag" (S38 A4/A5 manifest
    // of this bug — both workers exited without commits, required manual
    // intervention). Resume inherits sandbox posture from the original
    // session, so we don't need to pass it anyway.
    //
    // Roots are still honored via --add-dir (accepted by resume). When
    // roots are empty, no sandbox/bypass flag is added — codex resume
    // uses its own default, which is the parent session's mode.
    const rootFlags: string[] = [];
    if (roots && roots.length > 0) {
      for (const r of roots) rootFlags.push("--add-dir", r);
    }
    return {
      command: "codex",
      args: [
        "exec",
        "resume",
        resumeTarget,
        ...rootFlags,
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
  return buildExecCommand(effectiveProvider, prompt, outfile, roots);
};

export const supportsExecResume = (provider: string | undefined): boolean =>
  resolveAgentProvider(provider ?? DEFAULT_AGENT_PROVIDER) === "codex";

const resolveProviderEnvValue = (key: string, fallback: string): string => {
  const raw = process.env[key]?.trim();
  return raw && raw.length > 0 ? raw : fallback;
};

export const buildProviderEnvironmentOverrides = (
  provider: string | undefined,
): Record<string, string> | undefined => {
  const effectiveProvider = resolveAgentProvider(provider ?? DEFAULT_AGENT_PROVIDER);
  if (effectiveProvider !== "openclaw") {
    return undefined;
  }

  return {
    OPENCLAW_HIDE_BANNER: resolveProviderEnvValue("OPENCLAW_HIDE_BANNER", "1"),
    OPENCLAW_SUPPRESS_NOTES: resolveProviderEnvValue("OPENCLAW_SUPPRESS_NOTES", "1"),
    OPENCLAW_AGENT_HARNESS_FALLBACK: resolveProviderEnvValue(
      "OPENCLAW_AGENT_HARNESS_FALLBACK",
      "none",
    ),
  };
};

// Phase 10.9.7 — emergency auto-respawn kill switch.
//
// When `OCTOGENT_DISABLE_AUTO_RESPAWN=1`, the exec turn coordinator will NOT
// auto-start a new session after a turn ends or after operator_kill. Each
// turn must be explicitly started by an operator. Channel messaging still
// works, but the coordinator treats every worker as single-shot.
//
// Why: S38 shipped stuck-detection + per-tool checkpointing + retry-replan
// logic (Phases 10.8.6 / 10.8.7). Combined, these created an unbreakable
// respawn loop — killing a worker immediately triggered replan → new
// spawn → same quota error → same replan → infinite. Jon needs a hard
// off-switch to run Octogent safely while the root-cause circuit-breaker
// (quota/rate-limit errors non-retryable + operator_kill sets
// do-not-respawn) is designed + shipped.
//
// Scope: this switch disables the auto-respawn that follows a natural turn
// boundary OR a stuck-detection escalation OR an operator_kill. Manual
// startSession() calls still work — the switch just removes the
// coordinator's autonomous restart trigger.
export const isAutoRespawnDisabled = (): boolean =>
  (process.env.OCTOGENT_DISABLE_AUTO_RESPAWN ?? "").trim() === "1";

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

// Phase 10.8.6 — stuck detection thresholds.
//
// A RUNNING terminal with no tool-call activity for this many ms enters
// TIER_1 (synthetic @system status-check channel message). If no activity
// resumes within an additional `STUCK_TIER2_MS`, the terminal advances to
// TIER_2 (@system replan message). If still no activity after another
// `STUCK_DEAD_MS`, the lifecycle flips to DEAD and killSession fires.
//
// All three values are env-overridable so the test harness can drive the
// state machine deterministically without real-time sleeps. A poller
// interval of 0 disables the wall-clock setInterval entirely — tests
// invoke runStuckCheckNow(now) directly with injected timestamps.
export const TERMINAL_STUCK_THRESHOLD_MS =
  Number.parseInt(process.env.OCTOGENT_STUCK_THRESHOLD_MS ?? "", 10) || 120_000;
export const TERMINAL_STUCK_TIER2_MS =
  Number.parseInt(
    process.env.OCTOGENT_STUCK_TIER2_MS ?? process.env.OCTOGENT_STUCK_TIER_2_MS ?? "",
    10,
  ) || 60_000;
export const TERMINAL_STUCK_DEAD_MS =
  Number.parseInt(process.env.OCTOGENT_STUCK_DEAD_MS ?? "", 10) || 120_000;
export const TERMINAL_STUCK_POLL_INTERVAL_MS = (() => {
  const raw = process.env.OCTOGENT_STUCK_POLL_INTERVAL_MS;
  if (raw === undefined) return 30_000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30_000;
})();

export const TERMINAL_SESSION_IDLE_GRACE_MS = 5 * 60 * 1000;
export const TERMINAL_SCROLLBACK_MAX_BYTES = 512 * 1024;
export const TERMINAL_MAX_CONCURRENT_SESSIONS = 32;
export const DEFAULT_TERMINAL_INACTIVITY_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
