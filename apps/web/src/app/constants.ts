export const CODEX_USAGE_SCAN_INTERVAL_MS = 60_000;
export const GITHUB_SUMMARY_SCAN_INTERVAL_MS = 60_000;
export const UI_STATE_SAVE_DEBOUNCE_MS = 250;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 520;
export const DEFAULT_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH;

export const PRIMARY_NAV_ITEMS = [
  { index: 0, label: "Board" },
  { index: 1, label: "Agents" },
  { index: 2, label: "Sessions" },
  { index: 3, label: "GitHub" },
  { index: 4, label: "Pipelines" },
  { index: 5, label: "Logs" },
  { index: 6, label: "Settings" },
] as const;

export const GITHUB_SUBTABS = [{ id: "overview", label: "Overview" }] as const;

export const TELEMETRY_TAPE_ITEMS = [
  { symbol: "QUEUE", change: 1.92 },
  { symbol: "CPU", change: -0.37 },
  { symbol: "TOKENS", change: 0.66 },
  { symbol: "LATENCY", change: -2.12 },
  { symbol: "WORKTREE", change: 0.73 },
  { symbol: "RETRIES", change: 1.31 },
  { symbol: "ERRORS", change: -0.44 },
  { symbol: "THROUGHPUT", change: 0.29 },
] as const;

export const GITHUB_COMMIT_SERIES_LENGTH = 30;
export const GITHUB_SPARKLINE_WIDTH = 148;
export const GITHUB_SPARKLINE_HEIGHT = 36;
export const GITHUB_OVERVIEW_GRAPH_WIDTH = 640;
export const GITHUB_OVERVIEW_GRAPH_HEIGHT = 180;

export type PrimaryNavIndex = (typeof PRIMARY_NAV_ITEMS)[number]["index"];
export type GitHubSubtabId = (typeof GITHUB_SUBTABS)[number]["id"];
