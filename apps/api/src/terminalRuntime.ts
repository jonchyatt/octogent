import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";

import type { AgentSnapshot } from "@octogent/core";
import { WebSocketServer } from "ws";

import {
  DEFAULT_AGENT_PROVIDER,
  TENTACLE_ID_PREFIX,
  TENTACLE_REGISTRY_RELATIVE_PATH,
  TENTACLE_TRANSCRIPT_RELATIVE_PATH,
} from "./terminalRuntime/constants";
import { parseClaudeTranscript } from "./terminalRuntime/claudeTranscript";
import {
  conversationExportMarkdown,
  deleteAllConversations,
  deleteConversation,
  listConversationSessions,
  readConversationSession,
  searchConversations,
  storeClaudeTranscriptTurns,
} from "./terminalRuntime/conversations";
import { broadcastMessage } from "./terminalRuntime/protocol";
import {
  loadTentacleRegistry,
  persistTentacleRegistry,
  pruneUiStateTentacleReferences,
} from "./terminalRuntime/registry";
import { createSessionRuntime } from "./terminalRuntime/sessionRuntime";
import { createDefaultGitClient } from "./terminalRuntime/systemClients";
import {
  type CreateTerminalRuntimeOptions,
  type PersistedTentacle,
  type PersistedTentacleAgent,
  type PersistedUiState,
  RuntimeInputError,
  type TentacleGitStatusSnapshot,
  type TentaclePullRequestSnapshot,
  type TentacleAgentProvider,
  type TentacleWorkspaceMode,
  type TerminalSession,
} from "./terminalRuntime/types";
import { createWorktreeManager } from "./terminalRuntime/worktreeManager";

export type {
  GitClient,
  PersistedUiState,
  TentacleAgentProvider,
  TentacleCompletionSound,
  TentacleWorkspaceMode,
} from "./terminalRuntime/types";
export { isTentacleAgentProvider, isTentacleCompletionSound } from "./terminalRuntime/types";
export { RuntimeInputError } from "./terminalRuntime/types";

