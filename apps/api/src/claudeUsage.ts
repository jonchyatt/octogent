import { execFile, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CLAUDE_CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_USAGE_BETA_HEADER = "oauth-2025-04-20";

const CLI_PTY_TIMEOUT_MS = 20_000;
const CLI_PTY_SETTLE_MS = 2_000;
const CLI_PTY_ENTER_INTERVAL_MS = 800;
const CLI_PTY_COLS = 160;
const CLI_PTY_ROWS = 50;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

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

const toResetIso = (value: unknown): string | null => {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }

  const numberValue = asNumber(value);
  if (numberValue === null) {
    return null;
  }

  const milliseconds = numberValue >= 1_000_000_000_000 ? numberValue : numberValue * 1000;
  return new Date(milliseconds).toISOString();
};

type ClaudeUsageStatus = "ok" | "unavailable" | "error";

export type ClaudeUsageSource = "cli-pty" | "oauth-api" | "none";

export type ClaudeUsageSnapshot = {
  status: ClaudeUsageStatus;
  fetchedAt: string;
  source: ClaudeUsageSource;
  message?: string;
  planType?: string | null;
  primaryUsedPercent?: number | null;
  primaryResetAt?: string | null;
  secondaryUsedPercent?: number | null;
  secondaryResetAt?: string | null;
  sonnetUsedPercent?: number | null;
  sonnetResetAt?: string | null;
  extraUsageCostUsed?: number | null;
  extraUsageCostLimit?: number | null;
};

type ClaudeOauthCredentials = {
  accessToken: string;
  scopes: string[];
  rateLimitTier: string | null;
};

export type ClaudeUsageDependencies = {
  now?: () => Date;
  readCredentialsJson?: () => Promise<unknown>;
  fetchImpl?: typeof fetch;
  spawnCliUsage?: () => Promise<string | null>;
};

const unavailableSnapshot = (
  now: Date,
  message: string,
  status: ClaudeUsageStatus = "unavailable",
): ClaudeUsageSnapshot => ({
  status,
  fetchedAt: now.toISOString(),
  source: "none",
  message,
});

const normalizeScopes = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter((item): item is string => item !== null);
  }

  const scopeString = asString(value);
  if (!scopeString) {
    return [];
  }

  return scopeString
    .split(/\s+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const readClaudeOauthCredentials = (credentialsJson: unknown): ClaudeOauthCredentials | null => {
  const record = asRecord(credentialsJson);
  if (!record) {
    return null;
  }

  const oauth = asRecord(record.claudeAiOauth ?? record.claude_ai_oauth);
  if (!oauth) {
    return null;
  }

  const accessToken = asString(oauth.accessToken ?? oauth.access_token);
  if (!accessToken) {
    return null;
  }

  const scopes = normalizeScopes(oauth.scopes ?? oauth.scope);
  const rateLimitTier = asString(oauth.rateLimitTier ?? oauth.rate_limit_tier);

  return {
    accessToken,
    scopes,
    rateLimitTier,
  };
};

const resolveUsageWindow = (
  usagePayload: Record<string, unknown>,
  key: "five_hour" | "seven_day" | "seven_day_sonnet" | "seven_day_opus",
): Record<string, unknown> | null => {
  const directWindow = asRecord(usagePayload[key]);
  if (directWindow) {
    return directWindow;
  }

  const rateLimits = asRecord(usagePayload.rate_limits ?? usagePayload.rateLimits);
  return asRecord(rateLimits?.[key]);
};

const readErrorMessage = (value: unknown): string | null => {
  const payload = asRecord(value);
  if (!payload) {
    return null;
  }

  const directMessage = asString(payload.message);
  if (directMessage) {
    return directMessage;
  }

  const errorPayload = asRecord(payload.error);
  return asString(errorPayload?.message);
};

const readUsageErrorMessage = async (response: Response): Promise<string | null> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (contentType.includes("application/json")) {
      return readErrorMessage((await response.json()) as unknown);
    }
    return asString(await response.text());
  } catch {
    return null;
  }
};

const readWindowPercent = (window: Record<string, unknown> | null): number | null =>
  asNumber(window?.used_percent ?? window?.usedPercent ?? window?.utilization);

