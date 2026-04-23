import { describe, expect, it } from "vitest";

import type { TerminalSnapshot } from "@octogent/core";
import {
  deriveAllTentacleLiveStates,
  deriveTentacleLiveState,
} from "../src/deck/deriveTentacleLiveState";

// Phase 10.9.5 — the DECK tile badge derivation. Tests cover every branch
// of the precedence cascade (running > running-with-errors > failed >
// stale > inactive > null-no-terminals) plus the most-recent-by-createdAt
// tie-breaker used for the "failed" case.

const makeSnapshot = (overrides: Partial<TerminalSnapshot>): TerminalSnapshot =>
  ({
    terminalId: "terminal-x",
    label: "terminal-x",
    state: "exited",
    tentacleId: "t1",
    createdAt: "2026-04-23T00:00:00.000Z",
    ...overrides,
  }) as TerminalSnapshot;

describe("deriveTentacleLiveState", () => {
  it("returns state=null when no terminals are attached", () => {
    const result = deriveTentacleLiveState("t1", []);
    expect(result.state).toBe(null);
    expect(result.attachedTerminalCount).toBe(0);
    expect(result.runningTerminalCount).toBe(0);
    expect(result.label).toBe("");
  });

  it("returns state=null when terminals exist but none belong to the tentacle", () => {
    const terminals = [makeSnapshot({ terminalId: "terminal-1", tentacleId: "other" })];
    const result = deriveTentacleLiveState("t1", terminals);
    expect(result.state).toBe(null);
  });

  it("returns state=running when at least one terminal is lifecycleState=running", () => {
    const terminals = [
      makeSnapshot({ terminalId: "terminal-1", lifecycleState: "running" }),
      makeSnapshot({ terminalId: "terminal-2", lifecycleState: "exited" }),
    ];
    const result = deriveTentacleLiveState("t1", terminals);
    expect(result.state).toBe("running");
    expect(result.label).toBe("RUNNING (1)");
    expect(result.runningTerminalCount).toBe(1);
    expect(result.attachedTerminalCount).toBe(2);
  });

  it("counts multiple running terminals", () => {
    const terminals = [
      makeSnapshot({ terminalId: "t-a", lifecycleState: "running" }),
      makeSnapshot({ terminalId: "t-b", lifecycleState: "running" }),
      makeSnapshot({ terminalId: "t-c", lifecycleState: "running" }),
    ];
    const result = deriveTentacleLiveState("t1", terminals);
    expect(result.state).toBe("running");
    expect(result.label).toBe("RUNNING (3)");
    expect(result.runningTerminalCount).toBe(3);
  });

  it("promotes state=running-with-errors when a peer terminal failed non-retryably", () => {
    const terminals = [
      makeSnapshot({ terminalId: "t-live", lifecycleState: "running" }),
      makeSnapshot({
        terminalId: "t-dead",
        lifecycleState: "dead",
        doNotRespawn: true,
        lastExitErrorClass: "quota",
      }),
    ];
    const result = deriveTentacleLiveState("t1", terminals);
    expect(result.state).toBe("running-with-errors");
    expect(result.label).toContain("RUNNING");
    expect(result.label).toContain("peer-errors");
    expect(result.lastExitErrorClass).toBe("quota");
  });

  it("returns state=failed when most recent terminal has doNotRespawn + quota error", () => {
    const terminals = [
      makeSnapshot({
        terminalId: "t-old",
        lifecycleState: "exited",
        createdAt: "2026-04-22T00:00:00.000Z",
      }),
      makeSnapshot({
        terminalId: "t-new",
        lifecycleState: "dead",
        createdAt: "2026-04-23T00:00:00.000Z",
        doNotRespawn: true,
        lastExitErrorClass: "quota",
      }),
    ];
    const result = deriveTentacleLiveState("t1", terminals);
    expect(result.state).toBe("failed");
    expect(result.label).toBe("FAILED (quota)");
    expect(result.lastExitErrorClass).toBe("quota");
  });

  it("labels each non-retryable error class distinctly", () => {
    for (const [cls, expected] of [
      ["quota", "FAILED (quota)"],
      ["rate_limit", "FAILED (rate limit)"],
      ["auth", "FAILED (auth)"],
    ] as const) {
      const terminals = [
        makeSnapshot({
          lifecycleState: "dead",
          doNotRespawn: true,
          lastExitErrorClass: cls,
        }),
      ];
      const result = deriveTentacleLiveState("t1", terminals);
      expect(result.label).toBe(expected);
    }
  });

  it("labels operator_kill / operator_stop as STOPPED (operator)", () => {
    for (const cls of ["operator_kill", "operator_stop"]) {
      const terminals = [
        makeSnapshot({
          lifecycleState: "stopped",
          doNotRespawn: true,
          lastExitErrorClass: cls,
        }),
      ];
      const result = deriveTentacleLiveState("t1", terminals);
      expect(result.state).toBe("failed");
      expect(result.label).toBe("STOPPED (operator)");
    }
  });

  it("returns state=stale when any terminal is lifecycleState=stale and none running", () => {
    const terminals = [
      makeSnapshot({ terminalId: "t-a", lifecycleState: "stale" }),
      makeSnapshot({ terminalId: "t-b", lifecycleState: "exited" }),
    ];
    const result = deriveTentacleLiveState("t1", terminals);
    expect(result.state).toBe("stale");
    expect(result.label).toBe("STALE");
  });

  it("returns state=inactive when all terminals exited/stopped cleanly", () => {
    const terminals = [
      makeSnapshot({ terminalId: "t-a", lifecycleState: "exited" }),
      makeSnapshot({ terminalId: "t-b", lifecycleState: "stopped" }),
    ];
    const result = deriveTentacleLiveState("t1", terminals);
    expect(result.state).toBe("inactive");
    expect(result.label).toBe("INACTIVE");
  });

  it("running beats failed (if both attached, operator sees active worker)", () => {
    // Running terminal exists; another terminal is failed. Surface running,
    // but with the peer-errors warning (covered by earlier test).
    const terminals = [
      makeSnapshot({ terminalId: "t-live", lifecycleState: "running" }),
      makeSnapshot({
        terminalId: "t-dead",
        lifecycleState: "dead",
        doNotRespawn: true,
        lastExitErrorClass: "quota",
      }),
    ];
    expect(deriveTentacleLiveState("t1", terminals).state).toBe("running-with-errors");
  });

  it("doNotRespawn without a non-retryable error class is NOT treated as failure on a peer", () => {
    // doNotRespawn=true with operator_kill class should count as operator
    // intent, not a respawn-loop danger signal. The UI still shows it as
    // failed (STOPPED (operator)) when it's the most-recent terminal, but
    // its presence alongside a running terminal should NOT flip that other
    // terminal's state to "running-with-errors" (operator kill is intended,
    // not an error).
    const terminals = [
      makeSnapshot({ terminalId: "t-live", lifecycleState: "running" }),
      makeSnapshot({
        terminalId: "t-stopped",
        lifecycleState: "stopped",
        doNotRespawn: true,
        lastExitErrorClass: "operator_kill",
      }),
    ];
    const result = deriveTentacleLiveState("t1", terminals);
    expect(result.state).toBe("running");
    expect(result.label).toBe("RUNNING (1)");
  });

  it("filters terminals by tentacleId correctly", () => {
    const terminals = [
      makeSnapshot({ terminalId: "t-me", tentacleId: "t1", lifecycleState: "running" }),
      makeSnapshot({ terminalId: "t-other", tentacleId: "t2", lifecycleState: "running" }),
    ];
    const t1 = deriveTentacleLiveState("t1", terminals);
    const t2 = deriveTentacleLiveState("t2", terminals);
    expect(t1.state).toBe("running");
    expect(t1.runningTerminalCount).toBe(1);
    expect(t2.state).toBe("running");
    expect(t2.runningTerminalCount).toBe(1);
  });
});

describe("deriveAllTentacleLiveStates", () => {
  it("returns a map keyed by tentacleId", () => {
    const terminals = [
      makeSnapshot({ tentacleId: "a", lifecycleState: "running" }),
      makeSnapshot({ tentacleId: "b", lifecycleState: "exited" }),
    ];
    const result = deriveAllTentacleLiveStates(["a", "b", "c"], terminals);
    expect(result.get("a")?.state).toBe("running");
    expect(result.get("b")?.state).toBe("inactive");
    expect(result.get("c")?.state).toBe(null);
  });
});
