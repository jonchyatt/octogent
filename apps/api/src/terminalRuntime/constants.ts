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
    return {
      command,
      args: [...baseArgs, "--output-last-message", outfile, "-"],
      stdin: prompt,
    };
  }

  // Claude exec: no prompt positional when stdin is piped. Output-side-channel
  // is a TBD — `claude -p` emits to stdout; for now we rely on transcript
  // capture.
  return {
    command,
    args: baseArgs,
    stdin: prompt,
  };
};

// Hard ceiling on exec-mode worker runtime. Protects against hung workers
// (network stall, runaway model, broken prompt) that would otherwise hold
// a session slot indefinitely. Fires killSession when elapsed. Override
// per-process via OCTOGENT_EXEC_TIMEOUT_MS.
export const TERMINAL_EXEC_TIMEOUT_MS =
  Number.parseInt(process.env.OCTOGENT_EXEC_TIMEOUT_MS ?? "", 10) || 10 * 60 * 1000;

export const TERMINAL_SESSION_IDLE_GRACE_MS = 5 * 60 * 1000;
export const TERMINAL_SCROLLBACK_MAX_BYTES = 512 * 1024;
export const TERMINAL_MAX_CONCURRENT_SESSIONS = 32;
export const DEFAULT_TERMINAL_INACTIVITY_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