const readWindowResetAt = (window: Record<string, unknown> | null): string | null =>
  toResetIso(window?.reset_at ?? window?.resetAt ?? window?.resets_at);

const inferPlanType = (rateLimitTier: string | null): string | null => {
  const tier = rateLimitTier?.toLowerCase() ?? "";
  if (tier.includes("max")) return "Claude Max";
  if (tier.includes("pro")) return "Claude Pro";
  if (tier.includes("team")) return "Claude Team";
  if (tier.includes("enterprise")) return "Claude Enterprise";
  return null;
};

const mapUsageSnapshot = (
  usageJson: unknown,
  now: Date,
  rateLimitTier: string | null,
): ClaudeUsageSnapshot => {
  const usagePayload = asRecord(usageJson);
  if (!usagePayload) {
    throw new Error("invalid_usage_payload");
  }

  const primaryWindow = resolveUsageWindow(usagePayload, "five_hour");
  const weeklyWindow =
    resolveUsageWindow(usagePayload, "seven_day") ??
    resolveUsageWindow(usagePayload, "seven_day_opus");
  const sonnetWindow = resolveUsageWindow(usagePayload, "seven_day_sonnet");

  const extraUsage = asRecord(usagePayload.extra_usage ?? usagePayload.extraUsage);
  let extraUsageCostUsed: number | null = null;
  let extraUsageCostLimit: number | null = null;
  if (extraUsage?.is_enabled === true || extraUsage?.isEnabled === true) {
    const rawUsed = asNumber(extraUsage.used_credits ?? extraUsage.usedCredits);
    const rawLimit = asNumber(extraUsage.monthly_limit ?? extraUsage.monthlyLimit);
    if (rawUsed !== null && rawLimit !== null) {
      extraUsageCostUsed = rawUsed / 100;
      extraUsageCostLimit = rawLimit / 100;
    }
  }

  return {
    status: "ok",
    fetchedAt: now.toISOString(),
    source: "oauth-api",
    planType:
      asString(usagePayload.plan_type ?? usagePayload.planType) ?? inferPlanType(rateLimitTier),
    primaryUsedPercent: readWindowPercent(primaryWindow),
    primaryResetAt: readWindowResetAt(primaryWindow),
    secondaryUsedPercent: readWindowPercent(weeklyWindow),
    secondaryResetAt: readWindowResetAt(weeklyWindow),
    sonnetUsedPercent: readWindowPercent(sonnetWindow),
    sonnetResetAt: readWindowResetAt(sonnetWindow),
    extraUsageCostUsed,
    extraUsageCostLimit,
  };
};

const readKeychainCredentials = (): Promise<string | null> =>
  new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve(null);
      return;
    }

    execFile(
      "security",
      ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"],
      { timeout: 5_000 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(null);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });

const readDefaultCredentialsJson = async (): Promise<unknown> => {
  const keychainText = await readKeychainCredentials();
  if (keychainText) {
    try {
      return JSON.parse(keychainText) as unknown;
    } catch {
      // keychain data is not valid JSON, fall through to file
    }
  }

  const fileText = await readFile(CLAUDE_CREDENTIALS_PATH, "utf8");
  return JSON.parse(fileText) as unknown;
};

// ---------------------------------------------------------------------------
// CLI PTY usage source — persistent singleton session (like CodexBar)
// ---------------------------------------------------------------------------

