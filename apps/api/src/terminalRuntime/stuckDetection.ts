import { logVerbose } from "../logging";
import type { PersistedTerminal, TerminalSession } from "./types";

/**
 * Stuck detection — Phase 10.8.6.
 *
 * Escalates a RUNNING terminal that has stopped emitting tool-call activity
 * through three tiers and finally DEAD:
 *
 *   HEALTHY  — tool-call activity within `tier1Ms`
 *      ↓ no activity for `tier1Ms`
 *   TIER_1   — @system channel message: "are you stuck?"
 *      ↓ no activity for `tier2Ms` after TIER_1 entry
 *   TIER_2   — @system channel message: "replan + summary"
 *      ↓ no activity for `deadMs` after TIER_2 entry
 *   DEAD     — killSession + onStuckEscalationExhausted(terminalId)
 *
 * Tool-call activity (session.lastToolCallAt update) resets the state to
 * HEALTHY regardless of current tier. Output activity after a tier message
 * also counts as a response, since the tier prompts explicitly ask the worker
 * to reply with progress or a blocker.
 *
 * Coordination with P1b.9 (commit b8ef492):
 *   - Terminals with `retryCount >= 1` are in a consumed-retry state owned
 *     by the exec turn coordinator — skip entirely. The coordinator will
 *     escalate DEAD on the next consecutive timeout; stuck detection
 *     double-firing here would mark the terminal DEAD twice.
 *   - Terminals with `killedByTimeout === true` are mid-teardown for
 *     P1b.9's timeout path — also skip.
 *
 * Synthetic sender: channel messages are sent with fromTerminalId="@system"
 * (the channel messaging API accepts any string there; the outbound
 * @mention parser only runs on agent-produced text, not on delivery, so
 * "@system" as a sender label does not loop).
 *
 * Persistence: `stuckTier` is mirrored to PersistedTerminal on every tier
 * transition for operator visibility across restarts. `lastToolCallAt` and
 * `lastActivityAt` stay on the in-memory session (hot write path) and are
 * therefore not persisted.
 */

export enum StuckTier {
  HEALTHY = "HEALTHY",
  STUCK_TIER_1 = "STUCK_TIER_1",
  STUCK_TIER_2 = "STUCK_TIER_2",
}

export const isStuckTier = (value: unknown): value is StuckTier =>
  value === StuckTier.HEALTHY ||
  value === StuckTier.STUCK_TIER_1 ||
  value === StuckTier.STUCK_TIER_2;

export type StuckEscalationExhausted = {
  terminalId: string;
  lastToolCallAt: number;
  now: number;
};

export type StuckDetectionThresholds = {
  /** Time from last activity to TIER_1 entry. Default 120_000 (2 min). */
  tier1Ms: number;
  /** Additional time in TIER_1 before TIER_2 entry. Default 60_000 (1 min). */
  tier2Ms: number;
  /** Additional time in TIER_2 before DEAD. Default 120_000 (2 min). */
  deadMs: number;
};

export type CreateStuckDetectorOptions = {
  terminals: Map<string, PersistedTerminal>;
  sessions: Map<string, TerminalSession>;
  thresholds: StuckDetectionThresholds;
  /**
   * Send a @system channel message to the stuck terminal. Wire to
   * channelMessaging.sendChannelMessage(toTerminalId, "@system", content).
   * Non-throwing — implementation should swallow errors and keep the
   * state machine progressing.
   */
  sendSystemChannelMessage: (terminalId: string, content: string) => void;
  /**
   * Produce the TIER_2 replan summary. Injected so sessionRuntime itself
   * stays unaware of exec log locations / git client / etc. Keep output
   * short (few hundred chars) — it rides inline on a channel message.
   */
  composeStuckSummary: (terminalId: string) => string;
  /**
   * Kill the session associated with `terminalId`. Wire to
   * sessionRuntime.killSession. Fires BEFORE onStuckEscalationExhausted
   * so the caller's lifecycle mutation can observe the session as gone.
   */
  killSession: (terminalId: string) => void;
  /**
   * Persist any in-memory PersistedTerminal mutations caused by a tier
   * transition (stuckTier + stuckTierEnteredAt fields). Wire to
   * `persistRegistry` / `registryPersistence.schedulePersist`.
   */
  persistTerminalChanges: () => void;
  /**
   * Notify observers of tier transitions. `tier === undefined` means the
   * terminal recovered to HEALTHY.
   */
  onStuckTierChange?: (
    terminalId: string,
    tier: StuckTier.STUCK_TIER_1 | StuckTier.STUCK_TIER_2 | undefined,
  ) => void;
  /**
   * Notify observers that the DEAD threshold was crossed. Wire to
   * markTerminalDead so lifecycle flips to "dead" and a
   * terminal-state-changed broadcast fires for operator attention.
   */
  onStuckEscalationExhausted?: (info: StuckEscalationExhausted) => void;
};

export type StuckDetector = {
  /**
   * Run one pass of stuck detection against the current session map.
   * Idempotent — safe to call arbitrarily often. Exposed for setInterval
   * wiring AND for deterministic tests that inject `now`.
   */
  runCheck: (now: number) => void;
};

const TIER_1_MESSAGE =
  "Status check: are you stuck? Reply with current progress or blocker.";
const TIER_2_MESSAGE_PREFIX = "Replan required:";
const TIER_2_MESSAGE_SUFFIX =
  "Decompose remaining work into smaller steps and resume.";

