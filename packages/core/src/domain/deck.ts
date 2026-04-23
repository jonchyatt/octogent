export type DeckTentacleStatus = "idle" | "active" | "blocked" | "needs-review";

export type DeckOctopusAppearance = {
  animation: string | null;
  /** Valid: "normal" | "happy" | "angry" | "surprised". "sleepy" is reserved for idle state — never assign on creation. */
  expression: string | null;
  accessory: string | null;
  hairColor: string | null;
};

export type DeckAvailableSkill = {
  name: string;
  description: string;
  source: "project" | "user";
};

// Phase 10.9.5 — live terminal state rolled up across a tentacle's
// attached terminals. Derived at response time by joining terminal
// snapshots to tentacle records; not persisted to disk. When null, no
// terminal is attached or the tentacle is stored state only.
//
// Precedence (first-match-wins):
//   "running"             — at least one attached terminal lifecycleState=running
//   "running-with-errors" — at least one running AND at least one non-retryable
//                           exit on another attached terminal
//   "failed"              — most recent terminal has doNotRespawn=true
//                           (operator kill, quota, rate-limit, auth)
//   "stale"               — most recent terminal lifecycleState=stale
//   "inactive"            — terminals exist but all exited/stopped/dead cleanly
//   null                  — no terminals ever attached
export type DeckTentacleLiveState =
  | "running"
  | "running-with-errors"
  | "failed"
  | "stale"
  | "inactive"
  | null;

export type DeckTentacleLiveSummary = {
  state: DeckTentacleLiveState;
  // Human-readable badge label the UI shows (RUNNING / FAILED (quota) / etc).
  label: string;
  // For "failed" state, the error class that caused it. For other states, null.
  lastExitErrorClass: string | null;
  // Count of attached terminals regardless of state.
  attachedTerminalCount: number;
  // Count of attached terminals currently running (lifecycleState=running).
  runningTerminalCount: number;
};

export type DeckTentacleSummary = {
  tentacleId: string;
  displayName: string;
  description: string;
  status: DeckTentacleStatus;
  color: string | null;
  octopus: DeckOctopusAppearance;
  scope: {
    paths: string[];
    tags: string[];
  };
  vaultFiles: string[];
  todoTotal: number;
  todoDone: number;
  todoItems: { text: string; done: boolean }[];
  suggestedSkills: string[];
  // Phase 10.9.5 — live rolled-up state of attached terminals. Optional for
  // backwards compatibility — old clients ignore this field; new UI uses it
  // to drive the tile badge instead of the static `status` field (which
  // reflects operator intent, not runtime reality).
  liveTerminal?: DeckTentacleLiveSummary;
};
