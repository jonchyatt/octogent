type LocationLike = Pick<Location, "host" | "protocol">;

const readRuntimeBaseUrl = (): string | null => {
  const value = import.meta.env.VITE_OCTOGENT_API_ORIGIN;
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const withTrailingSlash = (value: string) => (value.endsWith("/") ? value : `${value}/`);

const buildAbsoluteUrl = (baseUrl: string, pathname: string) => {
  const normalizedPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return new URL(normalizedPath, withTrailingSlash(baseUrl)).toString();
};

const localWebSocketUrl = (location: LocationLike, tentacleId: string) => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/api/terminals/${tentacleId}/ws`;
};

const toWebSocketBase = (runtimeBaseUrl: string): string | null => {
  try {
    const url = new URL(runtimeBaseUrl);
    if (url.protocol === "https:") {
      url.protocol = "wss:";
      return url.toString();
    }
    if (url.protocol === "http:") {
      url.protocol = "ws:";
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
};

export const buildAgentSnapshotsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/agent-snapshots";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/agent-snapshots");
};

export const buildTentaclesUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/tentacles";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/tentacles");
};

export const buildCodexUsageUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/codex/usage";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/codex/usage");
};

export const buildClaudeUsageUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/claude/usage";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/claude/usage");
};

export const buildGithubSummaryUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/github/summary";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/github/summary");
};

export const buildUiStateUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/ui-state";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/ui-state");
};

export const buildMonitorConfigUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/monitor/config";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/monitor/config");
};

export const buildMonitorFeedUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/monitor/feed";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/monitor/feed");
};

export const buildMonitorRefreshUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/monitor/refresh";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/monitor/refresh");
};

export const buildConversationsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/conversations";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/conversations");
};

export const buildConversationSearchUrl = (
  query: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const path = `/api/conversations/search?q=${encodeURIComponent(query)}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildConversationSessionUrl = (
  sessionId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedSessionId = encodeURIComponent(sessionId);
  const path = `/api/conversations/${encodedSessionId}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildConversationExportUrl = (
  sessionId: string,
  format: "json" | "md",
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedSessionId = encodeURIComponent(sessionId);
  const path = `/api/conversations/${encodedSessionId}/export?format=${format}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildTentacleRenameUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedTentacleId = encodeURIComponent(tentacleId);
  if (!runtimeBaseUrl) {
    return `/api/tentacles/${encodedTentacleId}`;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, `/api/tentacles/${encodedTentacleId}`);
};

export const buildTentacleAgentsUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedTentacleId = encodeURIComponent(tentacleId);
  const path = `/api/tentacles/${encodedTentacleId}/agents`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildTentacleAgentUrl = (
  tentacleId: string,
  agentId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedTentacleId = encodeURIComponent(tentacleId);
  const encodedAgentId = encodeURIComponent(agentId);
  const path = `/api/tentacles/${encodedTentacleId}/agents/${encodedAgentId}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

const buildTentacleGitActionUrl = (
  tentacleId: string,
  action: "status" | "commit" | "push" | "sync",
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedTentacleId = encodeURIComponent(tentacleId);
  const path = `/api/tentacles/${encodedTentacleId}/git/${action}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildTentacleGitStatusUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildTentacleGitActionUrl(tentacleId, "status", runtimeBaseUrl);

export const buildTentacleGitCommitUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildTentacleGitActionUrl(tentacleId, "commit", runtimeBaseUrl);

export const buildTentacleGitPushUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildTentacleGitActionUrl(tentacleId, "push", runtimeBaseUrl);

export const buildTentacleGitSyncUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildTentacleGitActionUrl(tentacleId, "sync", runtimeBaseUrl);

export const buildTentacleGitPullRequestUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedTentacleId = encodeURIComponent(tentacleId);
  const path = `/api/tentacles/${encodedTentacleId}/git/pr`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildTentacleGitPullRequestMergeUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedTentacleId = encodeURIComponent(tentacleId);
  const path = `/api/tentacles/${encodedTentacleId}/git/pr/merge`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildDeckTentaclesUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/deck/tentacles";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/deck/tentacles");
};

export const buildDeckTentacleUrl = (tentacleId: string, runtimeBaseUrl = readRuntimeBaseUrl()) => {
  const encodedTentacleId = encodeURIComponent(tentacleId);
  const path = `/api/deck/tentacles/${encodedTentacleId}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildDeckVaultFileUrl = (
  tentacleId: string,
  fileName: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedTentacleId = encodeURIComponent(tentacleId);
  const encodedFileName = encodeURIComponent(fileName);
  const path = `/api/deck/tentacles/${encodedTentacleId}/files/${encodedFileName}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildTerminalSocketUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
  location: LocationLike = window.location,
) => {
  const encodedTentacleId = encodeURIComponent(tentacleId);
  if (!runtimeBaseUrl) {
    return localWebSocketUrl(location, encodedTentacleId);
  }

  const webSocketBase = toWebSocketBase(runtimeBaseUrl);
  if (!webSocketBase) {
    return localWebSocketUrl(location, encodedTentacleId);
  }

  return buildAbsoluteUrl(webSocketBase, `/api/terminals/${encodedTentacleId}/ws`);
};
