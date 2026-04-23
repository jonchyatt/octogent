import type {
  DeckTentacleLiveState,
  DeckTentacleLiveSummary,
  TerminalSnapshot,
} from "@octogent/core";

// Phase 10.9.5 — derive a tentacle's live terminal state from its attached
// terminal snapshots. Pure function; no I/O. The DECK tile displays this
// instead of the stored `status` field because the latter reflects operator
// intent (parked project vs active project), not runtime reality (is a
// worker currently attached + running).
//
// Why this exists: S38 respawn loop burned Jon's paid Codex Pro quota because
// the DECK tile said "IDLE" while a codex worker was actively failing +
// respawning every 60 seconds. Had the tile correctly said
// "FAILED (quota)" or "RUNNING WITH ERRORS", we'd have killed it within the
// first minute instead of after 10.

const SORT_DESC_BY_CREATED_AT = (a: TerminalSnapshot, b: TerminalSnapshot): number => {
  const aT = a.createdAt ?? "";
  const bT = b.createdAt ?? "";
  if (aT === bT) return 0;
  return aT < bT ? 1 : -1;
};

const isNonRetryableErrorClass = (cls: string | null | undefined): boolean => {
  if (!cls) return false;
  return cls === "rate_limit" || cls === "quota" || cls === "auth";
};

const buildFailureLabel = (errorClass: string | null): string => {
  switch (errorClass) {
    case "rate_limit":
      return "FAILED (rate limit)";
    case "quota":
      return "FAILED (quota)";
    case "auth":
      return "FAILED (auth)";
    case "operator_kill":
      return "STOPPED (operator)";
    case "operator_stop":
      return "STOPPED (operator)";
    default:
      return "STOPPED";
  }
};

/**
 * Compute the live summary for a single tentacle given all terminal
 * snapshots in the system. Implementations filter to the tentacle's own
 * children by tentacleId.
 *
 * Precedence:
 *   1. Any running terminal → "running" (with "running-with-errors" sub-
 *      state if another terminal on the same tentacle failed non-retryably).
 *   2. Most-recent terminal has doNotRespawn=true → "failed".
 *   3. Any stale terminal → "stale".
 *   4. All terminals exited/stopped/dead cleanly → "inactive".
 *   5. No terminals attached → null (signal the UI to fall back to the
 *      static `status` field).
 */
export const deriveTentacleLiveState = (
  tentacleId: string,
  allTerminals: readonly TerminalSnapshot[],
): DeckTentacleLiveSummary => {
  const attached = allTerminals.filter((t) => t.tentacleId === tentacleId);
  if (attached.length === 0) {
    return {
      state: null,
      label: "",
      lastExitErrorClass: null,
      attachedTerminalCount: 0,
      runningTerminalCount: 0,
    };
  }

  const sorted = [...attached].sort(SORT_DESC_BY_CREATED_AT);
  const running = sorted.filter((t) => t.lifecycleState === "running");
  const failed = sorted.filter(
    (t) => t.doNotRespawn === true && isNonRetryableErrorClass(t.lastExitErrorClass),
  );

  // Case 1: at least one running. Annotate with "with-errors" if any other
  // attached terminal has a non-retryable failure.
  if (running.length > 0) {
    const hasPeerError = failed.length > 0;
    return {
      state: hasPeerError ? "running-with-errors" : "running",
      label: hasPeerError ? `RUNNING (${running.length}, peer-errors)` : `RUNNING (${running.length})`,
      lastExitErrorClass: hasPeerError ? (failed[0]?.lastExitErrorClass ?? null) : null,
      attachedTerminalCount: attached.length,
      runningTerminalCount: running.length,
    };
  }

  // Case 2: most recent has doNotRespawn true.
  const mostRecent = sorted[0];
  if (mostRecent?.doNotRespawn === true) {
    const cls = mostRecent.lastExitErrorClass ?? null;
    return {
      state: "failed",
      label: buildFailureLabel(cls),
      lastExitErrorClass: cls,
      attachedTerminalCount: attached.length,
      runningTerminalCount: 0,
    };
  }

  // Case 3: any stale.
  if (sorted.some((t) => t.lifecycleState === "stale")) {
    return {
      state: "stale",
      label: "STALE",
      lastExitErrorClass: null,
      attachedTerminalCount: attached.length,
      runningTerminalCount: 0,
    };
  }

  // Case 4: clean inactive — all exited/stopped/dead without non-retryable
  // error class.
  return {
    state: "inactive",
    label: "INACTIVE",
    lastExitErrorClass: null,
    attachedTerminalCount: attached.length,
    runningTerminalCount: 0,
  };
};

/**
 * Compute live summaries for ALL tentacles in one pass. The caller passes
 * in the tentacle IDs (from readDeckTentacles) + terminal snapshots (from
 * runtime.listTerminalSnapshots) and receives a map the deckRoutes handler
 * can use to enrich each DeckTentacleSummary.
 */
export const deriveAllTentacleLiveStates = (
  tentacleIds: readonly string[],
  allTerminals: readonly TerminalSnapshot[],
): Map<string, DeckTentacleLiveSummary> => {
  const result = new Map<string, DeckTentacleLiveSummary>();
  for (const tentacleId of tentacleIds) {
    result.set(tentacleId, deriveTentacleLiveState(tentacleId, allTerminals));
  }
  return result;
};

export type { DeckTentacleLiveState, DeckTentacleLiveSummary };
