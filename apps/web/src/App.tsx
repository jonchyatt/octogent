import { buildTentacleColumns } from "@octogent/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

import {
  CODEX_USAGE_SCAN_INTERVAL_MS,
  DEFAULT_SIDEBAR_WIDTH,
  GITHUB_OVERVIEW_GRAPH_HEIGHT,
  GITHUB_OVERVIEW_GRAPH_WIDTH,
  GITHUB_SPARKLINE_HEIGHT,
  GITHUB_SPARKLINE_WIDTH,
  GITHUB_SUMMARY_SCAN_INTERVAL_MS,
  type GitHubSubtabId,
  PRIMARY_NAV_ITEMS,
  type PrimaryNavIndex,
  UI_STATE_SAVE_DEBOUNCE_MS,
} from "./app/constants";
import {
  buildGitHubCommitCount,
  buildGitHubCommitSeries,
  buildGitHubCommitSparkPoints,
  buildGitHubSparkPolylinePoints,
  buildGitHubStatusPill,
  formatGitHubCommitHoverLabel,
} from "./app/githubMetrics";
import {
  clampSidebarWidth,
  normalizeCodexUsageSnapshot,
  normalizeFrontendUiStateSnapshot,
  normalizeGitHubRepoSummarySnapshot,
} from "./app/normalizers";
import type {
  CodexUsageSnapshot,
  FrontendUiStateSnapshot,
  GitHubCommitSparkPoint,
  GitHubRepoSummarySnapshot,
  TentacleView,
  TentacleWorkspaceMode,
} from "./app/types";
import { ActiveAgentsSidebar } from "./components/ActiveAgentsSidebar";
import type { CodexState } from "./components/CodexStateBadge";
import { DeleteTentacleDialog } from "./components/DeleteTentacleDialog";
import { GitHubPrimaryView } from "./components/GitHubPrimaryView";
import { RuntimeStatusStrip } from "./components/RuntimeStatusStrip";
import { TelemetryTape } from "./components/TelemetryTape";
import { TentacleBoard } from "./components/TentacleBoard";
import { ActionButton } from "./components/ui/ActionButton";
import {
  TENTACLE_DIVIDER_WIDTH,
  TENTACLE_MIN_WIDTH,
  TENTACLE_RESIZE_STEP,
  reconcileTentacleWidths,
  resizeTentaclePair,
} from "./layout/tentaclePaneSizing";
import { HttpAgentSnapshotReader } from "./runtime/HttpAgentSnapshotReader";
import {
  buildAgentSnapshotsUrl,
  buildCodexUsageUrl,
  buildGithubSummaryUrl,
  buildTentacleRenameUrl,
  buildTentaclesUrl,
  buildUiStateUrl,
} from "./runtime/runtimeEndpoints";

