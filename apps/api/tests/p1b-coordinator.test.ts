import { describe, expect, it, vi } from "vitest";

import { buildResumeCommand } from "../src/terminalRuntime/constants";
import {
  createExecTurnCoordinator,
  type CreateExecTurnCoordinatorOptions,
  type ExecTurnCoordinatorEscalation,
} from "../src/terminalRuntime/execTurnCoordinator";
import type { PersistedTerminal } from "../src/terminalRuntime/types";

const makeTerminal = (
  overrides: Partial<PersistedTerminal> = {},
): PersistedTerminal => ({
  terminalId: "terminal-1",
  tentacleId: "t-1",
  tentacleName: "t",
  createdAt: new Date().toISOString(),
  workspaceMode: "worktree",
  agentProvider: "codex",
  runtimeMode: "exec",
  ...overrides,
});

const makeCoordinatorHarness = (
  initial: PersistedTerminal,
  overrides: Partial<CreateExecTurnCoordinatorOptions> = {},
) => {
  const terminals = new Map<string, PersistedTerminal>();
  terminals.set(initial.terminalId, initial);
  const drain = vi.fn<
    CreateExecTurnCoordinatorOptions["drainPendingForExecResume"]
  >(() => null);
  const markDelivered = vi.fn<
    CreateExecTurnCoordinatorOptions["markExecPromptDelivered"]
  >();
  const markFailed = vi.fn<
    CreateExecTurnCoordinatorOptions["markExecPromptFailed"]
  >();
  const startSession = vi.fn<CreateExecTurnCoordinatorOptions["startSession"]>(
    () => true,
  );
  const persist = vi.fn();
  const onTerminalDead = vi.fn<
    (escalation: ExecTurnCoordinatorEscalation) => void
  >();
  const coordinator = createExecTurnCoordinator({
    terminals,
    drainPendingForExecResume: drain,
    markExecPromptDelivered: markDelivered,
    markExecPromptFailed: markFailed,
    startSession,
    persistTerminalChanges: persist,
    onTerminalDead,
    ...overrides,
  });
  return {
    coordinator,
    terminals,
    drain,
    markDelivered,
    markFailed,
    startSession,
    persist,
    onTerminalDead,
  };
};

describe("buildResumeCommand (MED-3 hard-coded argv)", () => {
  // Phase 10.9.7 — `codex exec resume` rejects `--sandbox` and
  // `--dangerously-bypass-approvals-and-sandbox`. These tests codify the
  // post-fix contract: neither flag appears in resume args. Resume
  // inherits sandbox posture from the parent session.
  it("codex + no sessionId: uses --last without any sandbox flag", () => {
    const result = buildResumeCommand("codex", "queued msg", "/tmp/out.json");
    expect(result.command).toBe("codex");
    expect(result.args).toEqual([
      "exec",
      "resume",
      "--last",
      "--output-last-message",
      "/tmp/out.json",
      "-",
    ]);
    expect(result.stdin).toBe("queued msg");
  });

  it("codex + sessionId: resumes the exact session without any sandbox flag", () => {
    const result = buildResumeCommand(
      "codex",
      "queued msg",
      "/tmp/out.json",
      "019db52e-a889-7660-ab1f-6e54ab56da0b",
    );
    expect(result.args).toEqual([
      "exec",
      "resume",
      "019db52e-a889-7660-ab1f-6e54ab56da0b",
      "--output-last-message",
      "/tmp/out.json",
      "-",
    ]);
  });

  it("codex ignores OCTOGENT_CODEX_EXEC_CMD override entirely (MED-3 hard-code)", () => {
    // Even if the env were set to something weird, resume uses canonical shape.
    // We don't read the env var in buildResumeCommand at all. Assert that the
    // output is invariant to any user-supplied prefix.
    const prev = process.env.OCTOGENT_CODEX_EXEC_CMD;
    process.env.OCTOGENT_CODEX_EXEC_CMD = "mycodex --some-flag exec --whatever";
    try {
      const result = buildResumeCommand("codex", "p", "/tmp/o.json");
      expect(result.command).toBe("codex");
      expect(result.args[0]).toBe("exec");
      expect(result.args[1]).toBe("resume");
    } finally {
      if (prev === undefined) {
        delete process.env.OCTOGENT_CODEX_EXEC_CMD;
      } else {
        process.env.OCTOGENT_CODEX_EXEC_CMD = prev;
      }
    }
  });

  it("claude-code: falls back to buildExecCommand shape (no resume primitive)", () => {
    const result = buildResumeCommand("claude-code", "msg", "/tmp/out.json");
    expect(result.command).toBe("claude");
    // S38 shipped `--dangerously-skip-permissions` in the default claude
    // exec cmd (77e0f68), so the fallback argv now includes that flag.
    expect(result.args).toEqual(["-p", "--dangerously-skip-permissions"]);
    expect(result.stdin).toBe("msg");
  });
});

