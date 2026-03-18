export const CODEX_USAGE_SCAN_INTERVAL_MS = 60_000;
export const GITHUB_SUMMARY_SCAN_INTERVAL_MS = 60_000;
export const MONITOR_SCAN_INTERVAL_MS = 60_000;
export const BACKEND_LIVENESS_SCAN_INTERVAL_MS = 120_000;
export const UI_STATE_SAVE_DEBOUNCE_MS = 250;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 520;
export const DEFAULT_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH;

export const PRIMARY_NAV_ITEMS = [
  { index: 1, label: "Agents" },
  { index: 2, label: "Deck" },
  { index: 3, label: "GitHub" },
  { index: 4, label: "Monitor" },
  { index: 5, label: "Conversations" },
  { index: 6, label: "Settings" },
  { index: 7, label: "Sandbox" },
  { index: 8, label: "State Sandbox" },
] as const;

export const GITHUB_COMMIT_SERIES_LENGTH = 30;
export const GITHUB_SPARKLINE_WIDTH = 148;
export const GITHUB_SPARKLINE_HEIGHT = 36;
export const GITHUB_OVERVIEW_GRAPH_WIDTH = 640;
export const GITHUB_OVERVIEW_GRAPH_HEIGHT = 180;

export const PRIMARY_NAV_MAX = PRIMARY_NAV_ITEMS.length;

export type PrimaryNavIndex = (typeof PRIMARY_NAV_ITEMS)[number]["index"];
