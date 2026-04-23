import { describe, expect, it, vi } from "vitest";

import {
  StuckTier,
  createStuckDetector,
  type CreateStuckDetectorOptions,
} from "../src/terminalRuntime/stuckDetection";
import type { PersistedTerminal, TerminalSession } from "../src/terminalRuntime/types";

/**
 * Stuck-detection state-machine tests (Phase 10.8.6).
 *
 * These exercise the pure state transitions via injected `now` timestamps
 * — no setInterval, no real sessions. The four required coverage points
 * (spec rule 5):
 *
 *   (a) HEALTHY → TIER_1 transition
 *   (b) TIER_1 → TIER_2 → DEAD escalation
 *   (c) Resume to HEALTHY on tool-call activity
 *   (d) No double-fire with P1b.9 retry (retryCount >= 1 skips)
 *
 * Plus supplementary coverage for killedByTimeout skip + summary failure
 * swallowing + iterator safety on DEAD teardown.
 */

const THRESHOLDS = { tier1Ms: 120_000, tier2Ms: 60_000, deadMs: 120_000 };

type Harness = {
  detector: ReturnType<typeof createStuckDetector>;
  terminals: Map<string, PersistedTerminal>;
  sessions: Map<string, TerminalSession>;
  sendSystem: ReturnType<
    typeof vi.fn<CreateStuckDetectorOptions["sendSystemChannelMessage"]>
  >;
  composeSummary: ReturnType<
    typeof vi.fn<CreateStuckDetectorOptions["composeStuckSummary"]>
  >;
  kill: ReturnType<typeof vi.fn<CreateStuckDetectorOptions["killSession"]>>;
  persist: ReturnType<
    typeof vi.fn<CreateStuckDetectorOptions["persistTerminalChanges"]>
  >;
  onTier: ReturnType<
    typeof vi.fn<NonNullable<CreateStuckDetectorOptions["onStuckTierChange"]>>
  >;
  onExhausted: ReturnType<
    typeof vi.fn<
      NonNullable<CreateStuckDetectorOptions["onStuckEscalationExhausted"]>
    >
  >;
};

const makeTerminal = (
  overrides: Partial<PersistedTerminal> = {},
): PersistedTerminal => ({
  terminalId: "terminal-1",
  tentacleId: "t-1",
  tentacleName: "t",
  createdAt: new Date(0).toISOString(),
  workspaceMode: "worktree",
  agentProvider: "codex",
  runtimeMode: "exec",
  ...overrides,
});

const makeSession = (
  terminalId: string,
  lastToolCallAt: number,
  overrides: Partial<TerminalSession> = {},
): TerminalSession => {
  // Minimal session shape. The detector only reads a handful of fields; the
  // rest of the TerminalSession surface is stubbed so the cast below is
  // safe within the scope of these tests.
  const base = {
    terminalId,
    tentacleId: "t-1",
    cols: 80,
    rows: 24,
    clients: new Set(),
    directListeners: new Set(),
    isBootstrapCommandSent: false,
    scrollbackChunks: [],
    scrollbackBytes: 0,
    agentState: "idle" as const,
    lastActivityAt: lastToolCallAt,
    lastToolCallAt,
    isClosed: false,
    ...overrides,
  };
  return base as unknown as TerminalSession;
};

const makeHarness = (
  thresholds = THRESHOLDS,
  terminalOverrides: Partial<PersistedTerminal> = {},
  sessionOverrides: Partial<TerminalSession> = {},
  baseTime = 0,
): Harness => {
  const terminal = makeTerminal(terminalOverrides);
  const session = makeSession(terminal.terminalId, baseTime, sessionOverrides);
  const terminals = new Map<string, PersistedTerminal>([
    [terminal.terminalId, terminal],
  ]);
  const sessions = new Map<string, TerminalSession>([
    [terminal.terminalId, session],
  ]);
  const sendSystem = vi.fn<
    CreateStuckDetectorOptions["sendSystemChannelMessage"]
  >();
  const composeSummary = vi.fn<
    CreateStuckDetectorOptions["composeStuckSummary"]
  >(() => "cwd=/tmp\nturn=3\ngit_changed=2");
  const kill = vi.fn<CreateStuckDetectorOptions["killSession"]>(
    (terminalId: string) => {
      // Mimic sessionRuntime teardown: remove from sessions + mark closed.
      const entry = sessions.get(terminalId);
      if (entry) {
        entry.isClosed = true;
        sessions.delete(terminalId);
      }
    },
  );
  const persist = vi.fn<CreateStuckDetectorOptions["persistTerminalChanges"]>();
  const onTier = vi.fn<
    NonNullable<CreateStuckDetectorOptions["onStuckTierChange"]>
  >();
  const onExhausted = vi.fn<
    NonNullable<CreateStuckDetectorOptions["onStuckEscalationExhausted"]>
  >();
  const detector = createStuckDetector({
    terminals,
    sessions,
    thresholds,
    sendSystemChannelMessage: sendSystem,
    composeStuckSummary: composeSummary,
    killSession: kill,
    persistTerminalChanges: persist,
    onStuckTierChange: onTier,
    onStuckEscalationExhausted: onExhausted,
  });
  return {
    detector,
    terminals,
    sessions,
    sendSystem,
    composeSummary,
    kill,
    persist,
    onTier,
    onExhausted,
  };
};

