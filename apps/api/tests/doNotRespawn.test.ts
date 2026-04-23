import { describe, expect, it } from "vitest";

import {
  classifyExitOutput,
  type NonRetryableExitErrorClass,
} from "../src/terminalRuntime/exitErrorClassifier";
import { createExecTurnCoordinator } from "../src/terminalRuntime/execTurnCoordinator";
import { buildResumeCommand } from "../src/terminalRuntime/constants";
import type { PersistedTerminal } from "../src/terminalRuntime/types";

// Phase 10.9.7 — tests for doNotRespawn + exit error classification +
// resume-command sandbox fix. All four fixes in one test file so the
// respawn-loop guarantee is proven in one place.

const makeTerminal = (overrides: Partial<PersistedTerminal> = {}): PersistedTerminal =>
  ({
    terminalId: "terminal-1",
    label: "terminal-1",
    tentacleId: "t1",
    tentacleName: "t1",
    workspaceMode: "worktree",
    createdAt: "2026-04-23T00:00:00Z",
    runtimeMode: "exec",
    agentProvider: "codex",
    ...overrides,
  }) as PersistedTerminal;

describe("classifyExitOutput", () => {
  const expectClass = (output: string, cls: NonRetryableExitErrorClass | null) => {
    expect(classifyExitOutput(output)).toBe(cls);
  };

  it("returns null on empty / null input", () => {
    expect(classifyExitOutput("")).toBe(null);
    expect(classifyExitOutput(null)).toBe(null);
    expect(classifyExitOutput(undefined)).toBe(null);
  });

  it("returns null on non-error output", () => {
    expectClass("Running. Tool call: read_file. Exit code 0.", null);
    expectClass("All tests passed. No issues.", null);
  });

  it("classifies rate-limit errors", () => {
    expectClass("Error: 429 Too Many Requests", "rate_limit");
    expectClass("rate-limited, please retry", "rate_limit");
    expectClass("too many requests, slow down", "rate_limit");
  });

  it("classifies quota errors", () => {
    expectClass("Error: quota exceeded", "quota");
    expectClass("You've exceeded your plan's usage", "quota");
    expectClass("You're out of extra usage · resets 11:30am (America/New_York)", "quota");
    expectClass(
      "ERROR: You've hit your usage limit. Upgrade to Pro, purchase more credits or try again at 1:38 PM.",
      "quota",
    );
    expectClass("Upgrade to Pro for more usage", "quota");
    expectClass("insufficient credits", "quota");
  });

  it("classifies auth errors", () => {
    expectClass("401 Unauthorized", "auth");
    expectClass("Invalid API key provided", "auth");
    expectClass("Authentication failed", "auth");
    expectClass("Your session has expired — please log in", "auth");
  });

  it("auth takes precedence over quota over rate_limit when multiple match", () => {
    // Practical sequence: a token expires (401), the retry hits rate-limit.
    // We want to report auth, the more definitive class.
    const mixed = "401 Unauthorized. Error: 429 Too Many Requests";
    expectClass(mixed, "auth");
    const quotaAndRate = "quota exceeded. rate-limited downstream.";
    expectClass(quotaAndRate, "quota");
  });

  it("scans only the tail of long outputs for efficiency", () => {
    const prefix = "A".repeat(1_000_000);
    const withError = `${prefix}\nError: 429 Too Many Requests\n`;
    // Should still detect — tail includes the end.
    expectClass(withError, "rate_limit");
  });
});

