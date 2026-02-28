import type {
  MonitorCredentialSummary,
  MonitorCredentialsSaveResult,
  MonitorPost,
  MonitorProviderAdapter,
  MonitorProviderValidationResult,
  MonitorUsageSnapshot,
  XMonitorCredentials,
} from "./types";
import { DEFAULT_MONITOR_QUERY_TERMS } from "./defaults";

const DEFAULT_X_API_BASE_URL = "https://api.x.com";
const DEFAULT_X_USAGE_ENDPOINT_PATH = "/2/usage/tweets";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

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

const normalizeOptionalSecret = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const maskSecret = (value: string | null): string | null => {
  if (!value || value.length === 0) {
    return null;
  }

  if (value.length <= 4) {
    return "*".repeat(value.length);
  }

  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
};

const toXCredentials = (value: unknown): XMonitorCredentials | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const bearerToken = asString(record.bearerToken)?.trim();
  if (!bearerToken) {
    return null;
  }

  return {
    bearerToken,
    apiKey: normalizeOptionalSecret(record.apiKey),
    apiSecret: normalizeOptionalSecret(record.apiSecret),
    accessToken: normalizeOptionalSecret(record.accessToken),
    accessTokenSecret: normalizeOptionalSecret(record.accessTokenSecret),
    updatedAt: asString(record.updatedAt) ?? new Date().toISOString(),
  };
};

const summarizeXCredentials = (credentials: unknown): MonitorCredentialSummary => {
  const parsed = toXCredentials(credentials);
  if (!parsed) {
    return {
      isConfigured: false,
      bearerTokenHint: null,
      apiKeyHint: null,
      hasApiSecret: false,
      hasAccessToken: false,
      hasAccessTokenSecret: false,
      updatedAt: null,
    };
  }

  return {
    isConfigured: true,
    bearerTokenHint: maskSecret(parsed.bearerToken),
    apiKeyHint: maskSecret(parsed.apiKey),
    hasApiSecret: Boolean(parsed.apiSecret),
    hasAccessToken: Boolean(parsed.accessToken),
    hasAccessTokenSecret: Boolean(parsed.accessTokenSecret),
    updatedAt: parsed.updatedAt,
  };
};

const quoteQueryTerm = (term: string): string => {
  const trimmed = term.trim();
  if (trimmed.includes(" ")) {
    return `"${trimmed.replaceAll('"', "")}"`;
  }
  return trimmed;
};

const normalizeQueryTerms = (queryTerms: string[]): string[] => {
  const normalized = queryTerms
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .map((term) => quoteQueryTerm(term));

  return normalized.length > 0
    ? [...new Set(normalized)]
    : DEFAULT_MONITOR_QUERY_TERMS.map((term) => quoteQueryTerm(term));
};

export const buildXRecentSearchQuery = (queryTerms: string[]): string => {
  const terms = normalizeQueryTerms(queryTerms);
  return `(${terms.join(" OR ")}) lang:en -is:retweet`;
};

const buildXApiUrl = (baseUrl: string, pathname: string, searchParams?: URLSearchParams): string => {
  const url = new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (searchParams) {
    url.search = searchParams.toString();
  }
  return url.toString();
};

const asErrorMessage = (value: unknown): string => {
  if (value instanceof Error) {
    return value.message;
  }
  return typeof value === "string" ? value : "Unknown error";
};

const assertXCredentials = (credentials: unknown): XMonitorCredentials => {
  const parsed = toXCredentials(credentials);
  if (!parsed) {
    throw new Error("Invalid X credentials: bearerToken is required.");
  }
  return parsed;
};

