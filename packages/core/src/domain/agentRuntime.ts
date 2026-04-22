export type AgentRuntimeState =
  | "idle"
  | "processing"
  | "waiting_for_permission"
  | "waiting_for_user";

export const isAgentRuntimeState = (value: unknown): value is AgentRuntimeState =>
  value === "idle" ||
  value === "processing" ||
  value === "waiting_for_permission" ||
  value === "waiting_for_user";

export type TerminalAgentProvider = "codex" | "claude-code";

export const TERMINAL_AGENT_PROVIDERS: TerminalAgentProvider[] = ["codex", "claude-code"];

export const isTerminalAgentProvider = (value: unknown): value is TerminalAgentProvider =>
  typeof value === "string" && TERMINAL_AGENT_PROVIDERS.includes(value as TerminalAgentProvider);

// Runtime mode is ORTHOGONAL to agent provider. Provider = WHO runs (codex vs
// claude-code). Mode = HOW they run:
//   interactive — existing behavior. Spawn a shell PTY, boot the agent TUI,
//                 type the prompt in via bracketed paste. Good for manager
//                 sessions, long-running interactive work, live operator.
//   exec       — spawn the agent directly as a child_process with prompt as
//                 argv, no TUI, no shell. Stream stdout → transcript. Single
//                 turn, atomic completion. Good for swarm workers that need
//                 to "do one thing and exit" with clean completion semantics.
// Default is interactive — preserves current behavior for all existing callers.
export type TerminalRuntimeMode = "interactive" | "exec";

export const TERMINAL_RUNTIME_MODES: TerminalRuntimeMode[] = ["interactive", "exec"];

export const DEFAULT_TERMINAL_RUNTIME_MODE: TerminalRuntimeMode = "interactive";

export const isTerminalRuntimeMode = (value: unknown): value is TerminalRuntimeMode =>
  typeof value === "string" && TERMINAL_RUNTIME_MODES.includes(value as TerminalRuntimeMode);

// Sandbox roots — extra directories a Codex worker is allowed to write to
// beyond its primary workspace (the terminal's cwd). When present AND the
// agent provider is "codex", the runtime switches the Codex sandbox mode
// from --dangerously-bypass-approvals-and-sandbox to --sandbox workspace-write
// and emits one --add-dir flag per root. Absent ⇒ bypass mode preserved
// (today's default — Codex has full fs access).
//
// Rationale: cross-repo edits (e.g. a jarvis tentacle that needs to write
// to C:\Users\jonch\Projects\Visopscreen) benefit from the safer
// workspace-write posture. Without explicit roots the caller presumably
// wants today's "write anywhere" default — we don't silently tighten them.
//
// Paths SHOULD be absolute. Relative paths are forwarded as-is to Codex
// (which resolves against its workdir). String[] — order is irrelevant.
// Empty array is treated as "no roots" (identical to undefined).
export type TerminalRoots = readonly string[];

export const isTerminalRoots = (value: unknown): value is TerminalRoots =>
  Array.isArray(value) &&
  value.every((p) => typeof p === "string" && p.length > 0);