export const App = () => {
  const [columns, setColumns] = useState<TentacleView>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isAgentsSidebarVisible, setIsAgentsSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isActiveAgentsSectionExpanded, setIsActiveAgentsSectionExpanded] = useState(true);
  const [isCodexUsageSectionExpanded, setIsCodexUsageSectionExpanded] = useState(true);
  const [isUiStateHydrated, setIsUiStateHydrated] = useState(false);
  const [isCreatingTentacle, setIsCreatingTentacle] = useState(false);
  const [isDeletingTentacleId, setIsDeletingTentacleId] = useState<string | null>(null);
  const [pendingDeleteTentacle, setPendingDeleteTentacle] = useState<{
    tentacleId: string;
    tentacleName: string;
  } | null>(null);
  const [minimizedTentacleIds, setMinimizedTentacleIds] = useState<string[]>([]);
  const [editingTentacleId, setEditingTentacleId] = useState<string | null>(null);
  const [tentacleNameDraft, setTentacleNameDraft] = useState("");
  const [tentacleStates, setTentacleStates] = useState<Record<string, CodexState>>({});
  const [tentacleWidths, setTentacleWidths] = useState<Record<string, number>>({});
  const [tentacleViewportWidth, setTentacleViewportWidth] = useState<number | null>(null);
  const [codexUsageSnapshot, setCodexUsageSnapshot] = useState<CodexUsageSnapshot | null>(null);
  const [githubRepoSummary, setGithubRepoSummary] = useState<GitHubRepoSummarySnapshot | null>(
    null,
  );
  const [isRefreshingGitHubSummary, setIsRefreshingGitHubSummary] = useState(false);
  const [activePrimaryNav, setActivePrimaryNav] = useState<PrimaryNavIndex>(1);
  const [activeGitHubSubtab, setActiveGitHubSubtab] = useState<GitHubSubtabId>("overview");
  const [hoveredGitHubOverviewPointIndex, setHoveredGitHubOverviewPointIndex] = useState<
    number | null
  >(null);
  const [tickerQuery, setTickerQuery] = useState("MAIN");
  const tentaclesRef = useRef<HTMLElement | null>(null);
  const tentacleNameInputRef = useRef<HTMLInputElement | null>(null);
  const tickerInputRef = useRef<HTMLInputElement | null>(null);
  const cancelTentacleNameSubmitRef = useRef(false);
  const githubSummaryInFlightRef = useRef(false);
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

  const readUiState = useCallback(async (signal?: AbortSignal) => {
    try {
      const requestOptions: {
        method: "GET";
        headers: { Accept: string };
        signal?: AbortSignal;
      } = {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      };
      if (signal) {
        requestOptions.signal = signal;
      }

      const response = await fetch(buildUiStateUrl(), requestOptions);

      if (!response.ok) {
        return null;
      }

      return normalizeFrontendUiStateSnapshot(await response.json());
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const syncColumns = async () => {
      try {
        setLoadError(null);
        const [nextColumns, nextUiState] = await Promise.all([
          readColumns(controller.signal),
          readUiState(controller.signal),
        ]);
        setColumns(nextColumns);

        if (nextUiState) {
          if (nextUiState.isAgentsSidebarVisible !== undefined) {
            setIsAgentsSidebarVisible(nextUiState.isAgentsSidebarVisible);
          }

          if (nextUiState.sidebarWidth !== undefined) {
            setSidebarWidth(clampSidebarWidth(nextUiState.sidebarWidth));
          }

          if (nextUiState.isActiveAgentsSectionExpanded !== undefined) {
            setIsActiveAgentsSectionExpanded(nextUiState.isActiveAgentsSectionExpanded);
          }

          if (nextUiState.isCodexUsageSectionExpanded !== undefined) {
            setIsCodexUsageSectionExpanded(nextUiState.isCodexUsageSectionExpanded);
          }

          if (nextUiState.minimizedTentacleIds) {
            const activeTentacleIds = new Set(nextColumns.map((column) => column.tentacleId));
            setMinimizedTentacleIds(
              nextUiState.minimizedTentacleIds.filter((tentacleId) =>
                activeTentacleIds.has(tentacleId),
              ),
            );
          }

          if (nextUiState.tentacleWidths) {
            const activeTentacleIds = new Set(nextColumns.map((column) => column.tentacleId));
            setTentacleWidths(
              Object.entries(nextUiState.tentacleWidths).reduce<Record<string, number>>(
                (acc, [tentacleId, width]) => {
                  if (activeTentacleIds.has(tentacleId)) {
                    acc[tentacleId] = width;
                  }
                  return acc;
                },
                {},
              ),
            );
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setColumns([]);
          setLoadError("Agent data is currently unavailable.");
        }
      } finally {
        setIsLoading(false);
        setIsUiStateHydrated(true);
      }
    };

    void syncColumns();
    return () => {
      controller.abort();
    };
  }, [readColumns, readUiState]);

  useEffect(() => {
    if (!isUiStateHydrated) {
      return;
    }

    const activeTentacleIds = new Set(columns.map((column) => column.tentacleId));
    const payload: FrontendUiStateSnapshot = {
      isAgentsSidebarVisible,
      sidebarWidth: clampSidebarWidth(sidebarWidth),
      isActiveAgentsSectionExpanded,
      isCodexUsageSectionExpanded,
      minimizedTentacleIds: minimizedTentacleIds.filter((tentacleId) =>
        activeTentacleIds.has(tentacleId),
      ),
      tentacleWidths: Object.entries(tentacleWidths).reduce<Record<string, number>>(
        (acc, [tentacleId, width]) => {
          if (activeTentacleIds.has(tentacleId)) {
            acc[tentacleId] = width;
          }
          return acc;
        },
        {},
      ),
    };

    const timerId = window.setTimeout(() => {
      void fetch(buildUiStateUrl(), {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    }, UI_STATE_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    columns,
    isActiveAgentsSectionExpanded,
    isAgentsSidebarVisible,
    isCodexUsageSectionExpanded,
    isUiStateHydrated,
    minimizedTentacleIds,
    sidebarWidth,
    tentacleWidths,
  ]);

  useEffect(() => {
    let isDisposed = false;
    let isInFlight = false;

    const syncCodexUsage = async () => {
      if (isDisposed || isInFlight) {
        return;
      }
      isInFlight = true;
      try {
        const response = await fetch(buildCodexUsageUrl(), {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Unable to read codex usage (${response.status})`);
        }

        const parsed = normalizeCodexUsageSnapshot(await response.json());
        if (!isDisposed) {
          setCodexUsageSnapshot(
            parsed ?? {
              status: "error",
              source: "none",
              fetchedAt: new Date().toISOString(),
            },
          );
        }
      } catch {
        if (!isDisposed) {
          setCodexUsageSnapshot({
            status: "error",
            source: "none",
            fetchedAt: new Date().toISOString(),
          });
        }
      } finally {
        isInFlight = false;
      }
    };

    void syncCodexUsage();
    const timerId = window.setInterval(() => {
      void syncCodexUsage();
    }, CODEX_USAGE_SCAN_INTERVAL_MS);

    return () => {
      isDisposed = true;
      window.clearInterval(timerId);
    };
  }, []);

  const refreshGitHubRepoSummary = useCallback(async () => {
    if (githubSummaryInFlightRef.current) {
      return;
    }

    githubSummaryInFlightRef.current = true;
    setIsRefreshingGitHubSummary(true);
    try {
      const response = await fetch(buildGithubSummaryUrl(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Unable to read github summary (${response.status})`);
      }

      const parsed = normalizeGitHubRepoSummarySnapshot(await response.json());
      setGithubRepoSummary(
        parsed ?? {
          status: "error",
          source: "none",
          fetchedAt: new Date().toISOString(),
          message: "GitHub summary payload is invalid.",
          commitsPerDay: [],
        },
      );
    } catch {
      setGithubRepoSummary({
        status: "error",
        source: "none",
        fetchedAt: new Date().toISOString(),
        message: "Unable to read GitHub summary.",
        commitsPerDay: [],
      });
    } finally {
      githubSummaryInFlightRef.current = false;
      setIsRefreshingGitHubSummary(false);
    }
  }, []);

  useEffect(() => {
    void refreshGitHubRepoSummary();
    const timerId = window.setInterval(() => {
      void refreshGitHubRepoSummary();
    }, GITHUB_SUMMARY_SCAN_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [refreshGitHubRepoSummary]);

  useEffect(() => {
    if (!tentaclesRef.current) {
      return;
    }

    const measure = () => {
      const width = Math.floor(tentaclesRef.current?.getBoundingClientRect().width ?? 0);
      setTentacleViewportWidth(width > 0 ? width : null);
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        measure();
      });
      observer.observe(tentaclesRef.current);
      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const tentacleIds = visibleColumns.map((column) => column.tentacleId);
    const dividerTotalWidth = Math.max(0, tentacleIds.length - 1) * TENTACLE_DIVIDER_WIDTH;
    const paneViewportWidth =
      tentacleViewportWidth === null
        ? null
        : Math.max(0, tentacleViewportWidth - dividerTotalWidth);
    setTentacleWidths((currentWidths) =>
      reconcileTentacleWidths(currentWidths, tentacleIds, paneViewportWidth),
    );
  }, [tentacleViewportWidth, visibleColumns]);

  useEffect(() => {
    if (!editingTentacleId) {
      return;
    }

    if (!columns.some((column) => column.tentacleId === editingTentacleId)) {
      setEditingTentacleId(null);
      return;
    }

    const input = tentacleNameInputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, [columns, editingTentacleId]);

  useEffect(() => {
    const activeTentacleIds = new Set(columns.map((column) => column.tentacleId));
    setMinimizedTentacleIds((current) => {
      const next = current.filter((tentacleId) => activeTentacleIds.has(tentacleId));
      return next.length === current.length ? current : next;
    });
    setTentacleStates((current) => {
      const retainedStates = Object.entries(current).filter(([tentacleId]) =>
        activeTentacleIds.has(tentacleId),
      );
      if (retainedStates.length === Object.keys(current).length) {
        return current;
      }

      return Object.fromEntries(retainedStates);
    });
  }, [columns]);

  const activeNavItem = useMemo(
    () => PRIMARY_NAV_ITEMS.find((item) => item.index === activePrimaryNav) ?? PRIMARY_NAV_ITEMS[1],
    [activePrimaryNav],
  );
  const normalizedTicker = useMemo(() => {
    const trimmed = tickerQuery.trim().toUpperCase();
    return trimmed.length > 0 ? trimmed : "----";
  }, [tickerQuery]);
  const githubCommitSeries = useMemo(
    () => buildGitHubCommitSeries(githubRepoSummary),
    [githubRepoSummary],
  );
  const githubCommitCount30d = useMemo(
    () => buildGitHubCommitCount(githubCommitSeries),
    [githubCommitSeries],
  );
  const sparklineSeries = useMemo<GitHubCommitSparkPoint[]>(
    () =>
      buildGitHubCommitSparkPoints(
        githubCommitSeries,
        GITHUB_SPARKLINE_WIDTH,
        GITHUB_SPARKLINE_HEIGHT,
      ),
    [githubCommitSeries],
  );
  const sparklinePoints = useMemo(
    () => buildGitHubSparkPolylinePoints(sparklineSeries),
    [sparklineSeries],
  );
  const githubOverviewGraphSeries = useMemo<GitHubCommitSparkPoint[]>(
    () =>
      buildGitHubCommitSparkPoints(
        githubCommitSeries,
        GITHUB_OVERVIEW_GRAPH_WIDTH,
        GITHUB_OVERVIEW_GRAPH_HEIGHT,
      ),
    [githubCommitSeries],
  );
  const githubOverviewGraphPolylinePoints = useMemo(
    () => buildGitHubSparkPolylinePoints(githubOverviewGraphSeries),
    [githubOverviewGraphSeries],
  );
  const hoveredGitHubOverviewPoint = useMemo(() => {
    if (hoveredGitHubOverviewPointIndex === null) {
      return null;
    }
    return githubOverviewGraphSeries[hoveredGitHubOverviewPointIndex] ?? null;
  }, [githubOverviewGraphSeries, hoveredGitHubOverviewPointIndex]);
  const githubOverviewHoverLabel = useMemo(() => {
    if (hoveredGitHubOverviewPoint) {
      return formatGitHubCommitHoverLabel(hoveredGitHubOverviewPoint);
    }

    return "Hover points for date and commit count";
  }, [hoveredGitHubOverviewPoint]);
  const isGitHubPrimaryView = activePrimaryNav === 3;
  const githubStatusPill = useMemo(
    () => buildGitHubStatusPill(githubRepoSummary),
    [githubRepoSummary],
  );

  useEffect(() => {
    if (hoveredGitHubOverviewPointIndex === null) {
      return;
    }
    if (hoveredGitHubOverviewPointIndex >= githubOverviewGraphSeries.length) {
      setHoveredGitHubOverviewPointIndex(null);
    }
  }, [githubOverviewGraphSeries.length, hoveredGitHubOverviewPointIndex]);

  useEffect(() => {
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (/^[0-6]$/.test(event.key)) {
        setActivePrimaryNav(Number.parseInt(event.key, 10) as PrimaryNavIndex);
        event.preventDefault();
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        tickerInputRef.current?.focus();
        tickerInputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, []);

  const beginTentacleNameEdit = (tentacleId: string, currentTentacleName: string) => {
    setLoadError(null);
    setEditingTentacleId(tentacleId);
    setTentacleNameDraft(currentTentacleName);
  };

  const submitTentacleRename = async (tentacleId: string, currentTentacleName: string) => {
    if (cancelTentacleNameSubmitRef.current) {
      cancelTentacleNameSubmitRef.current = false;
      return;
    }

    const trimmedName = tentacleNameDraft.trim();
    if (trimmedName.length === 0) {
      setLoadError("Tentacle name cannot be empty.");
      return;
    }

    if (trimmedName === currentTentacleName) {
      setEditingTentacleId(null);
      return;
    }

    try {
      setLoadError(null);
      const response = await fetch(buildTentacleRenameUrl(tentacleId), {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: trimmedName }),
      });

      if (!response.ok) {
        throw new Error(`Unable to rename tentacle (${response.status})`);
      }

      const nextColumns = await readColumns();
      setColumns(nextColumns);
      setEditingTentacleId(null);
    } catch {
      setLoadError("Unable to rename tentacle.");
    }
  };

  const handleCreateTentacle = async (workspaceMode: TentacleWorkspaceMode) => {
    try {
      setIsCreatingTentacle(true);
      setLoadError(null);
      const response = await fetch(buildTentaclesUrl(), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workspaceMode }),
      });

      if (!response.ok) {
        throw new Error(`Unable to create tentacle (${response.status})`);
      }

      const createdSnapshot = (await response.json()) as {
        tentacleId?: unknown;
        tentacleName?: unknown;
      };
      const nextColumns = await readColumns();
      setColumns(nextColumns);

      const createdTentacleId =
        typeof createdSnapshot.tentacleId === "string" ? createdSnapshot.tentacleId : null;
      if (!createdTentacleId) {
        return;
      }

      const createdColumn = nextColumns.find((column) => column.tentacleId === createdTentacleId);
      const createdTentacleName =
        createdColumn?.tentacleName ??
        (typeof createdSnapshot.tentacleName === "string"
          ? createdSnapshot.tentacleName
          : createdTentacleId);
      setMinimizedTentacleIds((current) =>
        current.filter((tentacleId) => tentacleId !== createdTentacleId),
      );
      beginTentacleNameEdit(createdTentacleId, createdTentacleName);
    } catch {
      setLoadError("Unable to create a new tentacle.");
    } finally {
      setIsCreatingTentacle(false);
    }
  };

  const requestDeleteTentacle = (tentacleId: string, tentacleName: string) => {
    setLoadError(null);
    setPendingDeleteTentacle({ tentacleId, tentacleName });
  };

  const handleDeleteTentacle = async () => {
    if (!pendingDeleteTentacle) {
      return;
    }

    const { tentacleId } = pendingDeleteTentacle;
    try {
      setLoadError(null);
      setIsDeletingTentacleId(tentacleId);
      const response = await fetch(buildTentacleRenameUrl(tentacleId), {
        method: "DELETE",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Unable to delete tentacle (${response.status})`);
      }

      if (editingTentacleId === tentacleId) {
        setEditingTentacleId(null);
        setTentacleNameDraft("");
      }
      setMinimizedTentacleIds((current) =>
        current.filter((currentTentacleId) => currentTentacleId !== tentacleId),
      );

      const nextColumns = await readColumns();
      setColumns(nextColumns);
      setPendingDeleteTentacle(null);
    } catch {
      setLoadError("Unable to delete tentacle.");
    } finally {
      setIsDeletingTentacleId(null);
    }
  };

  const handleMinimizeTentacle = (tentacleId: string) => {
    if (editingTentacleId === tentacleId) {
      setEditingTentacleId(null);
      setTentacleNameDraft("");
    }

    setMinimizedTentacleIds((current) => {
      if (current.includes(tentacleId)) {
        return current;
      }
      return [...current, tentacleId];
    });
  };

  const handleMaximizeTentacle = (tentacleId: string) => {
    setMinimizedTentacleIds((current) =>
      current.filter((currentTentacleId) => currentTentacleId !== tentacleId),
    );
  };

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

  const handleTentacleDividerPointerDown = (leftTentacleId: string, rightTentacleId: string) => {
    return (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();

      const startX = event.clientX;
      const startLeftWidth = tentacleWidths[leftTentacleId] ?? TENTACLE_MIN_WIDTH;
      const startRightWidth = tentacleWidths[rightTentacleId] ?? TENTACLE_MIN_WIDTH;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        const resizedPair = resizeTentaclePair(
          {
            [leftTentacleId]: startLeftWidth,
            [rightTentacleId]: startRightWidth,
          },
          leftTentacleId,
          rightTentacleId,
          delta,
        );

        setTentacleWidths((current) => {
          const nextLeft = resizedPair[leftTentacleId] ?? startLeftWidth;
          const nextRight = resizedPair[rightTentacleId] ?? startRightWidth;
          if (current[leftTentacleId] === nextLeft && current[rightTentacleId] === nextRight) {
            return current;
          }

          return {
            ...current,
            [leftTentacleId]: nextLeft,
            [rightTentacleId]: nextRight,
          };
        });
      };

      const stopResize = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
    };
  };

  const handleTentacleDividerKeyDown = (leftTentacleId: string, rightTentacleId: string) => {
    return (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      event.preventDefault();
      const delta = event.key === "ArrowRight" ? TENTACLE_RESIZE_STEP : -TENTACLE_RESIZE_STEP;
      setTentacleWidths((currentWidths) =>
        resizeTentaclePair(currentWidths, leftTentacleId, rightTentacleId, delta),
      );
    };
  };

  const handleTentacleHeaderWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (!event.target.closest(".tentacle-column-header")) {
      return;
    }

    const board = tentaclesRef.current;
    if (!board) {
      return;
    }

    const horizontalDelta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
    if (!Number.isFinite(horizontalDelta) || horizontalDelta === 0) {
      return;
    }

    board.scrollLeft += horizontalDelta;
    event.preventDefault();
  };

  const githubRepoLabel = githubRepoSummary?.repo ?? "GitHub repository";
  const githubStarCountLabel =
    githubRepoSummary?.stargazerCount !== null && githubRepoSummary?.stargazerCount !== undefined
      ? Math.round(githubRepoSummary.stargazerCount).toLocaleString("en-US")
      : "--";
  const githubOpenIssuesLabel =
    githubRepoSummary?.openIssueCount !== null && githubRepoSummary?.openIssueCount !== undefined
      ? Math.round(githubRepoSummary.openIssueCount).toString()
      : "--";
  const githubOpenPrsLabel =
    githubRepoSummary?.openPullRequestCount !== null &&
    githubRepoSummary?.openPullRequestCount !== undefined
      ? Math.round(githubRepoSummary.openPullRequestCount).toString()
      : "--";

  return (
    <div className="page console-shell">
      <header className="chrome">
        <div className="chrome-left">
          <button
            aria-label={
              isAgentsSidebarVisible ? "Hide Active Agents sidebar" : "Show Active Agents sidebar"
            }
            className="chrome-sidebar-toggle"
            data-active={isAgentsSidebarVisible ? "true" : "false"}
            onClick={() => {
              setIsAgentsSidebarVisible((current) => !current);
            }}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="chrome-sidebar-toggle-icon"
              viewBox="0 0 16 16"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect
                fill="none"
                height="12"
                stroke="currentColor"
                strokeWidth="1.5"
                width="12"
                x="2"
                y="2"
              />
              <rect height="12" width="6" x="2" y="2" />
            </svg>
          </button>
          <h1>Octogent Engineering Console</h1>
        </div>

        <div className="chrome-brand">{`${normalizedTicker} | ${activeNavItem.label.toUpperCase()}`}</div>

        <div className="chrome-right">
          <span className="console-platform-label">Agent Runtime</span>
          <span className="console-live-indicator">
            <span className="console-live-dot" aria-hidden="true" />
            LIVE
          </span>
          <ActionButton
            aria-label="Create tentacle in main codebase"
            className="chrome-create-tentacle chrome-create-tentacle--shared"
            disabled={isCreatingTentacle}
            onClick={() => {
              setLoadError(null);
              void handleCreateTentacle("shared");
            }}
            size="dense"
            variant="primary"
          >
            {isCreatingTentacle ? "Creating..." : "+ Main Tentacle"}
          </ActionButton>
          <ActionButton
            aria-label="Create tentacle with isolated worktree"
            className="chrome-create-tentacle chrome-create-tentacle--worktree"
            disabled={isCreatingTentacle}
            onClick={() => {
              setLoadError(null);
              void handleCreateTentacle("worktree");
            }}
            size="dense"
            variant="info"
          >
            {isCreatingTentacle ? "Creating..." : "+ Worktree Tentacle"}
          </ActionButton>
        </div>
      </header>

      <RuntimeStatusStrip
        githubCommitCount30d={githubCommitCount30d}
        githubOpenIssuesLabel={githubOpenIssuesLabel}
        githubOpenPrsLabel={githubOpenPrsLabel}
        githubRepoLabel={githubRepoLabel}
        githubStarCountLabel={githubStarCountLabel}
        githubStatusPill={githubStatusPill}
        sparklinePoints={sparklinePoints}
      />

      <nav className="console-primary-nav" aria-label="Primary navigation">
        <div className="console-primary-nav-tabs">
          {PRIMARY_NAV_ITEMS.map((item) => (
            <button
              aria-current={item.index === activePrimaryNav ? "page" : undefined}
              className="console-primary-nav-tab"
              data-active={item.index === activePrimaryNav ? "true" : "false"}
              key={item.index}
              onClick={() => {
                setActivePrimaryNav(item.index);
              }}
              type="button"
            >
              [{item.index}] {item.label}
            </button>
          ))}
        </div>
        <p className="console-primary-nav-hint">Press 0-6 to navigate · Type context to search</p>
      </nav>

      <section className="console-main-canvas" aria-label="Main content canvas">
        <div className="console-canvas-controls">
          <label className="console-context-label" htmlFor="console-context-input">
            Context
          </label>
          <input
            id="console-context-input"
            ref={tickerInputRef}
            aria-label="Context search input"
            autoComplete="off"
            className="console-context-input"
            onChange={(event) => {
              setTickerQuery(
                event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9._/-]/g, "")
                  .slice(0, 16),
              );
            }}
            placeholder="Type agent, repo, or branch..."
            type="text"
            value={tickerQuery}
          />
          <div className="console-page-chips" aria-hidden="true">
            <span className="console-chip console-chip--active">{activeNavItem.label}</span>
            <span className="console-chip">1D</span>
            <span className="console-chip">1H</span>
            <span className="console-chip">6H</span>
            <span className="console-chip">24H</span>
          </div>
        </div>

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
          ) : (
            <TentacleBoard
              columns={columns}
              editingTentacleId={editingTentacleId}
              isDeletingTentacleId={isDeletingTentacleId}
              isLoading={isLoading}
              loadError={loadError}
              onBeginTentacleNameEdit={beginTentacleNameEdit}
              onCancelTentacleRename={() => {
                cancelTentacleNameSubmitRef.current = true;
                setEditingTentacleId(null);
                setTentacleNameDraft("");
              }}
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

      <TelemetryTape />

      {pendingDeleteTentacle && (
        <DeleteTentacleDialog
          isDeletingTentacleId={isDeletingTentacleId}
          onCancel={() => {
            setPendingDeleteTentacle(null);
          }}
          onConfirmDelete={() => {
            void handleDeleteTentacle();
          }}
          pendingDeleteTentacle={pendingDeleteTentacle}
        />
      )}
    </div>
  );
};
