import { buildTerminalList } from "@octogent/core";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useBackendLivenessPolling } from "./app/hooks/useBackendLivenessPolling";
import { useClaudeUsagePolling } from "./app/hooks/useClaudeUsagePolling";
import { useCodexUsagePolling } from "./app/hooks/useCodexUsagePolling";
import { useConsoleKeyboardShortcuts } from "./app/hooks/useConsoleKeyboardShortcuts";
import { useConversationsRuntime } from "./app/hooks/useConversationsRuntime";
import { useGitHubPrimaryViewModel } from "./app/hooks/useGitHubPrimaryViewModel";
import { useGithubSummaryPolling } from "./app/hooks/useGithubSummaryPolling";
import { useInitialColumnsHydration } from "./app/hooks/useInitialColumnsHydration";
import { useMonitorRuntime } from "./app/hooks/useMonitorRuntime";
import { usePersistedUiState } from "./app/hooks/usePersistedUiState";
import { useTerminalBoardInteractions } from "./app/hooks/useTerminalBoardInteractions";
import { useTerminalCompletionNotification } from "./app/hooks/useTerminalCompletionNotification";
import { useTentacleGitLifecycle } from "./app/hooks/useTentacleGitLifecycle";
import { useTerminalMutations } from "./app/hooks/useTerminalMutations";
import { useTerminalNameInputFocus } from "./app/hooks/useTerminalNameInputFocus";
import { useTerminalStateReconciliation } from "./app/hooks/useTerminalStateReconciliation";
import { useUsageHeatmapPolling } from "./app/hooks/useUsageHeatmapPolling";
import { clampSidebarWidth } from "./app/normalizers";
import type { TerminalView } from "./app/types";
import { ActiveAgentsSidebar } from "./components/ActiveAgentsSidebar";
import { SidebarConversationsList } from "./components/SidebarConversationsList";
import type { AgentRuntimeState } from "./components/AgentStateBadge";
import { ConsolePrimaryNav } from "./components/ConsolePrimaryNav";
import { PrimaryViewRouter } from "./components/PrimaryViewRouter";
import { RuntimeStatusStrip } from "./components/RuntimeStatusStrip";
import { ClearAllConversationsDialog } from "./components/ClearAllConversationsDialog";
import { SidebarActionPanel } from "./components/SidebarActionPanel";
import { TelemetryTape } from "./components/TelemetryTape";
import { HttpTerminalSnapshotReader } from "./runtime/HttpTerminalSnapshotReader";
import { buildTerminalSnapshotsUrl } from "./runtime/runtimeEndpoints";

