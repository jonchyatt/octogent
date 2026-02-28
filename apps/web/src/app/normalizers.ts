import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from "./constants";
import type {
  CodexUsageSnapshot,
  FrontendUiStateSnapshot,
  GitHubCommitPoint,
  GitHubRepoSummarySnapshot,
} from "./types";

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

export const clampSidebarWidth = (width: number) =>
  Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));

export const normalizeCodexUsageSnapshot = (value: unknown): CodexUsageSnapshot | null => {
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

const normalizeGitHubCommitPoint = (value: unknown): GitHubCommitPoint | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const date = asString(record.date);
  const count = asNumber(record.count);
  if (!date || count === null) {
    return null;
  }

  return {
    date,
    count: Math.max(0, Math.round(count)),
  };
};

export const normalizeGitHubRepoSummarySnapshot = (
  value: unknown,
): GitHubRepoSummarySnapshot | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const status = record.status;
  if (status !== "ok" && status !== "unavailable" && status !== "error") {
    return null;
  }

  const rawCommitsPerDay = Array.isArray(record.commitsPerDay) ? record.commitsPerDay : [];
  const commitsPerDay = rawCommitsPerDay
    .map((point) => normalizeGitHubCommitPoint(point))
    .filter((point): point is GitHubCommitPoint => point !== null);

  return {
    status,
    source: record.source === "gh-cli" ? "gh-cli" : "none",
    fetchedAt: asString(record.fetchedAt) ?? new Date().toISOString(),
    message: asString(record.message),
    repo: asString(record.repo),
    stargazerCount: asNumber(record.stargazerCount),
    openIssueCount: asNumber(record.openIssueCount),
    openPullRequestCount: asNumber(record.openPullRequestCount),
    commitsPerDay,
  };
};

export const normalizeFrontendUiStateSnapshot = (
  value: unknown,
): FrontendUiStateSnapshot | null => {
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
