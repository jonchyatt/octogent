/**
 * channelStore — SQLite-WAL backed durable message queue for agent-to-agent channels.
 *
 * Ports TinyAGI's pattern from
 * `C:/Users/jonch/Projects/tinyagi/packages/core/src/queues.ts` (Jarvis M0.02 Phase
 * 10.8.1). Replaces the previous in-memory `Map<string, ChannelMessage[]>` in
 * channelMessaging.ts so pending messages survive API restarts and can be
 * atomically claimed by workers when they boot.
 *
 * Lifecycle (5 states, TinyAGI parity):
 *   pending    — queued on disk, not yet observed by any reader
 *   queued     — claimed atomically by a reader (claimAllPending)
 *   processing — actively being delivered to the PTY
 *   completed  — delivered to the target agent's stdin
 *   dead       — exceeded MAX_RETRIES, operator intervention needed
 *
 * Stale recovery: rows stuck in queued/processing for >10min (default) revert to
 * pending. Safe to call periodically from a tick loop; mirrors TinyAGI's
 * `recoverStaleMessages(thresholdMs)`.
 *
 * API surface is a superset of the old in-RAM queue — `channelMessaging.ts` can
 * swap the Map for this store without changing its external contract
 * (`sendChannelMessage` / `listChannelMessages` / `deliverChannelMessages`).
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { ChannelMessage } from "@octogent/core";

export type ChannelMessageStatus = "pending" | "queued" | "processing" | "completed" | "dead";

export type ChannelMessageRow = {
  messageId: string;
  fromTerminalId: string;
  toTerminalId: string;
  content: string;
  timestamp: string;       // ISO8601, matches ChannelMessage.timestamp
  delivered: 0 | 1;        // surfaces as `delivered: boolean` to callers
  status: ChannelMessageStatus;
  retryCount: number;
  lastError: string | null;
  createdAt: number;       // unix ms
  updatedAt: number;       // unix ms
};

export type ChannelStoreOptions = {
  /** Absolute path to the SQLite DB file. Parent directories are auto-created. */
  dbPath: string;
  /** Max retry attempts before a message is marked `dead`. Default 5 (TinyAGI parity). */
  maxRetries?: number;
  /** If true, use WAL journal mode (default). Set false for :memory: tests. */
  useWal?: boolean;
};

const DEFAULT_MAX_RETRIES = 5;

export class ChannelStore {
  private readonly dbPath: string;
  private readonly useWal: boolean;
  private readonly maxRetries: number;
  private _db: Database.Database | null = null;

  constructor(options: ChannelStoreOptions) {
    this.dbPath = options.dbPath;
    this.useWal = options.useWal !== false;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    // DB is opened lazily on first operation so constructing ChannelStore in a
    // test harness or during pre-setup doesn't create `.octogent/state/` files.
  }

  /**
   * Return the underlying DB, opening + migrating on first call.
   */
  private get db(): Database.Database {
    if (this._db) return this._db;

    if (this.dbPath !== ":memory:") {
      const parent = dirname(this.dbPath);
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    }

    this._db = new Database(this.dbPath);
    if (this.useWal && this.dbPath !== ":memory:") {
      this._db.pragma("journal_mode = WAL");
    }
    this._db.pragma("busy_timeout = 5000");
    this.migrate();
    return this._db;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channel_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL UNIQUE,
        from_terminal_id TEXT NOT NULL,
        to_terminal_id TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cm_to_status
        ON channel_messages(to_terminal_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_cm_status_updated
        ON channel_messages(status, updated_at);
    `);
  }

  /**
   * Insert a new pending message. Idempotent on messageId — duplicate insert
   * returns null instead of throwing (TinyAGI parity).
   */
  enqueue(message: ChannelMessage): number | null {
    const now = Date.now();
    try {
      const result = this.db
        .prepare(
          `INSERT INTO channel_messages
           (message_id, from_terminal_id, to_terminal_id, content, timestamp,
            delivered, status, retry_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
        )
        .run(
          message.messageId,
          message.fromTerminalId,
          message.toTerminalId,
          message.content,
          message.timestamp,
          message.delivered ? 1 : 0,
          now,
          now,
        );
      return result.lastInsertRowid as number;
    } catch (err: any) {
      if (err?.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return null;
      }
      throw err;
    }
  }

