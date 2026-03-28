import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";

import type { TerminalSnapshot } from "@octogent/core";
import { WebSocketServer } from "ws";

import { parseClaudeTranscript } from "./terminalRuntime/claudeTranscript";
import {
  DEFAULT_AGENT_PROVIDER,
  TERMINAL_ID_PREFIX,
  TERMINAL_REGISTRY_RELATIVE_PATH,
  TERMINAL_TRANSCRIPT_RELATIVE_PATH,
} from "./terminalRuntime/constants";
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
  loadTerminalRegistry,
  persistTerminalRegistry,
  pruneUiStateTerminalReferences,
} from "./terminalRuntime/registry";
import { createSessionRuntime } from "./terminalRuntime/sessionRuntime";
import { createDefaultGitClient } from "./terminalRuntime/systemClients";
import type { DirectSessionListener } from "./terminalRuntime/types";
import {
  type ChannelMessage,
  type CreateTerminalRuntimeOptions,
  type PersistedTerminal,
  type PersistedUiState,
  RuntimeInputError,
  type TentacleGitStatusSnapshot,
  type TentaclePullRequestSnapshot,
  type TentacleWorkspaceMode,
  type TerminalAgentProvider,
  type TerminalSession,
} from "./terminalRuntime/types";
import { createWorktreeManager } from "./terminalRuntime/worktreeManager";

export type {
  ChannelMessage,
  DirectSessionListener,
  GitClient,
  PersistedUiState,
  TerminalAgentProvider,
  TerminalCompletionSound,
  TentacleWorkspaceMode,
} from "./terminalRuntime/types";
export { isTerminalAgentProvider, isTerminalCompletionSound } from "./terminalRuntime/types";
export { RuntimeInputError } from "./terminalRuntime/types";

const MAX_AUTO_NAME_LENGTH = 50;

const deriveTerminalNameFromPrompt = (prompt: string): string => {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_AUTO_NAME_LENGTH) {
    return normalized;
  }

  // Truncate at the last space before the limit to avoid cutting mid-word.
  const truncated = normalized.slice(0, MAX_AUTO_NAME_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 0 ? `${truncated.slice(0, lastSpace)}…` : `${truncated}…`;
};

