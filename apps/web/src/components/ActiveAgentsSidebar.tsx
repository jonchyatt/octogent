import type { AgentState, TentacleColumn } from "@octogent/core";
import { useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { type CodexState, CodexStateBadge } from "./CodexStateBadge";
import { ActionButton } from "./ui/ActionButton";

const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 520;

const fallbackCodexStateByAgentState: Record<AgentState, CodexState> = {
  live: "processing",
  idle: "idle",
  queued: "processing",
  blocked: "processing",
};

type ActiveAgentsSidebarProps = {
  columns: TentacleColumn[];
  isLoading: boolean;
  loadError: string | null;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  isActiveAgentsSectionExpanded: boolean;
  onActiveAgentsSectionExpandedChange: (expanded: boolean) => void;
  isCodexUsageVisible: boolean;
  isClaudeUsageSectionExpanded: boolean;
  isClaudeUsageVisible: boolean;
  onClaudeUsageSectionExpandedChange: (expanded: boolean) => void;
  isCodexUsageSectionExpanded: boolean;
  onCodexUsageSectionExpandedChange: (expanded: boolean) => void;
  tentacleStates?: Record<string, CodexState>;
  minimizedTentacleIds?: string[];
  onMaximizeTentacle?: (tentacleId: string) => void;
  codexUsageSnapshot?: {
    message?: string | null;
    primaryUsedPercent?: number | null;
    secondaryUsedPercent?: number | null;
    creditsBalance?: number | null;
    creditsUnlimited?: boolean | null;
  } | null;
  codexUsageStatus?: "ok" | "unavailable" | "error" | "loading";
  claudeUsageSnapshot?: {
    message?: string | null;
    planType?: string | null;
    primaryUsedPercent?: number | null;
    secondaryUsedPercent?: number | null;
    sonnetUsedPercent?: number | null;
    extraUsageCostUsed?: number | null;
    extraUsageCostLimit?: number | null;
  } | null;
  claudeUsageStatus?: "ok" | "unavailable" | "error" | "loading";
  actionPanel?: ReactNode;
  bodyContent?: ReactNode;
};

const clampSidebarWidth = (width: number): number =>
  Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));

const resolveUsageStatusMessage = ({
  status,
  message,
  waitingLabel,
  unavailableLabel,
  errorLabel,
}: {
  status: "ok" | "unavailable" | "error" | "loading";
  message: string | null | undefined;
  waitingLabel: string;
  unavailableLabel: string;
  errorLabel: string;
}) => {
  if (status === "loading") {
    return waitingLabel;
  }

  if ((status === "unavailable" || status === "error") && message && message.trim().length > 0) {
    return message.trim();
  }

  return status === "unavailable" ? unavailableLabel : errorLabel;
};

const isInternalRootTerminal = (tentacleId: string, agentId: string) =>
  agentId === `${tentacleId}-root`;

