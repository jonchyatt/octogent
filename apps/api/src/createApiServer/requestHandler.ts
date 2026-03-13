import type { IncomingMessage, ServerResponse } from "node:http";

import type { ClaudeUsageSnapshot } from "../claudeUsage";
import type { CodexUsageSnapshot } from "../codexUsage";
import type { GitHubRepoSummarySnapshot } from "../githubRepoSummary";
import { MonitorInputError, type MonitorService } from "../monitor";
import {
  RuntimeInputError,
  type TentacleAgentProvider,
  type TentacleWorkspaceMode,
} from "../terminalRuntime";
import {
  RequestBodyTooLargeError,
  parseMonitorConfigPatch,
  parseTentacleAgentCreateInput,
  parseTentacleAgentProvider,
  parseTentacleCommitMessage,
  parseTentacleName,
  parseTentaclePullRequestCreateInput,
  parseTentacleSyncBaseRef,
  parseTentacleWorkspaceMode,
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
  readClaudeUsageSnapshot: () => Promise<ClaudeUsageSnapshot>;
  readCodexUsageSnapshot: () => Promise<CodexUsageSnapshot>;
  readGithubRepoSummary: () => Promise<GitHubRepoSummarySnapshot>;
  monitorService: MonitorService;
  allowRemoteAccess: boolean;
};