export const App = () => {
  const [terminals, setTerminals] = useState<TerminalView>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [terminalStates, setTerminalStates] = useState<Record<string, AgentRuntimeState>>({});
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [hoveredGitHubOverviewPointIndex, setHoveredGitHubOverviewPointIndex] = useState<
    number | null
  >(null);
  const [deckSidebarContent, setDeckSidebarContent] = useState<ReactNode>(null);
  const [isPendingClearAllConversations, setIsPendingClearAllConversations] = useState(false);
  const terminalsRef = useRef<HTMLElement | null>(null);
  const terminalNameInputRef = useRef<HTMLInputElement | null>(null);

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
    setTerminalWidths,
    sidebarWidth,
    terminalCompletionSound,
    terminalWidths,
    canvasOpenTerminalIds,
    setCanvasOpenTerminalIds,
    canvasTerminalsPanelWidth,
    setCanvasTerminalsPanelWidth,
  } = usePersistedUiState({ columns: terminals });

  const visibleTerminals = useMemo(
    () => terminals.filter((terminal) => !minimizedTerminalIds.includes(terminal.terminalId)),
    [terminals, minimizedTerminalIds],
  );

  useEffect(() => {
    const visibleTerminalIds = new Set(visibleTerminals.map((terminal) => terminal.terminalId));
    setSelectedTerminalId((currentSelectedTerminalId) => {
      if (currentSelectedTerminalId !== null && visibleTerminalIds.has(currentSelectedTerminalId)) {
        return currentSelectedTerminalId;
      }

      return visibleTerminals[0]?.terminalId ?? null;
    });
  }, [visibleTerminals]);

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
    beginTerminalNameEdit,
    cancelTerminalRename,
    clearPendingDeleteTerminal,
    confirmDeleteTerminal,
    createTerminal,
    editingTerminalId,
    isCreatingTerminal,
    isDeletingTerminalId,
    pendingDeleteTerminal,
    requestDeleteTerminal,
    setEditingTerminalId,
    setTerminalNameDraft,
    submitTerminalRename,
    terminalNameDraft,
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
  const {
    handleMaximizeTerminal,
    handleMinimizeTerminal,
    handleTerminalDividerKeyDown,
    handleTerminalDividerPointerDown,
    handleTerminalHeaderWheel,
  } = useTerminalBoardInteractions({
    terminalsRef,
    visibleColumns: visibleTerminals,
    terminalWidths,
    setTerminalWidths,
    setMinimizedTerminalIds,
    editingTerminalId,
    setEditingTerminalId,
    setTerminalNameDraft,
  });

  useTerminalNameInputFocus({
    columns: terminals,
    editingTerminalId,
    setEditingTerminalId,
    terminalNameInputRef,
  });
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
    enabled: isUiStateHydrated && activePrimaryNav === 5,
  });

  const { heatmapData, isLoadingHeatmap, refreshHeatmap } = useUsageHeatmapPolling({
    enabled: isUiStateHydrated && activePrimaryNav === 3,
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

  return (
    <div className="page console-shell">
      {isRuntimeStatusStripVisible && (
        <RuntimeStatusStrip
          githubCommitCount30d={githubCommitCount30d}
          githubOpenIssuesLabel={githubOpenIssuesLabel}
          githubOpenPrsLabel={githubOpenPrsLabel}
          githubRepoLabel={githubRepoLabel}
          githubStarCountLabel={githubStarCountLabel}
          githubStatusPill={githubStatusPill}
          sparklinePoints={sparklinePoints}
        />
      )}

      <ConsolePrimaryNav
        activePrimaryNav={activePrimaryNav}
        onPrimaryNavChange={setActivePrimaryNav}
      />

      <section className="console-main-canvas" aria-label="Main content canvas">
        <div
          className={`workspace-shell${isAgentsSidebarVisible && activePrimaryNav !== 3 ? "" : " workspace-shell--full"}`}
        >
          {isAgentsSidebarVisible && activePrimaryNav !== 3 && (
            <ActiveAgentsSidebar
              claudeUsageSnapshot={claudeUsageSnapshot}
              claudeUsageStatus={claudeUsageSnapshot?.status ?? "loading"}
              terminals={terminals.filter((t) => !t.tentacleName?.includes("sandbox"))}
              codexUsageSnapshot={codexUsageSnapshot}
              codexUsageStatus={codexUsageSnapshot?.status ?? "loading"}
              isLoading={isLoading}
              loadError={loadError}
              sidebarWidth={sidebarWidth}
              onSidebarWidthChange={(width) => {
                setSidebarWidth(clampSidebarWidth(width));
              }}
              isActiveAgentsSectionExpanded={isActiveAgentsSectionExpanded}
              onActiveAgentsSectionExpandedChange={setIsActiveAgentsSectionExpanded}
              isClaudeUsageVisible={
                activePrimaryNav !== 2 && activePrimaryNav !== 5 && isClaudeUsageVisible
              }
              isClaudeUsageSectionExpanded={isClaudeUsageSectionExpanded}
              isCodexUsageVisible={
                activePrimaryNav !== 2 && activePrimaryNav !== 5 && isCodexUsageVisible
              }
              onClaudeUsageSectionExpandedChange={setIsClaudeUsageSectionExpanded}
              isCodexUsageSectionExpanded={isCodexUsageSectionExpanded}
              onCodexUsageSectionExpandedChange={setIsCodexUsageSectionExpanded}
              terminalStates={terminalStates}
              minimizedTerminalIds={minimizedTerminalIds}
              onMaximizeTerminal={handleMaximizeTerminal}
              onRefreshClaudeUsage={refreshClaudeUsage}
              onRefreshCodexUsage={refreshCodexUsage}
              actionPanel={sidebarActionPanel}
              bodyContent={
                activePrimaryNav === 2 ? (
                  (deckSidebarContent ?? undefined)
                ) : activePrimaryNav === 5 ? (
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
              isBottomTelemetryVisible,
              isClaudeUsageVisible,
              isCodexUsageVisible,
              isMonitorVisible,
              isRuntimeStatusStripVisible,
              onBottomTelemetryVisibilityChange: setIsBottomTelemetryVisible,
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
              canvasTerminalsPanelWidth,
              onCanvasOpenTerminalIdsChange: setCanvasOpenTerminalIds,
              onCanvasTerminalsPanelWidthChange: setCanvasTerminalsPanelWidth,
              onCreateAgent: async (tentacleId) => {
                void createTerminal("shared", undefined, tentacleId);
                return undefined;
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
            terminalBoardProps={{
              terminals,
              editingTerminalId: editingTerminalId,
              gitStatusByTentacleId,
              gitStatusLoadingByTentacleId,
              pullRequestByTentacleId,
              pullRequestLoadingByTentacleId,
              isDeletingTerminalId: isDeletingTerminalId,
              isLoading,
              loadError,
              onBeginTerminalNameEdit: beginTerminalNameEdit,
              onCancelTerminalRename: cancelTerminalRename,
              onMinimizeTerminal: handleMinimizeTerminal,
              onOpenTerminalGitActions: (terminalId) => {
                setIsAgentsSidebarVisible(true);
                openTentacleGitActions(terminalId);
              },
              onRequestDeleteTerminal: (terminalId, terminalName, workspaceMode) => {
                setIsAgentsSidebarVisible(true);
                closeTentacleGitActions();
                requestDeleteTerminal(terminalId, terminalName, {
                  workspaceMode,
                  intent: "delete-terminal",
                });
              },
              onSubmitTerminalRename: (terminalId, currentTerminalName) => {
                void submitTerminalRename(terminalId, currentTerminalName);
              },
              onTerminalDividerKeyDown: handleTerminalDividerKeyDown,
              onTerminalDividerPointerDown: handleTerminalDividerPointerDown,
              onTerminalHeaderWheel: handleTerminalHeaderWheel,
              onTerminalNameDraftChange: setTerminalNameDraft,
              onSelectTerminal: setSelectedTerminalId,
              onTerminalStateChange: handleTerminalStateChange,
              selectedTerminalId,
              terminalNameDraft: terminalNameDraft,
              terminalNameInputRef,
              terminalWidths: terminalWidths,
              terminalsRef,
              visibleTerminals,
            }}
          />
        </div>
      </section>

      {isMonitorVisible && isBottomTelemetryVisible && <TelemetryTape monitorFeed={monitorFeed} />}
    </div>
  );
};
