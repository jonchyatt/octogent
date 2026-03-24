import { useCallback, useEffect, useRef, useState } from "react";

import { GITHUB_OVERVIEW_GRAPH_HEIGHT, GITHUB_OVERVIEW_GRAPH_WIDTH } from "../app/constants";
import { formatGitHubCommitHoverLabel } from "../app/githubMetrics";
import type { GitHubCommitSparkPoint, GitHubRecentCommit } from "../app/types";
import { ActionButton } from "./ui/ActionButton";

type GitHubPrimaryViewProps = {
  githubRepoLabel: string;
  githubStatusPill: string;
  isRefreshingGitHubSummary: boolean;
  onRefresh: () => void;
  githubStarCountLabel: string;
  githubOpenIssuesLabel: string;
  githubOpenPrsLabel: string;
  githubRecentCommits: GitHubRecentCommit[];
  githubCommitCount30d: number;
  githubOverviewHoverLabel: string;
  githubOverviewGraphPolylinePoints: string;
  githubOverviewGraphSeries: GitHubCommitSparkPoint[];
  hoveredGitHubOverviewPointIndex: number | null;
  onHoveredGitHubOverviewPointIndexChange: (index: number | null) => void;
};

const GITHUB_OVERVIEW_GRAPH_VIEWBOX_INSET = 8;
const GITHUB_RECENT_COMMITS_LIMIT = 50;