const ANSI_CSI_RE = /\u001B\[[0-?]*[ -/]*[@-~]/gu;

export const stripAnsiCodes = (text: string): string => text.replace(ANSI_CSI_RE, "");

const STOP_NEEDLES = [
  "current week (all models)",
  "current week (opus)",
  "current week (sonnet only)",
  "current week (sonnet)",
  "current session",
  "failed to load usage data",
];

const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s*%/u;

const USED_KEYWORDS = ["used", "spent", "consumed"];
const REMAINING_KEYWORDS = ["left", "remaining", "available"];

type ParsedCliUsage = {
  primaryUsedPercent: number | null;
  secondaryUsedPercent: number | null;
  sonnetUsedPercent: number | null;
};

const percentFromLine = (line: string): number | null => {
  const match = PERCENT_RE.exec(line);
  if (!match) return null;

  const raw = Number.parseFloat(match[1]!);
  const clamped = Math.max(0, Math.min(100, raw));
  const lower = line.toLowerCase();

  // "2% used" → store as 2 (already represents usage)
  if (USED_KEYWORDS.some((kw) => lower.includes(kw))) {
    return Math.round(clamped * 10) / 10;
  }

  // "98% remaining" → convert to used: 100 - 98 = 2
  if (REMAINING_KEYWORDS.some((kw) => lower.includes(kw))) {
    return Math.round((100 - clamped) * 10) / 10;
  }

  // Default: assume it's "used" (Claude CLI convention per screenshot)
  return Math.round(clamped * 10) / 10;
};

const extractLabeledPercent = (lines: string[], labelSubstrings: string[]): number | null => {
  for (let i = 0; i < lines.length; i++) {
    const normalized = lines[i]!.toLowerCase();
    const collapsed = normalized.replace(/\s+/gu, "");
    const matches = labelSubstrings.some(
      (label) => normalized.includes(label) || collapsed.includes(label.replace(/\s+/gu, "")),
    );
    if (!matches) continue;

    // Check this line and the next few lines for a percentage
    for (let j = i; j < Math.min(i + 3, lines.length); j++) {
      const pct = percentFromLine(lines[j]!);
      if (pct !== null) return pct;
    }
  }
  return null;
};

export const parseCliUsageOutput = (rawOutput: string): ParsedCliUsage => {
  const clean = stripAnsiCodes(rawOutput);
  const lines = clean
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const primaryUsedPercent = extractLabeledPercent(lines, ["current session"]);
  const secondaryUsedPercent = extractLabeledPercent(lines, [
    "current week (all models)",
    "current week (opus)",
  ]);
  const sonnetUsedPercent = extractLabeledPercent(lines, [
    "current week (sonnet only)",
    "current week (sonnet)",
  ]);

  return { primaryUsedPercent, secondaryUsedPercent, sonnetUsedPercent };
};

const resolveClaudeBinary = (): string | null => {
  try {
    const result = execFileSync("which", ["claude"], {
      timeout: 3_000,
      encoding: "utf8",
    }).trim();
    return result || null;
  } catch {
    return null;
  }
};

const scrubbedEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === "CLAUDECODE") continue;
    if (key.startsWith("ANTHROPIC_")) continue;
    if (value !== undefined) env[key] = value;
  }
  return env;
};

// ---------------------------------------------------------------------------
// CLI PTY spawn — fresh process each time, results cached
// ---------------------------------------------------------------------------

