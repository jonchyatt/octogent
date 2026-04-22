import { TERMINAL_EXEC_MAX_TURNS } from "./constants";
import type { PersistedTerminal } from "./types";

/**
 * Exec turn coordinator — owns the "spawn next turn on channel-message
 * arrival" decision for exec-mode terminals.
 *
 * State machine:
 *   TURN 0 SPAWN → (exec exits clean + queue empty)              → DONE
 *                → (exec exits clean + queue non-empty)           → TURN N+1 RESPAWN
 *                → (exec times out — killedByTimeout set)         → DEAD (escalate)
 *                → (operator stop/kill — no flag)                 → DONE
 *   Guards:
 *     - agentProvider === "claude-code"                          → DONE
 *       (no resume primitive; respawn would lose context silently — MED-2)
 *     - nextTurnPrompt already set                               → SKIP
 *       (another respawn already in-flight — MED-4 re-entrancy guard)
 *     - turnNumber >= OCTOGENT_EXEC_MAX_TURNS                    → DEAD
 *       (runaway ping-pong protection — LOW-3)
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

    // MED-1: timeout escalation. The sessionRuntime timeout callback sets
    // killedByTimeout=true right before killSession, then teardown fires
    // onExecSessionEnd with reason="operator_kill". Distinguish by checking
    // the flag. (P1b.9 will layer retry-once-then-DEAD on top of this hook;
    // for now, one timeout = DEAD.)
    if (reason === "operator_kill" && terminal.killedByTimeout === true) {
      delete terminal.killedByTimeout;
      persistTerminalChanges?.();
      onTerminalDead?.({
        kind: "timeout",
        terminalId,
        turnNumber: terminal.turnNumber ?? 0,
      });
      return "dead";
    }

    // Only respawn on clean exits. operator_stop / operator_kill without
    // the timeout flag = user said "enough", don't respawn.
    if (reason !== "pty_exit") {
      return "done";
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