describe("stuckDetection — HEALTHY → TIER_1 transition (spec rule 5a)", () => {
  it("leaves HEALTHY alone before the threshold elapses", () => {
    const h = makeHarness(THRESHOLDS, {}, {}, 0);
    h.detector.runCheck(THRESHOLDS.tier1Ms - 1);
    const terminal = h.terminals.get("terminal-1");
    expect(terminal?.stuckTier).toBeUndefined();
    expect(h.sendSystem).not.toHaveBeenCalled();
    expect(h.onTier).not.toHaveBeenCalled();
  });

  it("enters TIER_1 exactly at the threshold, sends @system status-check, persists", () => {
    const h = makeHarness(THRESHOLDS, {}, {}, 0);
    h.detector.runCheck(THRESHOLDS.tier1Ms);
    const terminal = h.terminals.get("terminal-1");
    expect(terminal?.stuckTier).toBe(StuckTier.STUCK_TIER_1);
    expect(terminal?.stuckTierEnteredAt).toBeTypeOf("string");
    expect(h.sendSystem).toHaveBeenCalledTimes(1);
    const [toId, content] = h.sendSystem.mock.calls[0]!;
    expect(toId).toBe("terminal-1");
    expect(content).toMatch(/stuck/i);
    expect(h.persist).toHaveBeenCalled();
    expect(h.onTier).toHaveBeenCalledWith("terminal-1", StuckTier.STUCK_TIER_1);
  });

  it("does not re-fire TIER_1 on subsequent ticks while still in TIER_1 window", () => {
    const h = makeHarness(THRESHOLDS, {}, {}, 0);
    h.detector.runCheck(THRESHOLDS.tier1Ms);
    h.sendSystem.mockClear();
    // Second tick still before tier2Ms has elapsed since TIER_1 entry.
    h.detector.runCheck(THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms - 1);
    expect(h.sendSystem).not.toHaveBeenCalled();
  });
});

