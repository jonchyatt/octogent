import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { logVerbose } from "../logging";
import { parseClaudeTranscript } from "./claudeTranscript";
import { storeClaudeTranscriptTurns } from "./conversations";
import {
  CONTEXT_BURN_PROMPT_TEXT,
  CONTEXT_BURN_PROMPT,
  HANDOFF_AUTO_COMPACT_PERCENT,
  HANDOFF_SLASH_COMMAND_BODY,
  HANDOFF_SLASH_COMMAND_FILENAME,
} from "./handoffTemplate";
import { broadcastMessage } from "./protocol";
import type { PersistedTerminal, TerminalSession } from "./types";

const MAX_AUTO_NAME_LENGTH = 50;

type HandoffTracker = {
  burnFired: boolean;
};

type HookResult = {
  ok: boolean;
  decision?: "block";
  reason?: string;
};

const deriveTerminalNameFromPrompt = (prompt: string): string => {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_AUTO_NAME_LENGTH) {
    return normalized;
  }

  // Truncate at the last space before the limit to avoid cutting mid-word.
  const truncated = normalized.slice(0, MAX_AUTO_NAME_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 0 ? `${truncated.slice(0, lastSpace)}…` : `${truncated}…`;
};

export const createHookProcessor = (deps: {
  terminals: Map<string, PersistedTerminal>;
  sessions: Map<string, TerminalSession>;
  transcriptDirectoryPath: string;
  getApiBaseUrl: () => string;
  persistRegistry: () => void;
  deliverChannelMessages: (terminalId: string) => number;
  releaseSessionKeepAlive: (terminalId: string) => boolean;
  // Phase 10.5.2 — used to inject the synthetic context-burn message into
  // the worker's PTY when PreCompact fires or the turn threshold is crossed.
  // Optional for backwards compatibility; when absent, the burn injection is
  // skipped and only the slash command + spawn-time preamble paths run.
  writeInput?: (terminalId: string, data: string) => boolean;
  onStateChange?: (
    terminalId: string,
    state: TerminalSession["agentState"],
    toolName?: string,
  ) => void;
}) => {
  const {
    terminals,
    sessions,
    transcriptDirectoryPath,
    getApiBaseUrl,
    persistRegistry,
    deliverChannelMessages,
    releaseSessionKeepAlive,
    writeInput,
    onStateChange,
  } = deps;

  const handoffTrackers = new Map<string, HandoffTracker>();

  const getHandoffTracker = (sessionId: string): HandoffTracker => {
    let tracker = handoffTrackers.get(sessionId);
    if (!tracker) {
      tracker = { burnFired: false };
      handoffTrackers.set(sessionId, tracker);
    }
    return tracker;
  };

  /**
   * Inject the context-burn synthetic prompt into the worker's PTY exactly
   * once per session. The `burnFired` flag prevents duplicate injection
   * when Claude retries or multiple hook sources fire.
   *
   * Returns true if the injection landed, false otherwise (no writeInput
   * dep wired, no live session, or already fired).
   */
  const fireContextBurnInjection = (sessionId: string, source: string): boolean => {
    const tracker = getHandoffTracker(sessionId);
    if (tracker.burnFired) {
      logVerbose(`[Handoff] burn already fired for ${sessionId} (source=${source}) — skipping`);
      return false;
    }

    if (!writeInput) {
      logVerbose(
        `[Handoff] writeInput dep not wired — context-burn injection skipped (source=${source})`,
      );
      return false;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      logVerbose(`[Handoff] no live session for ${sessionId} — burn injection skipped`);
      return false;
    }

    const wrote = writeInput(sessionId, CONTEXT_BURN_PROMPT);
    if (!wrote) {
      logVerbose(`[Handoff] writeInput refused burn message for ${sessionId} — not marking fired`);
      return false;
    }

    tracker.burnFired = true;
    logVerbose(`[Handoff] context-burn injected for ${sessionId} (source=${source})`);
    return true;
  };

  const mergeEnvSettings = (
    existingValue: unknown,
    nextEntries: Record<string, string>,
  ): Record<string, string> => {
    const nextEnv: Record<string, string> = {};
    if (existingValue && typeof existingValue === "object" && !Array.isArray(existingValue)) {
      for (const [key, value] of Object.entries(existingValue as Record<string, unknown>)) {
        if (typeof value === "string") {
          nextEnv[key] = value;
        }
      }
    }

    for (const [key, value] of Object.entries(nextEntries)) {
      nextEnv[key] = value;
    }

    return nextEnv;
  };

  const parseSettingsObject = (fileContents: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(fileContents) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const mergeHookEntries = (
    existingValue: unknown,
    eventName: string,
    nextEntries: unknown[],
  ): Record<string, unknown> => {
    const nextHooks =
      existingValue && typeof existingValue === "object" && !Array.isArray(existingValue)
        ? { ...(existingValue as Record<string, unknown>) }
        : {};
    const existingEntries = Array.isArray(nextHooks[eventName])
      ? [...(nextHooks[eventName] as unknown[])]
      : [];
    const mergedEntries = [...existingEntries];

    for (const nextEntry of nextEntries) {
      const serializedNextEntry = JSON.stringify(nextEntry);
      const alreadyPresent = existingEntries.some(
        (existingEntry) => JSON.stringify(existingEntry) === serializedNextEntry,
      );
      if (!alreadyPresent) {
        mergedEntries.push(nextEntry);
      }
    }

    nextHooks[eventName] = mergedEntries;
    return nextHooks;
  };

  const installHooksInDirectory = (targetCwd: string) => {
    const targetClaudeDir = join(targetCwd, ".claude");
    const targetSettingsPath = join(targetClaudeDir, "settings.json");
    const targetCommandsDir = join(targetClaudeDir, "commands");
    const targetHandoffCommandPath = join(targetCommandsDir, HANDOFF_SLASH_COMMAND_FILENAME);
    const apiBaseUrl = getApiBaseUrl();

    const hooksConfig = {
      hooks: {
        SessionStart: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "${apiBaseUrl}/api/hooks/session-start?octogent_session=$OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 5,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "${apiBaseUrl}/api/hooks/user-prompt-submit?octogent_session=$OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 5,
              },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              {
                type: "http",
                url: `${apiBaseUrl}/api/hooks/pre-tool-use`,
                headers: { "X-Octogent-Session": "$OCTOGENT_SESSION_ID" },
                allowedEnvVars: ["OCTOGENT_SESSION_ID"],
                timeout: 5,
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [
              {
                type: "http",
                url: `${apiBaseUrl}/api/code-intel/events`,
                headers: { "X-Octogent-Session": "$OCTOGENT_SESSION_ID" },
                allowedEnvVars: ["OCTOGENT_SESSION_ID"],
                timeout: 5,
              },
            ],
          },
        ],
        Notification: [
          {
            matcher: "*",
            hooks: [
              {
                type: "http",
                url: `${apiBaseUrl}/api/hooks/notification`,
                headers: { "X-Octogent-Session": "$OCTOGENT_SESSION_ID" },
                allowedEnvVars: ["OCTOGENT_SESSION_ID"],
                timeout: 5,
              },
            ],
          },
        ],
        Stop: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "${apiBaseUrl}/api/hooks/stop?octogent_session=$OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 15,
              },
            ],
          },
        ],
        // Phase 10.5.2 — context-burn signal. The installed env below moves
        // Claude Code auto-compact to ~30% context used, then this hook asks
        // Claude to hand off and exits by normal turn completion.
        PreCompact: [
          {
            matcher: "auto",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "${apiBaseUrl}/api/hooks/pre-compact?octogent_session=$OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 5,
              },
            ],
          },
        ],
      },
    };

    try {
      mkdirSync(targetClaudeDir, { recursive: true });

      // Phase 10.5.2 — install /handoff slash command. Always overwrite so
      // the worker picks up template updates on its next spawn. The body is
      // small + idempotent; cheap to rewrite every time.
      try {
        mkdirSync(targetCommandsDir, { recursive: true });
        writeFileSync(targetHandoffCommandPath, HANDOFF_SLASH_COMMAND_BODY, "utf8");
      } catch {
        // Best-effort — slash command install failure must not block the
        // rest of the hook installation. The PreCompact hook + spawn
        // preamble paths still work without the slash command.
      }

      const existingSettings = existsSync(targetSettingsPath)
        ? parseSettingsObject(readFileSync(targetSettingsPath, "utf8"))
        : null;
      const mergedSettings =
        existingSettings && typeof existingSettings === "object" ? { ...existingSettings } : {};

      let mergedHooks =
        mergedSettings.hooks &&
        typeof mergedSettings.hooks === "object" &&
        !Array.isArray(mergedSettings.hooks)
          ? { ...(mergedSettings.hooks as Record<string, unknown>) }
          : {};

      for (const [eventName, eventEntries] of Object.entries(hooksConfig.hooks)) {
        mergedHooks = mergeHookEntries(mergedHooks, eventName, eventEntries);
      }

      mergedSettings.hooks = mergedHooks;
      mergedSettings.env = mergeEnvSettings(mergedSettings.env, {
        CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: HANDOFF_AUTO_COMPACT_PERCENT,
      });
      writeFileSync(targetSettingsPath, `${JSON.stringify(mergedSettings, null, 2)}\n`, "utf8");
    } catch {
      // Best-effort
    }
  };

  const handleHook = (
    hookName: string,
    payload: unknown,
    octogentSessionId?: string,
  ): HookResult => {
    logVerbose(
      `[Hook] Received hook: ${hookName} octogentSession=${octogentSessionId ?? "(none)"}`,
    );

    if (!payload || typeof payload !== "object") {
      return { ok: true };
    }

    const hookPayloadRecord = payload as Record<string, unknown>;

    if (hookName === "session-start") {
      if (octogentSessionId) {
        handoffTrackers.delete(octogentSessionId);
      }
      return { ok: true };
    }

    if (hookName === "pre-compact") {
      if (!octogentSessionId) {
        return { ok: true };
      }

      const injected = fireContextBurnInjection(octogentSessionId, "pre-compact");
      if (!injected) {
        return { ok: true };
      }

      return {
        ok: true,
        decision: "block",
        reason: CONTEXT_BURN_PROMPT_TEXT,
      };
    }

    if (hookName === "notification") {
      if (!octogentSessionId) {
        return { ok: true };
      }
      const session = sessions.get(octogentSessionId);
      if (!session) {
        logVerbose(`[Hook] notification: no session for ${octogentSessionId}, skipping.`);
        return { ok: true };
      }

      const notificationType =
        typeof hookPayloadRecord.notification_type === "string"
          ? hookPayloadRecord.notification_type
          : null;

      logVerbose(`[Hook] notification: type=${notificationType} session=${octogentSessionId}`);

      if (notificationType === "permission_prompt") {
        session.agentState = "waiting_for_permission";
        session.stateTracker.forceState("waiting_for_permission");
        onStateChange?.(octogentSessionId, "waiting_for_permission", session.lastToolName);
        broadcastMessage(session, {
          type: "state",
          state: "waiting_for_permission",
          ...(session.lastToolName ? { toolName: session.lastToolName } : {}),
        });
      } else if (notificationType === "idle_prompt") {
        session.agentState = "idle";
        session.stateTracker.forceState("idle");
        onStateChange?.(octogentSessionId, "idle");
        broadcastMessage(session, { type: "state", state: "idle" });

        // Deliver any queued channel messages now that the agent is idle.
        deliverChannelMessages(octogentSessionId);
      }

      return { ok: true };
    }

    if (hookName === "pre-tool-use") {
      if (!octogentSessionId) {
        return { ok: true };
      }
      const session = sessions.get(octogentSessionId);
      if (!session) {
        return { ok: true };
      }

      const toolName =
        typeof hookPayloadRecord.tool_name === "string" ? hookPayloadRecord.tool_name : null;

      logVerbose(`[Hook] pre-tool-use: tool=${toolName} session=${octogentSessionId}`);

      if (toolName) {
        session.lastToolName = toolName;
      }

      if (toolName === "AskUserQuestion") {
        session.agentState = "waiting_for_user";
        session.stateTracker.forceState("waiting_for_user");
        onStateChange?.(octogentSessionId, "waiting_for_user");
        broadcastMessage(session, { type: "state", state: "waiting_for_user" });
      }

      return { ok: true };
    }

    if (hookName === "user-prompt-submit") {
      if (!octogentSessionId) {
        return { ok: true };
      }

      const terminal = terminals.get(octogentSessionId);
      if (!terminal) {
        return { ok: true };
      }

      // Update last-active timestamp (determines active/inactive on the canvas).
      terminal.lastActiveAt = new Date().toISOString();

      // The user submitted a prompt, so the agent is about to start processing.
      // Transition state out of waiting/idle to processing immediately.
      const activitySession = sessions.get(terminal.terminalId);
      if (activitySession) {
        activitySession.agentState = "processing";
        activitySession.lastToolName = undefined;
        activitySession.stateTracker.forceState("processing");
        onStateChange?.(terminal.terminalId, "processing");
        broadcastMessage(activitySession, { type: "state", state: "processing" });
        broadcastMessage(activitySession, { type: "activity" });
      }

      // Auto-name the terminal from the first prompt when it still has its default name.
      if (terminal.nameOrigin === "generated") {
        const prompt =
          typeof hookPayloadRecord.prompt === "string" ? hookPayloadRecord.prompt.trim() : "";
        const renameContext = terminal.autoRenamePromptContext?.trim() || prompt;
        if (renameContext.length > 0) {
          const derived = deriveTerminalNameFromPrompt(renameContext);
          terminal.tentacleName = derived;
          terminal.nameOrigin = "prompt";
          terminal.autoRenamePromptContext = undefined;
          logVerbose(`[Hook] Auto-named terminal ${terminal.terminalId} → "${derived}"`);

          const session = sessions.get(terminal.terminalId);
          if (session) {
            broadcastMessage(session, { type: "rename", tentacleName: derived });
          }
        }
      }

      persistRegistry();
      return { ok: true };
    }

    if (hookName !== "stop") {
      return { ok: true };
    }

    const hookPayload = payload as Record<string, unknown>;
    const transcriptPath =
      typeof hookPayload.transcript_path === "string" ? hookPayload.transcript_path : null;
    const hookCwd = typeof hookPayload.cwd === "string" ? hookPayload.cwd : null;

    logVerbose(`[Hook] Stop hook: transcriptPath=${transcriptPath}, hookCwd=${hookCwd}`);

    if (!transcriptPath || !hookCwd) {
      logVerbose("[Hook] Missing transcriptPath or hookCwd, skipping.");
      return { ok: true };
    }

    let matchedSessionId: string | null = null;

    if (octogentSessionId && sessions.has(octogentSessionId)) {
      matchedSessionId = octogentSessionId;
      logVerbose(`[Hook] Matched session by octogent_session param: ${matchedSessionId}`);
    } else if (octogentSessionId) {
      logVerbose(
        `[Hook] octogent_session=${octogentSessionId} not found in active sessions, skipping.`,
      );
      return { ok: true };
    } else {
      logVerbose("[Hook] No octogent_session param — ignoring hook from external Claude session.");
      return { ok: true };
    }

    logVerbose(`[Hook] Matched session: ${matchedSessionId}, parsing transcript...`);
    const turns = parseClaudeTranscript(transcriptPath);
    logVerbose(`[Hook] Parsed ${turns?.length ?? 0} turns from transcript.`);

    const lastAssistantMessage =
      typeof hookPayload.last_assistant_message === "string"
        ? hookPayload.last_assistant_message.trim()
        : null;

    if (lastAssistantMessage && lastAssistantMessage.length > 0) {
      const effectiveTurns = turns ?? [];
      const lastTurn = effectiveTurns.length > 0 ? effectiveTurns[effectiveTurns.length - 1] : null;

      if (!lastTurn || lastTurn.role !== "assistant" || lastTurn.content !== lastAssistantMessage) {
        const now = new Date().toISOString();
        effectiveTurns.push({
          turnId: `turn-${effectiveTurns.length + 1}`,
          role: "assistant",
          content: lastAssistantMessage,
          startedAt: now,
          endedAt: now,
        });
        logVerbose("[Hook] Appended last_assistant_message as final turn.");
      }

      if (effectiveTurns.length > 0) {
        storeClaudeTranscriptTurns(transcriptDirectoryPath, matchedSessionId, effectiveTurns);
        logVerbose(`[Hook] Stored ${effectiveTurns.length} turns for session ${matchedSessionId}.`);
      }
    } else if (turns && turns.length > 0) {
      storeClaudeTranscriptTurns(transcriptDirectoryPath, matchedSessionId, turns);
      logVerbose(`[Hook] Stored ${turns.length} turns for session ${matchedSessionId}.`);
    }

    // Deliver any queued channel messages now that the agent is idle.
    if (matchedSessionId) {
      const deliveredMessageCount = deliverChannelMessages(matchedSessionId);
      if (deliveredMessageCount === 0) {
        releaseSessionKeepAlive(matchedSessionId);
      }
    }

    return { ok: true };
  };

  return { handleHook, installHooksInDirectory };
};
