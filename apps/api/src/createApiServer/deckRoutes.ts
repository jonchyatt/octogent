import { join } from "node:path";

import {
  addTodoItem,
  createDeckTentacle,
  deleteDeckTentacle,
  deleteTodoItem,
  editTodoItem,
  listDeckAvailableSkills,
  parseTodoProgress,
  readDeckTentacles,
  readDeckVaultFile,
  toggleTodoItem,
  updateDeckTentacleSuggestedSkills,
} from "../deck/readDeckTentacles";
import { deriveAllTentacleLiveStates } from "../deck/deriveTentacleLiveState";
import { detectCycle, parseTodoNeeds } from "@octogent/core";

import { resolvePrompt } from "../prompts";
import { DEFAULT_AGENT_PROVIDER } from "../terminalRuntime/constants";
import { MAX_CHILDREN_PER_PARENT, RuntimeInputError } from "../terminalRuntime";
import type { ApiRouteHandler } from "./routeHelpers";
import {
  readJsonBodyOrWriteError,
  writeJson,
  writeMethodNotAllowed,
  writeNoContent,
  writeText,
} from "./routeHelpers";
import { parseTerminalAgentProvider, parseTerminalWorkspaceMode } from "./terminalParsers";

const shellSingleQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const buildSingleTodoWorkerPrompt = async ({
  promptsDir,
  workspaceCwd,
  tentacleId,
  tentacleName,
  todoItemText,
  terminalId,
  apiPort,
}: {
  promptsDir: string;
  workspaceCwd: string;
  tentacleId: string;
  tentacleName: string;
  todoItemText: string;
  terminalId: string;
  apiPort: string;
}) => {
  const tentacleContextPath = join(workspaceCwd, ".octogent/tentacles", tentacleId);

  return await resolvePrompt(promptsDir, "swarm-worker", {
    tentacleName,
    tentacleId,
    tentacleContextPath,
    todoItemText,
    terminalId,
    apiPort,
    workspaceContextIntro:
      "You are working in the shared main workspace on the main branch, not in an isolated worktree.",
    workspaceGuidelines: [
      "- You must work in the main project directory. Do NOT create or use git worktrees for this task.",
      "- You are working in the shared main workspace. Keep edits narrow and focused on this one todo item.",
      "- Do NOT create commits. Leave your completed changes uncommitted in the main workspace.",
      "- Do NOT mark todo items done or rewrite tentacle context files unless this specific todo item explicitly requires it.",
    ].join("\n"),
    commitGuidance:
      "- Do NOT commit. Leave your completed changes uncommitted in the shared workspace and report what changed.",
    definitionOfDoneCommitStep:
      "Changes are left uncommitted in the shared main workspace, ready for operator review.",
    workspaceReminder: "Do not commit. Do not use worktrees.",
    parentTerminalId: "",
    parentSection: "",
  });
};

export const handleDeckTentaclesRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, workspaceCwd, projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/deck/tentacles") return false;

  if (request.method === "GET") {
    const tentacles = readDeckTentacles(workspaceCwd, projectStateDir);
    // Phase 10.9.5 — enrich each tentacle with a live rolled-up state of
    // its attached terminals so the UI tile can show RUNNING / FAILED /
    // INACTIVE accurately instead of a static "IDLE" that doesn't reflect
    // runtime reality. Derivation is pure — runtime.listTerminalSnapshots
    // is cheap (iterates in-memory Map), and deriveAllTentacleLiveStates
    // is O(tentacles × terminals).
    const allTerminals = runtime.listTerminalSnapshots();
    const liveStates = deriveAllTentacleLiveStates(
      tentacles.map((t) => t.tentacleId),
      allTerminals,
    );
    const enriched = tentacles.map((t) => {
      const live = liveStates.get(t.tentacleId);
      if (!live || live.state === null) return t;
      return { ...t, liveTerminal: live };
    });
    writeJson(response, 200, enriched, corsOrigin);
    return true;
  }

  if (request.method === "POST") {
    const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!bodyReadResult.ok) return true;

    const body = bodyReadResult.payload as Record<string, unknown> | null;
    const name = body && typeof body.name === "string" ? body.name : "";
    const description = body && typeof body.description === "string" ? body.description : "";
    const color = body && typeof body.color === "string" ? body.color : "#d4a017";
    const suggestedSkills =
      body && Array.isArray(body.suggestedSkills)
        ? body.suggestedSkills.filter((skill): skill is string => typeof skill === "string")
        : [];

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

    const result = createDeckTentacle(
      workspaceCwd,
      { name, description, color, octopus, suggestedSkills },
      projectStateDir,
    );
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