export const createTerminalRuntime = ({
  workspaceCwd,
  gitClient = createDefaultGitClient(),
}: CreateTerminalRuntimeOptions) => {
  const sessions = new Map<string, TerminalSession>();
  const websocketServer = new WebSocketServer({ noServer: true });
  const registryPath = join(workspaceCwd, TENTACLE_REGISTRY_RELATIVE_PATH);
  const registryState = loadTentacleRegistry(registryPath);
  const tentacles = registryState.tentacles;
  const tentacleAgents = registryState.tentacleAgents;
  let uiState = registryState.uiState;
  const isDebugPtyLogsEnabled = process.env.OCTOGENT_DEBUG_PTY_LOGS === "1";
  const ptyLogDir =
    process.env.OCTOGENT_DEBUG_PTY_LOG_DIR ?? join(workspaceCwd, ".octogent", "logs");
  const transcriptDirectoryPath = join(workspaceCwd, TENTACLE_TRANSCRIPT_RELATIVE_PATH);
  const apiPort = process.env.OCTOGENT_API_PORT ?? process.env.PORT ?? "8787";

  const installHooksInDirectory = (targetCwd: string) => {
    const targetClaudeDir = join(targetCwd, ".claude");
    const targetSettingsPath = join(targetClaudeDir, "settings.json");

    // Always generate hooks config with $OCTOGENT_SESSION_ID for session isolation.
    // Include $OCTOGENT_SESSION_ID so the handler can identify which octogent
    // session the hook originates from and ignore hooks from external Claude
    // sessions (e.g. VS Code) that share the same working directory.
    const hooksConfig = {
      hooks: {
        SessionStart: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "http://localhost:${apiPort}/api/hooks/session-start?octogent_session=$OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 5,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "http://localhost:${apiPort}/api/hooks/user-prompt-submit?octogent_session=$OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 5,
              },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              {
                type: "http",
                url: `http://localhost:${apiPort}/api/hooks/pre-tool-use`,
                headers: { "X-Octogent-Session": "$OCTOGENT_SESSION_ID" },
                allowedEnvVars: ["OCTOGENT_SESSION_ID"],
                timeout: 5,
              },
            ],
          },
        ],
        Notification: [
          {
            matcher: "*",
            hooks: [
              {
                type: "http",
                url: `http://localhost:${apiPort}/api/hooks/notification`,
                headers: { "X-Octogent-Session": "$OCTOGENT_SESSION_ID" },
                allowedEnvVars: ["OCTOGENT_SESSION_ID"],
                timeout: 5,
              },
            ],
          },
        ],
        Stop: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "http://localhost:${apiPort}/api/hooks/stop?octogent_session=$OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 15,
              },
            ],
          },
        ],
      },
    };

    try {
      mkdirSync(targetClaudeDir, { recursive: true });
      writeFileSync(targetSettingsPath, `${JSON.stringify(hooksConfig, null, 2)}\n`, "utf8");
    } catch {
      // Best-effort
    }
  };

  const persistRegistry = () => {
    uiState = pruneUiStateTentacleReferences(uiState, tentacles);
    for (const tentacleId of [...tentacleAgents.keys()]) {
      if (!tentacles.has(tentacleId)) {
        tentacleAgents.delete(tentacleId);
      }
    }
    persistTentacleRegistry(registryPath, {
      tentacles,
      tentacleAgents,
      uiState,
    });
  };

  const worktreeManager = createWorktreeManager({
    workspaceCwd,
    gitClient,
    tentacles,
  });

  const buildRootAgentId = (tentacleId: string) => `${tentacleId}-root`;

  const getTentacleAgentList = (tentacleId: string): PersistedTentacleAgent[] =>
    tentacleAgents.get(tentacleId) ?? [];

  const setTentacleAgentList = (tentacleId: string, agents: PersistedTentacleAgent[]) => {
    tentacleAgents.set(
      tentacleId,
      agents.map((agent, index) => ({
        ...agent,
        order: index,
      })),
    );
  };

  const findTentacleByAgentId = (agentId: string): string | null => {
    for (const [tentacleId, agents] of tentacleAgents.entries()) {
      if (agents.some((agent) => agent.agentId === agentId)) {
        return tentacleId;
      }
    }
    return null;
  };

  const resolveTerminalSession = (
    terminalId: string,
  ): { sessionId: string; tentacleId: string } | null => {
    if (tentacles.has(terminalId)) {
      return {
        sessionId: buildRootAgentId(terminalId),
        tentacleId: terminalId,
      };
    }

    if (terminalId.endsWith("-root")) {
      const tentacleId = terminalId.slice(0, -"-root".length);
      if (tentacles.has(tentacleId)) {
        return {
          sessionId: terminalId,
          tentacleId,
        };
      }
    }

    const childTentacleId = findTentacleByAgentId(terminalId);
    if (childTentacleId) {
      return {
        sessionId: terminalId,
        tentacleId: childTentacleId,
      };
    }

    return null;
  };

  const sessionRuntime = createSessionRuntime({
    websocketServer,
    tentacles,
    sessions,
    resolveTerminalSession,
    getTentacleWorkspaceCwd: worktreeManager.getTentacleWorkspaceCwd,
    isDebugPtyLogsEnabled,
    ptyLogDir,
    transcriptDirectoryPath,
  });

  const allocateTentacleId = () => {
    let candidateTentacleNumber = 1;
    while (candidateTentacleNumber < Number.MAX_SAFE_INTEGER) {
      const candidateTentacleId = `${TENTACLE_ID_PREFIX}${candidateTentacleNumber}`;
      if (tentacles.has(candidateTentacleId)) {
        candidateTentacleNumber += 1;
        continue;
      }

      if (sessions.has(candidateTentacleId)) {
        candidateTentacleNumber += 1;
        continue;
      }

      if (worktreeManager.hasTentacleWorktree(candidateTentacleId)) {
        candidateTentacleNumber += 1;
        continue;
      }

      return candidateTentacleId;
    }

    throw new Error("Unable to allocate tentacle id.");
  };

  const allocateTentacleAgentId = (tentacleId: string) => {
    const existingAgentIds = new Set(
      getTentacleAgentList(tentacleId).map((agent) => agent.agentId),
    );
    let candidateAgentNumber = 1;
    while (candidateAgentNumber < Number.MAX_SAFE_INTEGER) {
      const candidateAgentId = `${tentacleId}-agent-${candidateAgentNumber}`;
      if (existingAgentIds.has(candidateAgentId) || sessions.has(candidateAgentId)) {
        candidateAgentNumber += 1;
        continue;
      }

      return candidateAgentId;
    }

    throw new Error("Unable to allocate tentacle agent id.");
  };

  const buildRootSnapshot = (tentacle: PersistedTentacle): AgentSnapshot => ({
    agentId: buildRootAgentId(tentacle.tentacleId),
    label: buildRootAgentId(tentacle.tentacleId),
    state: "live",
    tentacleId: tentacle.tentacleId,
    tentacleName: tentacle.tentacleName,
    tentacleWorkspaceMode: tentacle.workspaceMode,
    createdAt: tentacle.createdAt,
  });

  const toTentacleAgentSnapshot = (agent: PersistedTentacleAgent): AgentSnapshot => ({
    agentId: agent.agentId,
    label: agent.label,
    state: "live",
    tentacleId: agent.tentacleId,
    parentAgentId: agent.parentAgentId,
    createdAt: agent.createdAt,
  });

  const createTentacle = ({
    tentacleName,
    workspaceMode = "shared",
    agentProvider,
    initialPrompt,
  }: {
    tentacleName?: string;
    workspaceMode?: TentacleWorkspaceMode;
    agentProvider?: TentacleAgentProvider;
    initialPrompt?: string;
  }): AgentSnapshot => {
    const tentacleId = allocateTentacleId();
    const tentacle: PersistedTentacle = {
      tentacleId,
      tentacleName: tentacleName ?? tentacleId,
      createdAt: new Date().toISOString(),
      workspaceMode,
      agentProvider: agentProvider ?? DEFAULT_AGENT_PROVIDER,
      ...(initialPrompt ? { initialPrompt } : {}),
    };

    const shouldCreateWorktree = workspaceMode === "worktree";
    if (shouldCreateWorktree) {
      worktreeManager.createTentacleWorktree(tentacleId);
    }

    // Install hooks in the tentacle's working directory. For worktree tentacles
    // this writes to the worktree's own .claude/settings.json; for shared
    // tentacles it updates the main workspace's .claude/settings.json so that
    // newly added hook types (e.g. Notification) are always present.
    try {
      const hookTargetCwd = shouldCreateWorktree
        ? worktreeManager.getTentacleWorkspaceCwd(tentacleId)
        : workspaceCwd;
      installHooksInDirectory(hookTargetCwd);
    } catch {
      // Best-effort: hooks installation should not block tentacle creation.
    }

    tentacles.set(tentacleId, tentacle);
    const rootAgentId = buildRootAgentId(tentacleId);
    const initialAgentId = allocateTentacleAgentId(tentacleId);
    setTentacleAgentList(tentacleId, [
      {
        agentId: initialAgentId,
        tentacleId,
        label: initialAgentId,
        createdAt: new Date().toISOString(),
        parentAgentId: rootAgentId,
        order: 0,
      },
    ]);
    persistRegistry();

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
    if (normalized.tentacleCompletionSound !== undefined) {
      result.tentacleCompletionSound = normalized.tentacleCompletionSound;
    }
    return result;
  };

  const resolveWorktreeTentacleContext = (
    tentacleId: string,
  ): { tentacle: PersistedTentacle; workspaceCwd: string } | null => {
    const tentacle = tentacles.get(tentacleId);
    if (!tentacle) {
      return null;
    }

    if (tentacle.workspaceMode !== "worktree") {
      throw new RuntimeInputError(
        "Git lifecycle actions are only available for worktree tentacles.",
      );
    }

    return {
      tentacle,
      workspaceCwd: worktreeManager.getTentacleWorkspaceCwd(tentacleId),
    };
  };

  const readWorktreeGitStatus = (
    tentacleId: string,
    tentacle: PersistedTentacle,
    workspaceCwd: string,
  ): TentacleGitStatusSnapshot => {
    try {
      const status = gitClient.readWorktreeStatus({ cwd: workspaceCwd });
      return {
        tentacleId,
        workspaceMode: tentacle.workspaceMode,
        branchName: status.branchName,
        upstreamBranchName: status.upstreamBranchName,
        isDirty: status.isDirty,
        aheadCount: status.aheadCount,
        behindCount: status.behindCount,
        insertedLineCount: status.insertedLineCount,
        deletedLineCount: status.deletedLineCount,
        hasConflicts: status.hasConflicts,
        changedFiles: [...status.changedFiles],
        defaultBaseBranchName: status.defaultBaseBranchName,
      };
    } catch (error) {
      throw new RuntimeInputError(
        `Unable to read git status for ${tentacleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const toPullRequestStatus = (state: "OPEN" | "MERGED" | "CLOSED") =>
    state === "OPEN" ? "open" : state === "MERGED" ? "merged" : "closed";

  const emptyPullRequestSnapshot = (
    tentacleId: string,
    tentacle: PersistedTentacle,
  ): TentaclePullRequestSnapshot => ({
    tentacleId,
    workspaceMode: tentacle.workspaceMode,
    status: "none",
    number: null,
    url: null,
    title: null,
    baseRef: null,
    headRef: null,
    isDraft: null,
    mergeable: null,
    mergeStateStatus: null,
  });

  const readWorktreePullRequest = (
    tentacleId: string,
    tentacle: PersistedTentacle,
    workspaceCwd: string,
  ): TentaclePullRequestSnapshot => {
    try {
      const pullRequest = gitClient.readCurrentBranchPullRequest({ cwd: workspaceCwd });
      if (!pullRequest) {
        return emptyPullRequestSnapshot(tentacleId, tentacle);
      }

      return {
        tentacleId,
        workspaceMode: tentacle.workspaceMode,
        status: toPullRequestStatus(pullRequest.state),
        number: pullRequest.number,
        url: pullRequest.url,
        title: pullRequest.title,
        baseRef: pullRequest.baseRef,
        headRef: pullRequest.headRef,
        isDraft: pullRequest.isDraft,
        mergeable: pullRequest.mergeable,
        mergeStateStatus: pullRequest.mergeStateStatus,
      };
    } catch (error) {
      throw new RuntimeInputError(
        `Unable to read pull request for ${tentacleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  return {
    listAgentSnapshots(): AgentSnapshot[] {
      const snapshots: AgentSnapshot[] = [];
      for (const tentacle of tentacles.values()) {
        snapshots.push(buildRootSnapshot(tentacle));
        const agents = getTentacleAgentList(tentacle.tentacleId);
        for (const agent of agents) {
          snapshots.push(toTentacleAgentSnapshot(agent));
        }
      }
      return snapshots;
    },

    listConversationSessions() {
      return listConversationSessions(transcriptDirectoryPath);
    },

    readConversationSession(sessionId: string) {
      return readConversationSession(transcriptDirectoryPath, sessionId);
    },

    exportConversationSession(sessionId: string, format: "json" | "md") {
      const conversation = readConversationSession(transcriptDirectoryPath, sessionId);
      if (!conversation) {
        return null;
      }

      if (format === "json") {
        const exported = {
          turns: conversation.turns,
        };
        return `${JSON.stringify(exported, null, 2)}\n`;
      }

      return conversationExportMarkdown(conversation);
    },

    deleteConversationSession(sessionId: string) {
      deleteConversation(transcriptDirectoryPath, sessionId);
    },

    deleteAllConversationSessions() {
      deleteAllConversations(transcriptDirectoryPath);
    },

    searchConversations(query: string) {
      return searchConversations(transcriptDirectoryPath, query);
    },

    readUiState,

    patchUiState(patch: PersistedUiState): PersistedUiState {
      if (patch.activePrimaryNav !== undefined) {
        uiState.activePrimaryNav = patch.activePrimaryNav;
      }
      if (patch.isAgentsSidebarVisible !== undefined) {
        uiState.isAgentsSidebarVisible = patch.isAgentsSidebarVisible;
      }
      if (patch.sidebarWidth !== undefined) {
        uiState.sidebarWidth = patch.sidebarWidth;
      }
      if (patch.isActiveAgentsSectionExpanded !== undefined) {
        uiState.isActiveAgentsSectionExpanded = patch.isActiveAgentsSectionExpanded;
      }
      if (patch.isRuntimeStatusStripVisible !== undefined) {
        uiState.isRuntimeStatusStripVisible = patch.isRuntimeStatusStripVisible;
      }
      if (patch.isMonitorVisible !== undefined) {
        uiState.isMonitorVisible = patch.isMonitorVisible;
      }
      if (patch.isBottomTelemetryVisible !== undefined) {
        uiState.isBottomTelemetryVisible = patch.isBottomTelemetryVisible;
      }
      if (patch.isCodexUsageVisible !== undefined) {
        uiState.isCodexUsageVisible = patch.isCodexUsageVisible;
      }
      if (patch.isClaudeUsageVisible !== undefined) {
        uiState.isClaudeUsageVisible = patch.isClaudeUsageVisible;
      }
      if (patch.isClaudeUsageSectionExpanded !== undefined) {
        uiState.isClaudeUsageSectionExpanded = patch.isClaudeUsageSectionExpanded;
      }
      if (patch.isCodexUsageSectionExpanded !== undefined) {
        uiState.isCodexUsageSectionExpanded = patch.isCodexUsageSectionExpanded;
      }
      if (patch.tentacleCompletionSound !== undefined) {
        uiState.tentacleCompletionSound = patch.tentacleCompletionSound;
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

    readTentacleGitStatus(tentacleId: string): TentacleGitStatusSnapshot | null {
      const context = resolveWorktreeTentacleContext(tentacleId);
      if (!context) {
        return null;
      }

      return readWorktreeGitStatus(tentacleId, context.tentacle, context.workspaceCwd);
    },

    commitTentacleWorktree(tentacleId: string, message: string): TentacleGitStatusSnapshot | null {
      const context = resolveWorktreeTentacleContext(tentacleId);
      if (!context) {
        return null;
      }

      const trimmedMessage = message.trim();
      if (trimmedMessage.length === 0) {
        throw new RuntimeInputError("Commit message cannot be empty.");
      }

      try {
        gitClient.commitAll({
          cwd: context.workspaceCwd,
          message: trimmedMessage,
        });
      } catch (error) {
        throw new RuntimeInputError(
          `Unable to commit ${tentacleId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      return readWorktreeGitStatus(tentacleId, context.tentacle, context.workspaceCwd);
    },

    pushTentacleWorktree(tentacleId: string): TentacleGitStatusSnapshot | null {
      const context = resolveWorktreeTentacleContext(tentacleId);
      if (!context) {
        return null;
      }

      try {
        gitClient.pushCurrentBranch({
          cwd: context.workspaceCwd,
        });
      } catch (error) {
        throw new RuntimeInputError(
          `Unable to push ${tentacleId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return readWorktreeGitStatus(tentacleId, context.tentacle, context.workspaceCwd);
    },

    syncTentacleWorktree(tentacleId: string, baseRef?: string): TentacleGitStatusSnapshot | null {
      const context = resolveWorktreeTentacleContext(tentacleId);
      if (!context) {
        return null;
      }

      const statusBeforeSync = readWorktreeGitStatus(
        tentacleId,
        context.tentacle,
        context.workspaceCwd,
      );
      if (statusBeforeSync.isDirty) {
        throw new RuntimeInputError(
          "Sync requires a clean worktree. Commit or stash changes first.",
        );
      }
      if (statusBeforeSync.hasConflicts) {
        throw new RuntimeInputError("Resolve git conflicts before syncing with base.");
      }

      const normalizedBaseRef = baseRef?.trim();
      const effectiveBaseRef =
        normalizedBaseRef && normalizedBaseRef.length > 0
          ? normalizedBaseRef
          : (statusBeforeSync.defaultBaseBranchName ?? "main");

      try {
        gitClient.syncWithBase({
          cwd: context.workspaceCwd,
          baseRef: effectiveBaseRef,
        });
      } catch (error) {
        throw new RuntimeInputError(
          `Unable to sync ${tentacleId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return readWorktreeGitStatus(tentacleId, context.tentacle, context.workspaceCwd);
    },

    readTentaclePullRequest(tentacleId: string): TentaclePullRequestSnapshot | null {
      const context = resolveWorktreeTentacleContext(tentacleId);
      if (!context) {
        return null;
      }

      return readWorktreePullRequest(tentacleId, context.tentacle, context.workspaceCwd);
    },

    createTentaclePullRequest(
      tentacleId: string,
      input: { title: string; body?: string; baseRef?: string },
    ): TentaclePullRequestSnapshot | null {
      const context = resolveWorktreeTentacleContext(tentacleId);
      if (!context) {
        return null;
      }

      const title = input.title.trim();
      if (title.length === 0) {
        throw new RuntimeInputError("Pull request title cannot be empty.");
      }

      const existingPullRequest = readWorktreePullRequest(
        tentacleId,
        context.tentacle,
        context.workspaceCwd,
      );
      if (existingPullRequest.status === "open") {
        throw new RuntimeInputError("An open pull request already exists for this branch.");
      }

      const status = readWorktreeGitStatus(tentacleId, context.tentacle, context.workspaceCwd);
      if (status.hasConflicts) {
        throw new RuntimeInputError("Resolve git conflicts before creating a pull request.");
      }

      const normalizedBaseRef = input.baseRef?.trim();
      const effectiveBaseRef =
        normalizedBaseRef && normalizedBaseRef.length > 0
          ? normalizedBaseRef
          : (status.defaultBaseBranchName ?? "main");

      try {
        const pullRequest = gitClient.createPullRequest({
          cwd: context.workspaceCwd,
          title,
          body: input.body ?? "",
          baseRef: effectiveBaseRef,
          headRef: status.branchName,
        });
        if (!pullRequest) {
          return readWorktreePullRequest(tentacleId, context.tentacle, context.workspaceCwd);
        }

        return {
          tentacleId,
          workspaceMode: context.tentacle.workspaceMode,
          status: toPullRequestStatus(pullRequest.state),
          number: pullRequest.number,
          url: pullRequest.url,
          title: pullRequest.title,
          baseRef: pullRequest.baseRef,
          headRef: pullRequest.headRef,
          isDraft: pullRequest.isDraft,
          mergeable: pullRequest.mergeable,
          mergeStateStatus: pullRequest.mergeStateStatus,
        };
      } catch (error) {
        throw new RuntimeInputError(
          `Unable to create pull request for ${tentacleId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },

    mergeTentaclePullRequest(tentacleId: string): TentaclePullRequestSnapshot | null {
      const context = resolveWorktreeTentacleContext(tentacleId);
      if (!context) {
        return null;
      }

      const currentPullRequest = readWorktreePullRequest(
        tentacleId,
        context.tentacle,
        context.workspaceCwd,
      );
      if (currentPullRequest.status !== "open") {
        throw new RuntimeInputError("No open pull request found for this branch.");
      }
      if (currentPullRequest.isDraft) {
        throw new RuntimeInputError("Draft pull requests cannot be merged.");
      }
      if (currentPullRequest.mergeable === "CONFLICTING") {
        throw new RuntimeInputError("Pull request has conflicts and cannot be merged.");
      }

      try {
        gitClient.mergeCurrentBranchPullRequest({
          cwd: context.workspaceCwd,
          strategy: "squash",
        });
      } catch (error) {
        throw new RuntimeInputError(
          `Unable to merge pull request for ${tentacleId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      return readWorktreePullRequest(tentacleId, context.tentacle, context.workspaceCwd);
    },

    createTentacle,

    createTentacleAgent({
      tentacleId,
      anchorAgentId,
      placement,
    }: {
      tentacleId: string;
      anchorAgentId: string;
      placement: "up" | "down";
    }): AgentSnapshot | null {
      const tentacle = tentacles.get(tentacleId);
      if (!tentacle) {
        return null;
      }

      const rootAgentId = buildRootAgentId(tentacleId);
      const existingAgents = getTentacleAgentList(tentacleId);
      const orderedAgentIds = [rootAgentId, ...existingAgents.map((agent) => agent.agentId)];
      const anchorIndex = orderedAgentIds.indexOf(anchorAgentId);
      if (anchorIndex === -1) {
        throw new RuntimeInputError("Anchor agent was not found in this tentacle.");
      }

      const nextAgentId = allocateTentacleAgentId(tentacleId);
      const nextAgent: PersistedTentacleAgent = {
        agentId: nextAgentId,
        tentacleId,
        label: nextAgentId,
        createdAt: new Date().toISOString(),
        parentAgentId: rootAgentId,
        order: 0,
      };

      const insertionIndex = placement === "up" ? anchorIndex : anchorIndex + 1;
      const boundedInsertionIndex = Math.max(1, insertionIndex);
      const nextOrderedAgentIds = [...orderedAgentIds];
      nextOrderedAgentIds.splice(boundedInsertionIndex, 0, nextAgentId);
      const nextChildOrder = nextOrderedAgentIds.slice(1);
      const nextAgentById = new Map(
        [...existingAgents, nextAgent].map((agent) => [agent.agentId, agent] as const),
      );
      setTentacleAgentList(
        tentacleId,
        nextChildOrder.map((agentId) => {
          const agent = nextAgentById.get(agentId);
          if (!agent) {
            throw new RuntimeInputError("Unable to reorder tentacle agents.");
          }
          return agent;
        }),
      );
      persistRegistry();

      return toTentacleAgentSnapshot(nextAgent);
    },

    deleteTentacleAgent({
      tentacleId,
      agentId,
    }: {
      tentacleId: string;
      agentId: string;
    }): boolean | null {
      const tentacle = tentacles.get(tentacleId);
      if (!tentacle) {
        return null;
      }

      const rootAgentId = buildRootAgentId(tentacleId);
      if (agentId === rootAgentId) {
        throw new RuntimeInputError("Root terminal cannot be deleted from terminal controls.");
      }

      const existingAgents = getTentacleAgentList(tentacleId);
      if (!existingAgents.some((agent) => agent.agentId === agentId)) {
        return false;
      }

      const nextAgents = existingAgents
        .filter((agent) => agent.agentId !== agentId)
        .map((agent) =>
          agent.parentAgentId === agentId
            ? {
                ...agent,
                parentAgentId: rootAgentId,
              }
            : agent,
        );

      sessionRuntime.closeSession(agentId);
      setTentacleAgentList(tentacleId, nextAgents);
      persistRegistry();
      return true;
    },

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

      const rootAgentId = buildRootAgentId(tentacleId);
      sessionRuntime.closeSession(rootAgentId);
      for (const agent of getTentacleAgentList(tentacleId)) {
        sessionRuntime.closeSession(agent.agentId);
      }
      if (tentacle.workspaceMode === "worktree") {
        worktreeManager.removeTentacleWorktree(tentacleId);
      }
      tentacleAgents.delete(tentacleId);
      tentacles.delete(tentacleId);
      persistRegistry();
      return true;
    },

    handleHook(hookName: string, payload: unknown, octogentSessionId?: string): { ok: boolean } {
      console.log(`[Hook] Received hook: ${hookName} octogentSession=${octogentSessionId ?? "(none)"}`, JSON.stringify(payload));

      if (!payload || typeof payload !== "object") {
        return { ok: true };
      }

      const hookPayloadRecord = payload as Record<string, unknown>;

      // ── Notification hook: detect permission_prompt and idle_prompt ──
      if (hookName === "notification") {
        if (!octogentSessionId) {
          return { ok: true };
        }
        const session = sessions.get(octogentSessionId);
        if (!session) {
          console.log(`[Hook] notification: no session for ${octogentSessionId}, skipping.`);
          return { ok: true };
        }

        const notificationType =
          typeof hookPayloadRecord.notification_type === "string"
            ? hookPayloadRecord.notification_type
            : null;

        console.log(`[Hook] notification: type=${notificationType} session=${octogentSessionId}`);

        if (notificationType === "permission_prompt") {
          session.agentState = "waiting_for_permission";
          session.stateTracker.forceState("waiting_for_permission");
          broadcastMessage(session, { type: "state", state: "waiting_for_permission" });
        } else if (notificationType === "idle_prompt") {
          session.agentState = "waiting_for_user";
          session.stateTracker.forceState("waiting_for_user");
          broadcastMessage(session, { type: "state", state: "waiting_for_user" });
        }

        return { ok: true };
      }

      // ── PreToolUse hook: detect AskUserQuestion tool ──
      if (hookName === "pre-tool-use") {
        if (!octogentSessionId) {
          return { ok: true };
        }
        const session = sessions.get(octogentSessionId);
        if (!session) {
          return { ok: true };
        }

        const toolName =
          typeof hookPayloadRecord.tool_name === "string" ? hookPayloadRecord.tool_name : null;

        console.log(`[Hook] pre-tool-use: tool=${toolName} session=${octogentSessionId}`);

        if (toolName === "AskUserQuestion") {
          session.agentState = "waiting_for_user";
          session.stateTracker.forceState("waiting_for_user");
          broadcastMessage(session, { type: "state", state: "waiting_for_user" });
        }

        return { ok: true };
      }

      if (hookName !== "stop") {
        return { ok: true };
      }

      const hookPayload = payload as Record<string, unknown>;
      const transcriptPath =
        typeof hookPayload.transcript_path === "string" ? hookPayload.transcript_path : null;
      const hookCwd = typeof hookPayload.cwd === "string" ? hookPayload.cwd : null;

      console.log(`[Hook] Stop hook: transcriptPath=${transcriptPath}, hookCwd=${hookCwd}`);

      if (!transcriptPath || !hookCwd) {
        console.log("[Hook] Missing transcriptPath or hookCwd, skipping.");
        return { ok: true };
      }

      // If an octogent session ID was provided (from the OCTOGENT_SESSION_ID env var),
      // use it directly to match the session. This prevents external Claude sessions
      // (e.g. VS Code) from bleeding into tentacle conversation histories.
      let matchedSessionId: string | null = null;

      if (octogentSessionId && sessions.has(octogentSessionId)) {
        matchedSessionId = octogentSessionId;
        console.log(`[Hook] Matched session by octogent_session param: ${matchedSessionId}`);
      } else if (octogentSessionId) {
        // The param was provided but doesn't match any active session — skip.
        console.log(`[Hook] octogent_session=${octogentSessionId} not found in active sessions, skipping.`);
        return { ok: true };
      } else {
        // No octogent_session param — this hook likely came from an external Claude
        // session (e.g. VS Code). Skip to avoid conversation bleed.
        console.log("[Hook] No octogent_session param — ignoring hook from external Claude session.");
        return { ok: true };
      }

      console.log(`[Hook] Matched session: ${matchedSessionId}, parsing transcript...`);
      const turns = parseClaudeTranscript(transcriptPath);
      console.log(`[Hook] Parsed ${turns?.length ?? 0} turns from transcript.`);

      // The Stop hook payload includes the last assistant message which may not
      // yet be written to the transcript file. Append it if it's missing.
      const lastAssistantMessage =
        typeof hookPayload.last_assistant_message === "string"
          ? hookPayload.last_assistant_message.trim()
          : null;

      if (lastAssistantMessage && lastAssistantMessage.length > 0) {
        const effectiveTurns = turns ?? [];
        const lastTurn = effectiveTurns.length > 0 ? effectiveTurns[effectiveTurns.length - 1] : null;

        if (!lastTurn || lastTurn.role !== "assistant" || lastTurn.content !== lastAssistantMessage) {
          const now = new Date().toISOString();
          effectiveTurns.push({
            turnId: `turn-${effectiveTurns.length + 1}`,
            role: "assistant",
            content: lastAssistantMessage,
            startedAt: now,
            endedAt: now,
          });
          console.log(`[Hook] Appended last_assistant_message as final turn.`);
        }

        if (effectiveTurns.length > 0) {
          storeClaudeTranscriptTurns(transcriptDirectoryPath, matchedSessionId, effectiveTurns);
          console.log(`[Hook] Stored ${effectiveTurns.length} turns for session ${matchedSessionId}.`);
        }
      } else if (turns && turns.length > 0) {
        storeClaudeTranscriptTurns(transcriptDirectoryPath, matchedSessionId, turns);
        console.log(`[Hook] Stored ${turns.length} turns for session ${matchedSessionId}.`);
      }

      return { ok: true };
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