type ActiveStuckTier = StuckTier.STUCK_TIER_1 | StuckTier.STUCK_TIER_2;

const activeTierFromPersisted = (tier: StuckTier | undefined): ActiveStuckTier | undefined =>
  tier === StuckTier.STUCK_TIER_1 || tier === StuckTier.STUCK_TIER_2 ? tier : undefined;

const parseTierEnteredAt = (terminal: PersistedTerminal, fallback: number): number => {
  if (!terminal.stuckTierEnteredAt) {
    return fallback;
  }
  const parsed = Date.parse(terminal.stuckTierEnteredAt);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getLastToolCallAt = (session: TerminalSession, now: number): number =>
  typeof session.lastToolCallAt === "number" ? session.lastToolCallAt : now;

const getLastResponseAt = (session: TerminalSession): number | undefined => {
  const values = [session.lastToolCallAt, session.lastActivityAt].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (values.length === 0) {
    return undefined;
  }
  return Math.max(...values);
};

export const createStuckDetector = (
  options: CreateStuckDetectorOptions,
): StuckDetector => {
  const {
    terminals,
    sessions,
    thresholds,
    sendSystemChannelMessage,
    composeStuckSummary,
    killSession,
    persistTerminalChanges,
    onStuckTierChange,
    onStuckEscalationExhausted,
  } = options;

  const runCheck = (now: number): void => {
    // Collect ids first; a DEAD transition mutates `sessions` (via killSession
    // → teardown → sessions.delete) which would invalidate the iterator.
    const sessionIds = [...sessions.keys()];

    for (const terminalId of sessionIds) {
      const session = sessions.get(terminalId);
      if (!session || session.isClosed) {
        continue;
      }

      const terminal = terminals.get(terminalId);
      if (!terminal) {
        continue;
      }

      // P1b.9 coordination: skip terminals whose retry budget has already
      // been consumed by the exec turn coordinator. The coordinator owns
      // the DEAD escalation for this terminal; double-firing would both
      // race and double-broadcast.
      if ((terminal.retryCount ?? 0) >= 1) {
        continue;
      }
      // Also skip the tight window where the exec timeout timer has set
      // killedByTimeout but teardown hasn't fired yet.
      if (terminal.killedByTimeout === true) {
        continue;
      }

      // If lastToolCallAt is unset (should not happen post-ensureSession,
      // but defensive), treat the current check as the activity anchor.
      const lastToolCallAt = getLastToolCallAt(session, now);
      const priorTier = activeTierFromPersisted(terminal.stuckTier);

      if (priorTier !== undefined) {
        const tierEnteredAt = parseTierEnteredAt(terminal, now);
        const lastResponseAt = getLastResponseAt(session);
        if (lastResponseAt !== undefined && lastResponseAt > tierEnteredAt) {
          delete terminal.stuckTier;
          delete terminal.stuckTierEnteredAt;
          persistTerminalChanges();
          onStuckTierChange?.(terminalId, undefined);
          continue;
        }
      }

      const elapsedSinceToolCall = now - lastToolCallAt;
      if (priorTier === undefined && elapsedSinceToolCall < thresholds.tier1Ms) {
        continue;
      }

      if (priorTier === undefined) {
        if (elapsedSinceToolCall < thresholds.tier1Ms) {
          continue;
        }
        terminal.stuckTier = StuckTier.STUCK_TIER_1;
        terminal.stuckTierEnteredAt = new Date(now).toISOString();
        persistTerminalChanges();
        try {
          sendSystemChannelMessage(terminalId, TIER_1_MESSAGE);
        } catch {
          // Swallow delivery errors — the state machine must keep moving.
        }
        onStuckTierChange?.(terminalId, StuckTier.STUCK_TIER_1);
        continue;
      }

      if (priorTier === StuckTier.STUCK_TIER_1) {
        const tierEnteredAt = parseTierEnteredAt(terminal, now);
        if (now - tierEnteredAt < thresholds.tier2Ms) {
          continue;
        }
        let summary = "";
        try {
          summary = composeStuckSummary(terminalId);
        } catch {
          summary = "(summary unavailable)";
        }
        terminal.stuckTier = StuckTier.STUCK_TIER_2;
        terminal.stuckTierEnteredAt = new Date(now).toISOString();
        persistTerminalChanges();
        const content = `${TIER_2_MESSAGE_PREFIX} ${summary}\n\n${TIER_2_MESSAGE_SUFFIX}`.trim();
        try {
          sendSystemChannelMessage(terminalId, content);
        } catch {
          // Swallow delivery errors — the state machine must keep moving.
        }
        onStuckTierChange?.(terminalId, StuckTier.STUCK_TIER_2);
        continue;
      }

      const tierEnteredAt = parseTierEnteredAt(terminal, now);
      if (now - tierEnteredAt < thresholds.deadMs) {
        continue;
      }

      // priorTier === STUCK_TIER_2 — escalation exhausted.
      delete terminal.stuckTier;
      delete terminal.stuckTierEnteredAt;
      persistTerminalChanges();
      logVerbose(`[Stuck] terminal=${terminalId} reason=stuck_escalation_exhausted`);
      try {
        killSession(terminalId);
      } catch {
        // Even if kill fails, fire the exhaustion callback so the lifecycle
        // still flips to DEAD for operator attention.
      }
      onStuckEscalationExhausted?.({
        terminalId,
        lastToolCallAt,
        now,
      });
    }
  };

  return { runCheck };
};