const formatRecentCommitTimestamp = (value: string) => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const GitHubPrimaryView = ({
  githubRepoLabel,
  githubStatusPill,
  isRefreshingGitHubSummary,
  onRefresh,
  githubStarCountLabel,
  githubOpenIssuesLabel,
  githubOpenPrsLabel,
  githubRecentCommits,
  githubCommitCount30d,
  githubOverviewHoverLabel,
  githubOverviewGraphPolylinePoints,
  githubOverviewGraphSeries,
  hoveredGitHubOverviewPointIndex,
  onHoveredGitHubOverviewPointIndexChange,
}: GitHubPrimaryViewProps) => {
  const [hoverCursorPosition, setHoverCursorPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [pinnedCommitHash, setPinnedCommitHash] = useState<string | null>(null);
  const [hoveredCommitHash, setHoveredCommitHash] = useState<string | null>(null);
  const [commitTooltipY, setCommitTooltipY] = useState<number | null>(null);
  const recentSectionRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const activeCommitHash = pinnedCommitHash ?? hoveredCommitHash;
  const activeCommit = activeCommitHash
    ? (githubRecentCommits.find((c) => c.hash === activeCommitHash) ?? null)
    : null;

  const dismissCommitTooltip = useCallback(() => {
    setPinnedCommitHash(null);
    setCommitTooltipY(null);
  }, []);

  useEffect(() => {
    if (!pinnedCommitHash) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (recentSectionRef.current?.contains(target) || tooltipRef.current?.contains(target)) {
        return;
      }
      dismissCommitTooltip();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [pinnedCommitHash, dismissCommitTooltip]);
  const hoveredGitHubOverviewPoint =
    hoveredGitHubOverviewPointIndex !== null
      ? (githubOverviewGraphSeries[hoveredGitHubOverviewPointIndex] ?? null)
      : null;
  const tooltipLabel = hoveredGitHubOverviewPoint
    ? formatGitHubCommitHoverLabel(hoveredGitHubOverviewPoint)
    : null;

  return (
    <section className="github-view" aria-label="GitHub primary view">
      <section className="github-overview" aria-label="GitHub overview">
        <header className="github-overview-header">
          <h2>{githubRepoLabel}</h2>
          <div className="github-overview-header-actions">
            <span className="console-status-pill">{githubStatusPill}</span>
            <ActionButton
              aria-label="Refresh GitHub overview data"
              className="github-overview-refresh"
              disabled={isRefreshingGitHubSummary}
              onClick={onRefresh}
              size="dense"
              variant="accent"
            >
              {isRefreshingGitHubSummary ? "Refreshing..." : "Refresh"}
            </ActionButton>
          </div>
        </header>
        <div className="github-overview-content">
          <section className="github-overview-main">
            <section className="github-overview-graph" aria-label="GitHub commits graph">
              <div className="github-overview-graph-meta">
                <strong>Commits Per Day</strong>
                <span>{githubOverviewHoverLabel}</span>
              </div>
              <div className="github-overview-graph-surface">
                <svg
                  onMouseLeave={() => {
                    onHoveredGitHubOverviewPointIndexChange(null);
                    setHoverCursorPosition(null);
                  }}
                  onMouseMove={(event) => {
                    if (githubOverviewGraphSeries.length === 0) {
                      return;
                    }

                    const rect = event.currentTarget.getBoundingClientRect();
                    if (rect.width <= 0) {
                      return;
                    }

                    const clampedRatio = Math.min(
                      1,
                      Math.max(0, (event.clientX - rect.left) / rect.width),
                    );
                    const viewBox = event.currentTarget.viewBox.baseVal;
                    const pointerX = viewBox.x + viewBox.width * clampedRatio;
                    const pointerY = Math.max(0, event.clientY - rect.top);

                    let nearestPointIndex = 0;
                    let nearestDistance = Number.POSITIVE_INFINITY;
                    githubOverviewGraphSeries.forEach((point, index) => {
                      const distance = Math.abs(point.x - pointerX);
                      if (distance < nearestDistance) {
                        nearestDistance = distance;
                        nearestPointIndex = index;
                      }
                    });

                    if (nearestPointIndex !== hoveredGitHubOverviewPointIndex) {
                      onHoveredGitHubOverviewPointIndexChange(nearestPointIndex);
                    }

                    setHoverCursorPosition({
                      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
                      y: Math.max(0, Math.min(rect.height, pointerY)),
                    });
                  }}
                  viewBox={`${-GITHUB_OVERVIEW_GRAPH_VIEWBOX_INSET} ${-GITHUB_OVERVIEW_GRAPH_VIEWBOX_INSET} ${
                    GITHUB_OVERVIEW_GRAPH_WIDTH + GITHUB_OVERVIEW_GRAPH_VIEWBOX_INSET * 2
                  } ${GITHUB_OVERVIEW_GRAPH_HEIGHT + GITHUB_OVERVIEW_GRAPH_VIEWBOX_INSET * 2}`}
                  role="presentation"
                >
                  <polyline points={githubOverviewGraphPolylinePoints} />
                  {githubOverviewGraphSeries.map((point, index) => (
                    <circle
                      aria-label={formatGitHubCommitHoverLabel(point)}
                      className={`github-overview-graph-point${
                        hoveredGitHubOverviewPointIndex === index ? " is-active" : ""
                      }`}
                      cx={point.x}
                      cy={point.y}
                      key={`${point.date}-${index}`}
                      onFocus={() => {
                        onHoveredGitHubOverviewPointIndexChange(index);
                      }}
                      onMouseEnter={() => {
                        onHoveredGitHubOverviewPointIndexChange(index);
                      }}
                      r={6}
                      tabIndex={0}
                    >
                      <title>{formatGitHubCommitHoverLabel(point)}</title>
                    </circle>
                  ))}
                </svg>
                {hoverCursorPosition && tooltipLabel && (
                  <div
                    className="github-overview-graph-tooltip"
                    style={{
                      left: `${hoverCursorPosition.x}px`,
                      top: `${Math.max(8, hoverCursorPosition.y - 14)}px`,
                    }}
                  >
                    {tooltipLabel}
                  </div>
                )}
              </div>
            </section>
          </section>

          <aside className="github-overview-side" aria-label="GitHub recent activity">
            <dl className="github-overview-stats" aria-label="Repository stats">
              <div
                aria-label={`Stars ${githubStarCountLabel}`}
                className="github-overview-stat"
                data-metric="st"
                data-label="Stars"
                title="Stars"
              >
                <dt>
                  <span aria-hidden="true" className="github-overview-stat-icon">
                    <svg viewBox="0 0 16 16">
                      <path d="M8 1.5 9.9 5.5 14.3 6 11 9.1 11.9 13.5 8 11.3 4.1 13.5 5 9.1 1.7 6 6.1 5.5z" />
                    </svg>
                  </span>
                </dt>
                <dd>{githubStarCountLabel}</dd>
              </div>
              <div
                aria-label={`Open issues ${githubOpenIssuesLabel}`}
                className="github-overview-stat"
                data-metric="is"
                data-label="Open issues"
                title="Open issues"
              >
                <dt>
                  <span aria-hidden="true" className="github-overview-stat-icon">
                    <svg viewBox="0 0 16 16">
                      <path d="M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2z" />
                      <path d="M8 5.1v3.6m0 2.2h.01" />
                    </svg>
                  </span>
                </dt>
                <dd>{githubOpenIssuesLabel}</dd>
              </div>
              <div
                aria-label={`Open PRs ${githubOpenPrsLabel}`}
                className="github-overview-stat"
                data-metric="pr"
                data-label="Open PRs"
                title="Open PRs"
              >
                <dt>
                  <span aria-hidden="true" className="github-overview-stat-icon">
                    <svg viewBox="0 0 16 16">
                      <path d="M5 2.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM11 9.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5 6.5v7m0-3.5h4.2" />
                    </svg>
                  </span>
                </dt>
                <dd>{githubOpenPrsLabel}</dd>
              </div>
              <div
                aria-label={`Commits in 30 days ${githubCommitCount30d}`}
                className="github-overview-stat"
                data-metric="30d"
                data-label="Commits (30d)"
                title="Commits (30d)"
              >
                <dt>
                  <span aria-hidden="true" className="github-overview-stat-icon">
                    <svg viewBox="0 0 16 16">
                      <path d="M2 11.8h12M4 9.7l2.2-2.2 2 1.7L12 5.6" />
                    </svg>
                  </span>
                </dt>
                <dd>{githubCommitCount30d}</dd>
              </div>
            </dl>
            <section
              className="github-overview-recent"
              aria-label="Recent commits"
              ref={recentSectionRef}
            >
              <header className="github-overview-recent-header">
                <h3>Recent commits</h3>
                <span>{`Showing last ${GITHUB_RECENT_COMMITS_LIMIT}`}</span>
              </header>
              {githubRecentCommits.length > 0 ? (
                <ol className="github-overview-recent-list">
                  {githubRecentCommits.map((commit) => (
                    <li
                      className={`github-overview-recent-item${pinnedCommitHash === commit.hash ? " is-selected" : ""}`}
                      key={commit.hash}
                      onMouseEnter={(event) => {
                        if (pinnedCommitHash) {
                          return;
                        }
                        setHoveredCommitHash(commit.hash);
                        const sectionRect = recentSectionRef.current?.getBoundingClientRect();
                        if (sectionRect) {
                          const itemRect = event.currentTarget.getBoundingClientRect();
                          setCommitTooltipY(itemRect.top - sectionRect.top + itemRect.height / 2);
                        }
                      }}
                      onMouseLeave={() => {
                        if (pinnedCommitHash) {
                          return;
                        }
                        setHoveredCommitHash(null);
                        setCommitTooltipY(null);
                      }}
                      onClick={(event) => {
                        if (pinnedCommitHash === commit.hash) {
                          dismissCommitTooltip();
                          return;
                        }
                        setPinnedCommitHash(commit.hash);
                        const sectionRect = recentSectionRef.current?.getBoundingClientRect();
                        if (sectionRect) {
                          const itemRect = event.currentTarget.getBoundingClientRect();
                          setCommitTooltipY(itemRect.top - sectionRect.top + itemRect.height / 2);
                        }
                      }}
                    >
                      <span aria-hidden="true" className="github-overview-recent-node" />
                      <span className="github-overview-recent-sha">{commit.shortHash}</span>
                      <div className="github-overview-recent-copy">
                        <p className="github-overview-recent-subject">{commit.subject}</p>
                        <p className="github-overview-recent-meta">
                          <span>{commit.authorName}</span>
                          <span>{formatRecentCommitTimestamp(commit.authoredAt)}</span>
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="github-overview-recent-empty">Recent commit data is unavailable.</p>
              )}
              <div
                ref={tooltipRef}
                className={`github-overview-recent-tooltip${activeCommit ? " is-visible" : ""}`}
                style={{
                  top: commitTooltipY !== null ? `${commitTooltipY}px` : undefined,
                }}
              >
                {activeCommit && (
                  <>
                    <p className="github-overview-recent-tooltip-hash">
                      <span>{activeCommit.shortHash}</span>
                      <button
                        className="github-overview-recent-tooltip-copy"
                        type="button"
                        title="Copy full hash"
                        onClick={() => {
                          navigator.clipboard.writeText(activeCommit.hash);
                        }}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
                          <path d="M10.5 5.5V3.7a1.2 1.2 0 0 0-1.2-1.2H3.7a1.2 1.2 0 0 0-1.2 1.2v5.6a1.2 1.2 0 0 0 1.2 1.2H5.5" />
                        </svg>
                      </button>
                    </p>
                    <p className="github-overview-recent-tooltip-author">
                      {activeCommit.authorName}
                      {activeCommit.authorEmail ? ` <${activeCommit.authorEmail}>` : ""}
                    </p>
                    <p className="github-overview-recent-tooltip-message">
                      {activeCommit.body
                        ? `${activeCommit.subject}\n\n${activeCommit.body}`
                        : activeCommit.subject}
                    </p>
                    {activeCommit.filesChanged > 0 && (
                      <p className="github-overview-recent-tooltip-diff">
                        <span>
                          {activeCommit.filesChanged}{" "}
                          {activeCommit.filesChanged === 1 ? "file" : "files"}
                        </span>
                        <span className="github-overview-recent-tooltip-ins">
                          +{activeCommit.insertions}
                        </span>
                        <span className="github-overview-recent-tooltip-del">
                          -{activeCommit.deletions}
                        </span>
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </section>
  );
};