export const handleDeckSkillsRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  if (requestUrl.pathname !== "/api/deck/skills") return false;

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  writeJson(response, 200, listDeckAvailableSkills(workspaceCwd), corsOrigin);
  return true;
};

const DECK_TENTACLE_ITEM_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)$/;

export const handleDeckTentacleItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd, projectStateDir },
) => {
  const match = requestUrl.pathname.match(DECK_TENTACLE_ITEM_PATTERN);
  if (!match) return false;

  if (request.method !== "DELETE") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const result = deleteDeckTentacle(workspaceCwd, tentacleId, projectStateDir);
  if (!result.ok) {
    writeJson(response, 404, { error: result.error }, corsOrigin);
    return true;
  }

  writeNoContent(response, 204, corsOrigin);
  return true;
};

const DECK_VAULT_FILE_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/files\/([^/]+)$/;

export const handleDeckVaultFileRoute: ApiRouteHandler = async (
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

const DECK_TENTACLE_SKILLS_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/skills$/;

export const handleDeckTentacleSkillsRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd, projectStateDir },
) => {
  const match = requestUrl.pathname.match(DECK_TENTACLE_SKILLS_PATTERN);
  if (!match) return false;
  if (request.method !== "PATCH") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;

  const payload = body.payload as Record<string, unknown> | null;
  const suggestedSkills = Array.isArray(payload?.suggestedSkills)
    ? payload.suggestedSkills.filter((skill): skill is string => typeof skill === "string")
    : null;

  if (suggestedSkills === null) {
    writeJson(response, 400, { error: "suggestedSkills (string[]) is required" }, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const updated = updateDeckTentacleSuggestedSkills(
    workspaceCwd,
    tentacleId,
    suggestedSkills,
    projectStateDir,
  );
  if (!updated) {
    writeJson(response, 404, { error: "Tentacle not found" }, corsOrigin);
    return true;
  }

  writeJson(response, 200, updated, corsOrigin);
  return true;
};

// ---------------------------------------------------------------------------
// Deck — Todo toggle
// ---------------------------------------------------------------------------

const DECK_TODO_TOGGLE_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/todo\/toggle$/;

export const handleDeckTodoToggleRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  const match = requestUrl.pathname.match(DECK_TODO_TOGGLE_PATTERN);
  if (!match) return false;
  if (request.method !== "PATCH") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;

  const { itemIndex, done } = body.payload as { itemIndex: unknown; done: unknown };
  if (typeof itemIndex !== "number" || typeof done !== "boolean") {
    writeJson(
      response,
      400,
      { error: "itemIndex (number) and done (boolean) are required" },
      corsOrigin,
    );
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const result = toggleTodoItem(workspaceCwd, tentacleId, itemIndex, done);
  if (!result) {
    writeJson(response, 404, { error: "Todo item not found" }, corsOrigin);
    return true;
  }

  writeJson(response, 200, result, corsOrigin);
  return true;
};

// ---------------------------------------------------------------------------
// Deck — Todo edit (rename item text)
// ---------------------------------------------------------------------------

const DECK_TODO_EDIT_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/todo\/edit$/;

export const handleDeckTodoEditRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  const match = requestUrl.pathname.match(DECK_TODO_EDIT_PATTERN);
  if (!match) return false;
  if (request.method !== "PATCH") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;

  const { itemIndex, text } = body.payload as { itemIndex: unknown; text: unknown };
  if (typeof itemIndex !== "number" || typeof text !== "string" || text.trim().length === 0) {
    writeJson(
      response,
      400,
      { error: "itemIndex (number) and text (non-empty string) are required" },
      corsOrigin,
    );
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const result = editTodoItem(workspaceCwd, tentacleId, itemIndex, text.trim());
  if (!result) {
    writeJson(response, 404, { error: "Todo item not found" }, corsOrigin);
    return true;
  }

  writeJson(response, 200, result, corsOrigin);
  return true;
};

// ---------------------------------------------------------------------------
// Deck — Todo add
// ---------------------------------------------------------------------------

const DECK_TODO_ADD_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/todo$/;

export const handleDeckTodoAddRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  const match = requestUrl.pathname.match(DECK_TODO_ADD_PATTERN);
  if (!match) return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;

  const { text } = body.payload as { text: unknown };
  if (typeof text !== "string" || text.trim().length === 0) {
    writeJson(response, 400, { error: "text (non-empty string) is required" }, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const result = addTodoItem(workspaceCwd, tentacleId, text.trim());
  if (!result) {
    writeJson(response, 404, { error: "Tentacle todo.md not found" }, corsOrigin);
    return true;
  }

  writeJson(response, 201, result, corsOrigin);
  return true;
};

// ---------------------------------------------------------------------------
// Deck — Todo delete
// ---------------------------------------------------------------------------

const DECK_TODO_DELETE_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/todo\/delete$/;

export const handleDeckTodoDeleteRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  const match = requestUrl.pathname.match(DECK_TODO_DELETE_PATTERN);
  if (!match) return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;

  const { itemIndex } = body.payload as { itemIndex: unknown };
  if (typeof itemIndex !== "number") {
    writeJson(response, 400, { error: "itemIndex (number) is required" }, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const result = deleteTodoItem(workspaceCwd, tentacleId, itemIndex);
  if (!result) {
    writeJson(response, 404, { error: "Todo item not found" }, corsOrigin);
    return true;
  }

  writeJson(response, 200, result, corsOrigin);
  return true;
};

// ---------------------------------------------------------------------------
// Deck — Solve a single todo item
// ---------------------------------------------------------------------------

const DECK_TODO_SOLVE_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/todo\/solve$/;

export const handleDeckTodoSolveRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, workspaceCwd, projectStateDir, promptsDir, getApiPort },
) => {
  const match = requestUrl.pathname.match(DECK_TODO_SOLVE_PATTERN);
  if (!match) return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) return true;

  const body = (bodyReadResult.payload ?? {}) as Record<string, unknown>;
  const itemIndex = body.itemIndex;
  if (typeof itemIndex !== "number") {
    writeJson(response, 400, { error: "itemIndex (number) is required" }, corsOrigin);
    return true;
  }

  const agentProviderResult = parseTerminalAgentProvider(body);
  if (agentProviderResult.error) {
    writeJson(response, 400, { error: agentProviderResult.error }, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const todoContent = readDeckVaultFile(workspaceCwd, tentacleId, "todo.md");
  if (todoContent === null) {
    writeJson(response, 404, { error: "Tentacle or todo.md not found." }, corsOrigin);
    return true;
  }

  const todoResult = parseTodoProgress(todoContent);
  const todoItem = todoResult.items[itemIndex] ?? null;
  if (!todoItem) {
    writeJson(response, 404, { error: "Todo item not found." }, corsOrigin);
    return true;
  }
  if (todoItem.done) {
    writeJson(response, 400, { error: "Todo item is already complete." }, corsOrigin);
    return true;
  }

  const terminalId = `${tentacleId}-todo-${itemIndex}`;
  const existingTerminal = runtime
    .listTerminalSnapshots()
    .find((terminal) => terminal.terminalId === terminalId);
  if (existingTerminal) {
    writeJson(
      response,
      409,
      { error: "A solve agent is already active for this todo item.", terminalId },
      corsOrigin,
    );
    return true;
  }

  const deckTentacles = readDeckTentacles(workspaceCwd, projectStateDir);
  const deckEntry = deckTentacles.find((tentacle) => tentacle.tentacleId === tentacleId);
  const tentacleName = deckEntry?.displayName ?? tentacleId;

  try {
    const workerPrompt = await buildSingleTodoWorkerPrompt({
      promptsDir,
      workspaceCwd,
      tentacleId,
      tentacleName,
      todoItemText: todoItem.text,
      terminalId,
      apiPort: getApiPort(),
    });

    const snapshot = runtime.createTerminal({
      terminalId,
      tentacleId,
      tentacleName,
      nameOrigin: "generated",
      autoRenamePromptContext: todoItem.text,
      workspaceMode: "shared",
      ...(agentProviderResult.agentProvider
        ? { agentProvider: agentProviderResult.agentProvider }
        : {}),
      ...(workerPrompt ? { initialPrompt: workerPrompt } : {}),
    });

    writeJson(
      response,
      201,
      {
        terminalId: snapshot.terminalId,
        tentacleId,
        itemIndex,
        workspaceMode: "shared",
      },
      corsOrigin,
    );
    return true;
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 400, { error: error.message }, corsOrigin);
      return true;
    }

    throw error;
  }
};

// ---------------------------------------------------------------------------
// Deck — Swarm
// ---------------------------------------------------------------------------

const DECK_TENTACLE_SWARM_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/swarm$/;

export const handleDeckTentacleSwarmRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, workspaceCwd, projectStateDir, promptsDir, getApiPort },
) => {
  const match = requestUrl.pathname.match(DECK_TENTACLE_SWARM_PATTERN);
  if (!match) return false;

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);

  // Read and parse the tentacle's todo.md.
  const todoContent = readDeckVaultFile(workspaceCwd, tentacleId, "todo.md");
  if (todoContent === null) {
    writeJson(response, 404, { error: "Tentacle or todo.md not found." }, corsOrigin);
    return true;
  }

  const todoResult = parseTodoProgress(todoContent);
  const incompleteItems = todoResult.items
    .map((item, index) => ({ ...item, index }))
    .filter((item) => !item.done);

  if (incompleteItems.length === 0) {
    writeJson(response, 400, { error: "No incomplete todo items found." }, corsOrigin);
    return true;
  }

  // Parse optional request body for item filtering and agent provider.
  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) return true;
  const body = (bodyReadResult.payload ?? {}) as Record<string, unknown>;

  const agentProviderResult = parseTerminalAgentProvider(body);
  if (agentProviderResult.error) {
    writeJson(response, 400, { error: agentProviderResult.error }, corsOrigin);
    return true;
  }

  const workspaceModeResult = parseTerminalWorkspaceMode(body);
  if (workspaceModeResult.error) {
    writeJson(response, 400, { error: workspaceModeResult.error }, corsOrigin);
    return true;
  }
  const workerWorkspaceMode =
    body.workspaceMode === undefined ? "worktree" : workspaceModeResult.workspaceMode;

  // Filter to specific item indices if requested.
  let targetItems = incompleteItems;
  if (Array.isArray(body.todoItemIndices)) {
    const requestedIndices = new Set(
      (body.todoItemIndices as unknown[]).filter((v): v is number => typeof v === "number"),
    );
    targetItems = incompleteItems.filter((item) => requestedIndices.has(item.index));
    if (targetItems.length === 0) {
      writeJson(
        response,
        400,
        { error: "None of the requested todo item indices are incomplete." },
        corsOrigin,
      );
      return true;
    }
  }

  if (targetItems.length > MAX_CHILDREN_PER_PARENT) {
    // Todo order is priority order, so overflow items are deferred automatically.
    targetItems = targetItems.slice(0, MAX_CHILDREN_PER_PARENT);
  }

  // Check for existing swarm terminals to prevent duplicates.
  const existingTerminals = runtime.listTerminalSnapshots();
  const existingSwarmIds = existingTerminals
    .filter((t) => t.terminalId.startsWith(`${tentacleId}-swarm-`))
    .map((t) => t.terminalId);
  if (existingSwarmIds.length > 0) {
    writeJson(
      response,
      409,
      { error: "A swarm is already active for this tentacle.", existingSwarmIds },
      corsOrigin,
    );
    return true;
  }

  // Determine base ref: use tentacle's worktree branch if it exists, otherwise HEAD.
  const tentacleTerminal = existingTerminals.find(
    (t) => t.tentacleId === tentacleId && t.workspaceMode === "worktree",
  );
  const baseRef = tentacleTerminal ? `octogent/${tentacleId}` : "HEAD";

  // Resolve the tentacle display name for prompts.
  const deckTentacles = readDeckTentacles(workspaceCwd, projectStateDir);
  const deckEntry = deckTentacles.find((t) => t.tentacleId === tentacleId);
  const tentacleName = deckEntry?.displayName ?? tentacleId;

  const apiPort = getApiPort();
  const needsParent = targetItems.length > 1;
  const parentTerminalId = needsParent ? `${tentacleId}-swarm-parent` : null;
  const tentacleContextPath = join(workspaceCwd, ".octogent/tentacles", tentacleId);
  // Parse (needs: a, b, c) annotations out of each todo item so the swarm
  // coordinator can sequence dependent workers. `needs:` ids are matched
  // case-insensitively against either the worker index (e.g. "2") or the
  // terminal-id tail (e.g. "swarm-2"). Cycles are rejected before dispatch.
  const parsedItems = targetItems.map((item) => {
    const parsed = parseTodoNeeds(item.text);
    return {
      terminalId: `${tentacleId}-swarm-${item.index}`,
      todoIndex: item.index,
      todoText: parsed.cleanText,
      rawNeeds: parsed.needs,
    };
  });

  // Resolve needs references: accept either a bare index ("2") or a tail
  // like "swarm-2" or a full terminal-id. Unknown refs get surfaced in the
  // workerListing as a warning so the coordinator can ask the operator.
  const indexToTerminalId = new Map<string, string>();
  for (const w of parsedItems) {
    indexToTerminalId.set(String(w.todoIndex), w.terminalId);
    indexToTerminalId.set(`swarm-${w.todoIndex}`, w.terminalId);
    indexToTerminalId.set(w.terminalId, w.terminalId);
  }
  const workers = parsedItems.map((w) => ({
    terminalId: w.terminalId,
    todoIndex: w.todoIndex,
    todoText: w.todoText,
    needs: w.rawNeeds
      .map((ref) => indexToTerminalId.get(ref.toLowerCase()) ?? null)
      .filter((id): id is string => id !== null),
    unresolvedNeeds: w.rawNeeds.filter((ref) => !indexToTerminalId.has(ref.toLowerCase())),
  }));

  // Cycle check before we hand a broken plan to the coordinator.
  const cycle = detectCycle(workers.map((w) => ({ id: w.terminalId, needs: w.needs })));
  if (cycle) {
    writeJson(
      response,
      400,
      {
        error: "Swarm todo graph has a dependency cycle.",
        cycle,
      },
      corsOrigin,
    );
    return true;
  }

  const buildWorkerContextIntro = (): string =>
    workerWorkspaceMode === "worktree"
      ? "You are working on an isolated worktree branch, not the main branch."
      : "You are working in the shared main workspace on the main branch, not in an isolated worktree.";

  const buildWorkerGuidelines = (terminalId: string): string =>
    workerWorkspaceMode === "worktree"
      ? `- You are working in an isolated git worktree on branch \`octogent/${terminalId}\`. Make changes freely without worrying about conflicts with other agents.`
      : [
          "- You are working in the shared main workspace. Other workers may touch the same files, so keep your edits narrow, avoid broad refactors, and coordinate via your parent if you hit overlap.",
          "- Do NOT create commits in shared mode. Leave your changes uncommitted for the coordinator to review and commit later.",
          "- Do NOT mark todo items done or rewrite tentacle context files unless your assigned todo item explicitly requires it. The coordinator handles the final tentacle-level sync.",
        ].join("\n");

  const buildWorkerCommitGuidance = (): string =>
    workerWorkspaceMode === "worktree"
      ? "- Commit your changes with a clear commit message describing what you did."
      : "- Do NOT commit in shared mode. Leave your completed changes uncommitted and report DONE with a short summary of what changed.";

  const buildWorkerDefinitionOfDoneCommitStep = (): string =>
    workerWorkspaceMode === "worktree"
      ? "Changes are committed with a descriptive message."
      : "Changes are left uncommitted in the shared workspace, ready for coordinator review.";

  const buildWorkerReminder = (): string =>
    workerWorkspaceMode === "worktree" ? "Commit." : "Do not commit in shared mode.";

  const buildWorkerWorkspaceSection = (): string =>
    workerWorkspaceMode === "worktree"
      ? [
          "Each worker commits to its own isolated branch:",
          "",
          ...workers.map(
            (w) => `- \`octogent/${w.terminalId}\` — item #${w.todoIndex}: ${w.todoText}`,
          ),
        ].join("\n")
      : [
          "Workers are running in the shared main workspace, not in separate worktrees.",
          "",
          "There are no per-worker branches for this swarm. Supervise them carefully to avoid overlapping edits in the same files.",
        ].join("\n");

  const buildCompletionStrategySection = (baseBranch: string): string =>
    workerWorkspaceMode === "worktree"
      ? [
          `Only begin merging after ALL ${workers.length} workers have reported DONE.`,
          "",
          "### Step-by-step merge process",
          "",
          `1. **Create an integration branch** from \`${baseBranch}\`. First check if a stale integration branch exists from a previous swarm attempt — if so, delete it before proceeding:`,
          "   ```bash",
          `   git branch -D octogent_integration_${tentacleId} 2>/dev/null || true`,
          `   git checkout ${baseBranch}`,
          `   git checkout -b octogent_integration_${tentacleId}`,
          "   ```",
          "",
          "2. **Merge each worker branch** into the integration branch one at a time. Start with the branch most likely to merge cleanly (fewest changes):",
          "   ```bash",
          "   git merge <worker-branch-name> --no-edit",
          "   ```",
          "   If there are conflicts, resolve them carefully. Read the conflicting files and understand both sides before choosing.",
          "",
          "3. **Run tests** on the integration branch after all merges. Do not skip this step.",
          "",
          "4. **If tests pass**, merge the integration branch into the base branch:",
          "   ```bash",
          `   git checkout ${baseBranch}`,
          `   git merge octogent_integration_${tentacleId} --no-edit`,
          "   ```",
          "",
          "5. **If tests fail**, investigate and fix before merging. Do not merge broken code.",
          "",
          `6. **Update tentacle state/docs** before finalizing. Mark completed items as done in \`.octogent/tentacles/${tentacleId}/todo.md\`, and update \`.octogent/tentacles/${tentacleId}/CONTEXT.md\` or other tentacle markdown files if the merged work changed the reality they describe.`,
          "",
          "7. **Clean up** the integration branch:",
          "   ```bash",
          `   git branch -d octogent_integration_${tentacleId}`,
          "   ```",
          "",
          "### Merge failure recovery",
          "",
          "If a worker's branch has conflicts that are too complex to resolve, send a message to that worker asking them to rebase their work. Merge the other workers' branches first.",
        ].join("\n")
      : [
          `Only begin final verification after ALL ${workers.length} workers have reported DONE.`,
          "",
          "Workers are sharing the main workspace, so there are no per-worker branches to merge.",
          "",
          "### Step-by-step completion process",
          "",
          `1. **Verify the workspace is on \`${baseBranch}\`** and review the overall diff carefully. Do not assume the combined result is safe just because workers reported DONE.`,
          "",
          "2. **Review the changed files** to ensure workers did not overwrite each other or leave partial edits.",
          "",
          "3. **Run tests** on the shared workspace after all workers report DONE. Do not skip this step.",
          "",
          "4. **If tests fail**, investigate and coordinate fixes. Do not declare the swarm complete while the workspace is broken.",
          "",
          `5. **Update tentacle state/docs** before asking for approval. Mark completed items as done in \`.octogent/tentacles/${tentacleId}/todo.md\`, and update \`.octogent/tentacles/${tentacleId}/CONTEXT.md\` or other tentacle markdown files if the completed work changed the reality they describe. If no tentacle docs need updates, say that explicitly.`,
          "",
          "6. **Wait for explicit user approval** before creating any commit on the shared main branch. Present a concise summary of the reviewed diff, test results, and tentacle-doc updates first.",
          "",
          "7. **Only after approval, create one final commit** on the shared branch that captures the swarm's completed work.",
          "",
          "8. **Report completion** only after the shared workspace is reviewed, tests pass, tentacle docs are synced, approval is granted, and the final commit is created.",
          "",
          "### Shared-workspace failure recovery",
          "",
          "If two workers collide in the same files, stop them from making broad new edits, inspect the current diff, and coordinate targeted follow-up changes instead of pretending there is a clean merge boundary.",
        ].join("\n");

  try {
    if (!needsParent) {
      const [item] = targetItems;
      const [worker] = workers;
      if (!item || !worker) {
        writeJson(response, 400, { error: "No incomplete todo items found." }, corsOrigin);
        return true;
      }

      const workerPrompt = await resolvePrompt(promptsDir, "swarm-worker", {
        tentacleName,
        tentacleId,
        tentacleContextPath,
        todoItemText: item.text,
        terminalId: worker.terminalId,
        apiPort,
        workspaceContextIntro: buildWorkerContextIntro(),
        workspaceGuidelines: buildWorkerGuidelines(worker.terminalId),
        commitGuidance: buildWorkerCommitGuidance(),
        definitionOfDoneCommitStep: buildWorkerDefinitionOfDoneCommitStep(),
        workspaceReminder: buildWorkerReminder(),
        parentTerminalId: "",
        parentSection: "",
      });

      runtime.createTerminal({
        terminalId: worker.terminalId,
        tentacleId,
        ...(workerWorkspaceMode === "worktree" ? { worktreeId: worker.terminalId } : {}),
        tentacleName,
        nameOrigin: "generated",
        autoRenamePromptContext: item.text,
        workspaceMode: workerWorkspaceMode,
        ...(agentProviderResult.agentProvider
          ? { agentProvider: agentProviderResult.agentProvider }
          : {}),
        ...(workerPrompt ? { initialPrompt: workerPrompt } : {}),
        ...(workerWorkspaceMode === "worktree" ? { baseRef } : {}),
      });
    }

    if (needsParent && parentTerminalId) {
      const workerListing = workers
        .map((w) => {
          const depAnnot = w.needs.length > 0
            ? ` **(needs: ${w.needs.map((id) => `\`${id}\``).join(", ")})**`
            : "";
          const unresolvedAnnot = w.unresolvedNeeds.length > 0
            ? ` ⚠️ unresolved needs: ${w.unresolvedNeeds.join(", ")}`
            : "";
          return `- \`${w.terminalId}\`${depAnnot}${unresolvedAnnot} — item #${w.todoIndex}: ${w.todoText}`;
        })
        .join("\n");

      // Build a dedicated dependency section for the parent prompt so the
      // coordinator can sequence spawns. Empty string = no dependencies in play.
      const workerDependencies = workers.some((w) => w.needs.length > 0)
        ? [
            "### Dependency graph",
            "",
            "Some workers depend on others. DO NOT spawn or unblock a dependent worker until every prerequisite has reported DONE via channel message.",
            "",
            ...workers
              .filter((w) => w.needs.length > 0)
              .map(
                (w) =>
                  `- \`${w.terminalId}\` waits for: ${w.needs.map((id) => `\`${id}\``).join(", ")}`,
              ),
            "",
            "Recommended sequence:",
            "",
            "1. Spawn all workers with **no dependencies** first, in parallel.",
            "2. Monitor channel for DONE messages.",
            "3. As each prerequisite completes, spawn its dependents (still honoring any additional dependencies they have).",
            "4. If a prerequisite reports BLOCKED or never completes, do NOT spawn its dependents — escalate to the human.",
          ].join("\n")
        : "";

      const workerSpawnCommands = targetItems
        .map((item) => {
          const workerTerminalId = `${tentacleId}-swarm-${item.index}`;
          const parentSection = [
            "## Communication",
            "",
            `Your parent coordinator is at terminal \`${parentTerminalId}\`.`,
            "When you complete your task, report back:",
            "```bash",
            `octogent channel send ${parentTerminalId} "DONE: ${item.text}" --from ${workerTerminalId}`,
            "```",
            "If you are blocked, ask for help:",
            "```bash",
            `octogent channel send ${parentTerminalId} "BLOCKED: <describe what you need>" --from ${workerTerminalId}`,
            "```",
          ].join("\n");

          const promptVariables = JSON.stringify({
            tentacleName,
            tentacleId,
            tentacleContextPath,
            todoItemText: item.text,
            terminalId: workerTerminalId,
            apiPort,
            workspaceContextIntro: buildWorkerContextIntro(),
            workspaceGuidelines: buildWorkerGuidelines(workerTerminalId),
            commitGuidance: buildWorkerCommitGuidance(),
            definitionOfDoneCommitStep: buildWorkerDefinitionOfDoneCommitStep(),
            workspaceReminder: buildWorkerReminder(),
            parentTerminalId,
            parentSection,
          });

          // Preserve --agent-provider so a Codex parent doesn't accidentally spawn
          // Claude workers. The server picks up agentProvider from the POST body
          // (validated by parseTerminalAgentProvider), but the coordinator prompt
          // is what actually types this into a shell, so the flag has to be in the
          // generated command string verbatim.
          //
          // Always emit the flag with the *effective* provider — either the
          // explicit request or the configured default. Per Boardroom Codex
          // [MEDIUM] Session 31: omitting the flag when the request was
          // undefined preserves exactly the class of ambiguity P0 was trying
          // to remove.
          const effectiveProvider =
            agentProviderResult.agentProvider ?? DEFAULT_AGENT_PROVIDER;
          const commandParts = [
            "octogent terminal create",
            `--terminal-id ${shellSingleQuote(workerTerminalId)}`,
            `--tentacle-id ${shellSingleQuote(tentacleId)}`,
            `--parent-terminal-id ${shellSingleQuote(parentTerminalId)}`,
            `--workspace-mode ${workerWorkspaceMode}`,
            `--name ${shellSingleQuote(tentacleName)}`,
            "--name-origin generated",
            `--auto-rename-prompt-context ${shellSingleQuote(item.text)}`,
            "--prompt-template swarm-worker",
            `--prompt-variables ${shellSingleQuote(promptVariables)}`,
            `--agent-provider ${shellSingleQuote(effectiveProvider)}`,
          ];
          if (workerWorkspaceMode === "worktree") {
            commandParts.splice(3, 0, `--worktree-id ${shellSingleQuote(workerTerminalId)}`);
          }
          const command = commandParts.join(" ");

          return `- \`${workerTerminalId}\`:\n  \`\`\`bash\n  ${command}\n  \`\`\``;
        })
        .join("\n");

      const parentBaseBranch =
        workerWorkspaceMode === "worktree" ? (baseRef === "HEAD" ? "main" : baseRef) : "main";

      const parentPrompt = await resolvePrompt(promptsDir, "swarm-parent", {
        tentacleName,
        tentacleId,
        workerCount: String(workers.length),
        maxChildrenPerParent: String(MAX_CHILDREN_PER_PARENT),
        workerListing,
        workerDependencies,
        workerWorkspaceSection: buildWorkerWorkspaceSection(),
        workerSpawnCommands,
        completionStrategySection: buildCompletionStrategySection(parentBaseBranch),
        baseBranch: parentBaseBranch,
        terminalId: parentTerminalId,
        apiPort,
      });

      runtime.createTerminal({
        terminalId: parentTerminalId,
        tentacleId,
        tentacleName: `${tentacleName} (coordinator)`,
        workspaceMode: "shared",
        ...(agentProviderResult.agentProvider
          ? { agentProvider: agentProviderResult.agentProvider }
          : {}),
        ...(parentPrompt ? { initialPrompt: parentPrompt } : {}),
      });
    }
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 400, { error: error.message }, corsOrigin);
      return true;
    }
    throw error;
  }

  // Public response shape: core fields plus `needs` only when non-empty so
  // existing consumers (swarms with no dependencies) see the same shape they
  // did pre-10.8.3.
  const workerResponse = workers.map((w) => {
    const base = { terminalId: w.terminalId, todoIndex: w.todoIndex, todoText: w.todoText };
    if (w.needs.length > 0) (base as any).needs = w.needs;
    if (w.unresolvedNeeds.length > 0) (base as any).unresolvedNeeds = w.unresolvedNeeds;
    return base;
  });
  writeJson(response, 201, { tentacleId, parentTerminalId, workers: workerResponse }, corsOrigin);
  return true;
};
