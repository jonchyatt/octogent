import type { IncomingMessage } from "node:http";

import type { MonitorConfigPatchInput } from "../monitor";
import {
  type PersistedUiState,
  type TentacleAgentProvider,
  type TentacleWorkspaceMode,
  isTentacleAgentProvider,
  isTentacleCompletionSound,
} from "../terminalRuntime";

export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export class RequestBodyTooLargeError extends Error {}

export const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  let totalBytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const nextChunk = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += nextChunk.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new RequestBodyTooLargeError("Request body too large.");
    }
    chunks.push(nextChunk);
  }

  const payload = Buffer.concat(chunks).toString("utf8").trim();
  if (payload.length === 0) {
    return null;
  }

  return JSON.parse(payload);
};

export const parseTentacleName = (payload: unknown) => {
  if (payload === null || payload === undefined) {
    return {
      provided: false,
      name: undefined as string | undefined,
      error: null as string | null,
    };
  }

  if (typeof payload !== "object") {
    return {
      provided: true,
      name: undefined as string | undefined,
      error: "Expected a JSON object body.",
    };
  }

  const rawName = (payload as Record<string, unknown>).name;
  if (rawName === undefined) {
    return {
      provided: false,
      name: undefined as string | undefined,
      error: null as string | null,
    };
  }

  if (typeof rawName !== "string") {
    return {
      provided: true,
      name: undefined as string | undefined,
      error: "Tentacle name must be a string.",
    };
  }

  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    return {
      provided: true,
      name: undefined as string | undefined,
      error: "Tentacle name cannot be empty.",
    };
  }

  return {
    provided: true,
    name: trimmed,
    error: null as string | null,
  };
};

export const parseTentacleWorkspaceMode = (payload: unknown) => {
  if (payload === null || payload === undefined) {
    return {
      workspaceMode: "shared" as TentacleWorkspaceMode,
      error: null as string | null,
    };
  }

  if (typeof payload !== "object") {
    return {
      workspaceMode: "shared" as TentacleWorkspaceMode,
      error: "Expected a JSON object body.",
    };
  }

  const rawWorkspaceMode = (payload as Record<string, unknown>).workspaceMode;
  if (rawWorkspaceMode === undefined) {
    return {
      workspaceMode: "shared" as TentacleWorkspaceMode,
      error: null as string | null,
    };
  }

  if (rawWorkspaceMode !== "shared" && rawWorkspaceMode !== "worktree") {
    return {
      workspaceMode: "shared" as TentacleWorkspaceMode,
      error: "Tentacle workspace mode must be either 'shared' or 'worktree'.",
    };
  }

  return {
    workspaceMode: rawWorkspaceMode as TentacleWorkspaceMode,
    error: null as string | null,
  };
};

export const parseTentacleAgentProvider = (payload: unknown) => {
  if (payload === null || payload === undefined) {
    return {
      agentProvider: undefined as TentacleAgentProvider | undefined,
      error: null as string | null,
    };
  }

  if (typeof payload !== "object") {
    return {
      agentProvider: undefined as TentacleAgentProvider | undefined,
      error: "Expected a JSON object body.",
    };
  }

  const rawAgentProvider = (payload as Record<string, unknown>).agentProvider;
  if (rawAgentProvider === undefined) {
    return {
      agentProvider: undefined as TentacleAgentProvider | undefined,
      error: null as string | null,
    };
  }

  if (!isTentacleAgentProvider(rawAgentProvider)) {
    return {
      agentProvider: undefined as TentacleAgentProvider | undefined,
      error: "Tentacle agent provider must be either 'codex' or 'claude-code'.",
    };
  }

  return {
    agentProvider: rawAgentProvider,
    error: null as string | null,
  };
};

export const parseTentacleCommitMessage = (
  payload: unknown,
): { message: string | null; error: string | null } => {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return {
      message: null,
      error: "Expected a JSON object body.",
    };
  }

  const rawMessage = (payload as Record<string, unknown>).message;
  if (typeof rawMessage !== "string") {
    return {
      message: null,
      error: "Commit message must be a string.",
    };
  }

  const trimmed = rawMessage.trim();
  if (trimmed.length === 0) {
    return {
      message: null,
      error: "Commit message cannot be empty.",
    };
  }

  return {
    message: trimmed,
    error: null,
  };
};

