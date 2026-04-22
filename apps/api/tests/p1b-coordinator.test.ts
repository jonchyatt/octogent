import { describe, expect, it, vi } from "vitest";

import { buildResumeCommand } from "../src/terminalRuntime/constants";
import {
  createExecTurnCoordinator,
  type CreateExecTurnCoordinatorOptions,
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
  const coordinator = createExecTurnCoordinator({
    terminals,
    drainPendingForExecResume: drain,
    markExecPromptDelivered: markDelivered,
    markExecPromptFailed: markFailed,
    startSession,
    persistTerminalChanges: persist,
    ...overrides,
  });
  return { coordinator, terminals, drain, markDelivered, markFailed, startSession, persist };
};

describe("buildResumeCommand", () => {
  it("codex: inserts `resume --last` after `exec` and before sandbox flags", () => {
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

  it("returns 'done' when exit reason is operator_kill (no respawn on kill)", () => {
    const { coordinator, drain } = makeCoordinatorHarness(makeTerminal());
    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("done");
    expect(drain).not.toHaveBeenCalled();
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

  it("reverts optimistic state + marks messages failed if startSession returns false", () => {
    const { coordinator, drain, markDelivered, markFailed, startSession, terminals } =
      makeCoordinatorHarness(makeTerminal({ turnNumber: 0 }));
    drain.mockReturnValue({ prompt: "p", messageIds: ["msg-1"] });
    startSession.mockReturnValue(false);

    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("done");

    const t = terminals.get("terminal-1");
    expect(t?.turnNumber).toBe(0);
    expect(t?.nextTurnPrompt).toBeUndefined();
    expect(markDelivered).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(["msg-1"], expect.stringMatching(/startSession/));
  });

  it("catches throws from startSession and reverts + marks failed", () => {
    const { coordinator, drain, markFailed, startSession, terminals } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 0 }),
    );
    drain.mockReturnValue({ prompt: "p", messageIds: ["msg-1"] });
    startSession.mockImplementation(() => {
      throw new Error("spawn blew up");
    });

    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("done");

    const t = terminals.get("terminal-1");
    expect(t?.turnNumber).toBe(0);
    expect(markFailed).toHaveBeenCalled();
  });

  it("bumps from turn N to N+1 on subsequent respawns", () => {
    const { coordinator, drain, terminals } = makeCoordinatorHarness(
      makeTerminal({ turnNumber: 3 }),
    );
    drain.mockReturnValue({ prompt: "p", messageIds: ["m"] });
    coordinator.handleExecSessionEnd("terminal-1", "pty_exit");
    expect(terminals.get("terminal-1")?.turnNumber).toBe(4);
  });
});