describe("execTurnCoordinator.handleExecSessionEnd", () => {
  it("returns 'skip' for non-exec-mode terminals", () => {
    const { coordinator } = makeCoordinatorHarness(
      makeTerminal({ runtimeMode: "interactive" }),
    );
    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("skip");
  });

  it("returns 'skip' for unknown terminal", () => {
    const { coordinator } = makeCoordinatorHarness(makeTerminal());
    expect(coordinator.handleExecSessionEnd("does-not-exist", "pty_exit")).toBe("skip");
  });

  it("MED-2: returns 'done' without draining for claude-code (no resume primitive)", () => {
    const { coordinator, drain, startSession } = makeCoordinatorHarness(
      makeTerminal({ agentProvider: "claude-code" }),
    );
    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("done");
    expect(drain).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("returns 'done' when exit reason is operator_kill without timeout flag", () => {
    const { coordinator, drain, onTerminalDead } = makeCoordinatorHarness(makeTerminal());
    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("done");
    expect(drain).not.toHaveBeenCalled();
    expect(onTerminalDead).not.toHaveBeenCalled();
  });

  it("MED-1 + P1b.9: second consecutive timeout (retryCount=1) escalates DEAD", () => {
    const { coordinator, drain, onTerminalDead, terminals, persist } =
      makeCoordinatorHarness(
        makeTerminal({ turnNumber: 2, killedByTimeout: true, retryCount: 1 }),
      );
    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("dead");
    expect(drain).not.toHaveBeenCalled();
    expect(onTerminalDead).toHaveBeenCalledWith({
      kind: "timeout",
      terminalId: "terminal-1",
      turnNumber: 2,
    });
    // Both flags cleared after escalation.
    expect(terminals.get("terminal-1")?.killedByTimeout).toBeUndefined();
    expect(terminals.get("terminal-1")?.retryCount).toBeUndefined();
    expect(persist).toHaveBeenCalled();
  });

  it("P1b.9: first timeout (retryCount=0) + empty queue → respawn with synthetic marker alone", () => {
    const { coordinator, drain, onTerminalDead, markDelivered, markFailed, startSession, terminals, persist } =
      makeCoordinatorHarness(makeTerminal({ turnNumber: 1, killedByTimeout: true }));
    drain.mockReturnValue(null);

    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("respawn");

    const t = terminals.get("terminal-1");
    expect(t?.retryCount).toBe(1);
    expect(t?.turnNumber).toBe(2);
    expect(t?.nextTurnPrompt).toBe(
      "[Previous exec turn timed out and was killed. Resuming session.]",
    );
    expect(t?.killedByTimeout).toBeUndefined();
    expect(startSession).toHaveBeenCalledWith("terminal-1");
    expect(onTerminalDead).not.toHaveBeenCalled();
    expect(markDelivered).not.toHaveBeenCalled(); // no drained messages to mark
    expect(markFailed).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalled();
  });

  it("P1b.9: first timeout + queue has new messages → synthetic marker + drained composed, mark delivered", () => {
    const { coordinator, drain, onTerminalDead, markDelivered, startSession, terminals } =
      makeCoordinatorHarness(makeTerminal({ turnNumber: 1, killedByTimeout: true }));
    drain.mockReturnValue({
      prompt: "[Channel from peer]: ping",
      messageIds: ["msg-1", "msg-2"],
    });

    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("respawn");

    const t = terminals.get("terminal-1");
    expect(t?.retryCount).toBe(1);
    expect(t?.turnNumber).toBe(2);
    expect(t?.nextTurnPrompt).toBe(
      "[Previous exec turn timed out and was killed. Resuming session.]\n\n[Channel from peer]: ping",
    );
    expect(startSession).toHaveBeenCalledWith("terminal-1");
    expect(markDelivered).toHaveBeenCalledWith(["msg-1", "msg-2"]);
    expect(onTerminalDead).not.toHaveBeenCalled();
  });

  it("P1b.9: first timeout + startSession returns false → DEAD + messages FAILED + retry budget consumed", () => {
    const { coordinator, drain, markFailed, onTerminalDead, startSession, terminals, persist } =
      makeCoordinatorHarness(makeTerminal({ turnNumber: 1, killedByTimeout: true }));
    drain.mockReturnValue({ prompt: "p", messageIds: ["msg-1"] });
    startSession.mockReturnValue(false);

    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("dead");

    const t = terminals.get("terminal-1");
    // In-memory reverted — disk state should match pre-timeout turnNumber.
    expect(t?.turnNumber).toBe(1);
    expect(t?.nextTurnPrompt).toBeUndefined();
    expect(t?.retryCount).toBeUndefined();
    expect(t?.killedByTimeout).toBeUndefined();
    expect(markFailed).toHaveBeenCalledWith(["msg-1"], expect.stringMatching(/timeout retry/));
    expect(onTerminalDead).toHaveBeenCalledWith({
      kind: "timeout",
      terminalId: "terminal-1",
      turnNumber: 1,
    });
    expect(persist).toHaveBeenCalled();
  });

  it("P1b.9: first timeout + startSession throws → DEAD + messages FAILED + budget consumed", () => {
    const { coordinator, drain, markFailed, onTerminalDead, startSession, terminals } =
      makeCoordinatorHarness(makeTerminal({ turnNumber: 1, killedByTimeout: true }));
    drain.mockReturnValue({ prompt: "p", messageIds: ["msg-1"] });
    startSession.mockImplementation(() => {
      throw new Error("spawn blew up");
    });

    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("dead");

    const t = terminals.get("terminal-1");
    expect(t?.retryCount).toBeUndefined();
    expect(t?.turnNumber).toBe(1);
    expect(markFailed).toHaveBeenCalled();
    expect(onTerminalDead).toHaveBeenCalledWith({
      kind: "timeout",
      terminalId: "terminal-1",
      turnNumber: 1,
    });
  });

  it("P1b.9: first timeout at max-turns ceiling → DEAD with kind=max_turns (structural beats coincident)", () => {
    const { coordinator, drain, onTerminalDead, startSession, terminals } =
      makeCoordinatorHarness(
        makeTerminal({ turnNumber: 3, killedByTimeout: true }),
        { maxTurns: 3 },
      );

    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("dead");

    expect(drain).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(onTerminalDead).toHaveBeenCalledWith({
      kind: "max_turns",
      terminalId: "terminal-1",
      turnNumber: 3,
    });
    expect(terminals.get("terminal-1")?.retryCount).toBeUndefined();
    expect(terminals.get("terminal-1")?.killedByTimeout).toBeUndefined();
  });

  it("P1b.9: clean pty_exit with retryCount=1 resets it to undefined + persists", () => {
    const { coordinator, drain, persist, terminals } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 2, retryCount: 1 }),
    );
    drain.mockReturnValue(null); // queue empty → just a clean done

    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("done");

    const t = terminals.get("terminal-1");
    expect(t?.retryCount).toBeUndefined();
    // Persist fired for the reset (disk must reflect the budget refresh).
    expect(persist).toHaveBeenCalled();
  });

  it("P1b.9: clean pty_exit with retryCount=0/undefined skips the reset persist", () => {
    const { coordinator, drain, persist } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 2 }),
    );
    drain.mockReturnValue(null);

    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("done");

    // No reset to persist — persist should NOT fire (the done path doesn't
    // otherwise call it when queue is empty).
    expect(persist).not.toHaveBeenCalled();
  });

  it("P1b.9: timeout → retry → clean exit → timeout sequence treats second timeout as first (reset worked)", () => {
    const { coordinator, drain, onTerminalDead, terminals } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 1, killedByTimeout: true }),
    );
    drain.mockReturnValue(null);

    // First timeout → retry (retryCount 0→1).
    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("respawn");
    const afterFirst = terminals.get("terminal-1");
    expect(afterFirst?.retryCount).toBe(1);
    // Simulate ensureSession consuming nextTurnPrompt (real flow clears it
    // at sessionRuntime.ts:689 after spawn). The mock startSession doesn't,
    // so we mirror that here to model real behavior.
    if (afterFirst) delete afterFirst.nextTurnPrompt;

    // Clean exit between timeouts → retryCount resets to undefined.
    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("done");
    expect(terminals.get("terminal-1")?.retryCount).toBeUndefined();

    // Second timeout — but with retryCount reset, this is again a FIRST timeout.
    const beforeSecond = terminals.get("terminal-1");
    if (beforeSecond) beforeSecond.killedByTimeout = true;
    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("respawn");
    expect(terminals.get("terminal-1")?.retryCount).toBe(1);

    // No DEAD escalation fired across the sequence.
    expect(onTerminalDead).not.toHaveBeenCalled();
  });

  it("returns 'done' when queue is empty after clean exit", () => {
    const { coordinator, drain, startSession, terminals } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 0 }),
    );
    drain.mockReturnValue(null);
    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("done");
    expect(startSession).not.toHaveBeenCalled();
    expect(terminals.get("terminal-1")?.turnNumber).toBe(0);
  });

  it("MED-4: returns 'skip' if nextTurnPrompt is already set (re-entrancy guard)", () => {
    const { coordinator, drain, startSession } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 1, nextTurnPrompt: "in-flight" }),
    );
    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("skip");
    expect(drain).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("LOW-3: returns 'dead' + escalates when turnNumber >= max-turns ceiling", () => {
    const { coordinator, drain, onTerminalDead, startSession } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 3 }),
      { maxTurns: 3 },
    );
    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("dead");
    expect(drain).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(onTerminalDead).toHaveBeenCalledWith({
      kind: "max_turns",
      terminalId: "terminal-1",
      turnNumber: 3,
    });
  });

  it("respawns with queued messages + bumps turnNumber on clean exit with non-empty queue", () => {
    const { coordinator, drain, markDelivered, startSession, terminals, persist } =
      makeCoordinatorHarness(makeTerminal({ turnNumber: 0 }));
    drain.mockReturnValue({
      prompt: "[Channel message from peer]: ping",
      messageIds: ["msg-1"],
    });
    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("respawn");

    const t = terminals.get("terminal-1");
    expect(t?.turnNumber).toBe(1);
    expect(t?.nextTurnPrompt).toBe("[Channel message from peer]: ping");
    expect(startSession).toHaveBeenCalledWith("terminal-1");
    expect(markDelivered).toHaveBeenCalledWith(["msg-1"]);
    expect(persist).toHaveBeenCalled();
  });

  it("HIGH-2: persistTerminalChanges fires AFTER startSession, never before", () => {
    const callOrder: string[] = [];
    const drain = vi.fn(() => ({ prompt: "p", messageIds: ["m"] }));
    const startSession = vi.fn(() => {
      callOrder.push("startSession");
      return true;
    });
    const persist = vi.fn(() => callOrder.push("persist"));
    const { coordinator } = makeCoordinatorHarness(makeTerminal({ turnNumber: 0 }), {
      drainPendingForExecResume: drain,
      startSession,
      persistTerminalChanges: persist,
    });
    coordinator.handleExecSessionEnd("terminal-1", "pty_exit");
    // Persist must fire exactly once, and must come AFTER startSession — the
    // crash-consistency invariant.
    expect(callOrder).toEqual(["startSession", "persist"]);
  });

  it("HIGH-2: does NOT persist on startSession failure (reverts in-memory only)", () => {
    const { coordinator, drain, markDelivered, markFailed, startSession, terminals, persist } =
      makeCoordinatorHarness(makeTerminal({ turnNumber: 0 }));
    drain.mockReturnValue({ prompt: "p", messageIds: ["msg-1"] });
    startSession.mockReturnValue(false);

    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("done");

    const t = terminals.get("terminal-1");
    expect(t?.turnNumber).toBe(0);
    expect(t?.nextTurnPrompt).toBeUndefined();
    expect(markDelivered).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(["msg-1"], expect.stringMatching(/startSession/));
    // No persist on failure — disk state stays at turn N, not N+1.
    expect(persist).not.toHaveBeenCalled();
  });

  it("catches throws from startSession and reverts + marks failed (no persist)", () => {
    const { coordinator, drain, markFailed, startSession, terminals, persist } =
      makeCoordinatorHarness(makeTerminal({ turnNumber: 0 }));
    drain.mockReturnValue({ prompt: "p", messageIds: ["msg-1"] });
    startSession.mockImplementation(() => {
      throw new Error("spawn blew up");
    });

    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("done");

    const t = terminals.get("terminal-1");
    expect(t?.turnNumber).toBe(0);
    expect(markFailed).toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("bumps from turn N to N+1 on subsequent respawns", () => {
    const { coordinator, drain, terminals } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 3 }),
      { maxTurns: 100 },
    );
    drain.mockReturnValue({ prompt: "p", messageIds: ["m"] });
    coordinator.handleExecSessionEnd("terminal-1", "pty_exit");
    expect(terminals.get("terminal-1")?.turnNumber).toBe(4);
  });
});

