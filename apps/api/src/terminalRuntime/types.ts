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
