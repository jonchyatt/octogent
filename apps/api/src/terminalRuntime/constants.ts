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
export const TERMINAL_SESSION_IDLE_GRACE_MS = 5 * 60 * 1000;
export const TERMINAL_SCROLLBACK_MAX_BYTES = 512 * 1024;
export const TERMINAL_MAX_CONCURRENT_SESSIONS = 32;
export const DEFAULT_TERMINAL_INACTIVITY_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
