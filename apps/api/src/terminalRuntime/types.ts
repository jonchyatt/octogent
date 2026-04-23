import type { WriteStream } from "node:fs";

import type {
  ChannelMessage,
  PersistedUiState,
  TentacleGitStatusSnapshot,
  TentaclePullRequestSnapshot,
  TentacleWorkspaceMode,
  TerminalAgentProvider,
  TerminalLifecycleState,
  TerminalRoots,
  TerminalRuntimeMode,
} from "@octogent/core";
import {
  isTerminalAgentProvider,
  isTerminalCompletionSoundId,
  isTerminalRoots,
  isTerminalRuntimeMode,
} from "@octogent/core";
import type { WebSocket } from "ws";

import type { AgentRuntimeState, AgentStateTracker } from "../agentStateDetection";
import { StuckTier } from "./stuckDetection";

export { StuckTier } from "./stuckDetection";

export type TerminalStateMessage = {
  type: "state";
  state: AgentRuntimeState;
  toolName?: string;
};

export type TerminalOutputMessage = {
  type: "output";
  data: string;
};

export type TerminalHistoryMessage = {
  type: "history";
  data: string;
};

export type TerminalRenameMessage = {
  type: "rename";
  tentacleName: string;
};

export type TerminalActivityMessage = {
  type: "activity";
};

export type TerminalServerMessage =
  | TerminalStateMessage
  | TerminalOutputMessage
  | TerminalHistoryMessage
  | TerminalRenameMessage
  | TerminalActivityMessage;

export type DirectSessionListener = (message: TerminalServerMessage) => void;

export type Disposable = {
  dispose: () => void;
};

// Minimal process-handle contract. Satisfied by both node-pty's IPty (for
// interactive mode) and the exec-mode child_process adapter. Keeps
// sessionRuntime.ts identical across both paths — only the spawner differs.
export type TerminalProcessHandle = {
  readonly pid: number;
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): Disposable;
  write(data: string): void;
  kill(signal?: string): void;
  resize(cols: number, rows: number): void;
};

export type TerminalSession = {
  terminalId: string;
  tentacleId: string;
  pty: TerminalProcessHandle;
  ptyDisposables?: Disposable[];
  clients: Set<WebSocket>;
  directListeners: Set<DirectSessionListener>;
  cols: number;
  rows: number;
  agentState: AgentRuntimeState;
  stateTracker: AgentStateTracker;
  isBootstrapCommandSent: boolean;
  scrollbackChunks: string[];
  scrollbackBytes: number;
  statePollTimer?: ReturnType<typeof setInterval> | undefined;
  idleCloseTimer?: ReturnType<typeof setTimeout> | undefined;
  promptTimers?: Set<ReturnType<typeof setTimeout>>;
  debugLog?: WriteStream | undefined;
  transcriptLog?: WriteStream | undefined;
  // Exec-mode only: durable append log of streamed stdout/stderr. Ended on
  // teardown. Absent for interactive terminals (their output record lives
  // in scrollback + debug PTY logs).
  execOutputLog?: WriteStream | undefined;
  // Exec-mode only: timeout timer that force-kills a hung worker. Cleared on
  // clean exit.
  execTimeoutTimer?: ReturnType<typeof setTimeout> | undefined;
  // Exec-mode only: set to true by the timeout callback right before it fires
  // killSession, so the exec turn coordinator can distinguish timeout-kill
  // (→ escalate to DEAD) from operator-kill (→ silent done). Read by
  // onExecSessionEnd after teardown removes the session from the map; the
  // flag is also mirrored onto the PersistedTerminal so the signal survives
  // session teardown.
  killedByTimeout?: boolean;
  transcriptEventCount?: number;
  pendingInput?: string;
  hasTranscriptEnded?: boolean;
  // Epoch ms timestamp of last observed output/activity. Updated on every
  // pty onData chunk (interactive + exec). A response after a stuck prompt
  // recovers the terminal to HEALTHY. Not persisted: updated too frequently
  // for disk writes, and session restart clears it.
  lastActivityAt?: number;
  // Epoch ms timestamp of last observed tool-call event. Updated by Claude
  // PreToolUse hooks and best-effort Codex/Claude output pattern detection.
  // Read by the stuck-detection poller (Phase 10.8.6): no tool calls for
  // OCTOGENT_STUCK_THRESHOLD_MS escalates TIER_1 → TIER_2 → DEAD.
  lastToolCallAt?: number;
  initialPrompt?: string;
  isInitialPromptSent?: boolean;
  initialInputDraft?: string;
  isInitialInputDraftSent?: boolean;
  keepAliveWithoutClients?: boolean;
  isClosed?: boolean;
  hasSeenProcessing?: boolean;
  lastToolName?: string | undefined;
};

