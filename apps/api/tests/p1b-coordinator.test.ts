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
  it("codex + no sessionId: uses --last with canonical sandbox flag", () => {
    const result = buildResumeCommand("codex", "queued msg", "/tmp/out.json");
    expect(result.command).toBe("codex");
    expect(result.args).toEqual([
      "exec",
      "resume",
      "--last",
      "--dangerously-bypass-approvals-and-sandbox",
      "--output-last-message",
      "/tmp/out.json",
      "-",
    ]);
    expect(result.stdin).toBe("queued msg");
  });

  it("codex + sessionId: resumes the exact session (safe under shared cwd)", () => {
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
      "--dangerously-bypass-approvals-and-sandbox",
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
    expect(result.args).toEqual(["-p"]);
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

  it("MED-1: returns 'dead' + escalates when killedByTimeout flag is set", () => {
    const { coordinator, drain, onTerminalDead, terminals, persist } =
      makeCoordinatorHarness(makeTerminal({ turnNumber: 2, killedByTimeout: true }));
    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("dead");
    expect(drain).not.toHaveBeenCalled();
    expect(onTerminalDead).toHaveBeenCalledWith({
      kind: "timeout",
      terminalId: "terminal-1",
      turnNumber: 2,
    });
    // Flag is cleared after consumption.
    expect(terminals.get("terminal-1")?.killedByTimeout).toBeUndefined();
    expect(persist).toHaveBeenCalled();
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
