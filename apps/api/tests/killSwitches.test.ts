import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildExecCommand,
  buildResumeCommand,
  isAutoRespawnDisabled,
  resolveAgentProvider,
} from "../src/terminalRuntime/constants";
import { createExecTurnCoordinator } from "../src/terminalRuntime/execTurnCoordinator";
import type { PersistedTerminal } from "../src/terminalRuntime/types";

// Phase 10.9.7: auto-respawn kill switch. Provider selection is explicit
// and must not silently substitute Claude for Codex.

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

describe("Codex provider routing", () => {
  const original = process.env.OCTOGENT_DISABLE_CODEX;
  afterEach(() => {
    if (original === undefined) delete process.env.OCTOGENT_DISABLE_CODEX;
    else process.env.OCTOGENT_DISABLE_CODEX = original;
  });

  it("resolveAgentProvider passes codex through when legacy env var is unset", () => {
    delete process.env.OCTOGENT_DISABLE_CODEX;
    expect(resolveAgentProvider("codex")).toBe("codex");
  });

  it("resolveAgentProvider still passes codex through when legacy env var is set", () => {
    process.env.OCTOGENT_DISABLE_CODEX = "1";
    expect(resolveAgentProvider("codex")).toBe("codex");
  });

  it("resolveAgentProvider never touches claude-code", () => {
    process.env.OCTOGENT_DISABLE_CODEX = "1";
    expect(resolveAgentProvider("claude-code")).toBe("claude-code");
  });

  it("buildExecCommand uses codex argv even when legacy env var is set", () => {
    process.env.OCTOGENT_DISABLE_CODEX = "1";
    const result = buildExecCommand("codex", "hello", "/tmp/out.json");
    expect(result.command).toBe("codex");
    expect(result.args).toContain("--output-last-message");
    expect(result.args).toContain("-");
    expect(result.stdin).toBe("hello");
  });

  it("buildResumeCommand uses codex resume even when legacy env var is set", () => {
    process.env.OCTOGENT_DISABLE_CODEX = "1";
    const result = buildResumeCommand("codex", "hello", "/tmp/out.json", "abc-session-id");
    expect(result.command).toBe("codex");
    expect(result.args).toContain("resume");
    expect(result.args).toContain("abc-session-id");
    expect(result.stdin).toBe("hello");
  });

  it("buildExecCommand honors codex provider when disabled=false", () => {
    delete process.env.OCTOGENT_DISABLE_CODEX;
    const result = buildExecCommand("codex", "hello", "/tmp/out.json");
    expect(result.command).toBe("codex");
    expect(result.args).toContain("--output-last-message");
  });
});

describe("OCTOGENT_DISABLE_AUTO_RESPAWN kill switch", () => {
  const original = process.env.OCTOGENT_DISABLE_AUTO_RESPAWN;
  afterEach(() => {
    if (original === undefined) delete process.env.OCTOGENT_DISABLE_AUTO_RESPAWN;
    else process.env.OCTOGENT_DISABLE_AUTO_RESPAWN = original;
  });

  it("isAutoRespawnDisabled is false when env var is unset", () => {
    delete process.env.OCTOGENT_DISABLE_AUTO_RESPAWN;
    expect(isAutoRespawnDisabled()).toBe(false);
  });

  it("isAutoRespawnDisabled is true when env var is '1'", () => {
    process.env.OCTOGENT_DISABLE_AUTO_RESPAWN = "1";
    expect(isAutoRespawnDisabled()).toBe(true);
  });

  it("exec coordinator returns 'done' when auto-respawn disabled (no startSession call)", () => {
    process.env.OCTOGENT_DISABLE_AUTO_RESPAWN = "1";
    const terminals = new Map<string, PersistedTerminal>();
    terminals.set("terminal-1", makeTerminal());
    let startSessionCalls = 0;
    const coordinator = createExecTurnCoordinator({
      terminals,
      drainPendingForExecResume: () => null,
      markExecPromptDelivered: () => {},
      markExecPromptFailed: () => {},
      startSession: () => {
        startSessionCalls += 1;
        return true;
      },
    });

    const outcome = coordinator.handleExecSessionEnd("terminal-1", "pty_exit");
    expect(outcome).toBe("done");
    expect(startSessionCalls).toBe(0);
  });

  it("exec coordinator returns 'done' for operator_kill when auto-respawn disabled", () => {
    process.env.OCTOGENT_DISABLE_AUTO_RESPAWN = "1";
    const terminals = new Map<string, PersistedTerminal>();
    terminals.set(
      "terminal-1",
      makeTerminal({ killedByTimeout: true, retryCount: 0, turnNumber: 0 }),
    );
    let startSessionCalls = 0;
    const coordinator = createExecTurnCoordinator({
      terminals,
      drainPendingForExecResume: () => null,
      markExecPromptDelivered: () => {},
      markExecPromptFailed: () => {},
      startSession: () => {
        startSessionCalls += 1;
        return true;
      },
    });

    // Even with a pending timeout-retry scenario, the switch forces "done".
    const outcome = coordinator.handleExecSessionEnd("terminal-1", "operator_kill");
    expect(outcome).toBe("done");
    expect(startSessionCalls).toBe(0);
  });

  it("exec coordinator normal respawn path works when switch is off (sanity)", () => {
    delete process.env.OCTOGENT_DISABLE_AUTO_RESPAWN;
    const terminals = new Map<string, PersistedTerminal>();
    terminals.set("terminal-1", makeTerminal({ turnNumber: 0 }));
    let startSessionCalls = 0;
    const coordinator = createExecTurnCoordinator({
      terminals,
      drainPendingForExecResume: () => ({ prompt: "next turn", messageIds: ["m1"] }),
      markExecPromptDelivered: () => {},
      markExecPromptFailed: () => {},
      startSession: () => {
        startSessionCalls += 1;
        return true;
      },
    });

    const outcome = coordinator.handleExecSessionEnd("terminal-1", "pty_exit");
    expect(outcome).toBe("respawn");
    expect(startSessionCalls).toBe(1);
  });
});