export type TerminalNameOrigin = "generated" | "user" | "prompt";

export {
  type ChannelMessage,
  type PersistedUiState,
  type TentacleGitStatusSnapshot,
  type TentaclePullRequestSnapshot,
  type TentacleWorkspaceMode,
  type TerminalAgentProvider,
  type TerminalLifecycleState,
  type TerminalRoots,
  type TerminalRuntimeMode,
  isTerminalAgentProvider,
  isTerminalCompletionSoundId,
  isTerminalRoots,
  isTerminalRuntimeMode,
};

export type TerminalSessionStartDetails = {
  startedAt: string;
  processId?: number;
};

export type TerminalSessionEndReason =
  | "session_close"
  | "operator_stop"
  | "operator_kill"
  | "pty_exit";

export type TerminalSessionEndDetails = {
  reason: TerminalSessionEndReason;
  endedAt: string;
  exitCode?: number;
  signal?: number | string;
};

export type PersistedTerminal = {
  terminalId: string;
  tentacleId: string;
  worktreeId?: string;
  tentacleName: string;
  nameOrigin?: TerminalNameOrigin;
  autoRenamePromptContext?: string | undefined;
  createdAt: string;
  workspaceMode: TentacleWorkspaceMode;
  agentProvider?: TerminalAgentProvider;
  runtimeMode?: TerminalRuntimeMode;
  // Codex-only: additional sandbox roots. Presence switches Codex exec from
  // --dangerously-bypass-approvals-and-sandbox to --sandbox workspace-write
  // with one --add-dir per root. Absent = bypass mode preserved (today's
  // default). See packages/core/src/domain/agentRuntime.ts for rationale.
  roots?: TerminalRoots;
  // Exec-mode only: how many exec turns this terminal has run. 0 = initial
  // spawn pending; 1 = first turn started/done; 2+ = resumed turns. Incremented
  // by the exec turn coordinator when it respawns the session to deliver
  // queued channel messages.
  turnNumber?: number;
  // Exec-mode only: prompt to send on the NEXT turn (typically composed from
  // queued channel messages). Consumed + cleared by ensureSession at spawn
  // time. Absent for turn 0 (first spawn uses initialPrompt directly).
  nextTurnPrompt?: string;
  // Exec-mode only: Codex session UUID captured from the first turn's
  // `--output-last-message` sidecar OR parsed from stdout. When present,
  // resume turns use `codex exec resume <uuid>` instead of `--last` — safe
  // even when multiple exec terminals share the same cwd. Absent until we
  // see a session UUID in the exec output.
  codexSessionId?: string;
  // Exec-mode only: one-shot flag set by the sessionRuntime timeout callback
  // right before killSession. The coordinator reads it in handleExecSessionEnd
  // to distinguish timeout-kill (escalate to DEAD) from operator-kill
  // (silent done). Cleared after the coordinator consumes it.
  killedByTimeout?: boolean;
  // Exec-mode only: how many CONSECUTIVE timeout retries have been issued
  // for this terminal. 0/undefined = no retry in flight. 1 = one retry
  // attempt issued, second consecutive timeout escalates to DEAD. Reset to
  // 0 on any clean pty_exit (non-consecutive timeouts don't accumulate).
  retryCount?: number;
  // Phase 10.9.7 — sticky non-retryable kill flag.
  //
  // Set to true by:
  //   1. `POST /api/terminals/:id/kill` (operator manually killed) — so
  //      respawn loops can't resurrect an operator-killed terminal.
  //   2. The exec turn coordinator when classifyExitOutput returns a
  //      non-retryable error class (rate_limit / quota / auth). These
  //      errors retry-respawn into the same wall and burn paid quota.
  //
  // The exec turn coordinator checks this flag at the top of
  // handleExecSessionEnd and returns "done" without respawning. Stuck
  // detection treats the terminal as ineligible for TIER transitions
  // once this is true.
  //
  // The flag is NOT cleared by startSession — once sticky, stays sticky
  // until the operator deletes the terminal / tentacle, or manually
  // clears it. That's the whole point: stopping a respawn loop requires
  // a flag that outlives a respawn attempt.
  doNotRespawn?: boolean;
  // Last classified exit error for operator visibility. Populated by the
  // exec coordinator before setting doNotRespawn. Values: "rate_limit",
  // "quota", "auth", "operator_kill". Optional; null/undefined = normal
  // exit or unclassified.
  lastExitErrorClass?: string;
  // Stuck-detection tier (Phase 10.8.6). Undefined/HEALTHY = no active
  // escalation. STUCK_TIER_1 = @system status-check channel message has
  // been sent. STUCK_TIER_2 = @system replan channel message has been sent.
  // Reaching the DEAD threshold flips lifecycleState to "dead" and clears
  // this field.
  // Persisted so operator UI sees escalation state across API restarts,
  // though on restart the associated session is gone and the poller will
  // not re-enter the machine until a new session starts.
  stuckTier?: StuckTier;
  // ISO timestamp of the most recent stuckTier transition (TIER_1 or
  // TIER_2 entry). Cleared on recovery to HEALTHY or on DEAD escalation.
  stuckTierEnteredAt?: string;
  initialPrompt?: string;
  initialInputDraft?: string;
  lastActiveAt?: string;
  parentTerminalId?: string;
  lifecycleState?: TerminalLifecycleState | undefined;
  lifecycleReason?: string | undefined;
  lifecycleUpdatedAt?: string | undefined;
  processId?: number | undefined;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
  exitCode?: number | undefined;
  exitSignal?: number | string | undefined;
};