export const parseTentacleSyncBaseRef = (
  payload: unknown,
): { baseRef: string | null; error: string | null } => {
  if (payload === null || payload === undefined) {
    return {
      baseRef: null,
      error: null,
    };
  }

  if (typeof payload !== "object") {
    return {
      baseRef: null,
      error: "Expected a JSON object body.",
    };
  }

  const rawBaseRef = (payload as Record<string, unknown>).baseRef;
  if (rawBaseRef === undefined) {
    return {
      baseRef: null,
      error: null,
    };
  }

  if (typeof rawBaseRef !== "string") {
    return {
      baseRef: null,
      error: "baseRef must be a string.",
    };
  }

  const trimmed = rawBaseRef.trim();
  if (trimmed.length === 0) {
    return {
      baseRef: null,
      error: "baseRef cannot be empty.",
    };
  }

  return {
    baseRef: trimmed,
    error: null,
  };
};

export const parseTentaclePullRequestCreateInput = (
  payload: unknown,
): {
  title: string | null;
  body: string;
  baseRef: string | null;
  error: string | null;
} => {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return {
      title: null,
      body: "",
      baseRef: null,
      error: "Expected a JSON object body.",
    };
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.title !== "string" || record.title.trim().length === 0) {
    return {
      title: null,
      body: "",
      baseRef: null,
      error: "Pull request title cannot be empty.",
    };
  }

  if (record.body !== undefined && typeof record.body !== "string") {
    return {
      title: null,
      body: "",
      baseRef: null,
      error: "Pull request body must be a string.",
    };
  }

  if (record.baseRef !== undefined && typeof record.baseRef !== "string") {
    return {
      title: null,
      body: "",
      baseRef: null,
      error: "Pull request baseRef must be a string.",
    };
  }

  const normalizedBaseRef = typeof record.baseRef === "string" ? record.baseRef.trim() : "";
  if (record.baseRef !== undefined && normalizedBaseRef.length === 0) {
    return {
      title: null,
      body: "",
      baseRef: null,
      error: "Pull request baseRef cannot be empty.",
    };
  }

  return {
    title: record.title.trim(),
    body: typeof record.body === "string" ? record.body : "",
    baseRef: normalizedBaseRef.length > 0 ? normalizedBaseRef : null,
    error: null,
  };
};

export const parseTentacleAgentCreateInput = (
  payload: unknown,
): {
  anchorAgentId: string | null;
  placement: "up" | "down" | null;
  error: string | null;
} => {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return {
      anchorAgentId: null,
      placement: null,
      error: "Expected a JSON object body.",
    };
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.anchorAgentId !== "string" || record.anchorAgentId.trim().length === 0) {
    return {
      anchorAgentId: null,
      placement: null,
      error: "anchorAgentId must be a non-empty string.",
    };
  }

  if (record.placement !== "up" && record.placement !== "down") {
    return {
      anchorAgentId: null,
      placement: null,
      error: "placement must be either 'up' or 'down'.",
    };
  }

  return {
    anchorAgentId: record.anchorAgentId.trim(),
    placement: record.placement,
    error: null,
  };
};

