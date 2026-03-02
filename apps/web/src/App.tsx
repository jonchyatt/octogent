import { buildTentacleColumns } from "@octogent/core";
import { useCallback, useMemo, useRef, useState } from "react";

import { type GitHubSubtabId, PRIMARY_NAV_ITEMS, type PrimaryNavIndex } from "./app/constants";
import { useBackendLivenessPolling } from "./app/hooks/useBackendLivenessPolling";
import { useCodexUsagePolling } from "./app/hooks/useCodexUsagePolling";
import { useConsoleKeyboardShortcuts } from "./app/hooks/useConsoleKeyboardShortcuts";
import { useGitHubPrimaryViewModel } from "./app/hooks/useGitHubPrimaryViewModel";
import { useGithubSummaryPolling } from "./app/hooks/useGithubSummaryPolling";
import { useInitialColumnsHydration } from "./app/hooks/useInitialColumnsHydration";
import { useMonitorRuntime } from "./app/hooks/useMonitorRuntime";
import { usePersistedUiState } from "./app/hooks/usePersistedUiState";
import { useTentacleBoardInteractions } from "./app/hooks/useTentacleBoardInteractions";
import { useTentacleMutations } from "./app/hooks/useTentacleMutations";
import { useTentacleNameInputFocus } from "./app/hooks/useTentacleNameInputFocus";
import { useTentacleStateReconciliation } from "./app/hooks/useTentacleStateReconciliation";
import { clampSidebarWidth } from "./app/normalizers";
import type { TentacleView } from "./app/types";
import { ActiveAgentsSidebar } from "./components/ActiveAgentsSidebar";
import type { CodexState } from "./components/CodexStateBadge";
import { ConsoleHeader } from "./components/ConsoleHeader";
import { ConsolePrimaryNav } from "./components/ConsolePrimaryNav";
import { DeleteTentacleDialog } from "./components/DeleteTentacleDialog";
import { GitHubPrimaryView } from "./components/GitHubPrimaryView";
import { MonitorPrimaryView } from "./components/MonitorPrimaryView";
import { RuntimeStatusStrip } from "./components/RuntimeStatusStrip";
import { TelemetryTape } from "./components/TelemetryTape";
import { TentacleBoard } from "./components/TentacleBoard";
import { HttpAgentSnapshotReader } from "./runtime/HttpAgentSnapshotReader";
import { buildAgentSnapshotsUrl } from "./runtime/runtimeEndpoints";

