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

export type TerminalAgentProvider = "codex" | "claude-code" | "kimi" | "openclaw";

export const TERMINAL_AGENT_PROVIDERS: TerminalAgentProvider[] = [
  "codex",
  "claude-code",
  "kimi",
  "openclaw",
];

export const isTerminalAgentProvider = (value: unknown): value is TerminalAgentProvider =>
  typeof value === "string" && TERMINAL_AGENT_PROVIDERS.includes(value as TerminalAgentProvider);

// Runtime mode is ORTHOGONAL to agent provider. Provider = WHO runs (codex vs
// claude-code vs kimi). Mode = HOW they run:
//   interactive - existing behavior. Spawn a shell PTY, boot the agent TUI,
//                 type the prompt in via bracketed paste. Good for manager
//                 sessions, long-running interactive work, live operator.
//   exec       - spawn the agent directly as a child_process with prompt as
//                 argv, no TUI, no shell. Stream stdout -> transcript. Single
//                 turn, atomic completion. Good for swarm workers that need
//                 to "do one thing and exit" with clean completion semantics.
// Default is interactive - preserves current behavior for all existing callers.
export type TerminalRuntimeMode = "interactive" | "exec";

export const TERMINAL_RUNTIME_MODES: TerminalRuntimeMode[] = ["interactive", "exec"];

export const DEFAULT_TERMINAL_RUNTIME_MODE: TerminalRuntimeMode = "interactive";

export const isTerminalRuntimeMode = (value: unknown): value is TerminalRuntimeMode =>
  typeof value === "string" && TERMINAL_RUNTIME_MODES.includes(value as TerminalRuntimeMode);

// Workspace roots - extra directories a provider can access beyond its
// primary workspace (the terminal's cwd). Providers that support additional
// workspace directories (currently Codex and Kimi) receive one `--add-dir`
// per root. Providers without an equivalent flag ignore roots.
//
// Rationale: cross-repo edits (e.g. a jarvis tentacle that needs to write
// to C:\Users\jonch\Projects\Visopscreen) need an explicit way to extend the
// workspace boundary without changing the default posture for callers that
// do not opt in.
//
// Paths SHOULD be absolute. Relative paths are forwarded as-is to the agent
// CLI (which resolves against its workdir). String[] - order is irrelevant.
// Empty array is treated as "no roots" (identical to undefined).
export type TerminalRoots = readonly string[];

export const isTerminalRoots = (value: unknown): value is TerminalRoots =>
  Array.isArray(value) &&
  value.every((p) => typeof p === "string" && p.length > 0);