describe("execTurnCoordinator — Phase 10.8.7 checkpoint integration", () => {
  it("writes a checkpoint with next turn number on clean-exit respawn, BEFORE startSession", () => {
    const callOrder: string[] = [];
    const writeCheckpoint = vi.fn(
      (args: { terminalId: string; turnNumber: number }) => {
        callOrder.push(`write:${args.terminalId}:${args.turnNumber}`);
      },
    );
    const startSession = vi.fn((terminalId: string) => {
      callOrder.push(`start:${terminalId}`);
      return true;
    });
    const { coordinator, drain } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 0 }),
      {
        writeCheckpoint,
        startSession,
      },
    );
    drain.mockReturnValue({
      prompt: "[Channel message from peer]: ping",
      messageIds: ["msg-1"],
    });

    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("respawn");

    // Checkpoint fires with turnNumber=1 (the turn we're respawning into).
    expect(writeCheckpoint).toHaveBeenCalledTimes(1);
    expect(writeCheckpoint).toHaveBeenCalledWith({
      terminalId: "terminal-1",
      turnNumber: 1,
    });
    // Ordering guarantee: checkpoint is on disk BEFORE the new turn starts,
    // so a crash between write and startSession still leaves recoverable state.
    expect(callOrder).toEqual([
      "write:terminal-1:1",
      "start:terminal-1",
    ]);
  });

  it("reads prior checkpoint on respawn (log-only; does not seed prompt)", () => {
    const readCheckpoint = vi.fn((_terminalId: string) => ({
      turnNumber: 0,
      updatedAt: "2026-04-22T00:00:00.000Z",
    }));
    const writeCheckpoint = vi.fn();
    const { coordinator, drain, terminals } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 0 }),
      {
        writeCheckpoint,
        readCheckpoint,
      },
    );
    drain.mockReturnValue({ prompt: "real prompt", messageIds: ["m"] });

    coordinator.handleExecSessionEnd("terminal-1", "pty_exit");

    // readCheckpoint was consulted.
    expect(readCheckpoint).toHaveBeenCalledWith("terminal-1");
    // But the prompt coming down stays the real drained prompt — checkpoint
    // is log-only, NOT seeded into nextTurnPrompt.
    expect(terminals.get("terminal-1")?.nextTurnPrompt).toBe("real prompt");
  });

  it("writes checkpoint on the first-timeout retry path too", () => {
    const writeCheckpoint = vi.fn();
    const { coordinator, drain, terminals } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 1, killedByTimeout: true }),
      { writeCheckpoint },
    );
    drain.mockReturnValue(null);

    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("respawn");

    expect(writeCheckpoint).toHaveBeenCalledWith({
      terminalId: "terminal-1",
      turnNumber: 2,
    });
    // Turn bumped to 2 in memory as well — checkpoint write and in-memory
    // state agree.
    expect(terminals.get("terminal-1")?.turnNumber).toBe(2);
  });

  it("does NOT write a checkpoint on paths that don't respawn (done / skip / dead)", () => {
    const writeCheckpoint = vi.fn();
    const { coordinator, drain, onTerminalDead } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 0 }),
      { writeCheckpoint },
    );
    drain.mockReturnValue(null);

    // Queue empty → "done" path.
    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("done");
    expect(writeCheckpoint).not.toHaveBeenCalled();

    // DEAD on max-turns.
    const maxOut = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 3 }),
      { writeCheckpoint, maxTurns: 3 },
    );
    expect(maxOut.coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("dead");
    expect(writeCheckpoint).not.toHaveBeenCalled();
    expect(onTerminalDead).not.toHaveBeenCalled(); // different harness; closure unaffected
  });

  it("checkpoint write failure does not block the respawn (swallowed)", () => {
    const writeCheckpoint = vi.fn(() => {
      throw new Error("disk full");
    });
    const startSession = vi.fn(() => true);
    const { coordinator, drain, terminals } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 0 }),
      { writeCheckpoint, startSession },
    );
    drain.mockReturnValue({ prompt: "p", messageIds: ["m"] });

    // Coordinator still respawns despite the checkpoint throw.
    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("respawn");
    expect(startSession).toHaveBeenCalledWith("terminal-1");
    expect(terminals.get("terminal-1")?.turnNumber).toBe(1);
  });
});

