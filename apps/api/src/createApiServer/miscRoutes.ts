import { mkdirSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";

import type { WorkspaceSetupStepId } from "@octogent/core";

import {
  deleteUserPrompt,
  listAllPrompts,
  readPromptFromDirs,
  resolvePrompt,
  writeUserPrompt,
} from "../prompts";
import { markSetupStepVerified } from "../setupState";
import {
  ensureWorkspaceGitignore,
  initializeWorkspaceFiles,
  readWorkspaceSetupSnapshot,
} from "../setupStatus";
import type { ApiRouteHandler } from "./routeHelpers";
import {
  readJsonBodyOrWriteError,
  writeJson,
  writeMethodNotAllowed,
  writeNoContent,
} from "./routeHelpers";
import { parseUiStatePatch } from "./uiStateParsers";

// S56 — OctoBoss endpoint constant. Workers send `channel send octoboss <msg>`
// uniformly via the channel API; this route translates the special target to
// a filesystem write under <workspace>/.octogent/octoboss-inbox/. OctoBoss
// reads the inbox on session-start (or on demand) and acts on the messages.
//
// Codex MEDIUM-#4 from S55 architecture review. Pre-S56, send-to-octoboss
// returned 404 because OctoBoss is a standalone Claude session, not a
// registered terminal. Workers had to improvise filesystem handoffs ad-hoc.
// Now the protocol is formal: channel send octoboss → inbox file.
const OCTOBOSS_TERMINAL_ID = "octoboss";
const OCTOBOSS_INBOX_DIRNAME = "octoboss-inbox";

const WORKSPACE_SETUP_PATH = "/api/setup";
const WORKSPACE_SETUP_STEP_PATH_PATTERN = /^\/api\/setup\/steps\/([^/]+)$/;
const WORKSPACE_INFO_PATH = "/api/workspace-info";

/**
 * Phase 10.9.1 — reports the ACTIVE workspace info. External tools (eg
 * Boardroom CLI in the jarvis repo) need this to resolve paths that the
 * daemon wrote, like worktree dirs under .octogent/worktrees/. Reading
 * ~/.octogent/projects.json is not sufficient because the daemon can be
 * bound to a project that isn't registered there, and "lastOpenedAt"
 * doesn't always match the running bind point.
 *
 * Response shape is stable — adding fields is OK, renaming is not.
 */
export const handleWorkspaceInfoRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd, projectStateDir },
) => {
  if (requestUrl.pathname !== WORKSPACE_INFO_PATH) return false;

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  writeJson(
    response,
    200,
    {
      workspaceCwd,
      projectStateDir,
    },
    corsOrigin,
  );
  return true;
};

const isWorkspaceSetupStepId = (value: string): value is WorkspaceSetupStepId =>
  value === "initialize-workspace" ||
  value === "ensure-gitignore" ||
  value === "check-claude" ||
  value === "check-git" ||
  value === "check-curl" ||
  value === "create-tentacles";

