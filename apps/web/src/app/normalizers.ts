import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, PRIMARY_NAV_MAX } from "./constants";
import { isTentacleCompletionSoundId } from "./notificationSounds";
import type {
  ClaudeUsageSnapshot,
  CodexUsageSnapshot,
  ConversationSessionDetail,
  ConversationSessionSummary,
  ConversationTranscriptEvent,
  ConversationTurn,
  FrontendUiStateSnapshot,
  GitHubCommitPoint,
  GitHubRecentCommit,
  GitHubRepoSummarySnapshot,
  MonitorConfigSnapshot,
  MonitorFeedSnapshot,
  MonitorPost,
  MonitorUsageSnapshot,
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

export const normalizeClaudeUsageSnapshot = (value: unknown): ClaudeUsageSnapshot | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const status = record.status;
  if (status !== "ok" && status !== "unavailable" && status !== "error") {
    return null;
  }

  const source =
    record.source === "cli-pty" ? "cli-pty" : record.source === "oauth-api" ? "oauth-api" : "none";
  return {
    status,
    source,
    fetchedAt: asString(record.fetchedAt) ?? new Date().toISOString(),
    message: asString(record.message),
    planType: asString(record.planType),
    primaryUsedPercent: asNumber(record.primaryUsedPercent),
    primaryResetAt: asString(record.primaryResetAt),
    secondaryUsedPercent: asNumber(record.secondaryUsedPercent),
    secondaryResetAt: asString(record.secondaryResetAt),
    sonnetUsedPercent: asNumber(record.sonnetUsedPercent),
    sonnetResetAt: asString(record.sonnetResetAt),
    extraUsageCostUsed: asNumber(record.extraUsageCostUsed),
    extraUsageCostLimit: asNumber(record.extraUsageCostLimit),
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

const normalizeGitHubRecentCommit = (value: unknown): GitHubRecentCommit | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const hash = asString(record.hash)?.trim();
  const shortHash = asString(record.shortHash)?.trim();
  const subject = asString(record.subject)?.trim();
  const authorName = asString(record.authorName)?.trim();
  const authorEmail = asString(record.authorEmail)?.trim() ?? "";
  const authoredAt = asString(record.authoredAt)?.trim();
  const body = asString(record.body)?.trim() ?? "";
  const filesChanged = asNumber(record.filesChanged) ?? 0;
  const insertions = asNumber(record.insertions) ?? 0;
  const deletions = asNumber(record.deletions) ?? 0;
  if (!hash || !shortHash || !subject || !authorName || !authoredAt) {
    return null;
  }

  return {
    hash,
    shortHash,
    subject,
    authorName,
    authorEmail,
    authoredAt,
    body,
    filesChanged,
    insertions,
    deletions,
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
  const rawRecentCommits = Array.isArray(record.recentCommits) ? record.recentCommits : [];
  const recentCommits = rawRecentCommits
    .map((commit) => normalizeGitHubRecentCommit(commit))
    .filter((commit): commit is GitHubRecentCommit => commit !== null);

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
    recentCommits,
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
  if (
    typeof record.activePrimaryNav === "number" &&
    Number.isInteger(record.activePrimaryNav) &&
    record.activePrimaryNav >= 1 &&
    record.activePrimaryNav <= PRIMARY_NAV_MAX
  ) {
    nextState.activePrimaryNav = record.activePrimaryNav;
  }

  if (typeof record.isAgentsSidebarVisible === "boolean") {
    nextState.isAgentsSidebarVisible = record.isAgentsSidebarVisible;
  }

  if (typeof record.sidebarWidth === "number" && Number.isFinite(record.sidebarWidth)) {
    nextState.sidebarWidth = clampSidebarWidth(record.sidebarWidth);
  }

  if (typeof record.isActiveAgentsSectionExpanded === "boolean") {
    nextState.isActiveAgentsSectionExpanded = record.isActiveAgentsSectionExpanded;
  }

  if (typeof record.isRuntimeStatusStripVisible === "boolean") {
    nextState.isRuntimeStatusStripVisible = record.isRuntimeStatusStripVisible;
  }

  if (typeof record.isMonitorVisible === "boolean") {
    nextState.isMonitorVisible = record.isMonitorVisible;
  }

  if (typeof record.isBottomTelemetryVisible === "boolean") {
    nextState.isBottomTelemetryVisible = record.isBottomTelemetryVisible;
  }

  if (typeof record.isCodexUsageVisible === "boolean") {
    nextState.isCodexUsageVisible = record.isCodexUsageVisible;
  }

  if (typeof record.isClaudeUsageVisible === "boolean") {
    nextState.isClaudeUsageVisible = record.isClaudeUsageVisible;
  }

  if (typeof record.isCodexUsageSectionExpanded === "boolean") {
    nextState.isCodexUsageSectionExpanded = record.isCodexUsageSectionExpanded;
  }

  if (typeof record.isClaudeUsageSectionExpanded === "boolean") {
    nextState.isClaudeUsageSectionExpanded = record.isClaudeUsageSectionExpanded;
  }

  if (isTentacleCompletionSoundId(record.tentacleCompletionSound)) {
    nextState.tentacleCompletionSound = record.tentacleCompletionSound;
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

const normalizeMonitorUsageSnapshot = (value: unknown): MonitorUsageSnapshot | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const status = record.status;
  if (status !== "ok" && status !== "unavailable" && status !== "error") {
    return null;
  }

  return {
    status,
    source: record.source === "x-api" ? "x-api" : "none",
    fetchedAt: asString(record.fetchedAt) ?? new Date().toISOString(),
    message: asString(record.message),
    cap: asNumber(record.cap),
    used: asNumber(record.used),
    remaining: asNumber(record.remaining),
    resetAt: asString(record.resetAt),
  };
};

const normalizeMonitorPost = (value: unknown): MonitorPost | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = asString(record.id);
  const text = asString(record.text);
  const author = asString(record.author);
  const createdAt = asString(record.createdAt);
  const permalink = asString(record.permalink);
  const likeCount = asNumber(record.likeCount);
  const matchedQueryTerm = asString(record.matchedQueryTerm);

  if (!id || !text || !author || !createdAt || !permalink || likeCount === null) {
    return null;
  }

  return {
    source: "x",
    id,
    text,
    author,
    createdAt,
    permalink,
    likeCount: Math.max(0, Math.floor(likeCount)),
    matchedQueryTerm,
  };
};

export const normalizeMonitorConfigSnapshot = (value: unknown): MonitorConfigSnapshot | null => {
  const record = asRecord(value);
  if (!record || record.providerId !== "x") {
    return null;
  }

  const queryTerms = Array.isArray(record.queryTerms)
    ? record.queryTerms.filter((term): term is string => typeof term === "string")
    : [];
  const refreshPolicy = asRecord(record.refreshPolicy);
  const searchWindowDaysRaw = asNumber(refreshPolicy?.searchWindowDays);
  const searchWindowDays =
    searchWindowDaysRaw === 1 || searchWindowDaysRaw === 3 || searchWindowDaysRaw === 7
      ? searchWindowDaysRaw
      : 7;
  const providers = asRecord(record.providers);
  const xProvider = providers ? asRecord(providers.x) : null;
  const credentials = xProvider ? asRecord(xProvider.credentials) : null;
  if (!credentials) {
    return null;
  }

  return {
    providerId: "x",
    queryTerms,
    refreshPolicy: {
      maxCacheAgeMs: asNumber(refreshPolicy?.maxCacheAgeMs) ?? 24 * 60 * 60 * 1000,
      maxPosts: asNumber(refreshPolicy?.maxPosts) ?? 30,
      searchWindowDays,
    },
    providers: {
      x: {
        credentials: {
          isConfigured: credentials.isConfigured === true,
          bearerTokenHint: asString(credentials.bearerTokenHint),
          apiKeyHint: asString(credentials.apiKeyHint),
          hasApiSecret: credentials.hasApiSecret === true,
          hasAccessToken: credentials.hasAccessToken === true,
          hasAccessTokenSecret: credentials.hasAccessTokenSecret === true,
          updatedAt: asString(credentials.updatedAt),
        },
      },
    },
  };
};

export const normalizeMonitorFeedSnapshot = (value: unknown): MonitorFeedSnapshot | null => {
  const record = asRecord(value);
  if (!record || record.providerId !== "x") {
    return null;
  }

  const queryTerms = Array.isArray(record.queryTerms)
    ? record.queryTerms.filter((term): term is string => typeof term === "string")
    : [];
  const refreshPolicy = asRecord(record.refreshPolicy);
  const searchWindowDaysRaw = asNumber(refreshPolicy?.searchWindowDays);
  const searchWindowDays =
    searchWindowDaysRaw === 1 || searchWindowDaysRaw === 3 || searchWindowDaysRaw === 7
      ? searchWindowDaysRaw
      : 7;
  const posts = Array.isArray(record.posts)
    ? record.posts
        .map((post) => normalizeMonitorPost(post))
        .filter((post): post is MonitorPost => post !== null)
    : [];

  return {
    providerId: "x",
    queryTerms,
    refreshPolicy: {
      maxCacheAgeMs: asNumber(refreshPolicy?.maxCacheAgeMs) ?? 24 * 60 * 60 * 1000,
      maxPosts: asNumber(refreshPolicy?.maxPosts) ?? 30,
      searchWindowDays,
    },
    lastFetchedAt: asString(record.lastFetchedAt),
    staleAfter: asString(record.staleAfter),
    isStale: record.isStale === true,
    lastError: asString(record.lastError),
    posts,
    usage: normalizeMonitorUsageSnapshot(record.usage),
  };
};

const normalizeConversationTurn = (value: unknown): ConversationTurn | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const turnId = asString(record.turnId);
  const role = record.role;
  const content = asString(record.content);
  const startedAt = asString(record.startedAt);
  const endedAt = asString(record.endedAt);
  if (
    !turnId ||
    (role !== "user" && role !== "assistant") ||
    content === null ||
    !startedAt ||
    !endedAt
  ) {
    return null;
  }

  return {
    turnId,
    role,
    content,
    startedAt,
    endedAt,
  };
};

const normalizeConversationTranscriptEvent = (
  value: unknown,
): ConversationTranscriptEvent | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const eventId = asString(record.eventId);
  const sessionId = asString(record.sessionId);
  const tentacleId = asString(record.tentacleId);
  const timestamp = asString(record.timestamp);
  const type = record.type;
  if (
    !eventId ||
    !sessionId ||
    !tentacleId ||
    !timestamp ||
    (type !== "session_start" &&
      type !== "input_submit" &&
      type !== "output_chunk" &&
      type !== "state_change" &&
      type !== "session_end")
  ) {
    return null;
  }

  return {
    eventId,
    sessionId,
    tentacleId,
    timestamp,
    type,
  };
};

