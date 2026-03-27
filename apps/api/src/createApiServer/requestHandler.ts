import type { IncomingMessage, ServerResponse } from "node:http";

import type { ClaudeUsageSnapshot } from "../claudeUsage";
import type { UsageChartResponse } from "../claudeSessionScanner";
import type { CodexUsageSnapshot } from "../codexUsage";
import {
  createDeckTentacle,
  deleteDeckTentacle,
  readDeckTentacles,
  readDeckVaultFile,
} from "../deck/readDeckTentacles";
import type { GitHubRepoSummarySnapshot } from "../githubRepoSummary";
import { MonitorInputError, type MonitorService } from "../monitor";
import { listPromptTemplates, readPromptTemplate, resolvePrompt } from "../prompts";
import {
  RuntimeInputError,
  type TentacleWorkspaceMode,
  type TerminalAgentProvider,
} from "../terminalRuntime";
import {
  RequestBodyTooLargeError,
  parseMonitorConfigPatch,
  parseTentacleCommitMessage,
  parseTentaclePullRequestCreateInput,
  parseTentacleSyncBaseRef,
  parseTerminalAgentProvider,
  parseTerminalName,
  parseTerminalWorkspaceMode,
  parseUiStatePatch,
  readJsonBody,
} from "./requestParsers";
import {
  getRequestCorsOrigin,
  isAllowedHostHeader,
  isAllowedOriginHeader,
  readHeaderValue,
  withCors,
} from "./security";

type TerminalRuntime = ReturnType<typeof import("../terminalRuntime").createTerminalRuntime>;

type CreateApiRequestHandlerOptions = {
  runtime: TerminalRuntime;
  workspaceCwd: string;
  readClaudeUsageSnapshot: () => Promise<ClaudeUsageSnapshot>;
  readCodexUsageSnapshot: () => Promise<CodexUsageSnapshot>;
  readGithubRepoSummary: () => Promise<GitHubRepoSummarySnapshot>;
  scanUsageHeatmap: (scope: "all" | "project") => Promise<UsageChartResponse>;
  monitorService: MonitorService;
  invalidateClaudeUsageCache: () => void;
  allowRemoteAccess: boolean;
};

type RouteHandlerDependencies = {
  runtime: TerminalRuntime;
  workspaceCwd: string;
  readClaudeUsageSnapshot: () => Promise<ClaudeUsageSnapshot>;
  readCodexUsageSnapshot: () => Promise<CodexUsageSnapshot>;
  readGithubRepoSummary: () => Promise<GitHubRepoSummarySnapshot>;
  scanUsageHeatmap: (scope: "all" | "project") => Promise<UsageChartResponse>;
  monitorService: MonitorService;
  invalidateClaudeUsageCache: () => void;
};

type RouteHandlerContext = {
  request: IncomingMessage;
  response: ServerResponse;
  requestUrl: URL;
  corsOrigin: string | null;
};

type JsonBodyReadResult = { ok: true; payload: unknown } | { ok: false };
type ApiRouteHandler = (
  context: RouteHandlerContext,
  dependencies: RouteHandlerDependencies,
) => Promise<boolean>;

const writeJson = (
  response: ServerResponse,
  status: number,
  payload: unknown,
  corsOrigin: string | null,
) => {
  response.writeHead(status, withCors({ "Content-Type": "application/json" }, corsOrigin));
  response.end(JSON.stringify(payload));
};

const writeText = (
  response: ServerResponse,
  status: number,
  payload: string,
  contentType: string,
  corsOrigin: string | null,
) => {
  response.writeHead(status, withCors({ "Content-Type": contentType }, corsOrigin));
  response.end(payload);
};

const writeNoContent = (response: ServerResponse, status: number, corsOrigin: string | null) => {
  response.writeHead(status, withCors({}, corsOrigin));
  response.end();
};

const writeMethodNotAllowed = (response: ServerResponse, corsOrigin: string | null) => {
  writeJson(response, 405, { error: "Method not allowed" }, corsOrigin);
};

