import type { AgentRuntimeState } from "./agentRuntime";

export type AgentState = "live" | "idle" | "queued" | "blocked" | "stopped" | "exited" | "stale" | "dead";
export type TerminalLifecycleState = "registered" | "running" | "stopped" | "exited" | "stale" | "dead";
export type TentacleWorkspaceMode = "shared" | "worktree";

export type TerminalSnapshot = {
  terminalId: string;
  label: string;
  state: AgentState;
  tentacleId: string;
  tentacleName?: string;
  workspaceMode?: TentacleWorkspaceMode;
  createdAt: string;
  hasUserPrompt?: boolean;
  parentTerminalId?: string;
  agentRuntimeState?: AgentRuntimeState;
  lifecycleState?: TerminalLifecycleState;
  lifecycleReason?: string;
  lifecycleUpdatedAt?: string;
  processId?: number;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number;
  exitSignal?: number | string;
  // Phase 10.9.7 — sticky non-retryable kill flag. When true, coordinator +
  // stuck detection will never respawn this terminal, regardless of auto-
  // respawn kill switch. UI surfaces this as "STOPPED (operator)" or
  // "FAILED (quota)" etc. depending on lastExitErrorClass.
  doNotRespawn?: boolean;
  // Phase 10.9.7 — error class that caused doNotRespawn to be set. One of
  // "rate_limit" | "quota" | "auth" | "operator_kill" | "operator_stop".
  // Other strings are allowed for future classes; UI treats unknowns as
  // generic non-retryable.
  lastExitErrorClass?: string;
};