const parseRecentSearchPayload = (payload: unknown): MonitorPost[] => {
  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  const includesRecord = asRecord(record.includes);
  const users = Array.isArray(includesRecord?.users) ? includesRecord.users : [];
  const usersById = new Map<string, { username: string; displayName: string }>();

  for (const user of users) {
    const userRecord = asRecord(user);
    if (!userRecord) {
      continue;
    }

    const id = asString(userRecord.id);
    const username = asString(userRecord.username);
    const displayName = asString(userRecord.name);
    if (!id || !username) {
      continue;
    }

    usersById.set(id, {
      username,
      displayName: displayName ?? username,
    });
  }

  const tweets = Array.isArray(record.data) ? record.data : [];
  const normalized: MonitorPost[] = [];

  for (const tweet of tweets) {
    const tweetRecord = asRecord(tweet);
    if (!tweetRecord) {
      continue;
    }

    const id = asString(tweetRecord.id);
    const text = asString(tweetRecord.text);
    const createdAt = asString(tweetRecord.created_at);
    const authorId = asString(tweetRecord.author_id);
    const metrics = asRecord(tweetRecord.public_metrics);
    const likeCountRaw = asNumber(metrics?.like_count);

    if (!id || !text || !createdAt || !authorId || likeCountRaw === null) {
      continue;
    }

    const authorInfo = usersById.get(authorId);
    const author = authorInfo?.username ?? authorId;
    const permalink = authorInfo
      ? `https://x.com/${authorInfo.username}/status/${id}`
      : `https://x.com/i/web/status/${id}`;

    normalized.push({
      source: "x",
      id,
      text,
      author,
      createdAt,
      likeCount: Math.max(0, Math.floor(likeCountRaw)),
      permalink,
    });
  }

  return normalized;
};

const parseNextToken = (payload: unknown): string | null => {
  const record = asRecord(payload);
  const meta = record ? asRecord(record.meta) : null;
  const nextToken = meta ? asString(meta.next_token) : null;
  return nextToken ?? null;
};

const extractUsageBudget = (
  value: unknown,
): { cap: number; used: number; remaining: number; resetAt: string | null } | null => {
  const record = asRecord(value);
  if (!record) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const extracted = extractUsageBudget(item);
        if (extracted) {
          return extracted;
        }
      }
    }
    return null;
  }

  const cap = asNumber(record.cap);
  const used = asNumber(record.used) ?? asNumber(record.usage);
  if (cap !== null && used !== null) {
    const normalizedCap = Math.max(0, Math.floor(cap));
    const normalizedUsed = Math.max(0, Math.floor(used));
    const remaining = Math.max(0, normalizedCap - normalizedUsed);
    return {
      cap: normalizedCap,
      used: normalizedUsed,
      remaining,
      resetAt: asString(record.reset_at) ?? asString(record.resetAt) ?? null,
    };
  }

  for (const childValue of Object.values(record)) {
    const extracted = extractUsageBudget(childValue);
    if (extracted) {
      return extracted;
    }
  }

  return null;
};

const fetchRecentSearchPage = async ({
  fetchFn,
  baseUrl,
  credentials,
  query,
  startTime,
  endTime,
  nextToken,
}: {
  fetchFn: typeof fetch;
  baseUrl: string;
  credentials: XMonitorCredentials;
  query: string;
  startTime: string;
  endTime: string;
  nextToken?: string | null;
}) => {
  const searchParams = new URLSearchParams({
    query,
    "tweet.fields": "id,text,created_at,public_metrics,author_id,lang",
    expansions: "author_id",
    "user.fields": "id,name,username",
    max_results: "100",
    start_time: startTime,
    end_time: endTime,
  });

  if (nextToken) {
    searchParams.set("next_token", nextToken);
  }

  const url = buildXApiUrl(baseUrl, "/2/tweets/search/recent", searchParams);
  const response = await fetchFn(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${credentials.bearerToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`X recent search failed (${response.status}).`);
  }

  return response.json();
};

const validateXCredentials = async ({
  fetchFn,
  baseUrl,
  credentials,
}: {
  fetchFn: typeof fetch;
  baseUrl: string;
  credentials: XMonitorCredentials;
}): Promise<MonitorProviderValidationResult> => {
  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    await fetchRecentSearchPage({
      fetchFn,
      baseUrl,
      credentials,
      query: "Codex lang:en -is:retweet",
      startTime,
      endTime: now.toISOString(),
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `X credential validation failed: ${asErrorMessage(error)}`,
    };
  }
};