export const App = () => {
  const [columns, setColumns] = useState<TentacleView>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tentacleStates, setTentacleStates] = useState<Record<string, CodexState>>({});
  const [activePrimaryNav, setActivePrimaryNav] = useState<PrimaryNavIndex>(0);
  const [activeGitHubSubtab, setActiveGitHubSubtab] = useState<GitHubSubtabId>("overview");
  const [hoveredGitHubOverviewPointIndex, setHoveredGitHubOverviewPointIndex] = useState<
    number | null
  >(null);
  const tentaclesRef = useRef<HTMLElement | null>(null);
  const tentacleNameInputRef = useRef<HTMLInputElement | null>(null);

  const {
    applyHydratedUiState,
    isActiveAgentsSectionExpanded,
    isAgentsSidebarVisible,
    isCodexUsageSectionExpanded,
    isUiStateHydrated,
    minimizedTentacleIds,
    readUiState,
    setIsActiveAgentsSectionExpanded,
    setIsAgentsSidebarVisible,
    setIsCodexUsageSectionExpanded,
    setIsUiStateHydrated,
    setMinimizedTentacleIds,
    setSidebarWidth,
    setTentacleWidths,
    sidebarWidth,
    tentacleWidths,
  } = usePersistedUiState({ columns });

  const visibleColumns = useMemo(
    () => columns.filter((column) => !minimizedTentacleIds.includes(column.tentacleId)),
    [columns, minimizedTentacleIds],
  );

  const readColumns = useCallback(async (signal?: AbortSignal) => {
    const readerOptions: { endpoint: string; signal?: AbortSignal } = {
      endpoint: buildAgentSnapshotsUrl(),
    };
    if (signal) {
      readerOptions.signal = signal;
    }
    const reader = new HttpAgentSnapshotReader(readerOptions);
    return buildTentacleColumns(reader);
  }, []);

  const {
    beginTentacleNameEdit,
    cancelTentacleRename,
    clearPendingDeleteTentacle,
    confirmDeleteTentacle,
    createTentacle,
    editingTentacleId,
    isCreatingTentacle,
    isDeletingTentacleId,
    pendingDeleteTentacle,
    requestDeleteTentacle,
    setEditingTentacleId,
    setTentacleNameDraft,
    submitTentacleRename,
    tentacleNameDraft,
  } = useTentacleMutations({
    readColumns: async () => readColumns(),
    setColumns,
    setLoadError,
    setMinimizedTentacleIds,
  });

  useInitialColumnsHydration({
    readColumns,
    readUiState,
    applyHydratedUiState,
    setColumns,
    setLoadError,
    setIsLoading,
    setIsUiStateHydrated,
  });

  const codexUsageSnapshot = useCodexUsagePolling();
  const backendLivenessStatus = useBackendLivenessPolling();
  const { githubRepoSummary, isRefreshingGitHubSummary, refreshGitHubRepoSummary } =
    useGithubSummaryPolling();
  const {
    handleMaximizeTentacle,
    handleMinimizeTentacle,
    handleTentacleDividerKeyDown,
    handleTentacleDividerPointerDown,
    handleTentacleHeaderWheel,
  } = useTentacleBoardInteractions({
    tentaclesRef,
    visibleColumns,
    tentacleWidths,
    setTentacleWidths,
    setMinimizedTentacleIds,
    editingTentacleId,
    setEditingTentacleId,
    setTentacleNameDraft,
  });

  useTentacleNameInputFocus({
    columns,
    editingTentacleId,
    setEditingTentacleId,
    tentacleNameInputRef,
  });
  useTentacleStateReconciliation({
    columns,
    setMinimizedTentacleIds,
    setTentacleStates,
  });
  const {
    monitorConfig,
    monitorFeed,
    monitorError,
    isRefreshingMonitorFeed,
    isSavingMonitorConfig,
    refreshMonitorFeed,
    patchMonitorConfig,
  } = useMonitorRuntime();

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
  } = useGitHubPrimaryViewModel({
    githubRepoSummary,
    hoveredGitHubOverviewPointIndex,
    setHoveredGitHubOverviewPointIndex,
  });
  const isGitHubPrimaryView = activePrimaryNav === 1;
  const isMonitorPrimaryView = activePrimaryNav === 2;

  const handleTentacleStateChange = useCallback((tentacleId: string, state: CodexState) => {
    setTentacleStates((current) => {
      if (current[tentacleId] === state) {
        return current;
      }

      return {
        ...current,
        [tentacleId]: state,
      };
    });
  }, []);

  return (
    <div className="page console-shell">
      <ConsoleHeader
        backendLivenessStatus={backendLivenessStatus}
        isAgentsSidebarVisible={isAgentsSidebarVisible}
        isCreatingTentacle={isCreatingTentacle}
        onCreateSharedTentacle={() => {
          setLoadError(null);
          void createTentacle("shared");
        }}
        onCreateWorktreeTentacle={() => {
          setLoadError(null);
          void createTentacle("worktree");
        }}
        onToggleAgentsSidebar={() => {
          setIsAgentsSidebarVisible((current) => !current);
        }}
      />

      <RuntimeStatusStrip
        githubCommitCount30d={githubCommitCount30d}
        githubOpenIssuesLabel={githubOpenIssuesLabel}
        githubOpenPrsLabel={githubOpenPrsLabel}
        githubRepoLabel={githubRepoLabel}
        githubStarCountLabel={githubStarCountLabel}
        githubStatusPill={githubStatusPill}
        sparklinePoints={sparklinePoints}
      />

      <ConsolePrimaryNav
        activePrimaryNav={activePrimaryNav}
        onPrimaryNavChange={setActivePrimaryNav}
      />

      <section className="console-main-canvas" aria-label="Main content canvas">
        <div className={`workspace-shell${isAgentsSidebarVisible ? "" : " workspace-shell--full"}`}>
          {isAgentsSidebarVisible && (
            <ActiveAgentsSidebar
              columns={columns}
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
              isCodexUsageSectionExpanded={isCodexUsageSectionExpanded}
              onCodexUsageSectionExpandedChange={setIsCodexUsageSectionExpanded}
              tentacleStates={tentacleStates}
              minimizedTentacleIds={minimizedTentacleIds}
              onMaximizeTentacle={handleMaximizeTentacle}
            />
          )}

          {isGitHubPrimaryView ? (
            <GitHubPrimaryView
              activeGitHubSubtab={activeGitHubSubtab}
              githubCommitCount30d={githubCommitCount30d}
              githubOpenIssuesLabel={githubOpenIssuesLabel}
              githubOpenPrsLabel={githubOpenPrsLabel}
              githubOverviewGraphPolylinePoints={githubOverviewGraphPolylinePoints}
              githubOverviewGraphSeries={githubOverviewGraphSeries}
              githubOverviewHoverLabel={githubOverviewHoverLabel}
              githubRepoLabel={githubRepoLabel}
              githubStarCountLabel={githubStarCountLabel}
              githubStatusPill={githubStatusPill}
              hoveredGitHubOverviewPointIndex={hoveredGitHubOverviewPointIndex}
              isRefreshingGitHubSummary={isRefreshingGitHubSummary}
              onGitHubSubtabChange={setActiveGitHubSubtab}
              onHoveredGitHubOverviewPointIndexChange={setHoveredGitHubOverviewPointIndex}
              onRefresh={() => {
                void refreshGitHubRepoSummary();
              }}
            />
          ) : isMonitorPrimaryView ? (
            <MonitorPrimaryView
              isRefreshingMonitorFeed={isRefreshingMonitorFeed}
              isSavingMonitorConfig={isSavingMonitorConfig}
              monitorConfig={monitorConfig}
              monitorError={monitorError}
              monitorFeed={monitorFeed}
              onPatchConfig={patchMonitorConfig}
              onRefresh={() => {
                void refreshMonitorFeed(true);
              }}
              onSyncFeed={() => {
                void refreshMonitorFeed(false);
              }}
            />
          ) : (
            <TentacleBoard
              columns={columns}
              editingTentacleId={editingTentacleId}
              isDeletingTentacleId={isDeletingTentacleId}
              isLoading={isLoading}
              loadError={loadError}
              onBeginTentacleNameEdit={beginTentacleNameEdit}
              onCancelTentacleRename={cancelTentacleRename}
              onMinimizeTentacle={handleMinimizeTentacle}
              onRequestDeleteTentacle={requestDeleteTentacle}
              onSubmitTentacleRename={(tentacleId, currentTentacleName) => {
                void submitTentacleRename(tentacleId, currentTentacleName);
              }}
              onTentacleDividerKeyDown={handleTentacleDividerKeyDown}
              onTentacleDividerPointerDown={handleTentacleDividerPointerDown}
              onTentacleHeaderWheel={handleTentacleHeaderWheel}
              onTentacleNameDraftChange={setTentacleNameDraft}
              onTentacleStateChange={handleTentacleStateChange}
              tentacleNameDraft={tentacleNameDraft}
              tentacleNameInputRef={tentacleNameInputRef}
              tentacleWidths={tentacleWidths}
              tentaclesRef={tentaclesRef}
              visibleColumns={visibleColumns}
            />
          )}
        </div>
      </section>

      <TelemetryTape monitorFeed={monitorFeed} />

      {pendingDeleteTentacle && (
        <DeleteTentacleDialog
          isDeletingTentacleId={isDeletingTentacleId}
          onCancel={clearPendingDeleteTentacle}
          onConfirmDelete={() => {
            void confirmDeleteTentacle();
          }}
          pendingDeleteTentacle={pendingDeleteTentacle}
        />
      )}
    </div>
  );
};