export type GitClientPullRequestSnapshot = Omit<
  TentaclePullRequestSnapshot,
  "tentacleId" | "workspaceMode" | "status"
> & {
  state: "OPEN" | "MERGED" | "CLOSED";
};

export type TerminalRegistryDocument = {
  version: 3;
  terminals: PersistedTerminal[];
  uiState?: PersistedUiState;
};

export type GitClient = {
  assertAvailable(): void;
  isRepository(cwd: string): boolean;
  addWorktree(options: { cwd: string; path: string; branchName: string; baseRef: string }): void;
  removeWorktree(options: { cwd: string; path: string }): void;
  removeBranch(options: { cwd: string; branchName: string }): void;
  readWorktreeStatus(options: {
    cwd: string;
  }): Omit<TentacleGitStatusSnapshot, "tentacleId" | "workspaceMode">;
  commitAll(options: { cwd: string; message: string }): void;
  pushCurrentBranch(options: { cwd: string }): void;
  syncWithBase(options: { cwd: string; baseRef: string }): void;
  readCurrentBranchPullRequest(options: {
    cwd: string;
  }): GitClientPullRequestSnapshot | null;
  createPullRequest(options: {
    cwd: string;
    title: string;
    body: string;
    baseRef: string;
    headRef: string;
  }): GitClientPullRequestSnapshot | null;
  mergeCurrentBranchPullRequest(options: {
    cwd: string;
    strategy: "squash" | "merge" | "rebase";
  }): void;
};

export class RuntimeInputError extends Error {}

export type CreateTerminalRuntimeOptions = {
  workspaceCwd: string;
  projectStateDir?: string | undefined;
  gitClient?: GitClient;
  getApiBaseUrl?: () => string;
  maxConcurrentSessions?: number | undefined;
};