type RouteHandlerDependencies = {
  runtime: TerminalRuntime;
  readClaudeUsageSnapshot: () => Promise<ClaudeUsageSnapshot>;
  readCodexUsageSnapshot: () => Promise<CodexUsageSnapshot>;
  readGithubRepoSummary: () => Promise<GitHubRepoSummarySnapshot>;
  monitorService: MonitorService;
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

const handleAgentSnapshotsRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/agent-snapshots") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const payload = runtime.listAgentSnapshots();
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

const handleConversationItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const match = requestUrl.pathname.match(CONVERSATION_ITEM_PATH_PATTERN);
  if (!match) {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const sessionId = decodeURIComponent(match[1] ?? "");
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

const handleTentaclesCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/tentacles") {
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

  const nameResult = parseTentacleName(bodyReadResult.payload);
  if (nameResult.error) {
    writeJson(response, 400, { error: nameResult.error }, corsOrigin);
    return true;
  }

  const workspaceModeResult = parseTentacleWorkspaceMode(bodyReadResult.payload);
  if (workspaceModeResult.error) {
    writeJson(response, 400, { error: workspaceModeResult.error }, corsOrigin);
    return true;
  }

  const agentProviderResult = parseTentacleAgentProvider(bodyReadResult.payload);
  if (agentProviderResult.error) {
    writeJson(response, 400, { error: agentProviderResult.error }, corsOrigin);
    return true;
  }

  try {
    const createTentacleInput: {
      tentacleName?: string;
      workspaceMode: TentacleWorkspaceMode;
      agentProvider?: TentacleAgentProvider;
    } = {
      workspaceMode: workspaceModeResult.workspaceMode,
    };
    if (nameResult.name !== undefined) {
      createTentacleInput.tentacleName = nameResult.name;
    }
    if (agentProviderResult.agentProvider !== undefined) {
      createTentacleInput.agentProvider = agentProviderResult.agentProvider;
    }

    const payload = runtime.createTentacle(createTentacleInput);
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

const TENTACLE_ITEM_PATH_PATTERN = /^\/api\/tentacles\/([^/]+)$/;
const TENTACLE_AGENT_COLLECTION_PATH_PATTERN = /^\/api\/tentacles\/([^/]+)\/agents$/;
const TENTACLE_AGENT_ITEM_PATH_PATTERN = /^\/api\/tentacles\/([^/]+)\/agents\/([^/]+)$/;
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

const handleTentacleAgentCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const agentCollectionMatch = requestUrl.pathname.match(TENTACLE_AGENT_COLLECTION_PATH_PATTERN);
  if (!agentCollectionMatch) {
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

  const createInput = parseTentacleAgentCreateInput(bodyReadResult.payload);
  if (createInput.error || !createInput.anchorAgentId || !createInput.placement) {
    writeJson(
      response,
      400,
      { error: createInput.error ?? "Invalid tentacle agent input." },
      corsOrigin,
    );
    return true;
  }

  const tentacleId = decodeURIComponent(agentCollectionMatch[1] ?? "");
  try {
    const payload = runtime.createTentacleAgent({
      tentacleId,
      anchorAgentId: createInput.anchorAgentId,
      placement: createInput.placement,
    });
    if (!payload) {
      writeJson(response, 404, { error: "Tentacle not found." }, corsOrigin);
      return true;
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

const handleTentacleAgentItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const agentItemMatch = requestUrl.pathname.match(TENTACLE_AGENT_ITEM_PATH_PATTERN);
  if (!agentItemMatch) {
    return false;
  }

  if (request.method !== "DELETE") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(agentItemMatch[1] ?? "");
  const agentId = decodeURIComponent(agentItemMatch[2] ?? "");
  try {
    const deleted = runtime.deleteTentacleAgent({
      tentacleId,
      agentId,
    });
    if (deleted === null) {
      writeJson(response, 404, { error: "Tentacle not found." }, corsOrigin);
      return true;
    }
    if (!deleted) {
      writeJson(response, 404, { error: "Terminal agent not found." }, corsOrigin);
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
};

const handleTentacleItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const renameMatch = requestUrl.pathname.match(TENTACLE_ITEM_PATH_PATTERN);
  if (!renameMatch) {
    return false;
  }

  if (request.method !== "PATCH" && request.method !== "DELETE") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(renameMatch[1] ?? "");
  if (request.method === "DELETE") {
    try {
      const deleted = runtime.deleteTentacle(tentacleId);
      if (!deleted) {
        writeJson(response, 404, { error: "Tentacle not found." }, corsOrigin);
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

  const nameResult = parseTentacleName(bodyReadResult.payload);
  if (nameResult.error) {
    writeJson(response, 400, { error: nameResult.error }, corsOrigin);
    return true;
  }

  if (!nameResult.provided || !nameResult.name) {
    writeJson(response, 400, { error: "Tentacle name is required." }, corsOrigin);
    return true;
  }

  const payload = runtime.renameTentacle(tentacleId, nameResult.name);
  if (!payload) {
    writeJson(response, 404, { error: "Tentacle not found." }, corsOrigin);
    return true;
  }

  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const HOOK_PATH_PATTERN = /^\/api\/hooks\/(session-start|user-prompt-submit|pre-tool-use|stop)$/;

const handleHookRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
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
  const result = runtime.handleHook(hookName, body.payload);
  writeJson(response, 200, result, corsOrigin);
  return true;
};

const API_ROUTE_MAP: ReadonlyMap<string, readonly ApiRouteHandler[]> = new Map([
  ["hooks", [handleHookRoute]],
  ["agent-snapshots", [handleAgentSnapshotsRoute]],
  ["codex", [handleCodexUsageRoute]],
  ["claude", [handleClaudeUsageRoute]],
  ["github", [handleGithubSummaryRoute]],
  ["ui-state", [handleUiStateRoute]],
  [
    "monitor",
    [handleMonitorConfigRoute, handleMonitorFeedRoute, handleMonitorRefreshRoute],
  ],
  [
    "conversations",
    [
      handleConversationsCollectionRoute,
      handleConversationExportRoute,
      handleConversationItemRoute,
    ],
  ],
  [
    "tentacles",
    [
      handleTentaclesCollectionRoute,
      handleTentacleAgentCollectionRoute,
      handleTentacleAgentItemRoute,
      handleTentacleGitRoute,
      handleTentacleGitPullRequestRoute,
      handleTentacleItemRoute,
    ],
  ],
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
  readClaudeUsageSnapshot,
  readCodexUsageSnapshot,
  readGithubRepoSummary,
  monitorService,
  allowRemoteAccess,
}: CreateApiRequestHandlerOptions) => {
  const routeDependencies: RouteHandlerDependencies = {
    runtime,
    readClaudeUsageSnapshot,
    readCodexUsageSnapshot,
    readGithubRepoSummary,
    monitorService,
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
