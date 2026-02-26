import { buildTentacleColumns } from "@octogent/core";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

import { ActiveAgentsSidebar } from "./components/ActiveAgentsSidebar";
import type { CodexState } from "./components/CodexStateBadge";
import { EmptyOctopus } from "./components/EmptyOctopus";
import { TentacleTerminal } from "./components/TentacleTerminal";
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
  buildTentacleRenameUrl,
  buildTentaclesUrl,
  buildUiStateUrl,
} from "./runtime/runtimeEndpoints";

type TentacleView = Awaited<ReturnType<typeof buildTentacleColumns>>;
type CodexUsageSnapshot = {
  status: "ok" | "unavailable" | "error";
  fetchedAt: string;
  source: "oauth-api" | "none";
  message?: string | null;
  planType?: string | null;
  primaryUsedPercent?: number | null;
  secondaryUsedPercent?: number | null;
  creditsBalance?: number | null;
  creditsUnlimited?: boolean | null;
};

const CODEX_USAGE_SCAN_INTERVAL_MS = 60_000;
const UI_STATE_SAVE_DEBOUNCE_MS = 250;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 520;
const DEFAULT_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH;

type FrontendUiStateSnapshot = {
  isAgentsSidebarVisible?: boolean;
  sidebarWidth?: number;
  isActiveAgentsSectionExpanded?: boolean;
  isCodexUsageSectionExpanded?: boolean;
  minimizedTentacleIds?: string[];
  tentacleWidths?: Record<string, number>;
};

type TentacleWorkspaceMode = "shared" | "worktree";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const clampSidebarWidth = (width: number) =>
  Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));

const normalizeCodexUsageSnapshot = (value: unknown): CodexUsageSnapshot | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const status = record.status;
  if (status !== "ok" && status !== "unavailable" && status !== "error") {
    return null;
  }

  const source = record.source === "oauth-api" ? "oauth-api" : "none";
  return {
    status,
    source,
    fetchedAt: asString(record.fetchedAt) ?? new Date().toISOString(),
    message: asString(record.message),
    planType: asString(record.planType),
    primaryUsedPercent: asNumber(record.primaryUsedPercent),
    secondaryUsedPercent: asNumber(record.secondaryUsedPercent),
    creditsBalance: asNumber(record.creditsBalance),
    creditsUnlimited: typeof record.creditsUnlimited === "boolean" ? record.creditsUnlimited : null,
  };
};

