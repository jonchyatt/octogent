import { buildTerminalList } from "@octogent/core";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { useBackendLivenessPolling } from "./app/hooks/useBackendLivenessPolling";
import { OCTOBOSS_ID } from "./app/hooks/useCanvasGraphData";
import { useClaudeUsagePolling } from "./app/hooks/useClaudeUsagePolling";
import { useCodexUsagePolling } from "./app/hooks/useCodexUsagePolling";
import { useConsoleKeyboardShortcuts } from "./app/hooks/useConsoleKeyboardShortcuts";
import { useConversationsRuntime } from "./app/hooks/useConversationsRuntime";
import { useGitHubPrimaryViewModel } from "./app/hooks/useGitHubPrimaryViewModel";
import { useGithubSummaryPolling } from "./app/hooks/useGithubSummaryPolling";
import { useInitialColumnsHydration } from "./app/hooks/useInitialColumnsHydration";
import { useMonitorRuntime } from "./app/hooks/useMonitorRuntime";
import { usePersistedUiState } from "./app/hooks/usePersistedUiState";
import { useTentacleGitLifecycle } from "./app/hooks/useTentacleGitLifecycle";
import { useTerminalCompletionNotification } from "./app/hooks/useTerminalCompletionNotification";
import { useTerminalMutations } from "./app/hooks/useTerminalMutations";
import { useTerminalStateReconciliation } from "./app/hooks/useTerminalStateReconciliation";
import { useUsageHeatmapPolling } from "./app/hooks/useUsageHeatmapPolling";
import { clampSidebarWidth } from "./app/normalizers";
import type { TerminalView } from "./app/types";
import { ActiveAgentsSidebar } from "./components/ActiveAgentsSidebar";
import type { AgentRuntimeState } from "./components/AgentStateBadge";
import { ClearAllConversationsDialog } from "./components/ClearAllConversationsDialog";
import { ConsolePrimaryNav } from "./components/ConsolePrimaryNav";
import { PrimaryViewRouter } from "./components/PrimaryViewRouter";
import { RuntimeStatusStrip } from "./components/RuntimeStatusStrip";
import { SidebarActionPanel } from "./components/SidebarActionPanel";
import { SidebarConversationsList } from "./components/SidebarConversationsList";
import { TelemetryTape } from "./components/TelemetryTape";
import { HttpTerminalSnapshotReader } from "./runtime/HttpTerminalSnapshotReader";
import { buildTerminalSnapshotsUrl } from "./runtime/runtimeEndpoints";

