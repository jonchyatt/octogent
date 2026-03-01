import { useState } from "react";

import {
  GITHUB_OVERVIEW_GRAPH_HEIGHT,
  GITHUB_OVERVIEW_GRAPH_WIDTH,
  GITHUB_SUBTABS,
  type GitHubSubtabId,
} from "../app/constants";
import { formatGitHubCommitHoverLabel } from "../app/githubMetrics";
import type { GitHubCommitSparkPoint } from "../app/types";
import { ActionButton } from "./ui/ActionButton";

type GitHubPrimaryViewProps = {
  activeGitHubSubtab: GitHubSubtabId;
  onGitHubSubtabChange: (subtab: GitHubSubtabId) => void;
  githubRepoLabel: string;
  githubStatusPill: string;
  isRefreshingGitHubSummary: boolean;
  onRefresh: () => void;
  githubStarCountLabel: string;
  githubOpenIssuesLabel: string;
  githubOpenPrsLabel: string;
  githubCommitCount30d: number;
  githubOverviewHoverLabel: string;
  githubOverviewGraphPolylinePoints: string;
  githubOverviewGraphSeries: GitHubCommitSparkPoint[];
  hoveredGitHubOverviewPointIndex: number | null;
  onHoveredGitHubOverviewPointIndexChange: (index: number | null) => void;
};

const GITHUB_OVERVIEW_GRAPH_VIEWBOX_INSET = 8;

export const GitHubPrimaryView = ({
  activeGitHubSubtab,
  onGitHubSubtabChange,
  githubRepoLabel,
  githubStatusPill,
  isRefreshingGitHubSummary,
  onRefresh,
  githubStarCountLabel,
  githubOpenIssuesLabel,
  githubOpenPrsLabel,
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
  const hoveredGitHubOverviewPoint =
    hoveredGitHubOverviewPointIndex !== null
      ? githubOverviewGraphSeries[hoveredGitHubOverviewPointIndex] ?? null
      : null;
  const tooltipLabel = hoveredGitHubOverviewPoint
    ? formatGitHubCommitHoverLabel(hoveredGitHubOverviewPoint)
    : null;

  return (
    <section className="github-view" aria-label="GitHub primary view">
      <nav className="github-subtabs" aria-label="GitHub subtabs">
        {GITHUB_SUBTABS.map((subtab) => (
          <button
            aria-current={activeGitHubSubtab === subtab.id ? "page" : undefined}
            className="github-subtab"
            data-active={activeGitHubSubtab === subtab.id ? "true" : "false"}
            key={subtab.id}
            onClick={() => {
              onGitHubSubtabChange(subtab.id);
            }}
            type="button"
          >
            {subtab.label}
          </button>
        ))}
      </nav>

      {activeGitHubSubtab === "overview" && (
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
          <dl className="github-overview-stats">
            <div>
              <dt>Stars</dt>
              <dd>{githubStarCountLabel}</dd>
            </div>
            <div>
              <dt>Open issues</dt>
              <dd>{githubOpenIssuesLabel}</dd>
            </div>
            <div>
              <dt>Open PRs</dt>
              <dd>{githubOpenPrsLabel}</dd>
            </div>
            <div>
              <dt>Commits (30d)</dt>
              <dd>{githubCommitCount30d}</dd>
            </div>
          </dl>
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
      )}
    </section>
  );
};
