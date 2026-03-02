import type { IncomingMessage, ServerResponse } from "node:http";

import type { CodexUsageSnapshot } from "../codexUsage";
import type { GitHubRepoSummarySnapshot } from "../githubRepoSummary";
import { MonitorInputError, type MonitorService } from "../monitor";
import { RuntimeInputError, type TentacleWorkspaceMode } from "../terminalRuntime";
import {
  parseMonitorConfigPatch,
  RequestBodyTooLargeError,
  parseTentacleName,
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
  readCodexUsageSnapshot: () => Promise<CodexUsageSnapshot>;
  readGithubRepoSummary: () => Promise<GitHubRepoSummarySnapshot>;
  monitorService: MonitorService;
  allowRemoteAccess: boolean;
};

type RouteHandlerDependencies = {
  runtime: TerminalRuntime;
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
    writeJson(response, 400, { error: patchResult.error ?? "Invalid monitor config patch." }, corsOrigin);
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

  try {
    const createTentacleInput: {
      tentacleName?: string;
      workspaceMode: TentacleWorkspaceMode;
    } = {
      workspaceMode: workspaceModeResult.workspaceMode,
    };
    if (nameResult.name !== undefined) {
      createTentacleInput.tentacleName = nameResult.name;
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

const API_ROUTE_HANDLERS: readonly ApiRouteHandler[] = [
  handleAgentSnapshotsRoute,
  handleCodexUsageRoute,
  handleGithubSummaryRoute,
  handleUiStateRoute,
  handleMonitorConfigRoute,
  handleMonitorFeedRoute,
  handleMonitorRefreshRoute,
  handleTentaclesCollectionRoute,
  handleTentacleItemRoute,
];

export const createApiRequestHandler = ({
  runtime,
  readCodexUsageSnapshot,
  readGithubRepoSummary,
  monitorService,
  allowRemoteAccess,
}: CreateApiRequestHandlerOptions) => {
  const routeDependencies: RouteHandlerDependencies = {
    runtime,
    readCodexUsageSnapshot,
    readGithubRepoSummary,
    monitorService,
  };

  return async (request: IncomingMessage, response: ServerResponse) => {
    const originHeader = readHeaderValue(request.headers.origin);
    const hostHeader = readHeaderValue(request.headers.host);
    const corsOrigin = getRequestCorsOrigin(originHeader, allowRemoteAccess);

    if (!isAllowedHostHeader(hostHeader, allowRemoteAccess)) {
      writeJson(response, 403, { error: "Host not allowed." }, null);
      return;
    }

    if (!isAllowedOriginHeader(originHeader, allowRemoteAccess)) {
      writeJson(response, 403, { error: "Origin not allowed." }, null);
      return;
    }

    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "OPTIONS") {
        writeNoContent(response, 204, corsOrigin);
        return;
      }

      const routeContext: RouteHandlerContext = {
        request,
        response,
        requestUrl,
        corsOrigin,
      };
      for (const handleRoute of API_ROUTE_HANDLERS) {
        if (await handleRoute(routeContext, routeDependencies)) {
          return;
        }
      }

      writeJson(response, 404, { error: "Not found" }, corsOrigin);
    } catch {
      writeJson(
        response,
        500,
        {
          error: "Internal server error",
        },
        corsOrigin,
      );
    }
  };
};
