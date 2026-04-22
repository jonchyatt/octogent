import { TERMINAL_EXEC_MAX_TURNS } from "./constants";
import type { PersistedTerminal } from "./types";

/**
 * Exec turn coordinator — owns the "spawn next turn on channel-message
 * arrival" decision for exec-mode terminals.
 *
 * State machine:
 *   TURN 0 SPAWN → (exec exits clean + queue empty)              → DONE
 *                → (exec exits clean + queue non-empty)           → TURN N+1 RESPAWN
 *                → (exec times out, retryCount=0)                 → TURN N+1 RESPAWN (synthetic marker + any new drained)
 *                → (exec times out, retryCount>=1)                → DEAD (escalate)
 *                → (operator stop/kill — no flag)                 → DONE
 *   Guards:
 *     - agentProvider === "claude-code"                          → DONE
 *       (no resume primitive; respawn would lose context silently — MED-2)
 *     - nextTurnPrompt already set                               → SKIP
 *       (another respawn already in-flight — MED-4 re-entrancy guard)
 *     - turnNumber >= OCTOGENT_EXEC_MAX_TURNS                    → DEAD
 *       (runaway ping-pong protection — LOW-3)
 *
 * P1b.9 timeout retry semantics:
 *   First timeout (retryCount undefined/0): bump retryCount→1, drain any
 *   newly-arrived pending, compose nextTurnPrompt as
 *   `"[Previous exec turn timed out and was killed. Resuming session.]"`
 *   optionally followed by the drained composed prompt, bump turnNumber,
 *   respawn. Codex resumes its session with an honest note and any new
 *   user input. Second CONSECUTIVE timeout (retryCount>=1) escalates
 *   DEAD without a further retry. Clean pty_exit resets retryCount to 0
 *   (non-consecutive timeouts don't accumulate).
 *
 * The coordinator is invoked by sessionRuntime via the onExecSessionEnd
 * callback wired into teardownSession. It does NOT poll — it reacts to
 * exits.
 *
 * Crash-consistency ordering (HIGH-2):
 *   1. drain queue (SQLite atomic: pending → processing)
 *   2. set in-memory nextTurnPrompt + bump turnNumber
 *   3. call startSession (ensureSession consumes nextTurnPrompt + spawns)
 *   4. ON SUCCESS: persistTerminalChanges + markExecPromptDelivered
 *   5. ON FAILURE: revert in-memory, NO persist of bumped state,
 *                  markExecPromptFailed (SQLite messages → FAILED →
 *                  recoverStale eventually reverts to PENDING for retry)
 *
 * The key invariant: disk state never shows `turnNumber = N+1` unless
 * the spawn for turn N+1 actually started. A crash between steps 2 and 4
 * loses the in-memory bump but the on-disk bump never happened either,
 * so on restart the terminal looks like turn N (correct). SQLite messages
 * stuck in PROCESSING get reclaimed by recoverStale at the 10-min ceiling.
 */

export type ExecTurnCoordinatorEscalation =
  | { kind: "timeout"; terminalId: string; turnNumber: number }
  | { kind: "max_turns"; terminalId: string; turnNumber: number };

export type CreateExecTurnCoordinatorOptions = {
  terminals: Map<string, PersistedTerminal>;
  drainPendingForExecResume: (
    terminalId: string,
  ) => { prompt: string; messageIds: string[] } | null;
  markExecPromptDelivered: (messageIds: string[]) => void;
  markExecPromptFailed: (messageIds: string[], error: string) => void;
  /**
   * Start a new session for this terminalId. Must trigger ensureSession,
   * which reads terminal.turnNumber + terminal.nextTurnPrompt to decide
   * between buildExecCommand (turn 0) and buildResumeCommand (turn 1+).
   */
  startSession: (terminalId: string) => boolean;
  persistTerminalChanges?: () => void;
  /**
   * Called when the coordinator decides to mark a terminal DEAD. Caller
   * wires this to the terminal lifecycle (flip to "dead" + broadcast). The
   * coordinator does NOT touch the lifecycle field directly — that stays
   * in terminalRuntime.ts' domain.
   */
  onTerminalDead?: (escalation: ExecTurnCoordinatorEscalation) => void;
  /**
   * Override the default max-turn ceiling (for tests). Falls back to the
   * OCTOGENT_EXEC_MAX_TURNS env-derived constant.
   */
  maxTurns?: number;
};