export const handleWorkspaceSetupRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd, projectStateDir },
) => {
  if (requestUrl.pathname === WORKSPACE_SETUP_PATH) {
    if (request.method !== "GET") {
      writeMethodNotAllowed(response, corsOrigin);
      return true;
    }

    writeJson(response, 200, readWorkspaceSetupSnapshot(workspaceCwd, projectStateDir), corsOrigin);
    return true;
  }

  const match = requestUrl.pathname.match(WORKSPACE_SETUP_STEP_PATH_PATTERN);
  if (!match) {
    return false;
  }

  const stepId = decodeURIComponent(match[1] ?? "");
  if (!isWorkspaceSetupStepId(stepId)) {
    writeJson(response, 404, { error: "Setup step not found." }, corsOrigin);
    return true;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  if (stepId === "initialize-workspace") {
    initializeWorkspaceFiles(workspaceCwd, projectStateDir);
  } else if (stepId === "ensure-gitignore") {
    ensureWorkspaceGitignore(workspaceCwd);
  } else if (stepId === "check-claude" || stepId === "check-git" || stepId === "check-curl") {
    markSetupStepVerified(projectStateDir, stepId);
  }

  writeJson(response, 200, readWorkspaceSetupSnapshot(workspaceCwd, projectStateDir), corsOrigin);
  return true;
};

export const handleUiStateRoute: ApiRouteHandler = async (
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

const HOOK_PATH_PATTERN =
  /^\/api\/hooks\/(session-start|user-prompt-submit|pre-tool-use|post-tool-use|notification|stop|pre-compact)$/;

export const handleHookRoute: ApiRouteHandler = async (
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

const PROMPT_ITEM_PATH_PATTERN = /^\/api\/prompts\/([^/]+)$/;

export const handlePromptsCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { promptsDir, userPromptsDir },
) => {
  if (requestUrl.pathname !== "/api/prompts") {
    return false;
  }

  if (request.method === "GET") {
    const prompts = await listAllPrompts(promptsDir, userPromptsDir);
    writeJson(response, 200, { prompts }, corsOrigin);
    return true;
  }

  if (request.method === "POST") {
    const bodyResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!bodyResult.ok) return true;

    const body = bodyResult.payload as Record<string, unknown> | null;
    const name = body && typeof body.name === "string" ? body.name.trim() : "";
    const content = body && typeof body.content === "string" ? body.content : "";

    if (name.length === 0) {
      writeJson(response, 400, { error: "Prompt name is required." }, corsOrigin);
      return true;
    }

    const ok = await writeUserPrompt(userPromptsDir, name, content);
    if (!ok) {
      writeJson(response, 400, { error: "Invalid prompt name." }, corsOrigin);
      return true;
    }

    writeJson(response, 201, { name, source: "user" }, corsOrigin);
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};

export const handlePromptItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { promptsDir, userPromptsDir },
) => {
  const match = requestUrl.pathname.match(PROMPT_ITEM_PATH_PATTERN);
  if (!match) return false;

  const name = decodeURIComponent(match[1] as string);

  if (request.method === "GET") {
    // Resolve variables from query params (e.g. ?tentacleId=sandbox).
    const variables: Record<string, string> = {};
    for (const [key, value] of requestUrl.searchParams.entries()) {
      variables[key] = value;
    }

    const hasVariables = Object.keys(variables).length > 0;
    if (hasVariables) {
      const resolved = await resolvePrompt(promptsDir, name, variables);
      if (resolved === undefined) {
        writeJson(response, 404, { error: "Prompt template not found" }, corsOrigin);
        return true;
      }
      writeJson(response, 200, { name, prompt: resolved }, corsOrigin);
    } else {
      const result = await readPromptFromDirs(promptsDir, userPromptsDir, name);
      if (result === undefined) {
        writeJson(response, 404, { error: "Prompt template not found" }, corsOrigin);
        return true;
      }
      writeJson(response, 200, result, corsOrigin);
    }
    return true;
  }

  if (request.method === "PUT") {
    const bodyResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!bodyResult.ok) return true;

    const body = bodyResult.payload as Record<string, unknown> | null;
    const content = body && typeof body.content === "string" ? body.content : "";

    const ok = await writeUserPrompt(userPromptsDir, name, content);
    if (!ok) {
      writeJson(response, 400, { error: "Invalid prompt name." }, corsOrigin);
      return true;
    }
    writeJson(response, 200, { name, source: "user", content }, corsOrigin);
    return true;
  }

  if (request.method === "DELETE") {
    const ok = await deleteUserPrompt(userPromptsDir, name);
    if (!ok) {
      writeJson(response, 404, { error: "Prompt not found or cannot be deleted." }, corsOrigin);
      return true;
    }
    writeNoContent(response, 204, corsOrigin);
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};

// ─── Channel routes ───────────────────────────────────────────────────────

const CHANNEL_MESSAGES_PATH_PATTERN = /^\/api\/channels\/([^/]+)\/messages$/;

export const handleChannelMessagesRoute: ApiRouteHandler = async (
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

  // Special target: octoboss. OctoBoss is a standalone Claude session, not a
  // registered terminal in the daemon's tentacle registry, so we can't deliver
  // via runtime.sendChannelMessage. Translate to a filesystem inbox write.
  if (terminalId === OCTOBOSS_TERMINAL_ID) {
    try {
      const inboxDir = joinPath(runtime.workspaceCwd, ".octogent", OCTOBOSS_INBOX_DIRNAME);
      mkdirSync(inboxDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const fromSlug = (fromTerminalId || "anonymous").replace(/[^A-Za-z0-9_.-]/g, "_");
      const filename = `${ts}-${fromSlug}.md`;
      const filePath = joinPath(inboxDir, filename);
      const fileBody = [
        `# Worker → OctoBoss`,
        ``,
        `- From: ${fromTerminalId || "(anonymous)"}`,
        `- At:   ${new Date().toISOString()}`,
        ``,
        `---`,
        ``,
        content,
        ``,
      ].join("\n");
      writeFileSync(filePath, fileBody, "utf8");
      const message = {
        messageId: `octoboss-inbox-${ts}-${fromSlug}`,
        toTerminalId: OCTOBOSS_TERMINAL_ID,
        fromTerminalId: fromTerminalId || null,
        content,
        deliveredVia: "filesystem-inbox",
        inboxPath: filePath,
      };
      writeJson(response, 201, message, corsOrigin);
    } catch (error) {
      writeJson(
        response,
        500,
        { error: `Failed to write OctoBoss inbox file: ${(error as Error).message}` },
        corsOrigin,
      );
    }
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
