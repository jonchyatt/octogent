import { existsSync } from "node:fs";

import { logVerbose } from "../logging";
import { ChannelStore } from "./channelStore";
import type { ChannelMessage, PersistedTerminal, TerminalSession } from "./types";

/**
 * Channel messaging — agent-to-agent message delivery.
 *
 * As of Jarvis M0.02 Phase 10.8.1 (Session 31), backed by a SQLite-WAL durable
 * store (`channelStore.ts`) instead of the prior in-memory Map. External API
 * surface is unchanged — `sendChannelMessage` / `listChannelMessages` /
 * `deliverChannelMessages` behave identically to callers.
 *
 * The durable store adds:
 *   - Messages survive API restarts
 *   - Workers atomically `claim` pending on boot
 *   - Stale messages auto-recover from queued/processing after 10 min
 *   - Retry with dead-letter at MAX_RETRIES (5)
 *   - Status counts for diagnostics
 */

export type CreateChannelMessagingOptions = {
  terminals: Map<string, PersistedTerminal>;
  sessions: Map<string, TerminalSession>;
  writeInput: (terminalId: string, data: string) => boolean;
  /** Absolute path to SQLite DB file. Typically under the project state dir. */
  dbPath: string;
};

export const createChannelMessaging = (deps: CreateChannelMessagingOptions) => {
  const { terminals, sessions, writeInput, dbPath } = deps;
  const store = new ChannelStore({ dbPath });
  let channelMessageCounter = 0;

  // On boot, recover anything that was stuck in queued/processing (e.g., from
  // a hard crash that happened mid-delivery). Default 10-min threshold. Only run
  // if the DB file already exists — fresh workspaces shouldn't create it eagerly.
  if (existsSync(dbPath)) {
    const recovered = store.recoverStale();
    if (recovered > 0) {
      logVerbose(`[Channel] Recovered ${recovered} stale message(s) from prior session`);
    }
  }

  const deliverChannelMessages = (terminalId: string): number => {
    const session = sessions.get(terminalId);
    if (!session) {
      return 0;
    }

    // Claim all pending messages for this terminal (pending → queued, atomic).
    const claimed = store.claimPendingFor(terminalId);
    if (claimed.length === 0) {
      return 0;
    }

    // Compose into a single PTY write, mirroring prior behavior.
    const lines = claimed.map(
      (m) => `[Channel message from ${m.fromTerminalId}]: ${m.content}`,
    );
    const prompt = `${lines.join("\n")}\r`;

    logVerbose(`[Channel] Delivering ${claimed.length} message(s) to ${terminalId}`);

    // Mark processing, write to PTY, mark delivered. If writeInput throws or
    // returns false, fail the messages so they revert to pending for retry.
    for (const m of claimed) {
      store.markProcessing(m.messageId);
    }

    let ok = false;
    try {
      ok = writeInput(terminalId, prompt) !== false;
    } catch (err) {
      const errMsg = (err as Error)?.message ?? String(err);
      for (const m of claimed) store.markFailed(m.messageId, errMsg);
      return 0;
    }

    if (!ok) {
      for (const m of claimed) store.markFailed(m.messageId, "writeInput returned false");
      return 0;
    }

    for (const m of claimed) store.markDelivered(m.messageId);
    return claimed.length;
  };

  return {
    sendChannelMessage(
      toTerminalId: string,
      fromTerminalId: string,
      content: string,
    ): ChannelMessage | null {
      if (!terminals.has(toTerminalId)) {
        return null;
      }

      channelMessageCounter += 1;
      const message: ChannelMessage = {
        messageId: `msg-${Date.now()}-${channelMessageCounter}`,
        fromTerminalId,
        toTerminalId,
        content,
        timestamp: new Date().toISOString(),
        delivered: false,
      };

      const inserted = store.enqueue(message);
      if (inserted === null) {
        // Duplicate messageId (extremely rare given timestamp + counter); skip.
        return null;
      }

      logVerbose(
        `[Channel] Queued message ${message.messageId} from=${fromTerminalId} to=${toTerminalId}`,
      );

      // If the target session is idle, deliver immediately (same hot-path as before).
      //
      // Exception: exec-mode terminals must NEVER take the PTY-write delivery
      // path. Their writeInput is a no-op (prompt is already committed as
      // argv/stdin), which would fail the messages immediately. Queue-only
      // for exec; the exec turn coordinator drains on session exit and
      // respawns via `codex exec resume --last` with the messages as the
      // next-turn prompt.
      const targetTerminal = terminals.get(toTerminalId);
      const isExecMode = targetTerminal?.runtimeMode === "exec";
      const targetSession = sessions.get(toTerminalId);
      if (!isExecMode && targetSession && targetSession.agentState === "idle") {
        deliverChannelMessages(toTerminalId);
      }

      return message;
    },

    listChannelMessages(terminalId: string): ChannelMessage[] {
      return store.listForTerminal(terminalId);
    },

    deliverChannelMessages,

    /**
     * Drain pending channel messages for an exec-mode terminal and compose
     * them into a next-turn prompt. Used by the exec turn coordinator after
     * a worker exits to decide whether to respawn via `codex exec resume`.
     *
     * Atomically claims (pending → queued), returns the composed text +
     * messageIds. The caller MUST follow up with markExecPromptDelivered or
     * markExecPromptFailed — dangling claims auto-recover after 10 min via
     * `store.recoverStale()`.
     *
     * Returns null if no pending messages (no respawn needed).
     */
    drainPendingForExecResume(
      terminalId: string,
    ): { prompt: string; messageIds: string[] } | null {
      const claimed = store.claimPendingFor(terminalId);
      if (claimed.length === 0) {
        return null;
      }
      for (const m of claimed) {
        store.markProcessing(m.messageId);
      }
      const lines = claimed.map(
        (m) => `[Channel message from ${m.fromTerminalId}]: ${m.content}`,
      );
      return {
        prompt: lines.join("\n"),
        messageIds: claimed.map((m) => m.messageId),
      };
    },

    markExecPromptDelivered(messageIds: string[]): void {
      for (const id of messageIds) {
        store.markDelivered(id);
      }
    },

    markExecPromptFailed(messageIds: string[], error: string): void {
      for (const id of messageIds) {
        store.markFailed(id, error);
      }
    },

    /** Diagnostic: current status counts across all messages. */
    getChannelStatusCounts() {
      return store.getStatusCounts();
    },

    /** Call on server shutdown to close the DB handle cleanly. */
    close(): void {
      store.close();
    },
  };
};