const readJsonBodyOrWriteError = async (
  request: IncomingMessage,
  response: ServerResponse,
  corsOrigin: string | null,
): Promise<JsonBodyReadResult> => {
  try {
    const payload = await readJsonBody(request);
    return { ok: true, payload };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      writeJson(response, 413, { error: "Request body too large." }, corsOrigin);
      return { ok: false };
    }

    writeJson(response, 400, { error: "Invalid JSON body." }, corsOrigin);
    return { ok: false };
  }
};

const handleTerminalSnapshotsRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/terminal-snapshots") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const payload = runtime.listTerminalSnapshots();
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const handleCodexUsageRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { readCodexUsageSnapshot },
) => {
  if (requestUrl.pathname !== "/api/codex/usage") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const payload = await readCodexUsageSnapshot();
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const handleClaudeUsageRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { readClaudeUsageSnapshot },
) => {
  if (requestUrl.pathname !== "/api/claude/usage") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const payload = await readClaudeUsageSnapshot();
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const handleUsageHeatmapRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { scanUsageHeatmap },
) => {
  if (requestUrl.pathname !== "/api/analytics/usage-heatmap") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const scope = requestUrl.searchParams.get("scope") === "project" ? "project" : "all";
  const payload = await scanUsageHeatmap(scope);
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const handleGithubSummaryRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { readGithubRepoSummary },
) => {
  if (requestUrl.pathname !== "/api/github/summary") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const payload = await readGithubRepoSummary();
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const handleUiStateRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/ui-state") {
    return false;
  }

  if (request.method === "GET") {
    const payload = runtime.readUiState();
    writeJson(response, 200, payload, corsOrigin);
    return true;
  }

  if (request.method !== "PATCH") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) {
    return true;
  }

  const uiStatePatch = parseUiStatePatch(bodyReadResult.payload);
  if (uiStatePatch.error || !uiStatePatch.patch) {
    writeJson(
      response,
      400,
      { error: uiStatePatch.error ?? "Invalid UI state patch." },
      corsOrigin,
    );
    return true;
  }

  const payload = runtime.patchUiState(uiStatePatch.patch);
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const handleMonitorConfigRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { monitorService },
) => {
  if (requestUrl.pathname !== "/api/monitor/config") {
    return false;
  }

  if (request.method === "GET") {
    const payload = await monitorService.readConfig();
    writeJson(response, 200, payload, corsOrigin);
    return true;
  }

  if (request.method !== "PATCH") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) {
    return true;
  }

  const patchResult = parseMonitorConfigPatch(bodyReadResult.payload);
  if (patchResult.error || !patchResult.patch) {
    writeJson(
      response,
      400,
      { error: patchResult.error ?? "Invalid monitor config patch." },
      corsOrigin,
    );
    return true;
  }

  try {
    const payload = await monitorService.patchConfig(patchResult.patch);
    writeJson(response, 200, payload, corsOrigin);
    return true;
  } catch (error) {
    if (error instanceof MonitorInputError) {
      writeJson(response, 400, { error: error.message }, corsOrigin);
      return true;
    }

    throw error;
  }
};

const handleMonitorFeedRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { monitorService },
) => {
  if (requestUrl.pathname !== "/api/monitor/feed") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const payload = await monitorService.readFeed({
    forceRefresh: false,
    refreshIfStale: true,
  });
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const handleMonitorRefreshRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { monitorService },
) => {
  if (requestUrl.pathname !== "/api/monitor/refresh") {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const payload = await monitorService.readFeed({
    forceRefresh: true,
    refreshIfStale: true,
  });
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const CONVERSATION_SEARCH_PATH = "/api/conversations/search";
const CONVERSATION_ITEM_PATH_PATTERN = /^\/api\/conversations\/([^/]+)$/;
const CONVERSATION_EXPORT_PATH_PATTERN = /^\/api\/conversations\/([^/]+)\/export$/;

const handleConversationsCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/conversations") {
    return false;
  }

  if (request.method === "DELETE") {
    runtime.deleteAllConversationSessions();
    writeNoContent(response, 204, corsOrigin);
    return true;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const payload = runtime.listConversationSessions();
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const handleConversationSearchRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== CONVERSATION_SEARCH_PATH) {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const query = requestUrl.searchParams.get("q") ?? "";
  if (query.trim().length === 0) {
    writeJson(response, 400, { error: "Missing search query parameter 'q'." }, corsOrigin);
    return true;
  }

  const payload = runtime.searchConversations(query);
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const handleConversationItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const match = requestUrl.pathname.match(CONVERSATION_ITEM_PATH_PATTERN);
  if (!match) {
    return false;
  }

  const sessionId = decodeURIComponent(match[1] ?? "");

  if (request.method === "DELETE") {
    runtime.deleteConversationSession(sessionId);
    writeNoContent(response, 204, corsOrigin);
    return true;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const payload = runtime.readConversationSession(sessionId);
  if (!payload) {
    writeJson(response, 404, { error: "Conversation session not found." }, corsOrigin);
    return true;
  }

  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const handleConversationExportRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const match = requestUrl.pathname.match(CONVERSATION_EXPORT_PATH_PATTERN);
  if (!match) {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const sessionId = decodeURIComponent(match[1] ?? "");
  const format = requestUrl.searchParams.get("format");
  if (format !== "json" && format !== "md") {
    writeJson(response, 400, { error: "Unsupported conversation export format." }, corsOrigin);
    return true;
  }

  if (format === "json") {
    const payload = runtime.readConversationSession(sessionId);
    if (!payload) {
      writeJson(response, 404, { error: "Conversation session not found." }, corsOrigin);
      return true;
    }

    writeJson(response, 200, payload, corsOrigin);
    return true;
  }

  const payload = runtime.exportConversationSession(sessionId, "md");
  if (payload === null) {
    writeJson(response, 404, { error: "Conversation session not found." }, corsOrigin);
    return true;
  }

  writeText(response, 200, payload, "text/markdown; charset=utf-8", corsOrigin);
  return true;
};

const handleTerminalsCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, workspaceCwd },
) => {
  if (requestUrl.pathname !== "/api/terminals") {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) {
    return true;
  }

  const nameResult = parseTerminalName(bodyReadResult.payload);
  if (nameResult.error) {
    writeJson(response, 400, { error: nameResult.error }, corsOrigin);
    return true;
  }

  const workspaceModeResult = parseTerminalWorkspaceMode(bodyReadResult.payload);
  if (workspaceModeResult.error) {
    writeJson(response, 400, { error: workspaceModeResult.error }, corsOrigin);
    return true;
  }

  const agentProviderResult = parseTerminalAgentProvider(bodyReadResult.payload);
  if (agentProviderResult.error) {
    writeJson(response, 400, { error: agentProviderResult.error }, corsOrigin);
    return true;
  }

  try {
    const createTerminalInput: {
      terminalId?: string;
      tentacleName?: string;
      workspaceMode: TentacleWorkspaceMode;
      agentProvider?: TerminalAgentProvider;
      initialPrompt?: string;
    } = {
      workspaceMode: workspaceModeResult.workspaceMode,
    };
    if (nameResult.name !== undefined) {
      createTerminalInput.tentacleName = nameResult.name;
    }
    if (agentProviderResult.agentProvider !== undefined) {
      createTerminalInput.agentProvider = agentProviderResult.agentProvider;
    }
    const bodyPayload = bodyReadResult.payload as Record<string, unknown> | null;
    if (
      bodyPayload &&
      typeof bodyPayload.terminalId === "string" &&
      bodyPayload.terminalId.trim().length > 0
    ) {
      createTerminalInput.terminalId = bodyPayload.terminalId.trim();
    }

    // Support prompt resolution via template name + variables, or a raw string.
    if (
      bodyPayload &&
      typeof bodyPayload.promptTemplate === "string" &&
      bodyPayload.promptTemplate.trim().length > 0
    ) {
      const templateName = bodyPayload.promptTemplate.trim();
      const templateVars: Record<string, string> =
        bodyPayload.promptVariables != null &&
        typeof bodyPayload.promptVariables === "object" &&
        !Array.isArray(bodyPayload.promptVariables)
          ? Object.fromEntries(
              Object.entries(bodyPayload.promptVariables as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string")
                .map(([k, v]) => [k, v as string]),
            )
          : {};

      // Auto-inject terminalId variable so callers don't have to guess it.
      // The runtime hasn't allocated the ID yet, so we use the tentacle name
      // when provided (sandbox always passes its name).
      if (!templateVars.terminalId && createTerminalInput.tentacleName) {
        templateVars.terminalId = createTerminalInput.tentacleName;
      }

      // Auto-inject apiPort so prompt templates can reference the local API.
      if (!templateVars.apiPort) {
        templateVars.apiPort = process.env.OCTOGENT_API_PORT ?? process.env.PORT ?? "8787";
      }

      // Auto-inject existingTerminals summary so planner-style prompts have context.
      if (!templateVars.existingTerminals) {
        const deckTentacles = readDeckTentacles(workspaceCwd);
        if (deckTentacles.length > 0) {
          const listing = deckTentacles
            .map(
              (t) =>
                `- **${t.displayName}** (\`${t.tentacleId}\`): ${t.description || "(no description)"}`,
            )
            .join("\n");
          templateVars.existingTerminals = `## Existing Terminals\n\nThe following departments already exist:\n\n${listing}\n\nConsider these when proposing new departments — avoid duplicates and note any gaps.`;
        } else {
          templateVars.existingTerminals =
            "## Existing Terminals\n\nNo department terminals exist yet. You are starting from scratch.";
        }
      }

      const resolved = await resolvePrompt(workspaceCwd, templateName, templateVars);
      if (resolved !== undefined) {
        createTerminalInput.initialPrompt = resolved;
      }
    } else if (
      bodyPayload &&
      typeof bodyPayload.initialPrompt === "string" &&
      bodyPayload.initialPrompt.trim().length > 0
    ) {
      createTerminalInput.initialPrompt = bodyPayload.initialPrompt.trim();
    }

    const snapshot = runtime.createTerminal(createTerminalInput);
    const payload: Record<string, unknown> = { ...snapshot };
    if (createTerminalInput.initialPrompt) {
      payload.initialPrompt = createTerminalInput.initialPrompt;
    }
    writeJson(response, 201, payload, corsOrigin);
    return true;
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 400, { error: error.message }, corsOrigin);
      return true;
    }

    throw error;
  }
};