const normalizeFrontendUiStateSnapshot = (value: unknown): FrontendUiStateSnapshot | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const nextState: FrontendUiStateSnapshot = {};
  if (typeof record.isAgentsSidebarVisible === "boolean") {
    nextState.isAgentsSidebarVisible = record.isAgentsSidebarVisible;
  }

  if (typeof record.sidebarWidth === "number" && Number.isFinite(record.sidebarWidth)) {
    nextState.sidebarWidth = clampSidebarWidth(record.sidebarWidth);
  }

  if (typeof record.isActiveAgentsSectionExpanded === "boolean") {
    nextState.isActiveAgentsSectionExpanded = record.isActiveAgentsSectionExpanded;
  }

  if (typeof record.isCodexUsageSectionExpanded === "boolean") {
    nextState.isCodexUsageSectionExpanded = record.isCodexUsageSectionExpanded;
  }

  if (Array.isArray(record.minimizedTentacleIds)) {
    nextState.minimizedTentacleIds = [...new Set(record.minimizedTentacleIds)].filter(
      (tentacleId): tentacleId is string => typeof tentacleId === "string",
    );
  }

  const rawTentacleWidths = asRecord(record.tentacleWidths);
  if (rawTentacleWidths) {
    nextState.tentacleWidths = Object.entries(rawTentacleWidths).reduce<Record<string, number>>(
      (acc, [tentacleId, width]) => {
        if (typeof width === "number" && Number.isFinite(width)) {
          acc[tentacleId] = width;
        }
        return acc;
      },
      {},
    );
  }

  return nextState;
};

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
  const tentaclesRef = useRef<HTMLElement | null>(null);
  const tentacleNameInputRef = useRef<HTMLInputElement | null>(null);
  const cancelTentacleNameSubmitRef = useRef(false);
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
    return (event: KeyboardEvent<HTMLDivElement>) => {
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

  const renderTentacleWorkspaceLabel = (workspaceMode: TentacleWorkspaceMode) =>
    workspaceMode === "worktree" ? "WORKTREE" : "MAIN";

  return (
    <div className="page">
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
        </div>

        <div className="chrome-brand" aria-hidden="true" />

        <div className="chrome-right">
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

        <main
          ref={tentaclesRef}
          className="tentacles"
          aria-label="Tentacle board"
          onWheel={handleTentacleHeaderWheel}
        >
          {isLoading && (
            <section className="empty-state" aria-label="Loading">
              <h2>Loading tentacles...</h2>
            </section>
          )}

          {!isLoading && columns.length === 0 && (
            <section className="empty-state" aria-label="Empty state">
              <EmptyOctopus />
              <h2>No active tentacles</h2>
              <p>When agents start, tentacles will appear here.</p>
              {loadError && <p className="empty-state-subtle">{loadError}</p>}
            </section>
          )}

          {!isLoading && columns.length > 0 && visibleColumns.length === 0 && (
            <section className="empty-state" aria-label="All minimized">
              <h2>All tentacles minimized</h2>
              <p>Use the Active Agents sidebar to maximize a tentacle.</p>
              {loadError && <p className="empty-state-subtle">{loadError}</p>}
            </section>
          )}

          {visibleColumns.map((column, index) => {
            const rightNeighbor = visibleColumns[index + 1];
            return (
              <Fragment key={column.tentacleId}>
                <section
                  className="tentacle-column"
                  aria-label={column.tentacleId}
                  style={{
                    width: `${tentacleWidths[column.tentacleId] ?? TENTACLE_MIN_WIDTH}px`,
                  }}
                >
                  <div className="tentacle-column-header">
                    <div className="tentacle-column-heading">
                      {editingTentacleId === column.tentacleId ? (
                        <>
                          <input
                            ref={tentacleNameInputRef}
                            aria-label={`Tentacle name for ${column.tentacleId}`}
                            className="tentacle-name-editor"
                            onBlur={() => {
                              void submitTentacleRename(column.tentacleId, column.tentacleName);
                            }}
                            onChange={(event) => {
                              setTentacleNameDraft(event.target.value);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void submitTentacleRename(column.tentacleId, column.tentacleName);
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelTentacleNameSubmitRef.current = true;
                                setEditingTentacleId(null);
                                setTentacleNameDraft("");
                              }
                            }}
                            type="text"
                            value={tentacleNameDraft}
                          />
                          <span
                            className={`tentacle-workspace-badge tentacle-workspace-badge--${column.tentacleWorkspaceMode}`}
                          >
                            {renderTentacleWorkspaceLabel(column.tentacleWorkspaceMode)}
                          </span>
                        </>
                      ) : (
                        <h2>
                          <button
                            className="tentacle-name-display"
                            onClick={() => {
                              beginTentacleNameEdit(column.tentacleId, column.tentacleName);
                            }}
                            type="button"
                          >
                            {column.tentacleName}
                          </button>
                          <span
                            className={`tentacle-workspace-badge tentacle-workspace-badge--${column.tentacleWorkspaceMode}`}
                          >
                            {renderTentacleWorkspaceLabel(column.tentacleWorkspaceMode)}
                          </span>
                        </h2>
                      )}
                    </div>
                    {editingTentacleId !== column.tentacleId && (
                      <div className="tentacle-header-actions">
                        <ActionButton
                          aria-label={`Minimize tentacle ${column.tentacleId}`}
                          className="tentacle-minimize"
                          onClick={() => {
                            handleMinimizeTentacle(column.tentacleId);
                          }}
                          size="dense"
                          variant="info"
                        >
                          Minimize
                        </ActionButton>
                        <ActionButton
                          aria-label={`Rename tentacle ${column.tentacleId}`}
                          className="tentacle-rename"
                          onClick={() => {
                            beginTentacleNameEdit(column.tentacleId, column.tentacleName);
                          }}
                          size="dense"
                          variant="accent"
                        >
                          Rename
                        </ActionButton>
                        <ActionButton
                          aria-label={`Delete tentacle ${column.tentacleId}`}
                          className="tentacle-delete"
                          disabled={isDeletingTentacleId === column.tentacleId}
                          onClick={() => {
                            requestDeleteTentacle(column.tentacleId, column.tentacleName);
                          }}
                          size="dense"
                          variant="danger"
                        >
                          {isDeletingTentacleId === column.tentacleId ? "Deleting..." : "Delete"}
                        </ActionButton>
                      </div>
                    )}
                  </div>
                  <TentacleTerminal
                    tentacleId={column.tentacleId}
                    onCodexStateChange={(state) => {
                      handleTentacleStateChange(column.tentacleId, state);
                    }}
                  />
                </section>

                {rightNeighbor && (
                  <div
                    aria-label={`Resize between ${column.tentacleId} and ${rightNeighbor.tentacleId}`}
                    aria-orientation="vertical"
                    className="tentacle-divider"
                    onKeyDown={handleTentacleDividerKeyDown(
                      column.tentacleId,
                      rightNeighbor.tentacleId,
                    )}
                    onPointerDown={handleTentacleDividerPointerDown(
                      column.tentacleId,
                      rightNeighbor.tentacleId,
                    )}
                    role="separator"
                    tabIndex={0}
                  />
                )}
              </Fragment>
            );
          })}
        </main>
      </div>

      {pendingDeleteTentacle && (
        <div className="delete-confirm-backdrop" role="presentation">
          <dialog
            aria-label={`Delete confirmation for ${pendingDeleteTentacle.tentacleName}`}
            className="delete-confirm-dialog"
            onKeyDown={(event) => {
              if (event.key !== "Escape" || isDeletingTentacleId !== null) {
                return;
              }
              event.preventDefault();
              setPendingDeleteTentacle(null);
            }}
            open
          >
            <header className="delete-confirm-header">
              <h2>Delete Tentacle</h2>
              <span className="pill blocked">DESTRUCTIVE</span>
            </header>
            <div className="delete-confirm-body">
              <p className="delete-confirm-message">
                Delete <strong>{pendingDeleteTentacle.tentacleName}</strong> and terminate all of
                its active sessions.
              </p>
              <p className="delete-confirm-warning">This action cannot be undone.</p>
              <dl className="delete-confirm-details">
                <div>
                  <dt>Name</dt>
                  <dd>{pendingDeleteTentacle.tentacleName}</dd>
                </div>
                <div>
                  <dt>ID</dt>
                  <dd>{pendingDeleteTentacle.tentacleId}</dd>
                </div>
              </dl>
            </div>
            <div className="delete-confirm-actions">
              <ActionButton
                aria-label="Cancel delete"
                className="delete-confirm-cancel"
                onClick={() => {
                  setPendingDeleteTentacle(null);
                }}
                size="dense"
                variant="accent"
              >
                Cancel
              </ActionButton>
              <ActionButton
                aria-label={`Confirm delete ${pendingDeleteTentacle.tentacleId}`}
                className="delete-confirm-submit"
                disabled={isDeletingTentacleId === pendingDeleteTentacle.tentacleId}
                onClick={() => {
                  void handleDeleteTentacle();
                }}
                size="dense"
                variant="danger"
              >
                {isDeletingTentacleId === pendingDeleteTentacle.tentacleId
                  ? "Deleting..."
                  : "Delete"}
              </ActionButton>
            </div>
          </dialog>
        </div>
      )}
    </div>
  );
};