const fetchXRecentPosts = async ({
  fetchFn,
  baseUrl,
  credentials,
  queryTerms,
  now,
}: {
  fetchFn: typeof fetch;
  baseUrl: string;
  credentials: XMonitorCredentials;
  queryTerms: string[];
  now: Date;
}): Promise<MonitorPost[]> => {
  const startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const endTime = now.toISOString();
  const query = buildXRecentSearchQuery(queryTerms);

  let nextToken: string | null = null;
  let pageCount = 0;
  const posts: MonitorPost[] = [];

  while (pageCount < 5) {
    const payload = await fetchRecentSearchPage({
      fetchFn,
      baseUrl,
      credentials,
      query,
      startTime,
      endTime,
      nextToken,
    });

    posts.push(...parseRecentSearchPayload(payload));
    nextToken = parseNextToken(payload);
    pageCount += 1;

    if (!nextToken) {
      break;
    }
  }

  return posts;
};

const fetchXUsage = async ({
  fetchFn,
  baseUrl,
  usagePath,
  credentials,
  now,
}: {
  fetchFn: typeof fetch;
  baseUrl: string;
  usagePath: string;
  credentials: XMonitorCredentials;
  now: Date;
}): Promise<MonitorUsageSnapshot> => {
  try {
    const url = buildXApiUrl(baseUrl, usagePath);
    const response = await fetchFn(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credentials.bearerToken}`,
      },
    });

    if (!response.ok) {
      return {
        status: "error",
        source: "x-api",
        fetchedAt: now.toISOString(),
        message: `X usage request failed (${response.status}).`,
      };
    }

    const payload = await response.json();
    const budget = extractUsageBudget(payload);
    if (!budget) {
      return {
        status: "unavailable",
        source: "x-api",
        fetchedAt: now.toISOString(),
        message: "X usage response did not include cap and usage values.",
      };
    }

    return {
      status: "ok",
      source: "x-api",
      fetchedAt: now.toISOString(),
      cap: budget.cap,
      used: budget.used,
      remaining: budget.remaining,
      resetAt: budget.resetAt,
      message: null,
    };
  } catch (error) {
    return {
      status: "error",
      source: "x-api",
      fetchedAt: now.toISOString(),
      message: `Unable to read X usage: ${asErrorMessage(error)}`,
    };
  }
};

export const createXMonitorProvider = ({
  fetchFn = globalThis.fetch,
  apiBaseUrl = process.env.OCTOGENT_X_API_BASE_URL ?? DEFAULT_X_API_BASE_URL,
  usageEndpointPath = process.env.OCTOGENT_X_USAGE_ENDPOINT_PATH ?? DEFAULT_X_USAGE_ENDPOINT_PATH,
}: {
  fetchFn?: typeof fetch;
  apiBaseUrl?: string;
  usageEndpointPath?: string;
} = {}): MonitorProviderAdapter => ({
  providerId: "x",

  saveCredentials(input, now): MonitorCredentialsSaveResult {
    const record = asRecord(input);
    if (!record) {
      throw new Error("Expected credentials to be a JSON object.");
    }

    const bearerToken = asString(record.bearerToken)?.trim();
    if (!bearerToken) {
      throw new Error("X bearerToken is required.");
    }

    const credentials: XMonitorCredentials = {
      bearerToken,
      apiKey: normalizeOptionalSecret(record.apiKey),
      apiSecret: normalizeOptionalSecret(record.apiSecret),
      accessToken: normalizeOptionalSecret(record.accessToken),
      accessTokenSecret: normalizeOptionalSecret(record.accessTokenSecret),
      updatedAt: now.toISOString(),
    };

    return {
      credentials,
      summary: summarizeXCredentials(credentials),
    };
  },

  summarizeCredentials(credentials) {
    return summarizeXCredentials(credentials);
  },

  validateCredentials(credentials) {
    return validateXCredentials({
      fetchFn,
      baseUrl: apiBaseUrl,
      credentials: assertXCredentials(credentials),
    });
  },

  fetchRecentPosts({ credentials, queryTerms, now }) {
    return fetchXRecentPosts({
      fetchFn,
      baseUrl: apiBaseUrl,
      credentials: assertXCredentials(credentials),
      queryTerms,
      now,
    });
  },

  fetchUsage({ credentials, now }) {
    return fetchXUsage({
      fetchFn,
      baseUrl: apiBaseUrl,
      usagePath: usageEndpointPath,
      credentials: assertXCredentials(credentials),
      now,
    });
  },
});