describe("stuckDetection — TIER_1 → TIER_2 → DEAD escalation (spec rule 5b)", () => {
  it("enters TIER_2 after tier2Ms with replan summary + persists", () => {
    const h = makeHarness(THRESHOLDS, {}, {}, 0);
    // Enter TIER_1 at t=120_000.
    h.detector.runCheck(THRESHOLDS.tier1Ms);
    h.sendSystem.mockClear();
    h.persist.mockClear();
    h.onTier.mockClear();
    // Advance to TIER_2 threshold (tier2Ms AFTER tier_1 entry).
    h.detector.runCheck(THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms);
    const terminal = h.terminals.get("terminal-1");
    expect(terminal?.stuckTier).toBe(StuckTier.STUCK_TIER_2);
    expect(h.composeSummary).toHaveBeenCalledWith("terminal-1");
    expect(h.sendSystem).toHaveBeenCalledTimes(1);
    const [, content] = h.sendSystem.mock.calls[0]!;
    expect(content).toMatch(/replan/i);
    // Composed summary rides inline on the message.
    expect(content).toContain("cwd=/tmp");
    expect(h.persist).toHaveBeenCalled();
    expect(h.onTier).toHaveBeenCalledWith("terminal-1", StuckTier.STUCK_TIER_2);
  });

  it("escalates DEAD after deadMs in TIER_2 — killSession + onStuckEscalationExhausted", () => {
    const h = makeHarness(THRESHOLDS, {}, {}, 0);
    h.detector.runCheck(THRESHOLDS.tier1Ms);
    h.detector.runCheck(THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms);
    h.sendSystem.mockClear();
    h.onTier.mockClear();

    const deadTime = THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms + THRESHOLDS.deadMs;
    h.detector.runCheck(deadTime);

    expect(h.kill).toHaveBeenCalledWith("terminal-1");
    expect(h.onExhausted).toHaveBeenCalledTimes(1);
    const [info] = h.onExhausted.mock.calls[0]!;
    expect(info).toMatchObject({ terminalId: "terminal-1", now: deadTime });
    // DEAD clears the tier (lifecycle owner outside the detector flips to
    // "dead" via markTerminalDead in the outer runtime wiring).
    const terminal = h.terminals.get("terminal-1");
    expect(terminal?.stuckTier).toBeUndefined();
  });

  it("DEAD fires only once — second tick after escalation is a no-op (session gone)", () => {
    const h = makeHarness(THRESHOLDS, {}, {}, 0);
    h.detector.runCheck(THRESHOLDS.tier1Ms);
    h.detector.runCheck(THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms);
    h.detector.runCheck(
      THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms + THRESHOLDS.deadMs,
    );
    expect(h.kill).toHaveBeenCalledTimes(1);
    expect(h.onExhausted).toHaveBeenCalledTimes(1);

    // Second tick — session has been deleted by the mock killSession.
    h.detector.runCheck(
      THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms + THRESHOLDS.deadMs + 1,
    );
    expect(h.kill).toHaveBeenCalledTimes(1);
    expect(h.onExhausted).toHaveBeenCalledTimes(1);
  });
});

describe("stuckDetection — resume to HEALTHY on activity (spec rule 5c)", () => {
  it("recovers from TIER_1 when lastActivityAt advances past tier-entry", () => {
    const h = makeHarness(THRESHOLDS, {}, {}, 0);
    h.detector.runCheck(THRESHOLDS.tier1Ms);
    expect(h.terminals.get("terminal-1")?.stuckTier).toBe(StuckTier.STUCK_TIER_1);
    h.onTier.mockClear();
    h.persist.mockClear();

    // Worker "replies": bump both activity timestamps past the tier-entry.
    const session = h.sessions.get("terminal-1")!;
    const responseAt = THRESHOLDS.tier1Ms + 1_000;
    session.lastActivityAt = responseAt;
    session.lastToolCallAt = responseAt;

    // Next poll tick AFTER the response.
    h.detector.runCheck(responseAt + 100);
    const terminal = h.terminals.get("terminal-1")!;
    expect(terminal.stuckTier).toBeUndefined();
    expect(terminal.stuckTierEnteredAt).toBeUndefined();
    expect(h.onTier).toHaveBeenCalledWith("terminal-1", undefined);
    expect(h.persist).toHaveBeenCalled();
    // Should NOT have escalated to TIER_2 or DEAD.
    expect(h.kill).not.toHaveBeenCalled();
    expect(h.onExhausted).not.toHaveBeenCalled();
  });

  it("recovers from TIER_2 just as cleanly", () => {
    const h = makeHarness(THRESHOLDS, {}, {}, 0);
    h.detector.runCheck(THRESHOLDS.tier1Ms);
    h.detector.runCheck(THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms);
    expect(h.terminals.get("terminal-1")?.stuckTier).toBe(StuckTier.STUCK_TIER_2);

    const session = h.sessions.get("terminal-1")!;
    const responseAt = THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms + 500;
    session.lastActivityAt = responseAt;
    session.lastToolCallAt = responseAt;

    h.onTier.mockClear();
    h.detector.runCheck(responseAt + 100);
    expect(h.terminals.get("terminal-1")?.stuckTier).toBeUndefined();
    expect(h.onTier).toHaveBeenCalledWith("terminal-1", undefined);
    expect(h.kill).not.toHaveBeenCalled();
  });
});

