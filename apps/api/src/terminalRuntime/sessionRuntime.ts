import { type WriteStream, createWriteStream, existsSync, mkdirSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";

import { type IPty, spawn } from "node-pty";
import type { WebSocket, WebSocketServer } from "ws";

import { type AgentRuntimeState, AgentStateTracker } from "../agentStateDetection";
import {
  DEFAULT_AGENT_PROVIDER,
  TERMINAL_BOOTSTRAP_COMMANDS,
  TERMINAL_EXEC_TIMEOUT_MS,
  TERMINAL_MAX_CONCURRENT_SESSIONS,
  TERMINAL_SCROLLBACK_MAX_BYTES,
  TERMINAL_SESSION_IDLE_GRACE_MS,
  TERMINAL_STUCK_DEAD_MS,
  TERMINAL_STUCK_POLL_INTERVAL_MS,
  TERMINAL_STUCK_THRESHOLD_MS,
  TERMINAL_STUCK_TIER2_MS,
  buildProviderEnvironmentOverrides,
  buildExecCommand,
  buildResumeCommand,
  resolveAgentProvider,
} from "./constants";
import { spawnExecChild } from "./execSessionAdapter";
import {
  type StuckDetectionThresholds,
  type StuckEscalationExhausted,
  type StuckTier,
  createStuckDetector,
} from "./stuckDetection";
import {
  type ConversationTranscriptEvent,
  type ConversationTranscriptEventPayload,
  type SessionEndTranscriptEvent,
  ensureTranscriptDirectory,
  transcriptFilenameForSession,
} from "./conversations";
import { broadcastMessage, getTerminalId, sendMessage } from "./protocol";
import { createShellEnvironment, ensureNodePtySpawnHelperExecutable } from "./ptyEnvironment";
import { toErrorMessage } from "./systemClients";
import type {
  DirectSessionListener,
  PersistedTerminal,
  TerminalProcessHandle,
  TerminalSession,
  TerminalSessionEndDetails,
  TerminalSessionStartDetails,
} from "./types";

type CreateSessionRuntimeOptions = {
  websocketServer: WebSocketServer;
  terminals: Map<string, PersistedTerminal>;
  sessions: Map<string, TerminalSession>;
  resolveTerminalSession?: (terminalId: string) => {
    sessionId: string;
    tentacleId: string;
  } | null;
  getTentacleWorkspaceCwd: (tentacleId: string) => string;
  // Phase 10.5.2 — resolve the per-tentacle handoff directory so the runtime
  // can inject OCTOGENT_HANDOFF_DIR into the worker's PTY environment. The
  // implementation MUST mkdir -p the directory before returning; the worker's
  // /handoff slash command will write into it without re-creating it.
  // Optional for backwards compatibility — when absent, OCTOGENT_HANDOFF_DIR
  // is omitted from the env and the slash command falls back to its
  // `.octogent/handoffs/` cwd-relative default.
  getTentacleHandoffDir?: (tentacleId: string) => string;
  isDebugPtyLogsEnabled: boolean;
  ptyLogDir: string;
  transcriptDirectoryPath: string;
  // Where exec-mode workers write their durable artifacts:
  //   <execOutputDirectoryPath>/<sessionId>.json — codex --output-last-message
  //   <execOutputDirectoryPath>/<sessionId>.log  — streamed stdout/stderr
  execOutputDirectoryPath: string;
  sessionIdleGraceMs?: number;
  scrollbackMaxBytes?: number;
  maxConcurrentSessions?: number;
  execTimeoutMs?: number;
  /** Stuck-detection thresholds (Phase 10.8.6). Override for tests. */
  stuckDetection?: {
    tier1Ms?: number;
    tier2Ms?: number;
    deadMs?: number;
    /**
     * Poll interval in ms. Set to 0 to disable the wall-clock timer
     * entirely (tests drive runStuckCheckNow manually).
     */
    pollIntervalMs?: number;
  };
  /**
   * Send an @system channel message to the stuck terminal. Wire to
   * channelMessaging.sendSystemChannelMessage(toTerminalId, content).
   * Stuck detection is a no-op if this is omitted.
   */
  sendSystemChannelMessage?: (terminalId: string, content: string) => void;
  /**
   * Produce the TIER_2 replan summary for a stuck terminal. Short text
   * (few hundred chars). Called from the poller only on TIER_2 entry.
   * Omitting this yields "(summary unavailable)".
   */
  composeStuckSummary?: (terminalId: string) => string;
  /**
   * Persist in-memory PersistedTerminal mutations (stuckTier fields).
   * Wire to the outer runtime's debounced `persistRegistry`. If omitted,
   * tier transitions are still observed via onStuckTierChange but the
   * stuckTier field won't make it to disk.
   */
  persistStuckTierChanges?: () => void;
  /**
   * Tier transition observer. `tier === undefined` means recovery to
   * HEALTHY. Used for logging / broadcast fan-out.
   */
  onStuckTierChange?: (terminalId: string, tier: StuckTier | undefined) => void;
  /**
   * DEAD threshold crossed. Caller should flip lifecycleState to "dead"
   * and fire a terminal-state-changed broadcast for operator attention.
   */
  onStuckEscalationExhausted?: (info: StuckEscalationExhausted) => void;
  onStateChange?: (terminalId: string, state: AgentRuntimeState, toolName?: string) => void;
  onSessionStart?: (terminalId: string, details: TerminalSessionStartDetails) => void;
  onSessionEnd?: (terminalId: string, details: TerminalSessionEndDetails) => void;
  /**
   * Exec-mode specific post-teardown hook. Fires BEFORE onSessionEnd for
   * terminals with runtimeMode="exec" so the coordinator can decide whether
   * to respawn the terminal before the "exited" lifecycle event broadcasts
   * (avoids exited → running UI flicker — LOW-2). Coordinator returns a
   * string that teardown uses to decide whether to suppress the subsequent
   * onSessionEnd broadcast:
   *   "respawn" — suppress onSessionEnd (next turn's onSessionStart is the
   *               next lifecycle event).
   *   "dead"    — fire onSessionEnd normally (captures endedAt/exitCode);
   *               coordinator already flipped lifecycle to "dead".
   *   "done"    — fire onSessionEnd normally (standard exit path).
   *   "skip"    — not a coordinator concern; treat as "done".
   * Ignored for interactive-mode terminals.
   */
  onExecSessionEnd?: (
    terminalId: string,
    reason: TerminalSessionEndDetails["reason"],
  ) => "respawn" | "done" | "dead" | "skip";
};

const ANSI_BEL = String.fromCharCode(0x07);
const ANSI_ESCAPE = String.fromCharCode(0x1b);
const BROKEN_OSC_TAIL_RE = new RegExp(
  `^\\][^${ANSI_BEL}${ANSI_ESCAPE}]*(?:${ANSI_BEL}|${ANSI_ESCAPE}\\\\)`,
);
const TOOL_CALL_OUTPUT_PATTERNS = [
  /"type"\s*:\s*"tool_use"/i,
  /"type"\s*:\s*"function_call"/i,
  /"tool_name"\s*:/i,
  /\btool_use\b/i,
  /\bfunction_call\b/i,
];

const looksLikeToolCallOutput = (chunk: string): boolean =>
  TOOL_CALL_OUTPUT_PATTERNS.some((pattern) => pattern.test(chunk));

export const createSessionRuntime = ({
  websocketServer,
  terminals,
  sessions,
  resolveTerminalSession,
  getTentacleWorkspaceCwd,
  getTentacleHandoffDir,
  isDebugPtyLogsEnabled,
  ptyLogDir,
  transcriptDirectoryPath,
  execOutputDirectoryPath,
  sessionIdleGraceMs = TERMINAL_SESSION_IDLE_GRACE_MS,
  scrollbackMaxBytes = TERMINAL_SCROLLBACK_MAX_BYTES,
  maxConcurrentSessions = TERMINAL_MAX_CONCURRENT_SESSIONS,
  execTimeoutMs,
  stuckDetection,
  sendSystemChannelMessage,
  composeStuckSummary,
  persistStuckTierChanges,
  onStuckTierChange,
  onStuckEscalationExhausted,
  onStateChange,
  onSessionStart,
  onSessionEnd,
  onExecSessionEnd,
}: CreateSessionRuntimeOptions) => {
  const DEFAULT_PTY_COLS = 120;
  const DEFAULT_PTY_ROWS = 35;
  const sessionLimit = Number.isFinite(maxConcurrentSessions)
    ? Math.max(1, Math.floor(maxConcurrentSessions))
    : TERMINAL_MAX_CONCURRENT_SESSIONS;
  const execTimeoutCeilingMs =
    typeof execTimeoutMs === "number" && Number.isFinite(execTimeoutMs) && execTimeoutMs > 0
      ? Math.floor(execTimeoutMs)
      : TERMINAL_EXEC_TIMEOUT_MS;

  const positiveOr = (value: number | undefined, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : fallback;
  const stuckThresholds: StuckDetectionThresholds = {
    tier1Ms: positiveOr(stuckDetection?.tier1Ms, TERMINAL_STUCK_THRESHOLD_MS),
    tier2Ms: positiveOr(stuckDetection?.tier2Ms, TERMINAL_STUCK_TIER2_MS),
    deadMs: positiveOr(stuckDetection?.deadMs, TERMINAL_STUCK_DEAD_MS),
  };
  // Poll interval uses >=0 semantics (0 disables the setInterval so tests
  // can drive the state machine manually). Env/constant default is 30s.
  const stuckPollIntervalMs = (() => {
    const requested = stuckDetection?.pollIntervalMs;
    if (typeof requested !== "number" || !Number.isFinite(requested) || requested < 0) {
      return TERMINAL_STUCK_POLL_INTERVAL_MS;
    }
    return Math.floor(requested);
  })();

  const getShellLaunch = () => {
    if (process.platform === "win32") {
      return {
        command: process.env.ComSpec ?? "cmd.exe",
        args: [],
      };
    }

    const shellFromEnvironment = process.env.SHELL?.trim();
    if (shellFromEnvironment && shellFromEnvironment.length > 0) {
      return {
        command: shellFromEnvironment,
        args: ["-i"],
      };
    }

    return {
      command: "/bin/bash",
      args: ["-i"],
    };
  };

  const createDebugLog = (sessionId: string) => {
    if (!isDebugPtyLogsEnabled) {
      return undefined;
    }

    mkdirSync(ptyLogDir, { recursive: true });
    const filename = `${sessionId}-${Date.now()}.log`;
    return createWriteStream(join(ptyLogDir, filename), {
      flags: "a",
      encoding: "utf8",
    });
  };

  const appendDebugLog = (session: TerminalSession, line: string) => {
    session.debugLog?.write(`${new Date().toISOString()} ${line}\n`);
  };

  const createTranscriptLog = (sessionId: string) => {
    ensureTranscriptDirectory(transcriptDirectoryPath);
    const filename = transcriptFilenameForSession(sessionId);
    const stream = createWriteStream(join(transcriptDirectoryPath, filename), {
      flags: "a",
      encoding: "utf8",
    });
    stream.on("error", () => {
      // Keep terminal flow alive even if transcript writes fail.
    });
    return stream;
  };

  const appendTranscriptEvent = (
    session: TerminalSession,
    sessionId: string,
    event: ConversationTranscriptEventPayload,
  ) => {
    if (!session.transcriptLog) {
      return;
    }

    const nextEventCount = (session.transcriptEventCount ?? 0) + 1;
    session.transcriptEventCount = nextEventCount;
    const payload: ConversationTranscriptEvent = {
      ...event,
      eventId: `${sessionId}:${nextEventCount}`,
      sessionId,
      tentacleId: session.tentacleId,
    } as ConversationTranscriptEvent;
    session.transcriptLog.write(`${JSON.stringify(payload)}\n`);
  };

  const closeTranscript = (
    session: TerminalSession,
    sessionId: string,
    event: ConversationTranscriptEventPayload,
  ) => {
    if (session.hasTranscriptEnded) {
      return;
    }

    appendTranscriptEvent(session, sessionId, event);
    session.hasTranscriptEnded = true;
    session.transcriptLog?.end();
    session.transcriptLog = undefined;
  };

  const emitStateIfChanged = (
    session: TerminalSession,
    sessionId: string,
    nextState: AgentRuntimeState | null,
  ) => {
    if (!nextState || nextState === session.agentState) {
      return;
    }

    session.agentState = nextState;
    appendDebugLog(session, `state-change session=${sessionId} state=${nextState}`);
    appendTranscriptEvent(session, sessionId, {
      type: "state_change",
      state: nextState,
      timestamp: new Date().toISOString(),
    });
    onStateChange?.(sessionId, nextState, session.lastToolName);
    broadcastMessage(session, {
      type: "state",
      state: nextState,
      ...(session.lastToolName ? { toolName: session.lastToolName } : {}),
    });
  };

  const resolveSession =
    resolveTerminalSession ??
    ((terminalId: string) => {
      if (!terminals.has(terminalId)) {
        return null;
      }
      const terminal = terminals.get(terminalId);
      return {
        sessionId: terminalId,
        tentacleId: terminal?.tentacleId ?? terminalId,
      };
    });

  const clearIdleCloseTimer = (session: TerminalSession) => {
    if (!session.idleCloseTimer) {
      return;
    }

    clearTimeout(session.idleCloseTimer);
    session.idleCloseTimer = undefined;
  };

  const clearPromptTimers = (session: TerminalSession) => {
    if (!session.promptTimers) {
      return;
    }

    for (const timer of session.promptTimers) {
      clearTimeout(timer);
    }
    session.promptTimers.clear();
  };

  const schedulePromptTimer = (
    session: TerminalSession,
    sessionId: string,
    callback: () => void,
    delayMs: number,
  ) => {
    const timer = setTimeout(() => {
      session.promptTimers?.delete(timer);
      if (session.isClosed || sessions.get(sessionId) !== session) {
        return;
      }

      callback();
    }, delayMs);

    if (!session.promptTimers) {
      session.promptTimers = new Set();
    }
    session.promptTimers.add(timer);
  };

  const appendScrollback = (session: TerminalSession, chunk: string) => {
    let nextChunk = chunk;
    let nextChunkBytes = Buffer.byteLength(nextChunk, "utf8");
    if (nextChunkBytes > scrollbackMaxBytes) {
      const chunkBuffer = Buffer.from(nextChunk, "utf8");
      nextChunk = chunkBuffer.subarray(chunkBuffer.length - scrollbackMaxBytes).toString("utf8");
      nextChunkBytes = Buffer.byteLength(nextChunk, "utf8");
      session.scrollbackChunks = [];
      session.scrollbackBytes = 0;
    }

    session.scrollbackChunks.push(nextChunk);
    session.scrollbackBytes += nextChunkBytes;
    while (session.scrollbackBytes > scrollbackMaxBytes && session.scrollbackChunks.length > 0) {
      const removedChunk = session.scrollbackChunks.shift();
      if (!removedChunk) {
        break;
      }

      session.scrollbackBytes -= Buffer.byteLength(removedChunk, "utf8");
    }
  };

  const stripBrokenLeadingAnsi = (text: string): string => {
    let nextText = text;

    while (nextText.length > 0) {
      if (nextText.startsWith("\u001b")) {
        return nextText;
      }

      const oscMatch = nextText.match(BROKEN_OSC_TAIL_RE);
      if (oscMatch) {
        nextText = nextText.slice(oscMatch[0].length);
        continue;
      }

      const csiTailMatch = nextText.match(/^\[[0-9:;<=>?]*[ -/]*[@-~]/);
      if (csiTailMatch) {
        nextText = nextText.slice(csiTailMatch[0].length);
        continue;
      }

      const orphanedCsiTailMatch = nextText.match(
        /^(?=[0-9:;<=>?]*[;:<=>?])[0-9:;<=>?]*[ -/]*[@-~]/,
      );
      if (orphanedCsiTailMatch) {
        nextText = nextText.slice(orphanedCsiTailMatch[0].length);
        continue;
      }

      break;
    }

    return nextText;
  };

  const sendHistory = (websocket: WebSocket, session: TerminalSession) => {
    if (session.scrollbackChunks.length === 0) {
      return;
    }

    sendMessage(websocket, {
      type: "history",
      data: stripBrokenLeadingAnsi(session.scrollbackChunks.join("")),
    });
  };

  const teardownSession = (
    sessionId: string,
    session: TerminalSession,
    event: Omit<SessionEndTranscriptEvent, "eventId" | "sessionId" | "tentacleId">,
    options: { killPty: boolean; killSignal?: string },
  ): void => {
    if (session.isClosed) {
      return;
    }

    session.isClosed = true;
    clearIdleCloseTimer(session);
    clearPromptTimers(session);
    closeTranscript(session, sessionId, event);

    const normalizedReason: TerminalSessionEndDetails["reason"] =
      event.reason === "pty_exit" ||
      event.reason === "operator_stop" ||
      event.reason === "operator_kill"
        ? event.reason
        : "session_close";
    const sessionEndDetails: TerminalSessionEndDetails = {
      reason: normalizedReason,
      endedAt: typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString(),
      ...(typeof event.exitCode === "number" ? { exitCode: event.exitCode } : {}),
      ...(typeof event.signal === "number" || typeof event.signal === "string"
        ? { signal: event.signal }
        : {}),
    };
    // For exec-mode, onSessionEnd fires AFTER onExecSessionEnd so the
    // coordinator's respawn decision can suppress the intermediate "exited"
    // broadcast (LOW-2). For interactive mode, fire onSessionEnd immediately
    // — there is no coordinator to consult.
    const terminalRecordForTeardown = terminals.get(sessionId);
    const isExecTeardown = terminalRecordForTeardown?.runtimeMode === "exec";
    if (!isExecTeardown) {
      onSessionEnd?.(sessionId, sessionEndDetails);
    }

    if (session.statePollTimer) {
      clearInterval(session.statePollTimer);
      session.statePollTimer = undefined;
    }

    for (const disposable of session.ptyDisposables ?? []) {
      try {
        disposable.dispose();
      } catch {
        // Ignore listener cleanup errors; the PTY teardown below is still required.
      }
    }
    session.ptyDisposables = [];

    if (options.killPty) {
      try {
        session.pty.kill(options.killSignal);
      } catch {
        // Ignore teardown errors; session will still be discarded.
      }
    }

    for (const client of session.clients) {
      if (client.readyState === 1) {
        client.close();
      }
    }
    session.clients.clear();
    session.directListeners.clear();
    session.debugLog?.end();
    session.debugLog = undefined;
    session.execOutputLog?.end();
    session.execOutputLog = undefined;
    if (session.execTimeoutTimer) {
      clearTimeout(session.execTimeoutTimer);
      session.execTimeoutTimer = undefined;
    }

    if (sessions.get(sessionId) === session) {
      sessions.delete(sessionId);
    }

    // Exec-mode post-teardown hook: fire AFTER the session is removed from
    // the map so the coordinator can immediately startSession for the next
    // turn without tripping the "already running" guard in ensureSession.
    // Only for exec-mode terminals — interactive teardown is terminal (no
    // auto-respawn).
    //
    // Ordering (LOW-2): coordinator runs BEFORE onSessionEnd for exec. If
    // coordinator returns "respawn", onSessionEnd is suppressed (the next
    // turn's onSessionStart is the next real lifecycle event, avoiding an
    // exited → running UI flicker). Otherwise onSessionEnd fires as normal.
    if (isExecTeardown && onExecSessionEnd) {
      const execReason: TerminalSessionEndDetails["reason"] = normalizedReason;
      let coordinatorResult: "respawn" | "done" | "dead" | "skip" = "done";
      try {
        coordinatorResult = onExecSessionEnd(sessionId, execReason);
      } catch {
        // Don't let coordinator failures bubble up into the teardown path.
        coordinatorResult = "done";
      }
      if (coordinatorResult !== "respawn") {
        onSessionEnd?.(sessionId, sessionEndDetails);
      }
    } else if (isExecTeardown) {
      // Exec mode but no coordinator wired — still fire onSessionEnd so
      // the terminal doesn't look stuck in "running" forever.
      onSessionEnd?.(sessionId, sessionEndDetails);
    }
  };

  const closeSession = (sessionId: string): boolean => {
    const session = sessions.get(sessionId);
    if (!session) {
      return false;
    }

    teardownSession(
      sessionId,
      session,
      {
        type: "session_end",
        reason: "session_close",
        timestamp: new Date().toISOString(),
      },
      { killPty: true },
    );
    return true;
  };

  const stopSession = (sessionId: string): boolean => {
    const session = sessions.get(sessionId);
    if (!session) {
      return false;
    }

    teardownSession(
      sessionId,
      session,
      {
        type: "session_end",
        reason: "operator_stop",
        timestamp: new Date().toISOString(),
      },
      { killPty: true },
    );
    return true;
  };

  const killSession = (sessionId: string, signal = "SIGKILL"): boolean => {
    const session = sessions.get(sessionId);
    if (!session) {
      return false;
    }

    teardownSession(
      sessionId,
      session,
      {
        type: "session_end",
        reason: "operator_kill",
        signal,
        timestamp: new Date().toISOString(),
      },
      { killPty: true, killSignal: signal },
    );
    return true;
  };

  const INITIAL_PROMPT_DELAY_MS = 4_000;
  const INITIAL_PROMPT_SUBMIT_DELAY_MS = 150;
  const BRACKETED_PASTE_START = "\x1b[200~";
  const BRACKETED_PASTE_END = "\x1b[201~";

  const scheduleIdleCloseIfNeeded = (session: TerminalSession, sessionId: string) => {
    if (session.isClosed || sessions.get(sessionId) !== session) {
      return;
    }

    if (session.keepAliveWithoutClients) {
      return;
    }

    if (session.clients.size > 0 || session.directListeners.size > 0) {
      return;
    }

    appendDebugLog(
      session,
      `idle-grace-start session=${sessionId} timeoutMs=${sessionIdleGraceMs}`,
    );
    clearIdleCloseTimer(session);
    session.idleCloseTimer = setTimeout(() => {
      appendDebugLog(session, `idle-grace-expired session=${sessionId}`);
      closeSession(sessionId);
    }, sessionIdleGraceMs);
  };

  const ensureAgentBootstrapped = (sessionId: string, session: TerminalSession) => {
    if (session.isBootstrapCommandSent) {
      return;
    }

    session.isBootstrapCommandSent = true;
    const terminal = terminals.get(session.terminalId);

    // Exec mode: the agent was spawned directly with its prompt as argv in
    // ensureSession. No shell bootstrap, no typed-in prompt injection —
    // the child is already running the one-shot turn.
    if (terminal?.runtimeMode === "exec") {
      appendDebugLog(session, `bootstrap-skip-exec session=${sessionId}`);
      return;
    }

    const rawProvider = terminal?.agentProvider ?? DEFAULT_AGENT_PROVIDER;
    const provider = resolveAgentProvider(rawProvider);

    const bootstrapCommand =
      TERMINAL_BOOTSTRAP_COMMANDS[provider] ?? TERMINAL_BOOTSTRAP_COMMANDS[DEFAULT_AGENT_PROVIDER];
    appendDebugLog(session, `bootstrap session=${sessionId} command=${bootstrapCommand}`);
    session.pty.write(`${bootstrapCommand}\r`);

    // Schedule initial prompt injection after Claude Code has had time to boot.
    if (session.initialPrompt && !session.isInitialPromptSent) {
      schedulePromptTimer(
        session,
        sessionId,
        () => {
          if (session.isInitialPromptSent) {
            return;
          }
          session.isInitialPromptSent = true;
          appendDebugLog(session, `initial-prompt session=${sessionId}`);
          const prompt = session.initialPrompt ?? "";
          session.pty.write(`${BRACKETED_PASTE_START}${prompt}${BRACKETED_PASTE_END}`);
          schedulePromptTimer(
            session,
            sessionId,
            () => {
              appendDebugLog(session, `initial-prompt-submit session=${sessionId}`);
              session.pty.write("\r");
            },
            INITIAL_PROMPT_SUBMIT_DELAY_MS,
          );
        },
        INITIAL_PROMPT_DELAY_MS,
      );
    }

    if (session.initialInputDraft && !session.isInitialInputDraftSent && !session.initialPrompt) {
      schedulePromptTimer(
        session,
        sessionId,
        () => {
          if (session.isInitialInputDraftSent) {
            return;
          }
          session.isInitialInputDraftSent = true;
          appendDebugLog(session, `initial-input-draft session=${sessionId}`);
          const draft = session.initialInputDraft ?? "";
          session.pty.write(`${BRACKETED_PASTE_START}${draft}${BRACKETED_PASTE_END}`);
        },
        INITIAL_PROMPT_DELAY_MS,
      );
    }
  };

  const ensureSession = (sessionId: string, tentacleId: string) => {
    const existingSession = sessions.get(sessionId);
    if (existingSession) {
      return existingSession;
    }

    if (sessions.size >= sessionLimit) {
      throw new Error(
        `Terminal session limit reached (${sessionLimit}). Close an existing terminal session or increase OCTOGENT_MAX_TERMINAL_SESSIONS.`,
      );
    }

    const terminalRecord = terminals.get(sessionId);

    const tentacleCwd = getTentacleWorkspaceCwd(tentacleId);
    if (!existsSync(tentacleCwd)) {
      throw new Error(`Terminal working directory does not exist: ${tentacleCwd}`);
    }

    const isExecMode = terminalRecord?.runtimeMode === "exec";

    let pty: TerminalProcessHandle;
    if (isExecMode) {
      const provider = terminalRecord?.agentProvider ?? DEFAULT_AGENT_PROVIDER;
      const turnNumber = terminalRecord?.turnNumber ?? 0;
      // Turn 0 = initial exec, uses initialPrompt + buildExecCommand.
      // Turn 1+ = resume via buildResumeCommand + nextTurnPrompt (queued
      // channel messages). nextTurnPrompt is consumed here — cleared below
      // so a stale value can't leak into a later turn.
      const isResumeTurn = turnNumber >= 1;
      const prompt = isResumeTurn
        ? (terminalRecord?.nextTurnPrompt ?? "")
        : (terminalRecord?.initialPrompt ?? "");
      if (!prompt) {
        throw new Error(
          isResumeTurn
            ? `Exec-mode terminal ${sessionId} turn ${turnNumber} has no nextTurnPrompt — coordinator must stash queued messages before respawn.`
            : `Exec-mode terminal ${sessionId} has no initialPrompt — exec workers require a prompt.`,
        );
      }

      mkdirSync(execOutputDirectoryPath, { recursive: true });
      const outfile = join(execOutputDirectoryPath, `${sessionId}.json`);

      let command: string;
      let args: string[];
      let stdin: string;
      let useShell: boolean | undefined;
      const roots = terminalRecord?.roots;
      try {
        const built = isResumeTurn
          ? buildResumeCommand(provider, prompt, outfile, terminalRecord?.codexSessionId, roots)
          : buildExecCommand(provider, prompt, outfile, roots);
        command = built.command;
        args = built.args;
        stdin = built.stdin;
        useShell = built.useShell;
      } catch (error) {
        throw new Error(`Unable to build exec command: ${toErrorMessage(error)}`);
      }

      let handoffDirForExec: string | undefined;
      if (getTentacleHandoffDir) {
        try {
          handoffDirForExec = getTentacleHandoffDir(tentacleId);
        } catch {
          // Best-effort — handoff dir creation failure must not block spawn.
        }
      }

      try {
        pty = spawnExecChild({
          command,
          args,
          cwd: tentacleCwd,
          env: createShellEnvironment({
            octogentSessionId: sessionId,
            octogentTentacleId: tentacleId,
            ...(handoffDirForExec ? { octogentHandoffDir: handoffDirForExec } : {}),
            extraEnv: buildProviderEnvironmentOverrides(provider),
          }),
          stdin,
          ...(useShell !== undefined ? { useShell } : {}),
        });
      } catch (error) {
        throw new Error(`Unable to spawn exec worker (${command}): ${toErrorMessage(error)}`);
      }

      // Consume the one-shot next-turn prompt. The coordinator re-stashes
      // a new one before every respawn, so clearing here prevents a stale
      // prompt from leaking into a future turn if something odd happens.
      if (isResumeTurn && terminalRecord) {
        delete terminalRecord.nextTurnPrompt;
      }
    } else {
      ensureNodePtySpawnHelperExecutable();
      const shellLaunch = getShellLaunch();

      let handoffDirForInteractive: string | undefined;
      if (getTentacleHandoffDir) {
        try {
          handoffDirForInteractive = getTentacleHandoffDir(tentacleId);
        } catch {
          // Best-effort — handoff dir creation failure must not block spawn.
        }
      }

      try {
        pty = spawn(shellLaunch.command, shellLaunch.args, {
          cols: DEFAULT_PTY_COLS,
          rows: DEFAULT_PTY_ROWS,
          cwd: tentacleCwd,
          env: createShellEnvironment({
            octogentSessionId: sessionId,
            octogentTentacleId: tentacleId,
            ...(handoffDirForInteractive ? { octogentHandoffDir: handoffDirForInteractive } : {}),
            extraEnv: buildProviderEnvironmentOverrides(terminalRecord?.agentProvider),
          }),
          name: "xterm-256color",
        }) as unknown as TerminalProcessHandle;
      } catch (error) {
        throw new Error(
          `Unable to start terminal shell (${shellLaunch.command}): ${toErrorMessage(error)}`,
        );
      }
    }

    const stateTracker = new AgentStateTracker();
    const debugLog = createDebugLog(sessionId);
    const transcriptLog = createTranscriptLog(sessionId);

    // Exec mode: persist streamed stdout/stderr to a dedicated log file so
    // the full output record survives beyond scrollback. Interactive mode
    // continues to rely on scrollback + debug PTY logs (no change).
    //
    // Also: exec workers should NOT keep the session alive waiting for a
    // client reconnect — they're one-shot and must release the slot when
    // they exit. Override keepAliveWithoutClients for exec.
    let execOutputLog: WriteStream | undefined;
    if (isExecMode) {
      try {
        execOutputLog = createWriteStream(join(execOutputDirectoryPath, `${sessionId}.log`), {
          flags: "a",
          encoding: "utf8",
        });
        execOutputLog.on("error", () => {
          // Keep the session running even if the exec log write fails.
        });
      } catch {
        // Best-effort — an exec-output log failure should not block spawn.
      }
    }

    const sessionStartedAt = Date.now();
    const session: TerminalSession = {
      terminalId: sessionId,
      tentacleId,
      pty,
      clients: new Set(),
      directListeners: new Set(),
      cols: DEFAULT_PTY_COLS,
      rows: DEFAULT_PTY_ROWS,
      agentState: stateTracker.currentState,
      stateTracker,
      isBootstrapCommandSent: false,
      scrollbackChunks: [],
      scrollbackBytes: 0,
      transcriptEventCount: 0,
      pendingInput: "",
      hasTranscriptEnded: false,
      // Anchor stuck detection at session start so a freshly-spawned worker
      // gets the full tier1Ms grace window before escalation. lastToolCallAt
      // is seeded identically; hooks or output-side tool-call markers move it.
      lastActivityAt: sessionStartedAt,
      lastToolCallAt: sessionStartedAt,
      keepAliveWithoutClients: isExecMode ? false : Boolean(terminalRecord?.initialPrompt),
    };
    if (debugLog) {
      session.debugLog = debugLog;
    }
    session.transcriptLog = transcriptLog;
    if (execOutputLog) {
      session.execOutputLog = execOutputLog;
    }

    appendDebugLog(session, `session-start session=${sessionId} tentacle=${tentacleId}`);
    const processId =
      typeof pty.pid === "number" && Number.isInteger(pty.pid) && pty.pid > 0 ? pty.pid : undefined;
    onSessionStart?.(sessionId, {
      startedAt: new Date().toISOString(),
      ...(processId ? { processId } : {}),
    });
    appendTranscriptEvent(session, sessionId, {
      type: "session_start",
      timestamp: new Date().toISOString(),
    });
    session.statePollTimer = setInterval(() => {
      emitStateIfChanged(session, sessionId, session.stateTracker.poll(Date.now()));
    }, 300);

    const dataDisposable = session.pty.onData((chunk) => {
      if (session.isClosed) {
        return;
      }

      appendDebugLog(session, `pty-output session=${sessionId} chunk=${JSON.stringify(chunk)}`);
      appendScrollback(session, chunk);
      session.execOutputLog?.write(chunk);
      const observedAt = Date.now();
      session.lastActivityAt = observedAt;
      if (looksLikeToolCallOutput(chunk)) {
        session.lastToolCallAt = observedAt;
      }
      const nextState = session.stateTracker.observeChunk(chunk, observedAt);
      broadcastMessage(session, {
        type: "output",
        data: chunk,
      });
      emitStateIfChanged(session, sessionId, nextState);
    });

    const exitDisposable = session.pty.onExit(({ exitCode, signal }) => {
      if (session.isClosed) {
        return;
      }

      const message = `\r\n[terminal exited (code ${exitCode}, signal ${signal})]\r\n`;
      broadcastMessage(session, {
        type: "output",
        data: message,
      });

      appendDebugLog(
        session,
        `session-exit session=${sessionId} code=${exitCode} signal=${signal}`,
      );
      teardownSession(
        sessionId,
        session,
        {
          type: "session_end",
          reason: "pty_exit",
          ...(Number.isFinite(exitCode) ? { exitCode } : {}),
          ...(Number.isFinite(signal) ? { signal } : {}),
          timestamp: new Date().toISOString(),
        },
        { killPty: false },
      );
    });
    session.ptyDisposables = [dataDisposable, exitDisposable];

    // Propagate initial prompt from the terminal definition, if set.
    if (terminalRecord?.initialPrompt) {
      session.initialPrompt = terminalRecord.initialPrompt;
    }
    if (terminalRecord?.initialInputDraft) {
      session.initialInputDraft = terminalRecord.initialInputDraft;
    }

    sessions.set(sessionId, session);

    // Exec-mode safety timer: force-kill a worker that exceeds the configured
    // ceiling. Prevents hung codex/claude processes from holding a session
    // slot forever. Cleared in teardownSession when the worker exits cleanly.
    //
    // MED-1 (timeout visibility): set `killedByTimeout` on BOTH session and
    // terminal before killSession fires. teardownSession removes the session
    // from the map, so the coordinator can only read the flag off the
    // PersistedTerminal record after teardown. Setting both is the belt +
    // suspenders — session flag for any in-process observer, terminal flag
    // for the coordinator's post-teardown decision.
    if (isExecMode && execTimeoutCeilingMs > 0) {
      session.execTimeoutTimer = setTimeout(() => {
        if (session.isClosed || sessions.get(sessionId) !== session) {
          return;
        }
        appendDebugLog(
          session,
          `exec-timeout session=${sessionId} timeoutMs=${execTimeoutCeilingMs}`,
        );
        broadcastMessage(session, {
          type: "output",
          data: `\r\n[exec worker exceeded ${execTimeoutCeilingMs}ms ceiling — killing]\r\n`,
        });
        session.killedByTimeout = true;
        const terminalForTimeout = terminals.get(sessionId);
        if (terminalForTimeout) {
          terminalForTimeout.killedByTimeout = true;
        }
        killSession(sessionId, "SIGTERM");
      }, execTimeoutCeilingMs);
    }

    return session;
  };

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): boolean => {
    const terminalId = getTerminalId(request);
    if (!terminalId) {
      return false;
    }

    const resolvedSession = resolveSession(terminalId);
    if (!resolvedSession) {
      return false;
    }
    const { sessionId, tentacleId } = resolvedSession;

    websocketServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
      let session: TerminalSession;
      try {
        session = ensureSession(sessionId, tentacleId);
      } catch (error) {
        sendMessage(websocket, {
          type: "output",
          data: `\r\n[terminal failed to start: ${toErrorMessage(error)}]\r\n`,
        });
        websocket.close();
        return;
      }

      session.clients.add(websocket);
      appendDebugLog(session, `ws-open session=${sessionId} clients=${session.clients.size}`);
      clearIdleCloseTimer(session);
      ensureAgentBootstrapped(sessionId, session);
      sendHistory(websocket, session);
      sendMessage(websocket, {
        type: "state",
        state: session.agentState,
      });

      websocket.on("message", (raw: unknown) => {
        if (session.isClosed) {
          return;
        }

        const text =
          typeof raw === "string" ? raw : raw instanceof Buffer ? raw.toString() : String(raw);
        try {
          const payload = JSON.parse(text) as
            | { type: "input"; data: string }
            | { type: "resize"; cols: number; rows: number };

          if (payload.type === "input" && typeof payload.data === "string") {
            appendDebugLog(
              session,
              `ws-input session=${sessionId} data=${JSON.stringify(payload.data)}`,
            );
            // Exec mode: no mid-turn input. Drop + notify the client so they
            // don't watch the cursor sit there waiting for a prompt echo
            // that will never come.
            const terminal = terminals.get(session.terminalId);
            if (terminal?.runtimeMode === "exec") {
              sendMessage(websocket, {
                type: "output",
                data: "\r\n[exec mode: input ignored — this worker accepts only its initial prompt]\r\n",
              });
              return;
            }
            session.pty.write(payload.data);
            if (/[\r\n]/.test(payload.data)) {
              emitStateIfChanged(
                session,
                sessionId,
                session.stateTracker.observeSubmit(Date.now()),
              );
            }
            return;
          }

          if (
            payload.type === "resize" &&
            Number.isFinite(payload.cols) &&
            Number.isFinite(payload.rows)
          ) {
            const nextCols = Math.max(20, Math.floor(payload.cols));
            const nextRows = Math.max(10, Math.floor(payload.rows));
            if (session.cols === nextCols && session.rows === nextRows) {
              return;
            }

            session.cols = nextCols;
            session.rows = nextRows;
            session.pty.resize(nextCols, nextRows);
          }
        } catch {
          session.pty.write(text);
        }
      });

      websocket.on("close", () => {
        if (session.isClosed) {
          return;
        }

        session.clients.delete(websocket);
        appendDebugLog(session, `ws-close session=${sessionId} clients=${session.clients.size}`);
        scheduleIdleCloseIfNeeded(session, sessionId);
      });
    });

    return true;
  };

  const close = () => {
    for (const sessionId of sessions.keys()) {
      closeSession(sessionId);
    }
  };

  const connectDirect = (
    terminalId: string,
    listener: DirectSessionListener,
  ): (() => void) | null => {
    const resolvedSession = resolveSession(terminalId);
    if (!resolvedSession) {
      return null;
    }
    const { sessionId, tentacleId } = resolvedSession;

    let session: TerminalSession;
    try {
      session = ensureSession(sessionId, tentacleId);
    } catch {
      return null;
    }

    session.directListeners.add(listener);
    clearIdleCloseTimer(session);
    ensureAgentBootstrapped(sessionId, session);

    // Send history and current state to the new listener
    if (session.scrollbackChunks.length > 0) {
      listener({ type: "history", data: session.scrollbackChunks.join("") });
    }
    listener({ type: "state", state: session.agentState });

    return () => {
      if (session.isClosed) {
        return;
      }

      session.directListeners.delete(listener);
      scheduleIdleCloseIfNeeded(session, sessionId);
    };
  };

  const startSession = (terminalId: string): boolean => {
    const resolvedSession = resolveSession(terminalId);
    if (!resolvedSession) {
      return false;
    }

    const { sessionId, tentacleId } = resolvedSession;
    let session: TerminalSession;
    try {
      session = ensureSession(sessionId, tentacleId);
    } catch {
      return false;
    }

    clearIdleCloseTimer(session);
    ensureAgentBootstrapped(sessionId, session);
    return true;
  };

  const writeInput = (terminalId: string, data: string): boolean => {
    const session = sessions.get(terminalId);
    if (!session || session.isClosed) {
      return false;
    }

    // Exec-mode workers receive their entire prompt via stdin at spawn. They
    // don't accept mid-turn input — the prompt is already committed and any
    // incoming bytes would be silently dropped by the adapter. Return false
    // so callers know the write didn't land. New messages should queue in
    // the channel store and deliver on the NEXT turn (P1b-1).
    const terminal = terminals.get(session.terminalId);
    if (terminal?.runtimeMode === "exec") {
      appendDebugLog(session, `write-dropped-exec-mode session=${terminalId} bytes=${data.length}`);
      return false;
    }

    session.pty.write(data);
    if (/[\r\n]/.test(data)) {
      emitStateIfChanged(session, terminalId, session.stateTracker.observeSubmit(Date.now()));
    }
    return true;
  };

  const resizeSession = (terminalId: string, cols: number, rows: number): boolean => {
    const session = sessions.get(terminalId);
    if (!session || session.isClosed) {
      return false;
    }

    const nextCols = Math.max(20, Math.floor(cols));
    const nextRows = Math.max(10, Math.floor(rows));
    if (session.cols === nextCols && session.rows === nextRows) {
      return true;
    }

    session.cols = nextCols;
    session.rows = nextRows;
    session.pty.resize(nextCols, nextRows);
    return true;
  };

  const releaseSessionKeepAlive = (terminalId: string): boolean => {
    const session = sessions.get(terminalId);
    if (!session || session.isClosed) {
      return false;
    }

    session.keepAliveWithoutClients = false;
    scheduleIdleCloseIfNeeded(session, terminalId);
    return true;
  };

  // Stuck-detection wiring (Phase 10.8.6). The detector reads `sessions` +
  // `terminals` on each tick, so constructing it here — after both maps are
  // populated and all per-session mutators (killSession in particular) are
  // declared — avoids any Temporal Dead Zone surprises if a tick fires
  // immediately.
  //
  // `persistTerminalChanges` is routed through the onStuckTierChange hook
  // so the outer terminalRuntime handles actual registry persistence (it
  // owns the debounce). The detector's own persist hook is a no-op that
  // keeps the internal contract explicit.
  const stuckDetector = createStuckDetector({
    terminals,
    sessions,
    thresholds: stuckThresholds,
    sendSystemChannelMessage: (terminalId: string, content: string) => {
      if (sendSystemChannelMessage) {
        sendSystemChannelMessage(terminalId, content);
      }
    },
    composeStuckSummary: (terminalId: string) =>
      composeStuckSummary ? composeStuckSummary(terminalId) : "(summary unavailable)",
    killSession: (terminalId: string) => {
      killSession(terminalId);
    },
    persistTerminalChanges: () => {
      if (persistStuckTierChanges) {
        persistStuckTierChanges();
      }
    },
    onStuckTierChange: (terminalId, tier) => {
      onStuckTierChange?.(terminalId, tier);
    },
    onStuckEscalationExhausted: (info) => {
      onStuckEscalationExhausted?.(info);
    },
  });

  const runStuckCheckNow = (now: number = Date.now()): void => {
    stuckDetector.runCheck(now);
  };

  let stuckPollTimer: ReturnType<typeof setInterval> | undefined;
  if (stuckPollIntervalMs > 0) {
    stuckPollTimer = setInterval(() => {
      try {
        stuckDetector.runCheck(Date.now());
      } catch {
        // Swallow — the next tick gets another shot.
      }
    }, stuckPollIntervalMs);
    // Prevent the poller from blocking process exit in tests / short-lived CLI.
    if (typeof stuckPollTimer.unref === "function") {
      stuckPollTimer.unref();
    }
  }

  const closeAll = () => {
    if (stuckPollTimer) {
      clearInterval(stuckPollTimer);
      stuckPollTimer = undefined;
    }
    close();
  };

  return {
    closeSession,
    stopSession,
    killSession,
    handleUpgrade,
    connectDirect,
    startSession,
    writeInput,
    resizeSession,
    releaseSessionKeepAlive,
    close: closeAll,
    runStuckCheckNow,
    getSessionCapacity: () => ({
      active: sessions.size,
      max: sessionLimit,
    }),
  };
};
