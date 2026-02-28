import type { buildTentacleColumns } from "@octogent/core";

export type TentacleView = Awaited<ReturnType<typeof buildTentacleColumns>>;

export type CodexUsageSnapshot = {
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

export type GitHubCommitPoint = {
  date: string;
  count: number;
};

export type GitHubCommitSparkPoint = GitHubCommitPoint & {
  x: number;
  y: number;
};

export type GitHubRepoSummarySnapshot = {
  status: "ok" | "unavailable" | "error";
  fetchedAt: string;
  source: "gh-cli" | "none";
  message?: string | null;
  repo?: string | null;
  stargazerCount?: number | null;
  openIssueCount?: number | null;
  openPullRequestCount?: number | null;
  commitsPerDay?: GitHubCommitPoint[];
};

export type FrontendUiStateSnapshot = {
  isAgentsSidebarVisible?: boolean;
  sidebarWidth?: number;
  isActiveAgentsSectionExpanded?: boolean;
  isCodexUsageSectionExpanded?: boolean;
  minimizedTentacleIds?: string[];
  tentacleWidths?: Record<string, number>;
};

export type TentacleWorkspaceMode = "shared" | "worktree";