describe("ExecTurnCoordinator doNotRespawn + classifier", () => {
  it("returns 'done' when doNotRespawn=true, regardless of reason", () => {
    const terminals = new Map<string, PersistedTerminal>();
    terminals.set("terminal-1", makeTerminal({ doNotRespawn: true }));
    let startCalls = 0;
    const coordinator = createExecTurnCoordinator({
      terminals,
      drainPendingForExecResume: () => ({ prompt: "hello", messageIds: ["m1"] }),
      markExecPromptDelivered: () => {},
      markExecPromptFailed: () => {},
      startSession: () => {
        startCalls += 1;
        return true;
      },
    });

    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("done");
    expect(coordinator.handleExecSessionEnd("terminal-1", "operator_kill")).toBe("done");
    expect(startCalls).toBe(0);
  });

  it("sets doNotRespawn + returns 'dead' when classifier detects quota error", () => {
    const terminals = new Map<string, PersistedTerminal>();
    terminals.set("terminal-1", makeTerminal({ turnNumber: 3 }));
    let startCalls = 0;
    let deadCalls = 0;
    const coordinator = createExecTurnCoordinator({
      terminals,
      drainPendingForExecResume: () => ({ prompt: "hello", messageIds: ["m1"] }),
      markExecPromptDelivered: () => {},
      markExecPromptFailed: () => {},
      startSession: () => {
        startCalls += 1;
        return true;
      },
      onTerminalDead: () => {
        deadCalls += 1;
      },
      readExitOutput: () => "Error: quota exceeded. Upgrade to Pro for more usage.",
    });

    const outcome = coordinator.handleExecSessionEnd("terminal-1", "pty_exit");
    expect(outcome).toBe("dead");
    expect(startCalls).toBe(0);
    expect(deadCalls).toBe(1);
    expect(terminals.get("terminal-1")?.doNotRespawn).toBe(true);
    expect(terminals.get("terminal-1")?.lastExitErrorClass).toBe("quota");
  });

  it("sets doNotRespawn + returns 'dead' when classifier detects rate-limit", () => {
    const terminals = new Map<string, PersistedTerminal>();
    terminals.set("terminal-1", makeTerminal());
    const coordinator = createExecTurnCoordinator({
      terminals,
      drainPendingForExecResume: () => null,
      markExecPromptDelivered: () => {},
      markExecPromptFailed: () => {},
      startSession: () => true,
      readExitOutput: () => "Error: 429 Too Many Requests — rate-limited",
    });
    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("dead");
    expect(terminals.get("terminal-1")?.lastExitErrorClass).toBe("rate_limit");
  });

  it("sets doNotRespawn + returns 'dead' when classifier detects auth failure", () => {
    const terminals = new Map<string, PersistedTerminal>();
    terminals.set("terminal-1", makeTerminal());
    const coordinator = createExecTurnCoordinator({
      terminals,
      drainPendingForExecResume: () => null,
      markExecPromptDelivered: () => {},
      markExecPromptFailed: () => {},
      startSession: () => true,
      readExitOutput: () => "401 Unauthorized — Invalid API key",
    });
    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("dead");
    expect(terminals.get("terminal-1")?.lastExitErrorClass).toBe("auth");
  });

  it("does NOT set doNotRespawn when classifier returns null (normal exit)", () => {
    const terminals = new Map<string, PersistedTerminal>();
    terminals.set("terminal-1", makeTerminal({ turnNumber: 0 }));
    const coordinator = createExecTurnCoordinator({
      terminals,
      drainPendingForExecResume: () => ({ prompt: "next", messageIds: ["m1"] }),
      markExecPromptDelivered: () => {},
      markExecPromptFailed: () => {},
      startSession: () => true,
      readExitOutput: () => "Session completed successfully.",
    });
    expect(coordinator.handleExecSessionEnd("terminal-1", "pty_exit")).toBe("respawn");
    expect(terminals.get("terminal-1")?.doNotRespawn).toBeUndefined();
  });

  it("swallows classifier exceptions (best-effort) and falls through to normal flow", () => {
    const terminals = new Map<string, PersistedTerminal>();
    terminals.set("terminal-1", makeTerminal({ turnNumber: 0 }));
    const coordinator = createExecTurnCoordinator({
      terminals,
      drainPendingForExecResume: () => ({ prompt: "next", messageIds: ["m1"] }),
      markExecPromptDelivered: () => {},
      markExecPromptFailed: () => {},
      startSession: () => true,
      readExitOutput: () => {
        throw new Error("disk unavailable");
      },
    });
    // Should not throw; classifier failure is best-effort.
    const outcome = coordinator.handleExecSessionEnd("terminal-1", "pty_exit");
    expect(outcome).toBe("respawn");
  });
});

describe("buildResumeCommand — --sandbox strip fix (P2-#6)", () => {
  it("codex resume without roots has NO --sandbox and NO bypass flag", () => {
    const result = buildResumeCommand("codex", "hello", "/tmp/out.json", "sess-123");
    expect(result.command).toBe("codex");
    expect(result.args).not.toContain("--sandbox");
    expect(result.args).not.toContain("workspace-write");
    expect(result.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(result.args).toContain("resume");
    expect(result.args).toContain("sess-123");
  });

  it("codex resume WITH roots has --add-dir entries but NO --sandbox", () => {
    const result = buildResumeCommand(
      "codex",
      "hello",
      "/tmp/out.json",
      "sess-456",
      ["/path/a", "/path/b"],
    );
    expect(result.args).not.toContain("--sandbox");
    expect(result.args).not.toContain("workspace-write");
    expect(result.args).toContain("--add-dir");
    expect(result.args).toContain("/path/a");
    expect(result.args).toContain("/path/b");
  });

  it("falls back to --last when sessionId is empty", () => {
    const result = buildResumeCommand("codex", "hello", "/tmp/out.json", "");
    expect(result.args).toContain("--last");
  });
});
