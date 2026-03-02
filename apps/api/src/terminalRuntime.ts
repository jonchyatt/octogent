import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";

import type { AgentSnapshot } from "@octogent/core";
import { WebSocketServer } from "ws";

import { TENTACLE_ID_PREFIX, TENTACLE_REGISTRY_RELATIVE_PATH } from "./terminalRuntime/constants";
import { tmuxSessionNameForTentacle } from "./terminalRuntime/ids";
import {
  loadTentacleRegistry,
  persistTentacleRegistry,
  pruneUiStateTentacleReferences,
} from "./terminalRuntime/registry";
import { createSessionRuntime } from "./terminalRuntime/sessionRuntime";
import { createDefaultGitClient, createDefaultTmuxClient } from "./terminalRuntime/systemClients";
import type {
  CreateTerminalRuntimeOptions,
  PersistedTentacle,
  PersistedUiState,
  TentacleWorkspaceMode,
  TerminalSession,
} from "./terminalRuntime/types";
import { createWorktreeManager } from "./terminalRuntime/worktreeManager";

export type {
  GitClient,
  PersistedUiState,
  TentacleWorkspaceMode,
  TmuxClient,
} from "./terminalRuntime/types";
export { RuntimeInputError } from "./terminalRuntime/types";

export const createTerminalRuntime = ({
  workspaceCwd,
  tmuxClient = createDefaultTmuxClient(),
  gitClient = createDefaultGitClient(),
}: CreateTerminalRuntimeOptions) => {
  const sessions = new Map<string, TerminalSession>();
  const websocketServer = new WebSocketServer({ noServer: true });
  const registryPath = join(workspaceCwd, TENTACLE_REGISTRY_RELATIVE_PATH);
  const registryState = loadTentacleRegistry(registryPath);
  const tentacles = registryState.tentacles;
  let nextTentacleNumber = registryState.nextTentacleNumber;
  let uiState = registryState.uiState;
  const isDebugPtyLogsEnabled = process.env.OCTOGENT_DEBUG_PTY_LOGS === "1";
  const ptyLogDir =
    process.env.OCTOGENT_DEBUG_PTY_LOG_DIR ?? join(workspaceCwd, ".octogent", "logs");

  tmuxClient.assertAvailable();

  const persistRegistry = () => {
    uiState = pruneUiStateTentacleReferences(uiState, tentacles);
    persistTentacleRegistry(registryPath, {
      tentacles,
      nextTentacleNumber,
      uiState,
    });
  };

  const worktreeManager = createWorktreeManager({
    workspaceCwd,
    gitClient,
    tentacles,
  });

  const sessionRuntime = createSessionRuntime({
    websocketServer,
    tentacles,
    sessions,
    tmuxClient,
    getTentacleWorkspaceCwd: worktreeManager.getTentacleWorkspaceCwd,
    persistRegistry,
    isDebugPtyLogsEnabled,
    ptyLogDir,
  });

  const allocateTentacleId = () => {
    while (true) {
      const candidateTentacleId = `${TENTACLE_ID_PREFIX}${nextTentacleNumber}`;
      if (tentacles.has(candidateTentacleId)) {
        nextTentacleNumber += 1;
        continue;
      }

      if (tmuxClient.hasSession(tmuxSessionNameForTentacle(candidateTentacleId))) {
        nextTentacleNumber += 1;
        continue;
      }

      break;
    }

    const tentacleId = `${TENTACLE_ID_PREFIX}${nextTentacleNumber}`;
    nextTentacleNumber += 1;
    return tentacleId;
  };

  const buildRootSnapshot = (tentacle: PersistedTentacle): AgentSnapshot => ({
    agentId: `${tentacle.tentacleId}-root`,
    label: `${tentacle.tentacleId}-root`,
    state: "live",
    tentacleId: tentacle.tentacleId,
    tentacleName: tentacle.tentacleName,
    tentacleWorkspaceMode: tentacle.workspaceMode,
    createdAt: tentacle.createdAt,
  });

  const createTentacle = ({
    tentacleName,
    workspaceMode = "shared",
  }: {
    tentacleName?: string;
    workspaceMode?: TentacleWorkspaceMode;
  }): AgentSnapshot => {
    const tentacleId = allocateTentacleId();
    const tentacle: PersistedTentacle = {
      tentacleId,
      tentacleName: tentacleName ?? tentacleId,
      createdAt: new Date().toISOString(),
      codexBootstrapped: false,
      workspaceMode,
    };

    const shouldCreateWorktree = workspaceMode === "worktree";
    if (shouldCreateWorktree) {
      worktreeManager.createTentacleWorktree(tentacleId);
    }

    tentacles.set(tentacleId, tentacle);
    persistRegistry();

    try {
      sessionRuntime.ensureTmuxSession(tentacleId);
    } catch (error) {
      tentacles.delete(tentacleId);
      persistRegistry();
      if (shouldCreateWorktree) {
        worktreeManager.removeTentacleWorktree(tentacleId, { bestEffort: true });
      }
      throw error;
    }

    return buildRootSnapshot(tentacle);
  };

  const readUiState = (): PersistedUiState => {
    const normalized = pruneUiStateTentacleReferences(uiState, tentacles);
    const result: PersistedUiState = { ...normalized };
    if (normalized.minimizedTentacleIds) {
      result.minimizedTentacleIds = [...normalized.minimizedTentacleIds];
    }
    if (normalized.tentacleWidths) {
      result.tentacleWidths = { ...normalized.tentacleWidths };
    }
    return result;
  };

  return {
    listAgentSnapshots(): AgentSnapshot[] {
      return [...tentacles.values()].map((tentacle) => buildRootSnapshot(tentacle));
    },

    readUiState,

    patchUiState(patch: PersistedUiState): PersistedUiState {
      if (patch.isAgentsSidebarVisible !== undefined) {
        uiState.isAgentsSidebarVisible = patch.isAgentsSidebarVisible;
      }
      if (patch.sidebarWidth !== undefined) {
        uiState.sidebarWidth = patch.sidebarWidth;
      }
      if (patch.isActiveAgentsSectionExpanded !== undefined) {
        uiState.isActiveAgentsSectionExpanded = patch.isActiveAgentsSectionExpanded;
      }
      if (patch.isCodexUsageSectionExpanded !== undefined) {
        uiState.isCodexUsageSectionExpanded = patch.isCodexUsageSectionExpanded;
      }
      if (patch.minimizedTentacleIds !== undefined) {
        uiState.minimizedTentacleIds = [...patch.minimizedTentacleIds];
      }
      if (patch.tentacleWidths !== undefined) {
        uiState.tentacleWidths = { ...patch.tentacleWidths };
      }

      persistRegistry();
      return readUiState();
    },

    createTentacle,

    renameTentacle(tentacleId: string, tentacleName: string): AgentSnapshot | null {
      const tentacle = tentacles.get(tentacleId);
      if (!tentacle) {
        return null;
      }

      tentacle.tentacleName = tentacleName;
      persistRegistry();
      return buildRootSnapshot(tentacle);
    },

    deleteTentacle(tentacleId: string): boolean {
      const tentacle = tentacles.get(tentacleId);
      if (!tentacle) {
        return false;
      }

      sessionRuntime.closeSession(tentacleId);
      tmuxClient.killSession(tmuxSessionNameForTentacle(tentacleId));
      if (tentacle.workspaceMode === "worktree") {
        worktreeManager.removeTentacleWorktree(tentacleId);
      }
      tentacles.delete(tentacleId);
      persistRegistry();
      return true;
    },

    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      return sessionRuntime.handleUpgrade(request, socket, head);
    },

    close() {
      sessionRuntime.close();
      websocketServer.close();
    },
  };
};