export const ActiveAgentsSidebar = ({
  columns,
  isLoading,
  loadError,
  sidebarWidth,
  onSidebarWidthChange,
  isActiveAgentsSectionExpanded,
  onActiveAgentsSectionExpandedChange,
  isCodexUsageVisible,
  isClaudeUsageVisible,
  isClaudeUsageSectionExpanded,
  onClaudeUsageSectionExpandedChange,
  isCodexUsageSectionExpanded,
  onCodexUsageSectionExpandedChange,
  tentacleStates = {},
  minimizedTentacleIds = [],
  onMaximizeTentacle,
  codexUsageSnapshot = null,
  codexUsageStatus = "loading",
  claudeUsageSnapshot = null,
  claudeUsageStatus = "loading",
  actionPanel = null,
  bodyContent,
}: ActiveAgentsSidebarProps) => {
  const sidebarRef = useRef<HTMLElement | null>(null);
  const resolveAgentCodexState = (
    tentacleId: string,
    agentState: AgentState,
    isPrimaryVisibleTerminal: boolean,
  ): CodexState => {
    if (isPrimaryVisibleTerminal) {
      return tentacleStates[tentacleId] ?? fallbackCodexStateByAgentState[agentState];
    }
    return fallbackCodexStateByAgentState[agentState];
  };

  const primaryUsagePercent = useMemo(() => {
    const value = codexUsageSnapshot?.primaryUsedPercent;
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return null;
    }
    return Math.max(0, Math.min(100, value));
  }, [codexUsageSnapshot]);
  const secondaryUsagePercent = useMemo(() => {
    const value = codexUsageSnapshot?.secondaryUsedPercent;
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return null;
    }
    return Math.max(0, Math.min(100, value));
  }, [codexUsageSnapshot]);
  const creditsLabel = useMemo(() => {
    if (codexUsageSnapshot?.creditsUnlimited) {
      return "unlimited";
    }
    const creditsBalance = codexUsageSnapshot?.creditsBalance;
    if (
      creditsBalance === null ||
      creditsBalance === undefined ||
      !Number.isFinite(creditsBalance)
    ) {
      return "--";
    }
    return `$${creditsBalance.toFixed(2)}`;
  }, [codexUsageSnapshot]);
  const claudePrimaryUsagePercent = useMemo(() => {
    const value = claudeUsageSnapshot?.primaryUsedPercent;
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return null;
    }
    return Math.max(0, Math.min(100, value));
  }, [claudeUsageSnapshot]);
  const claudeSecondaryUsagePercent = useMemo(() => {
    const value = claudeUsageSnapshot?.secondaryUsedPercent;
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return null;
    }
    return Math.max(0, Math.min(100, value));
  }, [claudeUsageSnapshot]);
  const claudeSonnetUsagePercent = useMemo(() => {
    const value = claudeUsageSnapshot?.sonnetUsedPercent;
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return null;
    }
    return Math.max(0, Math.min(100, value));
  }, [claudeUsageSnapshot]);

  const handleResizeMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;

    const handleMouseMove = (event: MouseEvent) => {
      onSidebarWidthChange(clampSidebarWidth(event.clientX - sidebarLeft));
    };

    const stopResize = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
  };

  const showUsageFooter = isCodexUsageVisible || isClaudeUsageVisible;

  return (
    <div className="dashboard-deck-shell">
      <aside
        aria-label="Active Agents sidebar"
        className="active-agents-sidebar"
        ref={sidebarRef}
        style={{ width: `${sidebarWidth}px` }}
      >
        {actionPanel ? (
          <div className="active-agents-action-panel">{actionPanel}</div>
        ) : (
          <>
            <div className="active-agents-body">
              {bodyContent ?? (
              <section className="active-agents-section" aria-label="Sidebar section Active Agents">
                <button
                  aria-controls="active-agents-section-panel"
                  aria-expanded={isActiveAgentsSectionExpanded}
                  aria-label={
                    isActiveAgentsSectionExpanded
                      ? "Collapse Active Agents section"
                      : "Expand Active Agents section"
                  }
                  className="active-agents-section-toggle"
                  data-expanded={isActiveAgentsSectionExpanded ? "true" : "false"}
                  onClick={() => {
                    onActiveAgentsSectionExpandedChange(!isActiveAgentsSectionExpanded);
                  }}
                  type="button"
                >
                  <span className="active-agents-section-title">Active Agents</span>
                  <span className="active-agents-section-meta">{columns.length} tentacles</span>
                  <span className="active-agents-section-chevron" aria-hidden="true">
                    {isActiveAgentsSectionExpanded ? "▾" : "▸"}
                  </span>
                </button>

                {isActiveAgentsSectionExpanded && (
                  <div className="active-agents-section-panel" id="active-agents-section-panel">
                    {isLoading && <p className="active-agents-status">Loading active agents...</p>}

                    {!isLoading && columns.length === 0 && (
                      <p className="active-agents-status">No active tentacles right now.</p>
                    )}

                    {!isLoading &&
                      columns.map((column) => {
                        const visibleAgents = column.agents.filter(
                          (agent) => !isInternalRootTerminal(column.tentacleId, agent.agentId),
                        );
                        const agentCountLabel = visibleAgents.length === 1 ? "agent" : "agents";
                        return (
                          <section
                            key={column.tentacleId}
                            aria-label={`Active agents in ${column.tentacleId}`}
                            className="active-agents-group"
                          >
                            <div className="active-agents-group-header">
                              <div className="active-agents-group-header-text">
                                <h3>{column.tentacleName}</h3>
                              </div>
                              <span className="active-agents-group-count">
                                {visibleAgents.length} {agentCountLabel}
                              </span>
                              {minimizedTentacleIds.includes(column.tentacleId) && (
                                <ActionButton
                                  aria-label={`Maximize tentacle ${column.tentacleId}`}
                                  className="active-agents-maximize"
                                  onClick={() => {
                                    onMaximizeTentacle?.(column.tentacleId);
                                  }}
                                  size="compact"
                                  variant="accent"
                                >
                                  Maximize
                                </ActionButton>
                              )}
                            </div>
                            <ul>
                              {visibleAgents.map((agent, index) => (
                                <li
                                  className="active-agents-agent-row"
                                  key={agent.agentId}
                                >
                                  <span className="active-agents-agent-label" title={agent.label}>
                                    {agent.label}
                                  </span>
                                  <CodexStateBadge
                                    state={resolveAgentCodexState(
                                      column.tentacleId,
                                      agent.state,
                                      index === 0,
                                    )}
                                  />
                                </li>
                              ))}
                            </ul>
                          </section>
                        );
                      })}

                    {loadError && (
                      <p className="active-agents-status active-agents-error">{loadError}</p>
                    )}
                  </div>
                )}
              </section>
              )}</div>
            {showUsageFooter && (
              <footer className="active-agents-footer">
                {isCodexUsageVisible && (
                  <section className="active-agents-section active-agents-section--footer">
                <button
                  aria-controls="codex-usage-section-panel"
                  aria-expanded={isCodexUsageSectionExpanded}
                  aria-label={
                    isCodexUsageSectionExpanded
                      ? "Collapse Codex token usage section"
                      : "Expand Codex token usage section"
                  }
                  className="active-agents-section-toggle"
                  data-expanded={isCodexUsageSectionExpanded ? "true" : "false"}
                  onClick={() => {
                    onCodexUsageSectionExpandedChange(!isCodexUsageSectionExpanded);
                  }}
                  type="button"
                >
                  <span className="active-agents-section-title">Codex token usage</span>
                  <span className="active-agents-section-meta">Usage overview</span>
                  <span className="active-agents-section-chevron" aria-hidden="true">
                    {isCodexUsageSectionExpanded ? "▾" : "▸"}
                  </span>
                </button>

                {isCodexUsageSectionExpanded && (
                  <div className="active-agents-section-panel" id="codex-usage-section-panel">
                    <div
                      className={`active-agents-codex-usage active-agents-codex-usage--${codexUsageStatus}`}
                    >
                      {codexUsageStatus === "ok" ? (
                        <div
                          aria-label="Codex token usage bars"
                          className="active-agents-codex-usage-bars"
                        >
                          <div className="active-agents-codex-usage-row">
                            <span
                              aria-label="5H token usage"
                              aria-valuemax={100}
                              aria-valuemin={0}
                              aria-valuenow={
                                primaryUsagePercent === null
                                  ? undefined
                                  : Math.round(primaryUsagePercent)
                              }
                              aria-valuetext={
                                primaryUsagePercent === null
                                  ? "No usage data"
                                  : `${Math.round(primaryUsagePercent)}%`
                              }
                              className="active-agents-codex-usage-rail"
                              role="progressbar"
                              tabIndex={0}
                            >
                              <span
                                className="active-agents-codex-usage-rail-fill"
                                style={{ width: `${primaryUsagePercent ?? 0}%` }}
                              />
                            </span>
                            <p className="active-agents-codex-usage-meta-row">
                              <span className="active-agents-codex-usage-label">5H tokens</span>
                              <span className="active-agents-codex-usage-percent">
                                {primaryUsagePercent === null
                                  ? "--"
                                  : `${Math.round(primaryUsagePercent)}%`}
                              </span>
                            </p>
                          </div>
                          <div className="active-agents-codex-usage-row">
                            <span
                              aria-label="Weekly token usage"
                              aria-valuemax={100}
                              aria-valuemin={0}
                              aria-valuenow={
                                secondaryUsagePercent === null
                                  ? undefined
                                  : Math.round(secondaryUsagePercent)
                              }
                              aria-valuetext={
                                secondaryUsagePercent === null
                                  ? "No usage data"
                                  : `${Math.round(secondaryUsagePercent)}%`
                              }
                              className="active-agents-codex-usage-rail"
                              role="progressbar"
                              tabIndex={0}
                            >
                              <span
                                className="active-agents-codex-usage-rail-fill"
                                style={{ width: `${secondaryUsagePercent ?? 0}%` }}
                              />
                            </span>
                            <p className="active-agents-codex-usage-meta-row">
                              <span className="active-agents-codex-usage-label">Week tokens</span>
                              <span className="active-agents-codex-usage-percent">
                                {secondaryUsagePercent === null
                                  ? "--"
                                  : `${Math.round(secondaryUsagePercent)}%`}
                              </span>
                            </p>
                          </div>
                          {creditsLabel !== "--" && creditsLabel !== "$0.00" && (
                            <p className="active-agents-codex-usage-credits">Credits {creditsLabel}</p>
                          )}
                        </div>
                      ) : (
                        <p className="active-agents-codex-usage-status">
                          {resolveUsageStatusMessage({
                            status: codexUsageStatus,
                            message: codexUsageSnapshot?.message,
                            waitingLabel: "Waiting for Codex usage...",
                            unavailableLabel: "Codex usage unavailable.",
                            errorLabel: "Codex usage error.",
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </section>
                )}
                {isClaudeUsageVisible && (
                  <section className="active-agents-section active-agents-section--footer">
                <button
                  aria-controls="claude-usage-section-panel"
                  aria-expanded={isClaudeUsageSectionExpanded}
                  aria-label={
                    isClaudeUsageSectionExpanded
                      ? "Collapse Claude token usage section"
                      : "Expand Claude token usage section"
                  }
                  className="active-agents-section-toggle"
                  data-expanded={isClaudeUsageSectionExpanded ? "true" : "false"}
                  onClick={() => {
                    onClaudeUsageSectionExpandedChange(!isClaudeUsageSectionExpanded);
                  }}
                  type="button"
                >
                  <span className="active-agents-section-title">Claude token usage</span>
                  <span className="active-agents-section-meta">Usage overview</span>
                  <span className="active-agents-section-chevron" aria-hidden="true">
                    {isClaudeUsageSectionExpanded ? "▾" : "▸"}
                  </span>
                </button>

                {isClaudeUsageSectionExpanded && (
                  <div className="active-agents-section-panel" id="claude-usage-section-panel">
                    <div
                      className={`active-agents-codex-usage active-agents-codex-usage--${claudeUsageStatus}`}
                    >
                      {claudeUsageStatus === "ok" ? (
                        <div
                          aria-label="Claude token usage bars"
                          className="active-agents-codex-usage-bars"
                        >
                          {claudeUsageSnapshot?.extraUsageCostLimit != null &&
                          claudeUsageSnapshot?.extraUsageCostUsed != null ? (
                            <div className="active-agents-codex-usage-row">
                              <span
                                aria-label="Claude extra usage cost"
                                aria-valuemax={100}
                                aria-valuemin={0}
                                aria-valuenow={
                                  claudeUsageSnapshot.extraUsageCostLimit > 0
                                    ? Math.round(
                                        (claudeUsageSnapshot.extraUsageCostUsed /
                                          claudeUsageSnapshot.extraUsageCostLimit) *
                                          100,
                                      )
                                    : 0
                                }
                                aria-valuetext={`$${claudeUsageSnapshot.extraUsageCostUsed.toFixed(2)} / $${claudeUsageSnapshot.extraUsageCostLimit.toFixed(2)}`}
                                className="active-agents-codex-usage-rail"
                                role="progressbar"
                                tabIndex={0}
                              >
                                <span
                                  className="active-agents-codex-usage-rail-fill"
                                  style={{
                                    width: `${claudeUsageSnapshot.extraUsageCostLimit > 0 ? Math.min(100, (claudeUsageSnapshot.extraUsageCostUsed / claudeUsageSnapshot.extraUsageCostLimit) * 100) : 0}%`,
                                  }}
                                />
                              </span>
                              <p className="active-agents-codex-usage-meta-row">
                                <span className="active-agents-codex-usage-label">
                                  {claudeUsageSnapshot.planType ?? "Extra usage"}
                                </span>
                                <span className="active-agents-codex-usage-percent">
                                  {`$${claudeUsageSnapshot.extraUsageCostUsed.toFixed(2)} / $${claudeUsageSnapshot.extraUsageCostLimit.toFixed(2)}`}
                                </span>
                              </p>
                            </div>
                          ) : (
                            <>
                              <div className="active-agents-codex-usage-row">
                                <span
                                  aria-label="Claude current session usage"
                                  aria-valuemax={100}
                                  aria-valuemin={0}
                                  aria-valuenow={
                                    claudePrimaryUsagePercent === null
                                      ? undefined
                                      : Math.round(claudePrimaryUsagePercent)
                                  }
                                  aria-valuetext={
                                    claudePrimaryUsagePercent === null
                                      ? "No usage data"
                                      : `${Math.round(claudePrimaryUsagePercent)}%`
                                  }
                                  className="active-agents-codex-usage-rail"
                                  role="progressbar"
                                  tabIndex={0}
                                >
                                  <span
                                    className="active-agents-codex-usage-rail-fill"
                                    style={{ width: `${claudePrimaryUsagePercent ?? 0}%` }}
                                  />
                                </span>
                                <p className="active-agents-codex-usage-meta-row">
                                  <span className="active-agents-codex-usage-label">Current session</span>
                                  <span className="active-agents-codex-usage-percent">
                                    {claudePrimaryUsagePercent === null
                                      ? "--"
                                      : `${Math.round(claudePrimaryUsagePercent)}%`}
                                  </span>
                                </p>
                              </div>
                              <div className="active-agents-codex-usage-row">
                                <span
                                  aria-label="Claude current week usage"
                                  aria-valuemax={100}
                                  aria-valuemin={0}
                                  aria-valuenow={
                                    claudeSecondaryUsagePercent === null
                                      ? undefined
                                      : Math.round(claudeSecondaryUsagePercent)
                                  }
                                  aria-valuetext={
                                    claudeSecondaryUsagePercent === null
                                      ? "No usage data"
                                      : `${Math.round(claudeSecondaryUsagePercent)}%`
                                  }
                                  className="active-agents-codex-usage-rail"
                                  role="progressbar"
                                  tabIndex={0}
                                >
                                  <span
                                    className="active-agents-codex-usage-rail-fill"
                                    style={{ width: `${claudeSecondaryUsagePercent ?? 0}%` }}
                                  />
                                </span>
                                <p className="active-agents-codex-usage-meta-row">
                                  <span className="active-agents-codex-usage-label">Current week (all models)</span>
                                  <span className="active-agents-codex-usage-percent">
                                    {claudeSecondaryUsagePercent === null
                                      ? "--"
                                      : `${Math.round(claudeSecondaryUsagePercent)}%`}
                                  </span>
                                </p>
                              </div>
                              <div className="active-agents-codex-usage-row">
                                <span
                                  aria-label="Claude Sonnet weekly usage"
                                  aria-valuemax={100}
                                  aria-valuemin={0}
                                  aria-valuenow={
                                    claudeSonnetUsagePercent === null
                                      ? undefined
                                      : Math.round(claudeSonnetUsagePercent)
                                  }
                                  aria-valuetext={
                                    claudeSonnetUsagePercent === null
                                      ? "No usage data"
                                      : `${Math.round(claudeSonnetUsagePercent)}%`
                                  }
                                  className="active-agents-codex-usage-rail"
                                  role="progressbar"
                                  tabIndex={0}
                                >
                                  <span
                                    className="active-agents-codex-usage-rail-fill"
                                    style={{ width: `${claudeSonnetUsagePercent ?? 0}%` }}
                                  />
                                </span>
                                <p className="active-agents-codex-usage-meta-row">
                                  <span className="active-agents-codex-usage-label">
                                    Current week (Sonnet only)
                                  </span>
                                  <span className="active-agents-codex-usage-percent">
                                    {claudeSonnetUsagePercent === null
                                      ? "--"
                                      : `${Math.round(claudeSonnetUsagePercent)}%`}
                                  </span>
                                </p>
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <p className="active-agents-codex-usage-status">
                          {resolveUsageStatusMessage({
                            status: claudeUsageStatus,
                            message: claudeUsageSnapshot?.message,
                            waitingLabel: "Waiting for Claude usage...",
                            unavailableLabel: "Claude usage unavailable.",
                            errorLabel: "Claude usage error.",
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </section>
                )}
              </footer>
            )}
          </>
        )}
        <div
          className="active-agents-border-resizer"
          data-testid="active-agents-border-resizer"
          onMouseDown={handleResizeMouseDown}
        />
      </aside>
    </div>
  );
};