  /**
   * List all messages addressed to a given terminal, newest-first.
   * Returns ChannelMessage-compatible shape (preserves the original API).
   */
  listForTerminal(toTerminalId: string): ChannelMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM channel_messages
         WHERE to_terminal_id = ?
         ORDER BY created_at`,
      )
      .all(toTerminalId) as any[];
    return rows.map(rowToChannelMessage);
  }

  /**
   * Atomically claim all pending messages addressed to a terminal. Transitions
   * their status `pending` → `queued`. Mirrors TinyAGI's `claimAllPendingMessages`.
   *
   * Use this on worker boot to pick up messages that arrived while it was down.
   * Concurrent claim attempts for the same terminal are serialized via
   * `transaction().immediate()`.
   */
  claimPendingFor(toTerminalId: string): ChannelMessage[] {
    const now = Date.now();
    const claim = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT * FROM channel_messages
           WHERE to_terminal_id = ? AND status = 'pending'
           ORDER BY created_at`,
        )
        .all(toTerminalId) as any[];
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(",");
      this.db
        .prepare(
          `UPDATE channel_messages SET status='queued', updated_at=?
           WHERE id IN (${placeholders})`,
        )
        .run(now, ...ids);
      return rows;
    });
    return claim.immediate().map(rowToChannelMessage);
  }

  /** Queued → processing. Call when the message is actively being written to PTY. */
  markProcessing(messageId: string): void {
    this.db
      .prepare(
        `UPDATE channel_messages SET status='processing', updated_at=? WHERE message_id=?`,
      )
      .run(Date.now(), messageId);
  }

  /** Processing → completed + delivered=1. Call after successful PTY write. */
  markDelivered(messageId: string): void {
    this.db
      .prepare(
        `UPDATE channel_messages
         SET status='completed', delivered=1, updated_at=?
         WHERE message_id=?`,
      )
      .run(Date.now(), messageId);
  }

  /**
   * Record a delivery failure. Increments retry_count; if >= maxRetries, message
   * is marked `dead`, otherwise reverts to `pending` for re-claim.
   */
  markFailed(messageId: string, error: string): void {
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare(`SELECT id, retry_count FROM channel_messages WHERE message_id=?`)
        .get(messageId) as { id: number; retry_count: number } | undefined;
      if (!row) return;
      const newRetry = row.retry_count + 1;
      const newStatus: ChannelMessageStatus = newRetry >= this.maxRetries ? "dead" : "pending";
      this.db
        .prepare(
          `UPDATE channel_messages
           SET status=?, retry_count=?, last_error=?, updated_at=?
           WHERE id=?`,
        )
        .run(newStatus, newRetry, error, Date.now(), row.id);
    });
    tx();
  }

  /**
   * Revert rows stuck in queued/processing for longer than thresholdMs back to
   * pending. Default threshold 10 minutes mirrors TinyAGI's
   * `recoverStaleMessages()`. Returns the number of rows recovered.
   *
   * Call periodically (e.g. on worker tick or server boot).
   */
  recoverStale(thresholdMs: number = 10 * 60 * 1000): number {
    const cutoff = Date.now() - thresholdMs;
    const result = this.db
      .prepare(
        `UPDATE channel_messages
         SET status='pending', updated_at=?
         WHERE status IN ('queued', 'processing') AND updated_at < ?`,
      )
      .run(Date.now(), cutoff);
    return result.changes;
  }

  /** Summary counts by status, for diagnostics / monitoring. */
  getStatusCounts(): Record<ChannelMessageStatus, number> {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) as cnt FROM channel_messages GROUP BY status`)
      .all() as { status: ChannelMessageStatus; cnt: number }[];
    const counts: Record<ChannelMessageStatus, number> = {
      pending: 0,
      queued: 0,
      processing: 0,
      completed: 0,
      dead: 0,
    };
    for (const r of rows) counts[r.status] = r.cnt;
    return counts;
  }

  /** Drop completed messages older than `olderThanMs`. Returns rows deleted. */
  purgeCompleted(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db
      .prepare(
        `DELETE FROM channel_messages WHERE status='completed' AND updated_at < ?`,
      )
      .run(cutoff);
    return result.changes;
  }

  /** Close the underlying DB handle if opened. Safe to call on never-opened stores. */
  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
}

function rowToChannelMessage(row: any): ChannelMessage {
  return {
    messageId: row.message_id,
    fromTerminalId: row.from_terminal_id,
    toTerminalId: row.to_terminal_id,
    content: row.content,
    timestamp: row.timestamp,
    delivered: row.delivered === 1,
  };
}