describe("stuckDetection — P1b.9 coordination (spec rule 5d)", () => {
  it("skips terminals with retryCount >= 1 (coordinator owns the DEAD path)", () => {
    const h = makeHarness(THRESHOLDS, { retryCount: 1 }, {}, 0);
    // Walk through all three thresholds — nothing should fire.
    h.detector.runCheck(THRESHOLDS.tier1Ms);
    h.detector.runCheck(THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms);
    h.detector.runCheck(
      THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms + THRESHOLDS.deadMs,
    );
    expect(h.sendSystem).not.toHaveBeenCalled();
    expect(h.kill).not.toHaveBeenCalled();
    expect(h.onExhausted).not.toHaveBeenCalled();
    expect(h.terminals.get("terminal-1")?.stuckTier).toBeUndefined();
  });

  it("skips terminals mid-timeout-teardown (killedByTimeout === true)", () => {
    const h = makeHarness(THRESHOLDS, { killedByTimeout: true }, {}, 0);
    h.detector.runCheck(THRESHOLDS.tier1Ms);
    expect(h.sendSystem).not.toHaveBeenCalled();
    expect(h.terminals.get("terminal-1")?.stuckTier).toBeUndefined();
  });

  it("after coordinator finishes retry (retryCount cleared), stuck detection re-engages", () => {
    const h = makeHarness(THRESHOLDS, { retryCount: 1 }, {}, 0);
    h.detector.runCheck(THRESHOLDS.tier1Ms);
    expect(h.sendSystem).not.toHaveBeenCalled();

    // Simulate coordinator clearing retryCount on clean exit.
    delete h.terminals.get("terminal-1")!.retryCount;
    h.detector.runCheck(THRESHOLDS.tier1Ms + 10);
    expect(h.terminals.get("terminal-1")?.stuckTier).toBe(StuckTier.STUCK_TIER_1);
    expect(h.sendSystem).toHaveBeenCalledTimes(1);
  });
});

describe("stuckDetection — resilience", () => {
  it("summary failure does not block TIER_2 transition", () => {
    const h = makeHarness(THRESHOLDS, {}, {}, 0);
    h.composeSummary.mockImplementation(() => {
      throw new Error("exec log missing");
    });
    h.detector.runCheck(THRESHOLDS.tier1Ms);
    h.detector.runCheck(THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms);
    expect(h.terminals.get("terminal-1")?.stuckTier).toBe(StuckTier.STUCK_TIER_2);
    const [, content] = h.sendSystem.mock.calls[1]!;
    expect(content).toContain("(summary unavailable)");
  });

  it("sendSystemChannelMessage failure does not block the state machine", () => {
    const h = makeHarness(THRESHOLDS, {}, {}, 0);
    h.sendSystem.mockImplementation(() => {
      throw new Error("channel store offline");
    });
    h.detector.runCheck(THRESHOLDS.tier1Ms);
    expect(h.terminals.get("terminal-1")?.stuckTier).toBe(StuckTier.STUCK_TIER_1);
    // Subsequent tier advance still happens.
    h.detector.runCheck(THRESHOLDS.tier1Ms + THRESHOLDS.tier2Ms);
    expect(h.terminals.get("terminal-1")?.stuckTier).toBe(StuckTier.STUCK_TIER_2);
  });

  it("sessionIds snapshot is taken before iteration so DEAD teardown is safe", () => {
    // Two stuck terminals in the same tick. The first hits DEAD (killSession
    // removes it from the sessions Map). The iterator must not skip the
    // second one, and must not crash.
    const terminals = new Map<string, PersistedTerminal>();
    const sessions = new Map<string, TerminalSession>();
    for (const id of ["terminal-A", "terminal-B"]) {
      terminals.set(id, makeTerminal({ terminalId: id }));
      sessions.set(id, makeSession(id, 0));
    }
    const kill = vi.fn((terminalId: string) => {
      const entry = sessions.get(terminalId);
      if (entry) {
        entry.isClosed = true;
        sessions.delete(terminalId);
      }
    });
    const onExhausted = vi.fn();
    const detector = createStuckDetector({
      terminals,
      sessions,
      thresholds: THRESHOLDS,
      sendSystemChannelMessage: () => {},
      composeStuckSummary: () => "",
      killSession: kill,
      persistTerminalChanges: () => {},
      onStuckTierChange: () => {},
      onStuckEscalationExhausted: onExhausted,
    });
    // Walk both to DEAD in the same tick by pre-staging their tier state.
    for (const id of ["terminal-A", "terminal-B"]) {
      const t = terminals.get(id)!;
      t.stuckTier = StuckTier.STUCK_TIER_2;
      t.stuckTierEnteredAt = new Date(0).toISOString();
    }
    detector.runCheck(THRESHOLDS.deadMs);
    expect(kill).toHaveBeenCalledTimes(2);
    expect(onExhausted).toHaveBeenCalledTimes(2);
  });
});
