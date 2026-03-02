import type { WriteStream } from "node:fs";

import type { AgentSnapshot } from "@octogent/core";
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";

import type { CodexRuntimeState, CodexStateTracker } from "../codexStateDetection";

export type TerminalStateMessage = {
  type: "state";
  state: CodexRuntimeState;
};

export type TerminalOutputMessage = {
  type: "output";
  data: string;
};

export type TerminalServerMessage = TerminalStateMessage | TerminalOutputMessage;

export type TerminalSession = {
  pty: IPty;
  clients: Set<WebSocket>;
  codexState: CodexRuntimeState;
  stateTracker: CodexStateTracker;
  statePollTimer?: ReturnType<typeof setInterval>;
  debugLog?: WriteStream;
};

export type TentacleWorkspaceMode = "shared" | "worktree";

export type PersistedTentacle = {
  tentacleId: string;
  tentacleName: string;
  createdAt: string;
  codexBootstrapped: boolean;
  workspaceMode: TentacleWorkspaceMode;
};

export type PersistedUiState = {
  isAgentsSidebarVisible?: boolean;
  sidebarWidth?: number;
  isActiveAgentsSectionExpanded?: boolean;
  isCodexUsageSectionExpanded?: boolean;
  minimizedTentacleIds?: string[];
  tentacleWidths?: Record<string, number>;
};

export type TentacleRegistryDocument = {
  version: 2;
  nextTentacleNumber: number;
  tentacles: PersistedTentacle[];
  uiState?: PersistedUiState;
};

export type TmuxClient = {
  assertAvailable(): void;
  hasSession(sessionName: string): boolean;
  configureSession(sessionName: string): void;
  capturePane(sessionName: string): string;
  createSession(options: { sessionName: string; cwd: string; command?: string }): void;
  killSession(sessionName: string): void;
};

export type GitClient = {
  assertAvailable(): void;
  isRepository(cwd: string): boolean;
  addWorktree(options: { cwd: string; path: string; branchName: string; baseRef: string }): void;
  removeWorktree(options: { cwd: string; path: string }): void;
  removeBranch(options: { cwd: string; branchName: string }): void;
};

export class RuntimeInputError extends Error {}

export type CreateTerminalRuntimeOptions = {
  workspaceCwd: string;
  tmuxClient?: TmuxClient;
  gitClient?: GitClient;
};

export type TerminalRuntime = {
  listAgentSnapshots(): AgentSnapshot[];
  readUiState(): PersistedUiState;
  patchUiState(patch: PersistedUiState): PersistedUiState;
  createTentacle(options: {
    tentacleName?: string;
    workspaceMode?: TentacleWorkspaceMode;
  }): AgentSnapshot;
  renameTentacle(tentacleId: string, tentacleName: string): AgentSnapshot | null;
  deleteTentacle(tentacleId: string): boolean;
  handleUpgrade(
    request: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ): boolean;
  close(): void;
};