export const createTerminalRuntime = ({
  workspaceCwd,
  gitClient = createDefaultGitClient(),
}: CreateTerminalRuntimeOptions) => {
  const sessions = new Map<string, TerminalSession>();
  const channelQueues = new Map<string, ChannelMessage[]>();
  let channelMessageCounter = 0;
  const websocketServer = new WebSocketServer({ noServer: true });
  const registryPath = join(workspaceCwd, TERMINAL_REGISTRY_RELATIVE_PATH);
  const registryState = loadTerminalRegistry(registryPath);
  const terminals = registryState.terminals;
  let uiState = registryState.uiState;
  const isDebugPtyLogsEnabled = process.env.OCTOGENT_DEBUG_PTY_LOGS === "1";
  const ptyLogDir =
    process.env.OCTOGENT_DEBUG_PTY_LOG_DIR ?? join(workspaceCwd, ".octogent", "logs");
  const transcriptDirectoryPath = join(workspaceCwd, TERMINAL_TRANSCRIPT_RELATIVE_PATH);
  const apiPort = process.env.OCTOGENT_API_PORT ?? process.env.PORT ?? "8787";

  const installHooksInDirectory = (targetCwd: string) => {
    const targetClaudeDir = join(targetCwd, ".claude");
    const targetSettingsPath = join(targetClaudeDir, "settings.json");

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
    uiState = pruneUiStateTerminalReferences(uiState, terminals);
    persistTerminalRegistry(registryPath, {
      terminals,
      uiState,
    });
  };

  const worktreeManager = createWorktreeManager({
    workspaceCwd,
    gitClient,
    terminals,
  });

  const resolveTerminalSession = (
    terminalId: string,
  ): { sessionId: string; tentacleId: string } | null => {
    const terminal = terminals.get(terminalId);
    if (terminal) {
      return {
        sessionId: terminalId,
        tentacleId: terminal.tentacleId,
      };
    }

    return null;
  };

  const sessionRuntime = createSessionRuntime({
    websocketServer,
    terminals,
    sessions,
    resolveTerminalSession,
    getTentacleWorkspaceCwd: worktreeManager.getTentacleWorkspaceCwd,
    isDebugPtyLogsEnabled,
    ptyLogDir,
    transcriptDirectoryPath,
  });

  const allocateTerminalId = () => {
    let candidateNumber = 1;
    while (candidateNumber < Number.MAX_SAFE_INTEGER) {
      const candidateId = `${TERMINAL_ID_PREFIX}${candidateNumber}`;
      if (terminals.has(candidateId)) {
        candidateNumber += 1;
        continue;
      }

      if (sessions.has(candidateId)) {
        candidateNumber += 1;
        continue;
      }

      if (worktreeManager.hasTentacleWorktree(candidateId)) {
        candidateNumber += 1;
        continue;
      }

      return candidateId;
    }

    throw new Error("Unable to allocate terminal id.");
  };

  const toTerminalSnapshot = (terminal: PersistedTerminal): TerminalSnapshot => ({
    terminalId: terminal.terminalId,
    label: terminal.terminalId,
    state: "live",
    tentacleId: terminal.tentacleId,
    tentacleName: terminal.tentacleName,
    workspaceMode: terminal.workspaceMode,
    createdAt: terminal.createdAt,
  });

  const createTerminal = ({
    terminalId: requestedTerminalId,
    tentacleId: requestedTentacleId,
    tentacleName,
    workspaceMode = "shared",
    agentProvider,
    initialPrompt,
    baseRef,
  }: {
    terminalId?: string;
    tentacleId?: string;
    tentacleName?: string;
    workspaceMode?: TentacleWorkspaceMode;
    agentProvider?: TerminalAgentProvider;
    initialPrompt?: string;
    baseRef?: string;
  }): TerminalSnapshot => {
    const terminalId =
      requestedTerminalId && !terminals.has(requestedTerminalId)
        ? requestedTerminalId
        : allocateTerminalId();

    // Allow explicit tentacleId so multiple terminals can share a tentacle context (e.g. swarm workers).
    const tentacleId = requestedTentacleId ?? terminalId;

    const terminal: PersistedTerminal = {
      terminalId,
      tentacleId,
      tentacleName: tentacleName ?? terminalId,
      createdAt: new Date().toISOString(),
      workspaceMode,
      agentProvider: agentProvider ?? DEFAULT_AGENT_PROVIDER,
      ...(initialPrompt ? { initialPrompt } : {}),
    };

    const shouldCreateWorktree = workspaceMode === "worktree";
    if (shouldCreateWorktree) {
      worktreeManager.createTentacleWorktree(tentacleId, baseRef);
    }

    // Install hooks in the terminal's working directory.
    try {
      const hookTargetCwd = shouldCreateWorktree
        ? worktreeManager.getTentacleWorkspaceCwd(tentacleId)
        : workspaceCwd;
      installHooksInDirectory(hookTargetCwd);
    } catch {
      // Best-effort: hooks installation should not block terminal creation.
    }

    terminals.set(terminalId, terminal);
    persistRegistry();

    return toTerminalSnapshot(terminal);
  };

  const readUiState = (): PersistedUiState => {
    const normalized = pruneUiStateTerminalReferences(uiState, terminals);
    const result: PersistedUiState = { ...normalized };
    if (normalized.minimizedTerminalIds) {
      result.minimizedTerminalIds = [...normalized.minimizedTerminalIds];
    }
    if (normalized.terminalWidths) {
      result.terminalWidths = { ...normalized.terminalWidths };
    }
    if (normalized.terminalCompletionSound !== undefined) {
      result.terminalCompletionSound = normalized.terminalCompletionSound;
    }
    return result;
  };

  const resolveWorktreeTentacleContext = (
    tentacleId: string,
  ): { terminal: PersistedTerminal; workspaceCwd: string } | null => {
    // Find any terminal belonging to this tentacle
    let terminal: PersistedTerminal | undefined;
    for (const t of terminals.values()) {
      if (t.tentacleId === tentacleId) {
        terminal = t;
        break;
      }
    }
    if (!terminal) {
      return null;
    }

    if (terminal.workspaceMode !== "worktree") {
      throw new RuntimeInputError(
        "Git lifecycle actions are only available for worktree terminals.",
      );
    }

    return {
      terminal,
      workspaceCwd: worktreeManager.getTentacleWorkspaceCwd(tentacleId),
    };
  };

  const readWorktreeGitStatus = (
    tentacleId: string,
    terminal: PersistedTerminal,
    workspaceCwd: string,
  ): TentacleGitStatusSnapshot => {
    try {
      const status = gitClient.readWorktreeStatus({ cwd: workspaceCwd });
      return {
        tentacleId,
        workspaceMode: terminal.workspaceMode,
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
    terminal: PersistedTerminal,
  ): TentaclePullRequestSnapshot => ({
    tentacleId,
    workspaceMode: terminal.workspaceMode,
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
    terminal: PersistedTerminal,
    workspaceCwd: string,
  ): TentaclePullRequestSnapshot => {
    try {
      const pullRequest = gitClient.readCurrentBranchPullRequest({ cwd: workspaceCwd });
      if (!pullRequest) {
        return emptyPullRequestSnapshot(tentacleId, terminal);
      }

      return {
        tentacleId,
        workspaceMode: terminal.workspaceMode,
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
    listTerminalSnapshots(): TerminalSnapshot[] {
      const snapshots: TerminalSnapshot[] = [];
      for (const terminal of terminals.values()) {
        snapshots.push(toTerminalSnapshot(terminal));
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
      if (patch.terminalCompletionSound !== undefined) {
        uiState.terminalCompletionSound = patch.terminalCompletionSound;
      }
      if (patch.minimizedTerminalIds !== undefined) {
        uiState.minimizedTerminalIds = [...patch.minimizedTerminalIds];
      }
      if (patch.terminalWidths !== undefined) {
        uiState.terminalWidths = { ...patch.terminalWidths };
      }
      if (patch.canvasOpenTerminalIds !== undefined) {
        uiState.canvasOpenTerminalIds = [...patch.canvasOpenTerminalIds];
      }
      if (patch.canvasTerminalsPanelWidth !== undefined) {
        uiState.canvasTerminalsPanelWidth = patch.canvasTerminalsPanelWidth;
      }

      persistRegistry();
      return readUiState();
    },

    readTentacleGitStatus(tentacleId: string): TentacleGitStatusSnapshot | null {
      const context = resolveWorktreeTentacleContext(tentacleId);
      if (!context) {
        return null;
      }

      return readWorktreeGitStatus(tentacleId, context.terminal, context.workspaceCwd);
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

      return readWorktreeGitStatus(tentacleId, context.terminal, context.workspaceCwd);
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

      return readWorktreeGitStatus(tentacleId, context.terminal, context.workspaceCwd);
    },

    syncTentacleWorktree(tentacleId: string, baseRef?: string): TentacleGitStatusSnapshot | null {
      const context = resolveWorktreeTentacleContext(tentacleId);
      if (!context) {
        return null;
      }

      const statusBeforeSync = readWorktreeGitStatus(
        tentacleId,
        context.terminal,
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

      return readWorktreeGitStatus(tentacleId, context.terminal, context.workspaceCwd);
    },

    readTentaclePullRequest(tentacleId: string): TentaclePullRequestSnapshot | null {
      const context = resolveWorktreeTentacleContext(tentacleId);
      if (!context) {
        return null;
      }

      return readWorktreePullRequest(tentacleId, context.terminal, context.workspaceCwd);
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
        context.terminal,
        context.workspaceCwd,
      );
      if (existingPullRequest.status === "open") {
        throw new RuntimeInputError("An open pull request already exists for this branch.");
      }

      const status = readWorktreeGitStatus(tentacleId, context.terminal, context.workspaceCwd);
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
          return readWorktreePullRequest(tentacleId, context.terminal, context.workspaceCwd);
        }

        return {
          tentacleId,
          workspaceMode: context.terminal.workspaceMode,
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
        context.terminal,
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

      return readWorktreePullRequest(tentacleId, context.terminal, context.workspaceCwd);
    },

    createTerminal,

    renameTerminal(terminalId: string, tentacleName: string): TerminalSnapshot | null {
      const terminal = terminals.get(terminalId);
      if (!terminal) {
        return null;
      }

      terminal.tentacleName = tentacleName;
      persistRegistry();
      return toTerminalSnapshot(terminal);
    },

    deleteTerminal(terminalId: string): boolean {
      const terminal = terminals.get(terminalId);
      if (!terminal) {
        return false;
      }

      sessionRuntime.closeSession(terminalId);
      if (terminal.workspaceMode === "worktree") {
        worktreeManager.removeTentacleWorktree(terminal.tentacleId);
      }
      terminals.delete(terminalId);
      persistRegistry();
      return true;
    },

    sendChannelMessage(
      toTerminalId: string,
      fromTerminalId: string,
      content: string,
    ): ChannelMessage | null {
      if (!terminals.has(toTerminalId)) {
        return null;
      }

      channelMessageCounter += 1;
      const message: ChannelMessage = {
        messageId: `msg-${channelMessageCounter}`,
        fromTerminalId,
        toTerminalId,
        content,
        timestamp: new Date().toISOString(),
        delivered: false,
      };

      const queue = channelQueues.get(toTerminalId) ?? [];
      queue.push(message);
      channelQueues.set(toTerminalId, queue);

      console.log(
        `[Channel] Queued message ${message.messageId} from=${fromTerminalId} to=${toTerminalId}`,
      );

      // If the target session is idle, deliver immediately.
      const targetSession = sessions.get(toTerminalId);
      if (targetSession && targetSession.agentState === "idle") {
        this.deliverChannelMessages(toTerminalId);
      }

      return message;
    },

    listChannelMessages(terminalId: string): ChannelMessage[] {
      return channelQueues.get(terminalId) ?? [];
    },

    deliverChannelMessages(terminalId: string): void {
      const queue = channelQueues.get(terminalId);
      if (!queue || queue.length === 0) {
        return;
      }

      const session = sessions.get(terminalId);
      if (!session) {
        return;
      }

      const undelivered = queue.filter((m) => !m.delivered);
      if (undelivered.length === 0) {
        return;
      }

      // Compose all pending messages into a single prompt injection.
      const lines = undelivered.map(
        (m) => `[Channel message from ${m.fromTerminalId}]: ${m.content}`,
      );
      const prompt = `${lines.join("\n")}\r`;

      console.log(`[Channel] Delivering ${undelivered.length} message(s) to ${terminalId}`);

      for (const m of undelivered) {
        m.delivered = true;
      }

      sessionRuntime.writeInput(terminalId, prompt);
    },

    handleHook(hookName: string, payload: unknown, octogentSessionId?: string): { ok: boolean } {
      console.log(
        `[Hook] Received hook: ${hookName} octogentSession=${octogentSessionId ?? "(none)"}`,
        JSON.stringify(payload),
      );

      if (!payload || typeof payload !== "object") {
        return { ok: true };
      }

      const hookPayloadRecord = payload as Record<string, unknown>;

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

          // Deliver any queued channel messages now that the agent is idle.
          this.deliverChannelMessages(octogentSessionId);
        }

        return { ok: true };
      }

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

      if (hookName === "user-prompt-submit") {
        if (!octogentSessionId) {
          return { ok: true };
        }

        const terminal = terminals.get(octogentSessionId);
        if (!terminal) {
          return { ok: true };
        }

        // Auto-name the terminal from the first prompt when it still has its default name.
        if (terminal.tentacleName === terminal.terminalId) {
          const prompt =
            typeof hookPayloadRecord.prompt === "string" ? hookPayloadRecord.prompt.trim() : "";
          if (prompt.length > 0) {
            const derived = deriveTerminalNameFromPrompt(prompt);
            terminal.tentacleName = derived;
            persistRegistry();
            console.log(
              `[Hook] Auto-named terminal ${terminal.terminalId} → "${derived}"`,
            );
          }
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

      let matchedSessionId: string | null = null;

      if (octogentSessionId && sessions.has(octogentSessionId)) {
        matchedSessionId = octogentSessionId;
        console.log(`[Hook] Matched session by octogent_session param: ${matchedSessionId}`);
      } else if (octogentSessionId) {
        console.log(
          `[Hook] octogent_session=${octogentSessionId} not found in active sessions, skipping.`,
        );
        return { ok: true };
      } else {
        console.log(
          "[Hook] No octogent_session param — ignoring hook from external Claude session.",
        );
        return { ok: true };
      }

      console.log(`[Hook] Matched session: ${matchedSessionId}, parsing transcript...`);
      const turns = parseClaudeTranscript(transcriptPath);
      console.log(`[Hook] Parsed ${turns?.length ?? 0} turns from transcript.`);

      const lastAssistantMessage =
        typeof hookPayload.last_assistant_message === "string"
          ? hookPayload.last_assistant_message.trim()
          : null;

      if (lastAssistantMessage && lastAssistantMessage.length > 0) {
        const effectiveTurns = turns ?? [];
        const lastTurn =
          effectiveTurns.length > 0 ? effectiveTurns[effectiveTurns.length - 1] : null;

        if (
          !lastTurn ||
          lastTurn.role !== "assistant" ||
          lastTurn.content !== lastAssistantMessage
        ) {
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
          console.log(
            `[Hook] Stored ${effectiveTurns.length} turns for session ${matchedSessionId}.`,
          );
        }
      } else if (turns && turns.length > 0) {
        storeClaudeTranscriptTurns(transcriptDirectoryPath, matchedSessionId, turns);
        console.log(`[Hook] Stored ${turns.length} turns for session ${matchedSessionId}.`);
      }

      // Deliver any queued channel messages now that the agent is idle.
      if (matchedSessionId) {
        this.deliverChannelMessages(matchedSessionId);
      }

      return { ok: true };
    },

    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      return sessionRuntime.handleUpgrade(request, socket, head);
    },

    connectDirect(terminalId: string, listener: DirectSessionListener): (() => void) | null {
      return sessionRuntime.connectDirect(terminalId, listener);
    },

    writeInput(terminalId: string, data: string): boolean {
      return sessionRuntime.writeInput(terminalId, data);
    },

    resizeTerminal(terminalId: string, cols: number, rows: number): boolean {
      return sessionRuntime.resizeSession(terminalId, cols, rows);
    },

    close() {
      sessionRuntime.close();
      websocketServer.close();
    },
  };
};
