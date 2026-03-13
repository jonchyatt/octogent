import type { WriteStream } from "node:fs";

import type { AgentSnapshot } from "@octogent/core";
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";

import type { CodexRuntimeState, CodexStateTracker } from "../codexStateDetection";
import type { ConversationSessionDetail, ConversationSessionSummary } from "./conversations";

export type TerminalStateMessage = {
  type: "state";
  state: CodexRuntimeState;
};

export type TerminalOutputMessage = {
  type: "output";
  data: string;
};

export type TerminalHistoryMessage = {
  type: "history";
  data: string;
};

export type TerminalServerMessage =
  | TerminalStateMessage
  | TerminalOutputMessage
  | TerminalHistoryMessage;

export type TerminalSession = {
  tentacleId: string;
  pty: IPty;
  clients: Set<WebSocket>;
  cols: number;
  rows: number;
  codexState: CodexRuntimeState;
  stateTracker: CodexStateTracker;
  isBootstrapCommandSent: boolean;
  scrollbackChunks: string[];
  scrollbackBytes: number;
  statePollTimer?: ReturnType<typeof setInterval>;
  idleCloseTimer?: ReturnType<typeof setTimeout> | undefined;
  debugLog?: WriteStream;
  transcriptLog?: WriteStream | undefined;
  transcriptEventCount?: number;
  pendingInput?: string;
  hasTranscriptEnded?: boolean;
};

export type TentacleWorkspaceMode = "shared" | "worktree";

export type TentacleAgentProvider = "codex" | "claude-code";

export const TENTACLE_AGENT_PROVIDERS: TentacleAgentProvider[] = ["codex", "claude-code"];

export const isTentacleAgentProvider = (value: unknown): value is TentacleAgentProvider =>
  typeof value === "string" && TENTACLE_AGENT_PROVIDERS.includes(value as TentacleAgentProvider);

export const TENTACLE_COMPLETION_SOUND_IDS = [
  "soft-chime",
  "retro-beep",
  "double-beep",
  "bell",
  "pop",
  "silent",
] as const;

export type TentacleCompletionSound = (typeof TENTACLE_COMPLETION_SOUND_IDS)[number];

export const isTentacleCompletionSound = (value: unknown): value is TentacleCompletionSound =>
  typeof value === "string" &&
  TENTACLE_COMPLETION_SOUND_IDS.includes(value as TentacleCompletionSound);

export type PersistedTentacle = {
  tentacleId: string;
  tentacleName: string;
  createdAt: string;
  workspaceMode: TentacleWorkspaceMode;
  agentProvider?: TentacleAgentProvider;
};

export type PersistedTentacleAgent = {
  agentId: string;
  tentacleId: string;
  label: string;
  createdAt: string;
  parentAgentId: string;
  order: number;
};

export type TentacleGitStatusSnapshot = {
  tentacleId: string;
  workspaceMode: TentacleWorkspaceMode;
  branchName: string;
  upstreamBranchName: string | null;
  isDirty: boolean;
  aheadCount: number;
  behindCount: number;
  insertedLineCount: number;
  deletedLineCount: number;
  hasConflicts: boolean;
  changedFiles: string[];
  defaultBaseBranchName: string | null;
};

export type TentaclePullRequestStatus = "none" | "open" | "merged" | "closed";

export type TentaclePullRequestSnapshot = {
  tentacleId: string;
  workspaceMode: TentacleWorkspaceMode;
  status: TentaclePullRequestStatus;
  number: number | null;
  url: string | null;
  title: string | null;
  baseRef: string | null;
  headRef: string | null;
  isDraft: boolean | null;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
  mergeStateStatus: string | null;
};

export type GitClientPullRequestSnapshot = Omit<
  TentaclePullRequestSnapshot,
  "tentacleId" | "workspaceMode" | "status"
> & {
  state: "OPEN" | "MERGED" | "CLOSED";
};

export type PersistedUiState = {
  isAgentsSidebarVisible?: boolean;
  sidebarWidth?: number;
  isActiveAgentsSectionExpanded?: boolean;
  isRuntimeStatusStripVisible?: boolean;
  isMonitorVisible?: boolean;
  isBottomTelemetryVisible?: boolean;
  isCodexUsageVisible?: boolean;
  isClaudeUsageVisible?: boolean;
  isClaudeUsageSectionExpanded?: boolean;
  isCodexUsageSectionExpanded?: boolean;
  tentacleCompletionSound?: TentacleCompletionSound;
  minimizedTentacleIds?: string[];
  tentacleWidths?: Record<string, number>;
};

export type TentacleRegistryDocument = {
  version: 2;
  tentacles: PersistedTentacle[];
  agents?: PersistedTentacleAgent[];
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
  gitClient?: GitClient;
};

export type TerminalRuntime = {
  listAgentSnapshots(): AgentSnapshot[];
  listConversationSessions(): ConversationSessionSummary[];
  readConversationSession(sessionId: string): ConversationSessionDetail | null;
  exportConversationSession(sessionId: string, format: "json" | "md"): string | null;
  deleteAllConversationSessions(): void;
  readUiState(): PersistedUiState;
  patchUiState(patch: PersistedUiState): PersistedUiState;
  readTentacleGitStatus(tentacleId: string): TentacleGitStatusSnapshot | null;
  commitTentacleWorktree(tentacleId: string, message: string): TentacleGitStatusSnapshot | null;
  pushTentacleWorktree(tentacleId: string): TentacleGitStatusSnapshot | null;
  syncTentacleWorktree(tentacleId: string, baseRef?: string): TentacleGitStatusSnapshot | null;
  readTentaclePullRequest(tentacleId: string): TentaclePullRequestSnapshot | null;
  createTentaclePullRequest(
    tentacleId: string,
    input: { title: string; body?: string; baseRef?: string },
  ): TentaclePullRequestSnapshot | null;
  mergeTentaclePullRequest(tentacleId: string): TentaclePullRequestSnapshot | null;
  createTentacle(options: {
    tentacleName?: string;
    workspaceMode?: TentacleWorkspaceMode;
    agentProvider?: TentacleAgentProvider;
  }): AgentSnapshot;
  createTentacleAgent(options: {
    tentacleId: string;
    anchorAgentId: string;
    placement: "up" | "down";
  }): AgentSnapshot | null;
  deleteTentacleAgent(options: { tentacleId: string; agentId: string }): boolean | null;
  renameTentacle(tentacleId: string, tentacleName: string): AgentSnapshot | null;
  deleteTentacle(tentacleId: string): boolean;
  handleHook(hookName: string, payload: unknown): { ok: boolean };
  handleUpgrade(
    request: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ): boolean;
  close(): void;
};