let cachedSnapshot: { snapshot: ClaudeUsageSnapshot; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

// Patterns that indicate the CLI welcome screen has fully rendered.
// After ANSI stripping, cursor-movement codes collapse spaces, so we
// match with all whitespace removed (e.g. "tipsforgettingstarted").
const READY_NEEDLES = [
  "tipsforgettingstarted",
  "recentactivity",
  "welcomeback",
  "whatcanihelpyouwith",
];

const spawnCliAndCapture = (binary: string): Promise<string | null> =>
  new Promise<string | null>((resolve) => {
    import("node-pty")
      .then((pty) => {
        let buffer = "";
        let usageBuffer = "";
        let done = false;
        let phase: "waiting" | "capturing" = "waiting";
        let settleTimer: ReturnType<typeof setTimeout> | null = null;
        let enterTimer: ReturnType<typeof setInterval> | null = null;

        const term = pty.spawn(binary, ["--allowed-tools", ""], {
          name: "xterm-256color",
          cols: CLI_PTY_COLS,
          rows: CLI_PTY_ROWS,
          env: scrubbedEnv(),
        });

        const finish = (result: string | null) => {
          if (done) return;
          done = true;
          if (deadlineTimer) clearTimeout(deadlineTimer);
          if (settleTimer) clearTimeout(settleTimer);
          if (enterTimer) clearInterval(enterTimer);
          try {
            term.kill();
          } catch {
            /* already dead */
          }
          resolve(result);
        };

        const deadlineTimer = setTimeout(() => {
          finish(usageBuffer.length > 0 ? usageBuffer : buffer.length > 0 ? buffer : null);
        }, CLI_PTY_TIMEOUT_MS);

        const sendUsageCommand = () => {
          if (phase !== "waiting") return;
          phase = "capturing";
          // Clear the buffer so we only capture /usage output
          usageBuffer = "";
          console.log("[claude-usage] CLI ready, sending /usage");
          try {
            term.write("/usage\r");
          } catch {
            finish(null);
            return;
          }
          // Periodic Enter presses to refresh TUI render
          enterTimer = setInterval(() => {
            try {
              term.write("\r");
            } catch {
              /* ignore */
            }
          }, CLI_PTY_ENTER_INTERVAL_MS);
        };

        term.onData((data: string) => {
          buffer += data;
          if (phase === "capturing") {
            usageBuffer += data;
          }

          const normalized = stripAnsiCodes(buffer).toLowerCase();

          const collapsed = normalized.replace(/\s+/gu, "");

          // Handle trust prompts
          if (collapsed.includes("doyoutrust")) {
            try {
              term.write("y\r");
            } catch {
              /* ignore */
            }
            return;
          }

          // Phase 1: wait for welcome screen to render, then send /usage
          if (phase === "waiting") {
            if (READY_NEEDLES.some((n) => collapsed.includes(n))) {
              sendUsageCommand();
            }
            return;
          }

          // Phase 2: capturing /usage output — look for stop needles
          const usageCollapsed = stripAnsiCodes(usageBuffer).toLowerCase().replace(/\s+/gu, "");
          if (
            !settleTimer &&
            STOP_NEEDLES.some((n) => usageCollapsed.includes(n.replace(/\s+/gu, "")))
          ) {
            settleTimer = setTimeout(() => finish(usageBuffer), CLI_PTY_SETTLE_MS);
          }
        });

        term.onExit(() =>
          finish(usageBuffer.length > 0 ? usageBuffer : buffer.length > 0 ? buffer : null),
        );
      })
      .catch(() => resolve(null));
  });

const spawnDefaultCliUsage = async (): Promise<string | null> => {
  const binary = resolveClaudeBinary();
  if (!binary) return null;
  return spawnCliAndCapture(binary);
};

/** Exported for testing — resets the snapshot cache. */
export const resetCliSession = (): void => {
  cachedSnapshot = null;
};

/** Clears the cached usage snapshot so the next read triggers a fresh fetch. */
export const invalidateUsageCache = (): void => {
  cachedSnapshot = null;
};

const readOauthUsageSnapshot = async (
  now: Date,
  readCredentialsJson: () => Promise<unknown>,
  fetchImpl: typeof fetch,
): Promise<ClaudeUsageSnapshot> => {
  let credentialsJson: unknown;
  try {
    credentialsJson = await readCredentialsJson();
  } catch (error) {
    const errorCode =
      typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (errorCode === "ENOENT") {
      return unavailableSnapshot(now, "Claude credentials not found. Run `claude login`.");
    }
    return unavailableSnapshot(now, "Unable to read Claude credentials.", "error");
  }

  const oauthCredentials = readClaudeOauthCredentials(credentialsJson);
  if (!oauthCredentials) {
    return unavailableSnapshot(now, "Claude OAuth access token is missing. Re-run `claude login`.");
  }

  if (!oauthCredentials.scopes.includes("user:profile")) {
    return unavailableSnapshot(
      now,
      "Claude OAuth credentials are missing the required `user:profile` scope. Re-run `claude login`.",
    );
  }

  try {
    const usageResponse = await fetchImpl(CLAUDE_OAUTH_USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${oauthCredentials.accessToken}`,
        "anthropic-beta": CLAUDE_OAUTH_USAGE_BETA_HEADER,
      },
    });

    if (usageResponse.status === 401 || usageResponse.status === 403) {
      return unavailableSnapshot(
        now,
        "Claude OAuth token is expired or unauthorized. Re-run `claude login`.",
      );
    }

    if (!usageResponse.ok) {
      const usageErrorMessage = await readUsageErrorMessage(usageResponse);
      if (usageResponse.status === 429) {
        const retryAfterSeconds = asString(usageResponse.headers.get("retry-after"));
        const retrySuffix =
          retryAfterSeconds && retryAfterSeconds.length > 0
            ? ` Retry after ${retryAfterSeconds}s.`
            : "";
        return unavailableSnapshot(
          now,
          usageErrorMessage ?? `Claude OAuth usage API is rate limited.${retrySuffix}`,
        );
      }

      return unavailableSnapshot(
        now,
        usageErrorMessage
          ? `${usageErrorMessage} (HTTP ${usageResponse.status}).`
          : `Claude OAuth usage request failed (HTTP ${usageResponse.status}).`,
        "error",
      );
    }

    const usageJson = (await usageResponse.json()) as unknown;
    return mapUsageSnapshot(usageJson, now, oauthCredentials.rateLimitTier);
  } catch {
    return unavailableSnapshot(now, "Unable to read Claude usage from OAuth API.", "error");
  }
};

const buildCliSnapshot = (parsed: ParsedCliUsage, now: Date): ClaudeUsageSnapshot => ({
  status: "ok",
  fetchedAt: now.toISOString(),
  source: "cli-pty",
  primaryUsedPercent: parsed.primaryUsedPercent,
  secondaryUsedPercent: parsed.secondaryUsedPercent,
  sonnetUsedPercent: parsed.sonnetUsedPercent,
  primaryResetAt: null,
  secondaryResetAt: null,
  sonnetResetAt: null,
});

const cliHasRealData = (parsed: ParsedCliUsage): boolean =>
  parsed.primaryUsedPercent !== null ||
  parsed.secondaryUsedPercent !== null ||
  parsed.sonnetUsedPercent !== null;

export const readClaudeUsageSnapshot = async (
  dependencies: ClaudeUsageDependencies = {},
): Promise<ClaudeUsageSnapshot> => {
  const now = dependencies.now?.() ?? new Date();

  // Return cached snapshot if fresh enough (prevents rate-limit storms)
  if (cachedSnapshot && Date.now() - cachedSnapshot.fetchedAt < CACHE_TTL_MS) {
    return { ...cachedSnapshot.snapshot, fetchedAt: now.toISOString() };
  }

  const spawnCliUsage = dependencies.spawnCliUsage ?? spawnDefaultCliUsage;

  // Try CLI PTY first (primary source — works on Max plans)
  try {
    const cliOutput = await spawnCliUsage();
    if (cliOutput) {
      const cleaned = stripAnsiCodes(cliOutput);
      console.log(`[claude-usage] CLI PTY captured ${cleaned.length} chars`);
      const parsed = parseCliUsageOutput(cliOutput);
      if (cliHasRealData(parsed)) {
        console.log(
          `[claude-usage] CLI PTY parsed: session=${parsed.primaryUsedPercent}% week=${parsed.secondaryUsedPercent}% sonnet=${parsed.sonnetUsedPercent}%`,
        );
        const snapshot = buildCliSnapshot(parsed, now);
        cachedSnapshot = { snapshot, fetchedAt: Date.now() };
        return snapshot;
      }
      console.log(
        `[claude-usage] CLI PTY output had no parseable usage data. First 500 chars:\n${cleaned.slice(0, 500)}`,
      );
    } else {
      console.log("[claude-usage] CLI PTY returned null (binary missing or node-pty unavailable)");
    }
  } catch (error) {
    console.log(
      `[claude-usage] CLI PTY error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Fall back to OAuth API
  const readCredentialsJson = dependencies.readCredentialsJson ?? readDefaultCredentialsJson;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const oauthSnapshot = await readOauthUsageSnapshot(now, readCredentialsJson, fetchImpl);

  if (oauthSnapshot.status === "ok") {
    cachedSnapshot = { snapshot: oauthSnapshot, fetchedAt: Date.now() };
  } else {
    console.log(`[claude-usage] OAuth failed: ${oauthSnapshot.message}`);
    if (cachedSnapshot) {
      // Return last known good data instead of showing error
      return { ...cachedSnapshot.snapshot, fetchedAt: now.toISOString() };
    }
    // No cached data — cache the failure too so we don't hammer OAuth
    cachedSnapshot = { snapshot: oauthSnapshot, fetchedAt: Date.now() };
  }

  return oauthSnapshot;
};