export const App = () => {
  const [terminals, setTerminals] = useState<TerminalView>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [terminalStates, setTerminalStates] = useState<Record<string, AgentRuntimeState>>({});
  const [hoveredGitHubOverviewPointIndex, setHoveredGitHubOverviewPointIndex] = useState<
    number | null
  >(null);
  const [deckSidebarContent, setDeckSidebarContent] = useState<ReactNode>(null);
  const [isPendingClearAllConversations, setIsPendingClearAllConversations] = useState(false);

  const {
    activePrimaryNav,
    setActivePrimaryNav,
    applyHydratedUiState,
    isActiveAgentsSectionExpanded,
    isAgentsSidebarVisible,
    isBottomTelemetryVisible,
    isClaudeUsageVisible,
    isClaudeUsageSectionExpanded,
    isCodexUsageVisible,
    isCodexUsageSectionExpanded,
    isMonitorVisible,
    isRuntimeStatusStripVisible,
    isUiStateHydrated,
    minimizedTerminalIds,
    readUiState,
    setIsActiveAgentsSectionExpanded,
    setIsAgentsSidebarVisible,
    setIsBottomTelemetryVisible,
    setIsClaudeUsageVisible,
    setIsClaudeUsageSectionExpanded,
    setIsCodexUsageVisible,
    setIsCodexUsageSectionExpanded,
    setIsMonitorVisible,
    setIsRuntimeStatusStripVisible,
    setIsUiStateHydrated,
    setMinimizedTerminalIds,
    setSidebarWidth,
    setTerminalCompletionSound,
    sidebarWidth,
    terminalCompletionSound,
    canvasOpenTerminalIds,
    setCanvasOpenTerminalIds,
    canvasOpenTentacleIds,
    setCanvasOpenTentacleIds,
    canvasTerminalsPanelWidth,
    setCanvasTerminalsPanelWidth,
  } = usePersistedUiState({ columns: terminals });

  const readColumns = useCallback(async (signal?: AbortSignal) => {
    const readerOptions: { endpoint: string; signal?: AbortSignal } = {
      endpoint: buildTerminalSnapshotsUrl(),
    };
    if (signal) {
      readerOptions.signal = signal;
    }
    const reader = new HttpTerminalSnapshotReader(readerOptions);
    return buildTerminalList(reader);
  }, []);

  const {
    clearPendingDeleteTerminal,
    confirmDeleteTerminal,
    createTerminal,
    isCreatingTerminal,
    isDeletingTerminalId,
    pendingDeleteTerminal,
    requestDeleteTerminal,
  } = useTerminalMutations({
    readColumns: async () => readColumns(),
    setColumns: setTerminals,
    setLoadError,
    setMinimizedTerminalIds,
  });

  const {
    gitStatusByTentacleId,
    gitStatusLoadingByTentacleId,
    pullRequestByTentacleId,
    pullRequestLoadingByTentacleId,
    openGitTentacleId,
    openGitTentacleStatus,
    openGitTentaclePullRequest,
    gitCommitMessageDraft,
    gitDialogError,
    isGitDialogLoading,
    isGitDialogMutating,
    setGitCommitMessageDraft,
    openTentacleGitActions,
    closeTentacleGitActions,
    commitTentacleChanges,
    commitAndPushTentacleBranch,
    pushTentacleBranch,
    syncTentacleBranch,
    mergeTentaclePullRequest,
  } = useTentacleGitLifecycle({
    columns: terminals,
  });

  useInitialColumnsHydration({
    readColumns,
    readUiState,
    applyHydratedUiState,
    setColumns: setTerminals,
    setLoadError,
    setIsLoading,
    setIsUiStateHydrated,
  });

  const { codexUsageSnapshot, refreshCodexUsage } = useCodexUsagePolling();
  const { claudeUsageSnapshot, refreshClaudeUsage } = useClaudeUsagePolling();
  const backendLivenessStatus = useBackendLivenessPolling();
  const { githubRepoSummary, isRefreshingGitHubSummary, refreshGitHubRepoSummary } =
    useGithubSummaryPolling();
  const handleMaximizeTerminal = useCallback(
    (terminalId: string) => {
      setMinimizedTerminalIds((current) =>
        current.filter((currentTerminalId) => currentTerminalId !== terminalId),
      );
    },
    [setMinimizedTerminalIds],
  );

  useTerminalStateReconciliation({
    columns: terminals,
    setMinimizedTerminalIds,
    setTerminalStates,
  });
  const { playCompletionSoundPreview } = useTerminalCompletionNotification(
    terminalStates,
    terminalCompletionSound,
  );
  const {
    monitorConfig,
    monitorFeed,
    monitorError,
    isRefreshingMonitorFeed,
    isSavingMonitorConfig,
    refreshMonitorFeed,
    patchMonitorConfig,
  } = useMonitorRuntime({
    enabled: isUiStateHydrated && isMonitorVisible,
  });
  const {
    sessions: conversationSessions,
    selectedSessionId,
    selectedSession,
    isLoadingSessions: isLoadingConversationSessions,
    isLoadingSelectedSession,
    isExporting: isExportingConversation,
    isClearing: isClearingConversations,
    isSearching: isSearchingConversations,
    searchQuery: conversationsSearchQuery,
    searchHits: conversationsSearchHits,
    highlightedTurnId: conversationsHighlightedTurnId,
    errorMessage: conversationsErrorMessage,
    selectSession,
    refreshSessions,
    clearAllSessions,
    deleteSession,
    exportSession,
    searchConversations,
    clearSearch: clearConversationsSearch,
    navigateToSearchHit: navigateToConversationSearchHit,
  } = useConversationsRuntime({
    enabled: isUiStateHydrated && activePrimaryNav === 6,
  });

  const { heatmapData, isLoadingHeatmap, refreshHeatmap } = useUsageHeatmapPolling({
    enabled: isUiStateHydrated && (activePrimaryNav === 3 || isRuntimeStatusStripVisible),
  });

  useConsoleKeyboardShortcuts({ setActivePrimaryNav });

  const {
    githubCommitCount30d,
    sparklinePoints,
    githubOverviewGraphSeries,
    githubOverviewGraphPolylinePoints,
    githubOverviewHoverLabel,
    githubStatusPill,
    githubRepoLabel,
    githubStarCountLabel,
    githubOpenIssuesLabel,
    githubOpenPrsLabel,
    githubRecentCommits,
  } = useGitHubPrimaryViewModel({
    githubRepoSummary,
    hoveredGitHubOverviewPointIndex,
    setHoveredGitHubOverviewPointIndex,
  });
  const hasSidebarActionPanel =
    isPendingClearAllConversations ||
    pendingDeleteTerminal !== null ||
    (openGitTentacleId !== null &&
      terminals.find((terminal) => terminal.tentacleId === openGitTentacleId)?.workspaceMode ===
        "worktree");

  const sidebarActionPanel = hasSidebarActionPanel ? (
    isPendingClearAllConversations ? (
      <ClearAllConversationsDialog
        sessionCount={conversationSessions.length}
        isClearing={isClearingConversations}
        onCancel={() => {
          setIsPendingClearAllConversations(false);
        }}
        onConfirm={() => {
          void clearAllSessions().then(() => {
            setIsPendingClearAllConversations(false);
          });
        }}
      />
    ) : (
      <SidebarActionPanel
        pendingDeleteTerminal={pendingDeleteTerminal}
        isDeletingTerminalId={isDeletingTerminalId}
        clearPendingDeleteTerminal={clearPendingDeleteTerminal}
        confirmDeleteTerminal={confirmDeleteTerminal}
        openGitTentacleId={openGitTentacleId}
        columns={terminals}
        openGitTentacleStatus={openGitTentacleStatus}
        openGitTentaclePullRequest={openGitTentaclePullRequest}
        gitCommitMessageDraft={gitCommitMessageDraft}
        gitDialogError={gitDialogError}
        isGitDialogLoading={isGitDialogLoading}
        isGitDialogMutating={isGitDialogMutating}
        setGitCommitMessageDraft={setGitCommitMessageDraft}
        closeTentacleGitActions={closeTentacleGitActions}
        commitTentacleChanges={commitTentacleChanges}
        commitAndPushTentacleBranch={commitAndPushTentacleBranch}
        pushTentacleBranch={pushTentacleBranch}
        syncTentacleBranch={syncTentacleBranch}
        mergeTentaclePullRequest={mergeTentaclePullRequest}
        requestDeleteTerminal={requestDeleteTerminal}
      />
    )
  ) : null;

  useEffect(() => {
    if (!hasSidebarActionPanel || isAgentsSidebarVisible) {
      return;
    }
    setIsAgentsSidebarVisible(true);
  }, [isAgentsSidebarVisible, setIsAgentsSidebarVisible, hasSidebarActionPanel]);

  const handleTerminalStateChange = useCallback((terminalId: string, state: AgentRuntimeState) => {
    setTerminalStates((current) => {
      if (current[terminalId] === state) {
        return current;
      }

      return {
        ...current,
        [terminalId]: state,
      };
    });
  }, []);

  const handleTerminalRenamed = useCallback((terminalId: string, tentacleName: string) => {
    setTerminals((current) =>
      current.map((t) =>
        t.terminalId === terminalId ? { ...t, tentacleName, label: tentacleName } : t,
      ),
    );
  }, []);

  const handleTerminalActivity = useCallback((terminalId: string) => {
    setTerminals((current) =>
      current.map((t) => (t.terminalId === terminalId ? { ...t, hasUserPrompt: true } : t)),
    );
  }, []);

  return (
    <div className="page console-shell">
      {isRuntimeStatusStripVisible && (
        <RuntimeStatusStrip
          sparklinePoints={sparklinePoints}
          usageData={heatmapData}
          claudeUsage={claudeUsageSnapshot}
          onRefreshClaudeUsage={refreshClaudeUsage}
        />
      )}

      <ConsolePrimaryNav
        activePrimaryNav={activePrimaryNav}
        onPrimaryNavChange={setActivePrimaryNav}
      />

      <section className="console-main-canvas" aria-label="Main content canvas">
        <div
          className={`workspace-shell${isAgentsSidebarVisible && activePrimaryNav !== 1 && activePrimaryNav !== 3 && activePrimaryNav !== 4 && activePrimaryNav !== 5 && activePrimaryNav !== 7 ? "" : " workspace-shell--full"}`}
        >
          {isAgentsSidebarVisible &&
            activePrimaryNav !== 1 &&
            activePrimaryNav !== 3 &&
            activePrimaryNav !== 4 &&
            activePrimaryNav !== 5 &&
            activePrimaryNav !== 7 && (
              <ActiveAgentsSidebar
                sidebarWidth={sidebarWidth}
                onSidebarWidthChange={(width) => {
                  setSidebarWidth(clampSidebarWidth(width));
                }}
                actionPanel={sidebarActionPanel}
                bodyContent={
                  activePrimaryNav === 2 ? (
                    (deckSidebarContent ?? undefined)
                  ) : activePrimaryNav === 6 ? (
                    <SidebarConversationsList
                      sessions={conversationSessions}
                      selectedSessionId={selectedSessionId}
                      isLoadingSessions={isLoadingConversationSessions}
                      isSearching={isSearchingConversations}
                      searchQuery={conversationsSearchQuery}
                      searchHits={conversationsSearchHits}
                      onSelectSession={selectSession}
                      onRefresh={() => {
                        void refreshSessions();
                      }}
                      onClearAll={() => {
                        setIsPendingClearAllConversations(true);
                      }}
                      onSearch={(query) => {
                        void searchConversations(query);
                      }}
                      onClearSearch={clearConversationsSearch}
                      onNavigateToHit={navigateToConversationSearchHit}
                    />
                  ) : undefined
                }
              />
            )}

          <PrimaryViewRouter
            activePrimaryNav={activePrimaryNav}
            onDeckSidebarContent={setDeckSidebarContent}
            isMonitorVisible={isMonitorVisible}
            activityPrimaryViewProps={{
              usageChartProps: {
                data: heatmapData,
                isLoading: isLoadingHeatmap,
                onRefresh: refreshHeatmap,
              },
              githubPrimaryViewProps: {
                githubCommitCount30d,
                githubOpenIssuesLabel,
                githubOpenPrsLabel,
                githubRecentCommits,
                githubOverviewGraphPolylinePoints,
                githubOverviewGraphSeries,
                githubOverviewHoverLabel,
                githubRepoLabel,
                githubStarCountLabel,
                githubStatusPill,
                hoveredGitHubOverviewPointIndex,
                isRefreshingGitHubSummary,
                onHoveredGitHubOverviewPointIndexChange: setHoveredGitHubOverviewPointIndex,
                onRefresh: () => {
                  void refreshGitHubRepoSummary();
                },
              },
            }}
            monitorPrimaryViewProps={{
              isRefreshingMonitorFeed,
              isSavingMonitorConfig,
              monitorConfig,
              monitorError,
              monitorFeed,
              onPatchConfig: patchMonitorConfig,
              onRefresh: () => {
                void refreshMonitorFeed(true);
              },
              onSyncFeed: () => {
                void refreshMonitorFeed(false);
              },
            }}
            settingsPrimaryViewProps={{
              isClaudeUsageVisible,
              isCodexUsageVisible,
              isMonitorVisible,
              isRuntimeStatusStripVisible,
              onClaudeUsageVisibilityChange: setIsClaudeUsageVisible,
              onCodexUsageVisibilityChange: setIsCodexUsageVisible,
              onMonitorVisibilityChange: setIsMonitorVisible,
              onRuntimeStatusStripVisibilityChange: setIsRuntimeStatusStripVisible,
              onPreviewTerminalCompletionSound: playCompletionSoundPreview,
              onTerminalCompletionSoundChange: setTerminalCompletionSound,
              terminalCompletionSound,
            }}
            canvasPrimaryViewProps={{
              columns: terminals,
              isUiStateHydrated,
              canvasOpenTerminalIds,
              canvasOpenTentacleIds,
              canvasTerminalsPanelWidth,
              onCanvasOpenTerminalIdsChange: setCanvasOpenTerminalIds,
              onCanvasOpenTentacleIdsChange: setCanvasOpenTentacleIds,
              onCanvasTerminalsPanelWidthChange: setCanvasTerminalsPanelWidth,
              onCreateAgent: async (tentacleId) => {
                return await createTerminal("shared", undefined, tentacleId);
              },
              onCreateTerminal: async () => {
                return await createTerminal("shared", undefined, OCTOBOSS_ID);
              },
              onCreateWorktreeTerminal: async () => {
                return await createTerminal("worktree", undefined, OCTOBOSS_ID);
              },
              onCreateTentacle: async () => {
                const response = await fetch("/api/deck/tentacles", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: "", description: "" }),
                });
                if (!response.ok) return;
                const nextColumns = await readColumns();
                setTerminals(nextColumns);
              },
              onSpawnSwarm: async (tentacleId) => {
                await fetch(`/api/deck/tentacles/${encodeURIComponent(tentacleId)}/swarm`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({}),
                });
                const nextColumns = await readColumns();
                setTerminals(nextColumns);
              },
              onOctobossAction: async (action) => {
                const response = await fetch("/api/terminals", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    workspaceMode: "shared",
                    tentacleId: OCTOBOSS_ID,
                    promptTemplate: action,
                  }),
                });
                if (!response.ok) return undefined;
                const snapshot = (await response.json()) as { terminalId?: string };
                const nextColumns = await readColumns();
                setTerminals(nextColumns);
                return typeof snapshot.terminalId === "string" ? snapshot.terminalId : undefined;
              },
              onNavigateToConversation: (sessionId) => {
                selectSession(sessionId);
                setActivePrimaryNav(5);
              },
              onDeleteActiveSession: (terminalId, terminalName, workspaceMode) => {
                requestDeleteTerminal(terminalId, terminalName, {
                  workspaceMode: workspaceMode === "worktree" ? "worktree" : "shared",
                  intent: "delete-terminal",
                });
              },
              pendingDeleteTerminal,
              isDeletingTerminalId,
              onCancelDelete: clearPendingDeleteTerminal,
              onConfirmDelete: () => {
                void confirmDeleteTerminal();
              },
              onTerminalRenamed: handleTerminalRenamed,
              onTerminalActivity: handleTerminalActivity,
              onRefreshColumns: () => {
                void readColumns().then(setTerminals);
              },
            }}
            conversationsPrimaryViewProps={{
              errorMessage: conversationsErrorMessage,
              highlightedTurnId: conversationsHighlightedTurnId,
              searchQuery: conversationsSearchQuery,
              isExporting: isExportingConversation,
              isDeletingSession: false,
              isLoadingSelectedSession,
              isLoadingSessions: isLoadingConversationSessions,
              onDeleteSession: () => {
                if (selectedSessionId) {
                  void deleteSession(selectedSessionId);
                }
              },
              onExport: (format) => {
                if (!selectedSessionId) {
                  return;
                }

                void exportSession(selectedSessionId, format).then((result) => {
                  if (!result) {
                    return;
                  }

                  const blob = new Blob([result.content], { type: result.contentType });
                  const objectUrl = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = objectUrl;
                  anchor.download = result.filename;
                  document.body.append(anchor);
                  anchor.click();
                  anchor.remove();
                  URL.revokeObjectURL(objectUrl);
                });
              },
              selectedSession,
              sessions: conversationSessions,
            }}
          />
        </div>
      </section>

      {isMonitorVisible && isBottomTelemetryVisible && <TelemetryTape monitorFeed={monitorFeed} />}
    </div>
  );
};