export const normalizeConversationSessionSummary = (
  value: unknown,
): ConversationSessionSummary | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const sessionId = asString(record.sessionId);
  if (!sessionId) {
    return null;
  }

  const tentacleId = asString(record.tentacleId);
  return {
    sessionId,
    tentacleId,
    startedAt: asString(record.startedAt),
    endedAt: asString(record.endedAt),
    lastEventAt: asString(record.lastEventAt),
    eventCount: Math.max(0, Math.floor(asNumber(record.eventCount) ?? 0)),
    turnCount: Math.max(0, Math.floor(asNumber(record.turnCount) ?? 0)),
    userTurnCount: Math.max(0, Math.floor(asNumber(record.userTurnCount) ?? 0)),
    assistantTurnCount: Math.max(0, Math.floor(asNumber(record.assistantTurnCount) ?? 0)),
    firstUserTurnPreview: asString(record.firstUserTurnPreview),
    lastUserTurnPreview: asString(record.lastUserTurnPreview),
    lastAssistantTurnPreview: asString(record.lastAssistantTurnPreview),
  };
};

export const normalizeConversationSessionDetail = (
  value: unknown,
): ConversationSessionDetail | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const summary = normalizeConversationSessionSummary(record);
  if (!summary) {
    return null;
  }

  const turns = Array.isArray(record.turns)
    ? record.turns
        .map((turn) => normalizeConversationTurn(turn))
        .filter((turn): turn is ConversationTurn => turn !== null)
    : [];
  const events = Array.isArray(record.events)
    ? record.events
        .map((event) => normalizeConversationTranscriptEvent(event))
        .filter((event): event is ConversationTranscriptEvent => event !== null)
    : [];

  return {
    ...summary,
    turns,
    events,
  };
};