const TERMINAL_ITEM_PATH_PATTERN = /^\/api\/terminals\/([^/]+)$/;
const TENTACLE_GIT_ACTION_PATH_PATTERN =
  /^\/api\/tentacles\/([^/]+)\/git\/(status|commit|push|sync)$/;
const TENTACLE_GIT_PULL_REQUEST_PATH_PATTERN = /^\/api\/tentacles\/([^/]+)\/git\/pr$/;
const TENTACLE_GIT_PULL_REQUEST_MERGE_PATH_PATTERN = /^\/api\/tentacles\/([^/]+)\/git\/pr\/merge$/;

const handleTentacleGitRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const gitMatch = requestUrl.pathname.match(TENTACLE_GIT_ACTION_PATH_PATTERN);
  if (!gitMatch) {
    return false;
  }

  const tentacleId = decodeURIComponent(gitMatch[1] ?? "");
  const action = gitMatch[2];

  try {
    if (action === "status") {
      if (request.method !== "GET") {
        writeMethodNotAllowed(response, corsOrigin);
        return true;
      }

      const payload = runtime.readTentacleGitStatus(tentacleId);
      if (!payload) {
        writeJson(response, 404, { error: "Tentacle not found." }, corsOrigin);
        return true;
      }

      writeJson(response, 200, payload, corsOrigin);
      return true;
    }

    if (action === "commit") {
      if (request.method !== "POST") {
        writeMethodNotAllowed(response, corsOrigin);
        return true;
      }

      const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
      if (!bodyReadResult.ok) {
        return true;
      }

      const commitMessageResult = parseTentacleCommitMessage(bodyReadResult.payload);
      if (commitMessageResult.error || !commitMessageResult.message) {
        writeJson(
          response,
          400,
          { error: commitMessageResult.error ?? "Commit message cannot be empty." },
          corsOrigin,
        );
        return true;
      }

      const payload = runtime.commitTentacleWorktree(tentacleId, commitMessageResult.message);
      if (!payload) {
        writeJson(response, 404, { error: "Tentacle not found." }, corsOrigin);
        return true;
      }

      writeJson(response, 200, payload, corsOrigin);
      return true;
    }

    if (action === "push") {
      if (request.method !== "POST") {
        writeMethodNotAllowed(response, corsOrigin);
        return true;
      }

      const payload = runtime.pushTentacleWorktree(tentacleId);
      if (!payload) {
        writeJson(response, 404, { error: "Tentacle not found." }, corsOrigin);
        return true;
      }

      writeJson(response, 200, payload, corsOrigin);
      return true;
    }

    if (request.method !== "POST") {
      writeMethodNotAllowed(response, corsOrigin);
      return true;
    }

    const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!bodyReadResult.ok) {
      return true;
    }

    const baseRefResult = parseTentacleSyncBaseRef(bodyReadResult.payload);
    if (baseRefResult.error) {
      writeJson(response, 400, { error: baseRefResult.error }, corsOrigin);
      return true;
    }

    const payload = runtime.syncTentacleWorktree(tentacleId, baseRefResult.baseRef ?? undefined);
    if (!payload) {
      writeJson(response, 404, { error: "Tentacle not found." }, corsOrigin);
      return true;
    }

    writeJson(response, 200, payload, corsOrigin);
    return true;
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 409, { error: error.message }, corsOrigin);
      return true;
    }
    throw error;
  }
};

const handleTentacleGitPullRequestRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const mergeMatch = requestUrl.pathname.match(TENTACLE_GIT_PULL_REQUEST_MERGE_PATH_PATTERN);
  if (mergeMatch) {
    if (request.method !== "POST") {
      writeMethodNotAllowed(response, corsOrigin);
      return true;
    }

    const tentacleId = decodeURIComponent(mergeMatch[1] ?? "");
    try {
      const payload = runtime.mergeTentaclePullRequest(tentacleId);
      if (!payload) {
        writeJson(response, 404, { error: "Tentacle not found." }, corsOrigin);
        return true;
      }

      writeJson(response, 200, payload, corsOrigin);
      return true;
    } catch (error) {
      if (error instanceof RuntimeInputError) {
        writeJson(response, 409, { error: error.message }, corsOrigin);
        return true;
      }
      throw error;
    }
  }

  const prMatch = requestUrl.pathname.match(TENTACLE_GIT_PULL_REQUEST_PATH_PATTERN);
  if (!prMatch) {
    return false;
  }

  const tentacleId = decodeURIComponent(prMatch[1] ?? "");

  try {
    if (request.method === "GET") {
      const payload = runtime.readTentaclePullRequest(tentacleId);
      if (!payload) {
        writeJson(response, 404, { error: "Tentacle not found." }, corsOrigin);
        return true;
      }

      writeJson(response, 200, payload, corsOrigin);
      return true;
    }

    if (request.method !== "POST") {
      writeMethodNotAllowed(response, corsOrigin);
      return true;
    }

    const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!bodyReadResult.ok) {
      return true;
    }

    const pullRequestInput = parseTentaclePullRequestCreateInput(bodyReadResult.payload);
    if (pullRequestInput.error || !pullRequestInput.title) {
      writeJson(
        response,
        400,
        { error: pullRequestInput.error ?? "Pull request title cannot be empty." },
        corsOrigin,
      );
      return true;
    }

    const payload = runtime.createTentaclePullRequest(tentacleId, {
      title: pullRequestInput.title,
      ...(pullRequestInput.body.length > 0 ? { body: pullRequestInput.body } : {}),
      ...(pullRequestInput.baseRef !== null ? { baseRef: pullRequestInput.baseRef } : {}),
    });
    if (!payload) {
      writeJson(response, 404, { error: "Tentacle not found." }, corsOrigin);
      return true;
    }

    writeJson(response, 200, payload, corsOrigin);
    return true;
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 409, { error: error.message }, corsOrigin);
      return true;
    }
    throw error;
  }
};

const handleTerminalItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const renameMatch = requestUrl.pathname.match(TERMINAL_ITEM_PATH_PATTERN);
  if (!renameMatch) {
    return false;
  }

  if (request.method !== "PATCH" && request.method !== "DELETE") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const terminalId = decodeURIComponent(renameMatch[1] ?? "");
  if (request.method === "DELETE") {
    try {
      const deleted = runtime.deleteTerminal(terminalId);
      if (!deleted) {
        writeJson(response, 404, { error: "Terminal not found." }, corsOrigin);
        return true;
      }

      writeNoContent(response, 204, corsOrigin);
      return true;
    } catch (error) {
      if (error instanceof RuntimeInputError) {
        writeJson(response, 409, { error: error.message }, corsOrigin);
        return true;
      }
      throw error;
    }
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) {
    return true;
  }

  const nameResult = parseTerminalName(bodyReadResult.payload);
  if (nameResult.error) {
    writeJson(response, 400, { error: nameResult.error }, corsOrigin);
    return true;
  }

  if (!nameResult.provided || !nameResult.name) {
    writeJson(response, 400, { error: "Terminal name is required." }, corsOrigin);
    return true;
  }

  const payload = runtime.renameTerminal(terminalId, nameResult.name);
  if (!payload) {
    writeJson(response, 404, { error: "Terminal not found." }, corsOrigin);
    return true;
  }

  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const HOOK_PATH_PATTERN =
  /^\/api\/hooks\/(session-start|user-prompt-submit|pre-tool-use|notification|stop)$/;

const handleHookRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, invalidateClaudeUsageCache, readClaudeUsageSnapshot },
) => {
  const match = requestUrl.pathname.match(HOOK_PATH_PATTERN);
  if (!match) {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) {
    return true;
  }

  const hookName = match[1] ?? "";
  // HTTP hooks pass the session ID via header; command hooks via query param.
  const octogentSessionId =
    (typeof request.headers["x-octogent-session"] === "string"
      ? request.headers["x-octogent-session"]
      : undefined) ??
    requestUrl.searchParams.get("octogent_session") ??
    undefined;
  const result = runtime.handleHook(hookName, body.payload, octogentSessionId);

  if (hookName === "session-start" || hookName === "stop") {
    invalidateClaudeUsageCache();
    void readClaudeUsageSnapshot();
  }

  writeJson(response, 200, result, corsOrigin);
  return true;
};

// ─── Deck routes ──────────────────────────────────────────────────────────

const handleDeckTentaclesRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  if (requestUrl.pathname !== "/api/deck/tentacles") return false;

  if (request.method === "GET") {
    const tentacles = readDeckTentacles(workspaceCwd);
    writeJson(response, 200, tentacles, corsOrigin);
    return true;
  }

  if (request.method === "POST") {
    const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!bodyReadResult.ok) return true;

    const body = bodyReadResult.payload as Record<string, unknown> | null;
    const name = body && typeof body.name === "string" ? body.name : "";
    const description = body && typeof body.description === "string" ? body.description : "";
    const color = body && typeof body.color === "string" ? body.color : "#d4a017";

    const rawOctopus =
      body && typeof body.octopus === "object" && body.octopus !== null
        ? (body.octopus as Record<string, unknown>)
        : {};
    const octopus = {
      animation: typeof rawOctopus.animation === "string" ? rawOctopus.animation : null,
      expression: typeof rawOctopus.expression === "string" ? rawOctopus.expression : null,
      accessory: typeof rawOctopus.accessory === "string" ? rawOctopus.accessory : null,
      hairColor: typeof rawOctopus.hairColor === "string" ? rawOctopus.hairColor : null,
    };

    const result = createDeckTentacle(workspaceCwd, { name, description, color, octopus });
    if (!result.ok) {
      writeJson(response, 400, { error: result.error }, corsOrigin);
      return true;
    }

    writeJson(response, 201, result.tentacle, corsOrigin);
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};

const DECK_TENTACLE_ITEM_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)$/;

const handleDeckTentacleItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  const match = requestUrl.pathname.match(DECK_TENTACLE_ITEM_PATTERN);
  if (!match) return false;

  if (request.method !== "DELETE") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const result = deleteDeckTentacle(workspaceCwd, tentacleId);
  if (!result.ok) {
    writeJson(response, 404, { error: result.error }, corsOrigin);
    return true;
  }

  writeNoContent(response, 204, corsOrigin);
  return true;
};

const DECK_VAULT_FILE_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/files\/([^/]+)$/;

const handleDeckVaultFileRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  const match = requestUrl.pathname.match(DECK_VAULT_FILE_PATTERN);
  if (!match) return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const fileName = decodeURIComponent(match[2] as string);

  const content = readDeckVaultFile(workspaceCwd, tentacleId, fileName);
  if (content === null) {
    writeJson(response, 404, { error: "Vault file not found" }, corsOrigin);
    return true;
  }

  writeText(response, 200, content, "text/markdown; charset=utf-8", corsOrigin);
  return true;
};

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const PROMPT_ITEM_PATH_PATTERN = /^\/api\/prompts\/([^/]+)$/;

const handlePromptsCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  if (requestUrl.pathname !== "/api/prompts") {
    return false;
  }
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const names = await listPromptTemplates(workspaceCwd);
  writeJson(response, 200, { prompts: names }, corsOrigin);
  return true;
};

const handlePromptItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  const match = requestUrl.pathname.match(PROMPT_ITEM_PATH_PATTERN);
  if (!match) return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const name = decodeURIComponent(match[1] as string);

  // Resolve variables from query params (e.g. ?tentacleId=sandbox).
  const variables: Record<string, string> = {};
  for (const [key, value] of requestUrl.searchParams.entries()) {
    variables[key] = value;
  }

  const hasVariables = Object.keys(variables).length > 0;
  if (hasVariables) {
    const resolved = await resolvePrompt(workspaceCwd, name, variables);
    if (resolved === undefined) {
      writeJson(response, 404, { error: "Prompt template not found" }, corsOrigin);
      return true;
    }
    writeJson(response, 200, { name, prompt: resolved }, corsOrigin);
  } else {
    const template = await readPromptTemplate(workspaceCwd, name);
    if (template === undefined) {
      writeJson(response, 404, { error: "Prompt template not found" }, corsOrigin);
      return true;
    }
    writeJson(response, 200, { name, template }, corsOrigin);
  }

  return true;
};

// ─── Channel routes ───────────────────────────────────────────────────────

const CHANNEL_MESSAGES_PATH_PATTERN = /^\/api\/channels\/([^/]+)\/messages$/;

const handleChannelMessagesRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const match = requestUrl.pathname.match(CHANNEL_MESSAGES_PATH_PATTERN);
  if (!match) {
    return false;
  }

  const terminalId = decodeURIComponent(match[1] ?? "");

  if (request.method === "GET") {
    const messages = runtime.listChannelMessages(terminalId);
    writeJson(response, 200, { terminalId, messages }, corsOrigin);
    return true;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) {
    return true;
  }

  const body = bodyReadResult.payload as Record<string, unknown> | null;
  const fromTerminalId =
    body && typeof body.fromTerminalId === "string" ? body.fromTerminalId.trim() : "";
  const content = body && typeof body.content === "string" ? body.content.trim() : "";

  if (content.length === 0) {
    writeJson(response, 400, { error: "Message content cannot be empty." }, corsOrigin);
    return true;
  }

  const message = runtime.sendChannelMessage(terminalId, fromTerminalId, content);
  if (!message) {
    writeJson(response, 404, { error: "Target terminal not found." }, corsOrigin);
    return true;
  }

  writeJson(response, 201, message, corsOrigin);
  return true;
};