export const parseUiStatePatch = (
  payload: unknown,
): { patch: PersistedUiState | null; error: string | null } => {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return {
      patch: null,
      error: "Expected a JSON object body.",
    };
  }

  const record = payload as Record<string, unknown>;
  const patch: PersistedUiState = {};

  if (record.activePrimaryNav !== undefined) {
    if (
      typeof record.activePrimaryNav !== "number" ||
      !Number.isInteger(record.activePrimaryNav) ||
      record.activePrimaryNav < 1
    ) {
      return {
        patch: null,
        error: "activePrimaryNav must be a positive integer.",
      };
    }
    patch.activePrimaryNav = record.activePrimaryNav;
  }

  if (record.isAgentsSidebarVisible !== undefined) {
    if (typeof record.isAgentsSidebarVisible !== "boolean") {
      return {
        patch: null,
        error: "isAgentsSidebarVisible must be a boolean.",
      };
    }
    patch.isAgentsSidebarVisible = record.isAgentsSidebarVisible;
  }

  if (record.sidebarWidth !== undefined) {
    if (typeof record.sidebarWidth !== "number" || !Number.isFinite(record.sidebarWidth)) {
      return {
        patch: null,
        error: "sidebarWidth must be a finite number.",
      };
    }
    patch.sidebarWidth = record.sidebarWidth;
  }

  if (record.isActiveAgentsSectionExpanded !== undefined) {
    if (typeof record.isActiveAgentsSectionExpanded !== "boolean") {
      return {
        patch: null,
        error: "isActiveAgentsSectionExpanded must be a boolean.",
      };
    }
    patch.isActiveAgentsSectionExpanded = record.isActiveAgentsSectionExpanded;
  }

  if (record.isRuntimeStatusStripVisible !== undefined) {
    if (typeof record.isRuntimeStatusStripVisible !== "boolean") {
      return {
        patch: null,
        error: "isRuntimeStatusStripVisible must be a boolean.",
      };
    }
    patch.isRuntimeStatusStripVisible = record.isRuntimeStatusStripVisible;
  }

  if (record.isMonitorVisible !== undefined) {
    if (typeof record.isMonitorVisible !== "boolean") {
      return {
        patch: null,
        error: "isMonitorVisible must be a boolean.",
      };
    }
    patch.isMonitorVisible = record.isMonitorVisible;
  }

  if (record.isBottomTelemetryVisible !== undefined) {
    if (typeof record.isBottomTelemetryVisible !== "boolean") {
      return {
        patch: null,
        error: "isBottomTelemetryVisible must be a boolean.",
      };
    }
    patch.isBottomTelemetryVisible = record.isBottomTelemetryVisible;
  }

  if (record.isCodexUsageVisible !== undefined) {
    if (typeof record.isCodexUsageVisible !== "boolean") {
      return {
        patch: null,
        error: "isCodexUsageVisible must be a boolean.",
      };
    }
    patch.isCodexUsageVisible = record.isCodexUsageVisible;
  }

  if (record.isClaudeUsageVisible !== undefined) {
    if (typeof record.isClaudeUsageVisible !== "boolean") {
      return {
        patch: null,
        error: "isClaudeUsageVisible must be a boolean.",
      };
    }
    patch.isClaudeUsageVisible = record.isClaudeUsageVisible;
  }

  if (record.isClaudeUsageSectionExpanded !== undefined) {
    if (typeof record.isClaudeUsageSectionExpanded !== "boolean") {
      return {
        patch: null,
        error: "isClaudeUsageSectionExpanded must be a boolean.",
      };
    }
    patch.isClaudeUsageSectionExpanded = record.isClaudeUsageSectionExpanded;
  }

  if (record.isCodexUsageSectionExpanded !== undefined) {
    if (typeof record.isCodexUsageSectionExpanded !== "boolean") {
      return {
        patch: null,
        error: "isCodexUsageSectionExpanded must be a boolean.",
      };
    }
    patch.isCodexUsageSectionExpanded = record.isCodexUsageSectionExpanded;
  }

  if (record.tentacleCompletionSound !== undefined) {
    if (!isTentacleCompletionSound(record.tentacleCompletionSound)) {
      return {
        patch: null,
        error: "tentacleCompletionSound must be one of the supported sound identifiers.",
      };
    }
    patch.tentacleCompletionSound = record.tentacleCompletionSound;
  }

  if (record.minimizedTentacleIds !== undefined) {
    if (!Array.isArray(record.minimizedTentacleIds)) {
      return {
        patch: null,
        error: "minimizedTentacleIds must be an array of strings.",
      };
    }

    const minimizedTentacleIds = record.minimizedTentacleIds.filter(
      (tentacleId): tentacleId is string => typeof tentacleId === "string",
    );
    if (minimizedTentacleIds.length !== record.minimizedTentacleIds.length) {
      return {
        patch: null,
        error: "minimizedTentacleIds must be an array of strings.",
      };
    }
    patch.minimizedTentacleIds = [...new Set(minimizedTentacleIds)];
  }

  if (record.tentacleWidths !== undefined) {
    if (
      record.tentacleWidths === null ||
      typeof record.tentacleWidths !== "object" ||
      Array.isArray(record.tentacleWidths)
    ) {
      return {
        patch: null,
        error: "tentacleWidths must be an object map of numbers.",
      };
    }

    const tentacleWidths = Object.entries(record.tentacleWidths).reduce<Record<string, number>>(
      (acc, [tentacleId, width]) => {
        if (typeof width === "number" && Number.isFinite(width)) {
          acc[tentacleId] = width;
        }
        return acc;
      },
      {},
    );
    if (Object.keys(tentacleWidths).length !== Object.keys(record.tentacleWidths).length) {
      return {
        patch: null,
        error: "tentacleWidths must be an object map of numbers.",
      };
    }
    patch.tentacleWidths = tentacleWidths;
  }

  return { patch, error: null };
};