export type ExecTurnCoordinator = {
  /**
   * Called by sessionRuntime right after an exec-mode session ends cleanly,
   * or gets killed. Returns:
   *   "respawn" — stashed queued messages, turn N+1 started.
   *   "done"    — no more work, no respawn.
   *   "dead"    — escalated to DEAD (timeout without retry budget, or
   *               max-turns exceeded).
   *   "skip"    — not our concern (non-exec terminal, unknown terminal,
   *               or a respawn is already in-flight).
   */
  handleExecSessionEnd: (
    terminalId: string,
    reason: "pty_exit" | "operator_stop" | "operator_kill" | "session_close",
  ) => "respawn" | "done" | "dead" | "skip";
};

export const createExecTurnCoordinator = (
  options: CreateExecTurnCoordinatorOptions,
): ExecTurnCoordinator => {
  const {
    terminals,
    drainPendingForExecResume,
    markExecPromptDelivered,
    markExecPromptFailed,
    startSession,
    persistTerminalChanges,
    onTerminalDead,
    maxTurns,
  } = options;
  const maxTurnsCeiling =
    typeof maxTurns === "number" && Number.isFinite(maxTurns) && maxTurns > 0
      ? Math.floor(maxTurns)
      : TERMINAL_EXEC_MAX_TURNS;

  const handleExecSessionEnd: ExecTurnCoordinator["handleExecSessionEnd"] = (
    terminalId,
    reason,
  ) => {
    const terminal = terminals.get(terminalId);
    if (!terminal) {
      return "skip";
    }
    if (terminal.runtimeMode !== "exec") {
      return "skip";
    }

    // MED-2: claude-code has no resume primitive. Respawning would spawn a
    // fresh subprocess with no memory of turn N, effectively lying about
    // the turn counter. Until claude-code gains resume support, exec-mode
    // workers with agentProvider=claude-code are single-turn only. Queued
    // messages stay pending; the operator must manually respawn.
    if (terminal.agentProvider === "claude-code") {
      return "done";
    }

    // P1b.9: timeout retry-once-then-DEAD. The sessionRuntime timeout callback
    // sets killedByTimeout=true right before killSession, then teardown fires
    // onExecSessionEnd with reason="operator_kill". On FIRST consecutive
    // timeout (retryCount 0/undefined), bump retryCount→1, drain any new
    // pending, compose a synthetic-marker prompt so Codex knows the prior
    // turn was killed, respawn. On SECOND consecutive timeout (retryCount>=1),
    // escalate DEAD. Clean exits reset retryCount further down.
    if (reason === "operator_kill" && terminal.killedByTimeout === true) {
      const currentRetries = terminal.retryCount ?? 0;
      const currentTurn = terminal.turnNumber ?? 0;

      // Second consecutive timeout → DEAD.
      if (currentRetries >= 1) {
        delete terminal.killedByTimeout;
        delete terminal.retryCount;
        persistTerminalChanges?.();
        onTerminalDead?.({
          kind: "timeout",
          terminalId,
          turnNumber: currentTurn,
        });
        return "dead";
      }

      // First timeout → retry once. Also check max-turns ceiling — if we're
      // already at the ceiling, a retry would push past it. Escalate DEAD
      // with max_turns reason (the timeout is coincident but LOW-3 is the
      // structural cause).
      if (currentTurn >= maxTurnsCeiling) {
        delete terminal.killedByTimeout;
        delete terminal.retryCount;
        persistTerminalChanges?.();
        onTerminalDead?.({
          kind: "max_turns",
          terminalId,
          turnNumber: currentTurn,
        });
        return "dead";
      }

      // Drain any newly-arrived pending for retry (may be null/empty — that's
      // fine, the synthetic marker alone is a valid resume prompt).
      const drainedRetry = drainPendingForExecResume(terminalId);
      const syntheticMarker =
        "[Previous exec turn timed out and was killed. Resuming session.]";
      const retryPrompt =
        drainedRetry && drainedRetry.messageIds.length > 0
          ? `${syntheticMarker}\n\n${drainedRetry.prompt}`
          : syntheticMarker;

      // Stage the retry: bump retryCount + turnNumber + nextTurnPrompt IN
      // MEMORY ONLY (HIGH-2 crash-consistency invariant). Persist only on
      // spawn success.
      terminal.nextTurnPrompt = retryPrompt;
      terminal.turnNumber = currentTurn + 1;
      terminal.retryCount = currentRetries + 1;
      delete terminal.killedByTimeout;

      let respawnOk = false;
      try {
        respawnOk = startSession(terminalId);
      } catch {
        respawnOk = false;
      }

      if (!respawnOk) {
        // Retry spawn failed. Revert in-memory state (disk untouched).
        // killedByTimeout was consumed; re-setting it on failure would be
        // a lie about what the runtime did, so leave it cleared. The retry
        // attempt is spent — mark any drained messages FAILED and escalate
        // DEAD (we already consumed our one retry budget on this attempt).
        delete terminal.nextTurnPrompt;
        terminal.turnNumber = currentTurn;
        delete terminal.retryCount;
        if (drainedRetry && drainedRetry.messageIds.length > 0) {
          markExecPromptFailed(
            drainedRetry.messageIds,
            "timeout retry startSession returned false",
          );
        }
        persistTerminalChanges?.();
        onTerminalDead?.({
          kind: "timeout",
          terminalId,
          turnNumber: currentTurn,
        });
        return "dead";
      }

      // Retry spawn succeeded. Persist bumped state and mark any drained
      // messages delivered (they rode in on the synthetic-marker prompt).
      persistTerminalChanges?.();
      if (drainedRetry && drainedRetry.messageIds.length > 0) {
        markExecPromptDelivered(drainedRetry.messageIds);
      }
      return "respawn";
    }

    // Only respawn on clean exits. operator_stop / operator_kill without
    // the timeout flag = user said "enough", don't respawn.
    if (reason !== "pty_exit") {
      return "done";
    }

    // P1b.9: a clean turn-exit means the retry budget is fully refreshed.
    // Only CONSECUTIVE timeouts escalate to DEAD — one clean turn in between
    // resets the counter. Persist the reset so a post-reset crash doesn't
    // leave disk in retryCount=1 state.
    if ((terminal.retryCount ?? 0) > 0) {
      delete terminal.retryCount;
      persistTerminalChanges?.();
    }

    // MED-4: re-entrancy guard. If another respawn is already in-flight
    // (nextTurnPrompt set from a prior drain), don't clobber it. Queued
    // messages arriving during this turn stay in SQLite and get drained
    // on the NEXT real session end.
    if (terminal.nextTurnPrompt !== undefined) {
      return "skip";
    }

    // LOW-3: max-turns ceiling. Protect against infinite ping-pong.
    const currentTurn = terminal.turnNumber ?? 0;
    if (currentTurn >= maxTurnsCeiling) {
      onTerminalDead?.({
        kind: "max_turns",
        terminalId,
        turnNumber: currentTurn,
      });
      return "dead";
    }

    // Peek + claim the queue atomically. If empty, the terminal has no more
    // work — it's done.
    const drained = drainPendingForExecResume(terminalId);
    if (!drained || drained.messageIds.length === 0) {
      return "done";
    }

    // HIGH-2: bump in-memory state ONLY. Do NOT persist yet — persistence
    // commits us to "turn N+1 happened", which is only true if the spawn
    // below succeeds. Persist after startSession returns success.
    terminal.nextTurnPrompt = drained.prompt;
    terminal.turnNumber = currentTurn + 1;

    let respawnOk = false;
    try {
      respawnOk = startSession(terminalId);
    } catch {
      respawnOk = false;
    }

    if (!respawnOk) {
      // Respawn failed. Revert in-memory state (disk was never touched).
      // markExecPromptFailed moves messages to FAILED in SQLite — recoverStale
      // will eventually revert them to PENDING for a later retry attempt.
      delete terminal.nextTurnPrompt;
      terminal.turnNumber = currentTurn;
      markExecPromptFailed(
        drained.messageIds,
        "respawn startSession returned false",
      );
      return "done";
    }

    // Spawn succeeded. NOW persist the bumped turn state (nextTurnPrompt was
    // already consumed + cleared by ensureSession) and mark the messages
    // delivered.
    persistTerminalChanges?.();
    markExecPromptDelivered(drained.messageIds);
    return "respawn";
  };

  return { handleExecSessionEnd };
};