const API_ROUTE_MAP: ReadonlyMap<string, readonly ApiRouteHandler[]> = new Map([
  ["channels", [handleChannelMessagesRoute]],
  ["hooks", [handleHookRoute]],
  ["prompts", [handlePromptsCollectionRoute, handlePromptItemRoute]],
  ["deck", [handleDeckTentaclesRoute, handleDeckTentacleItemRoute, handleDeckVaultFileRoute]],
  ["terminal-snapshots", [handleTerminalSnapshotsRoute]],
  ["codex", [handleCodexUsageRoute]],
  ["claude", [handleClaudeUsageRoute]],
  ["analytics", [handleUsageHeatmapRoute]],
  ["github", [handleGithubSummaryRoute]],
  ["ui-state", [handleUiStateRoute]],
  ["monitor", [handleMonitorConfigRoute, handleMonitorFeedRoute, handleMonitorRefreshRoute]],
  [
    "conversations",
    [
      handleConversationsCollectionRoute,
      handleConversationSearchRoute,
      handleConversationExportRoute,
      handleConversationItemRoute,
    ],
  ],
  ["terminals", [handleTerminalsCollectionRoute, handleTerminalItemRoute]],
  ["tentacles", [handleTentacleGitRoute, handleTentacleGitPullRequestRoute]],
]);

const extractRoutePrefix = (pathname: string): string | null => {
  const segments = pathname.split("/");
  if (segments.length < 3 || segments[1] !== "api") {
    return null;
  }
  return segments[2] ?? null;
};

const logRequest = (method: string, path: string, status: number, startTime: number) => {
  console.log(`[API] ${method} ${path} ${status} ${Date.now() - startTime}ms`);
};

export const createApiRequestHandler = ({
  runtime,
  workspaceCwd,
  readClaudeUsageSnapshot,
  readCodexUsageSnapshot,
  readGithubRepoSummary,
  scanUsageHeatmap,
  monitorService,
  invalidateClaudeUsageCache,
  allowRemoteAccess,
}: CreateApiRequestHandlerOptions) => {
  const routeDependencies: RouteHandlerDependencies = {
    runtime,
    workspaceCwd,
    readClaudeUsageSnapshot,
    readCodexUsageSnapshot,
    readGithubRepoSummary,
    scanUsageHeatmap,
    monitorService,
    invalidateClaudeUsageCache,
  };

  return async (request: IncomingMessage, response: ServerResponse) => {
    const startTime = Date.now();
    let statusCode = 0;
    const originalWriteHead = response.writeHead.bind(response);
    response.writeHead = ((...args: Parameters<typeof response.writeHead>) => {
      statusCode = typeof args[0] === "number" ? args[0] : 0;
      return originalWriteHead(...args);
    }) as typeof response.writeHead;

    const originHeader = readHeaderValue(request.headers.origin);
    const hostHeader = readHeaderValue(request.headers.host);
    const corsOrigin = getRequestCorsOrigin(originHeader, allowRemoteAccess);

    if (!isAllowedHostHeader(hostHeader, allowRemoteAccess)) {
      writeJson(response, 403, { error: "Host not allowed." }, null);
      logRequest(request.method ?? "?", request.url ?? "/", 403, startTime);
      return;
    }

    if (!isAllowedOriginHeader(originHeader, allowRemoteAccess)) {
      writeJson(response, 403, { error: "Origin not allowed." }, null);
      logRequest(request.method ?? "?", request.url ?? "/", 403, startTime);
      return;
    }

    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "OPTIONS") {
        writeNoContent(response, 204, corsOrigin);
        logRequest(request.method ?? "OPTIONS", requestUrl.pathname, statusCode, startTime);
        return;
      }

      const routeContext: RouteHandlerContext = {
        request,
        response,
        requestUrl,
        corsOrigin,
      };

      const prefix = extractRoutePrefix(requestUrl.pathname);
      const handlers = prefix !== null ? API_ROUTE_MAP.get(prefix) : undefined;
      if (handlers) {
        for (const handleRoute of handlers) {
          if (await handleRoute(routeContext, routeDependencies)) {
            logRequest(request.method ?? "?", requestUrl.pathname, statusCode, startTime);
            return;
          }
        }
      }

      writeJson(response, 404, { error: "Not found" }, corsOrigin);
      logRequest(request.method ?? "?", requestUrl.pathname, statusCode, startTime);
    } catch {
      writeJson(
        response,
        500,
        {
          error: "Internal server error",
        },
        corsOrigin,
      );
      logRequest(request.method ?? "?", request.url ?? "/", statusCode, startTime);
    }
  };
};