export const parseMonitorConfigPatch = (
  payload: unknown,
): { patch: MonitorConfigPatchInput | null; error: string | null } => {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return {
      patch: null,
      error: "Expected a JSON object body.",
    };
  }

  const record = payload as Record<string, unknown>;
  const patch: MonitorConfigPatchInput = {};

  if (record.providerId !== undefined) {
    if (record.providerId !== "x") {
      return {
        patch: null,
        error: "providerId must be 'x'.",
      };
    }

    patch.providerId = "x";
  }

  if (record.queryTerms !== undefined) {
    if (!Array.isArray(record.queryTerms)) {
      return {
        patch: null,
        error: "queryTerms must be an array of strings.",
      };
    }

    const queryTerms = record.queryTerms.filter((term): term is string => typeof term === "string");
    if (queryTerms.length !== record.queryTerms.length) {
      return {
        patch: null,
        error: "queryTerms must be an array of strings.",
      };
    }

    patch.queryTerms = queryTerms;
  }

  if (record.refreshPolicy !== undefined) {
    if (
      record.refreshPolicy === null ||
      typeof record.refreshPolicy !== "object" ||
      Array.isArray(record.refreshPolicy)
    ) {
      return {
        patch: null,
        error: "refreshPolicy must be an object.",
      };
    }

    const refreshPolicyRecord = record.refreshPolicy as Record<string, unknown>;
    if (
      refreshPolicyRecord.maxCacheAgeMs !== undefined &&
      (typeof refreshPolicyRecord.maxCacheAgeMs !== "number" ||
        !Number.isFinite(refreshPolicyRecord.maxCacheAgeMs) ||
        refreshPolicyRecord.maxCacheAgeMs <= 0)
    ) {
      return {
        patch: null,
        error: "refreshPolicy.maxCacheAgeMs must be a positive number.",
      };
    }

    if (
      refreshPolicyRecord.maxPosts !== undefined &&
      (typeof refreshPolicyRecord.maxPosts !== "number" ||
        !Number.isFinite(refreshPolicyRecord.maxPosts) ||
        refreshPolicyRecord.maxPosts <= 0)
    ) {
      return {
        patch: null,
        error: "refreshPolicy.maxPosts must be a positive number.",
      };
    }

    if (
      refreshPolicyRecord.searchWindowDays !== undefined &&
      (typeof refreshPolicyRecord.searchWindowDays !== "number" ||
        !Number.isFinite(refreshPolicyRecord.searchWindowDays) ||
        ![1, 3, 7].includes(Math.floor(refreshPolicyRecord.searchWindowDays)))
    ) {
      return {
        patch: null,
        error: "refreshPolicy.searchWindowDays must be one of: 1, 3, 7.",
      };
    }

    patch.refreshPolicy = {};
    if (refreshPolicyRecord.maxCacheAgeMs !== undefined) {
      patch.refreshPolicy.maxCacheAgeMs = refreshPolicyRecord.maxCacheAgeMs;
    }
    if (refreshPolicyRecord.maxPosts !== undefined) {
      patch.refreshPolicy.maxPosts = refreshPolicyRecord.maxPosts;
    }
    if (refreshPolicyRecord.searchWindowDays !== undefined) {
      patch.refreshPolicy.searchWindowDays = Math.floor(refreshPolicyRecord.searchWindowDays) as
        | 1
        | 3
        | 7;
    }
  }

  if (record.credentials !== undefined) {
    if (
      record.credentials === null ||
      typeof record.credentials !== "object" ||
      Array.isArray(record.credentials)
    ) {
      return {
        patch: null,
        error: "credentials must be an object.",
      };
    }

    patch.credentials = record.credentials;
  }

  if (record.validateCredentials !== undefined) {
    if (typeof record.validateCredentials !== "boolean") {
      return {
        patch: null,
        error: "validateCredentials must be a boolean.",
      };
    }

    patch.validateCredentials = record.validateCredentials;
  }

  return { patch, error: null };
};
