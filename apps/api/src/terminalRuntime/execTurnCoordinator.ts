import type { PersistedTerminal } from "./types";

/**
 * Exec turn coordinator — owns the "spawn next turn on channel-message
 * arrival" decision for exec-mode terminals.
 *
 * State machine:
 *   TURN 0 SPAWN → (exec exits clean + queue empty)              → DONE
 *                → (exec exits clean + queue non-empty)           → TURN N+1 RESPAWN
 *                → (exec times out)                               → RETRY 1 (same turn)
 *   RETRY 1      → (exec exits clean)                             → handled as turn exit
 *                → (exec times out again)                         → DEAD (escalate)
 *
 * The coordinator is invoked by sessionRuntime via the onExecSessionEnd
 * callback wired into teardownSession. It does NOT poll — it reacts to
 * exits.
 */

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
};

export type ExecTurnCoordinator = {
  /**
   * Called by sessionRuntime right after an exec-mode session ends cleanly
   * (or hits its timeout). Returns `"respawn"` if we stashed queued messages
   * and kicked off the next turn, `"done"` if the terminal has no pending
   * work, or `"skip"` if this terminal isn't exec-mode (for safety — the
   * callback filters but guard anyway).
   */
  handleExecSessionEnd: (
    terminalId: string,
    reason: "pty_exit" | "operator_stop" | "operator_kill" | "session_close",
  ) => "respawn" | "done" | "skip";
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
  } = options;

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

    // Only respawn on clean exits. Operator stop/kill = user said "enough",
    // don't re-spawn. Timeout kills come through as operator_kill too (the
    // timeout fires killSession internally), so that's also a no-respawn.
    // P1b-2 handles retry-on-timeout separately with its own hook.
    if (reason !== "pty_exit") {
      return "done";
    }

    // Peek + claim the queue atomically. If empty, the terminal has no more
    // work — it's done.
    const drained = drainPendingForExecResume(terminalId);
    if (!drained || drained.messageIds.length === 0) {
      return "done";
    }

    // Stash the composed prompt for the next turn + bump turnNumber.
    terminal.nextTurnPrompt = drained.prompt;
    terminal.turnNumber = (terminal.turnNumber ?? 0) + 1;
    persistTerminalChanges?.();

    // Attempt the respawn. startSession triggers ensureSession which reads
    // turnNumber > 0 + nextTurnPrompt → uses buildResumeCommand.
    let respawnOk = false;
    try {
      respawnOk = startSession(terminalId);
    } catch {
      respawnOk = false;
    }

    if (!respawnOk) {
      // Respawn failed — revert the optimistic update and mark messages
      // failed so they go back to pending for a later retry.
      delete terminal.nextTurnPrompt;
      terminal.turnNumber = Math.max(0, (terminal.turnNumber ?? 1) - 1);
      persistTerminalChanges?.();
      markExecPromptFailed(drained.messageIds, "respawn startSession returned false");
      return "done";
    }

    markExecPromptDelivered(drained.messageIds);
    return "respawn";
  };

  return { handleExecSessionEnd };
};
