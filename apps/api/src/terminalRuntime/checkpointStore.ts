/**
 * checkpointStore — per-tool-call checkpointing for Octogent terminals.
 *
 * Jarvis M0.02 Phase 10.8.7. Stacks with Phase 10.8.1 (SQLite WAL channel queue
 * in channelStore.ts) to give full restart safety: if a worker crashes mid-
 * build, the checkpoint on disk tells us which turn + tool call it was on so
 * the next respawn can log where it's resuming from.
 *
 * Layout: `<stateDir>/state/checkpoints/<terminal-id>.json`, one file per
 * terminal. Writes are atomic (write-temp + rename) so a crash mid-write can
 * never leave a half-JSON file behind — the old checkpoint is still valid.
 *
 * Schema (exact, per design contract):
 *   {
 *     "terminalId": string,
 *     "tentacleId": string,
 *     "turnNumber": number,
 *     "lastToolCall": { "name": string, "args_digest": string, "result_digest": string, "ts": ISO-8601 },
 *     "workingDir": string,
 *     "gitBranch": string | null,
 *     "gitHead": string | null,
 *     "updatedAt": ISO-8601
 *   }
 *
 * Intentionally NOT implemented here (deferred):
 *   - retention / cleanup of stale checkpoints
 *   - UI surface
 *   - auto-seeding resume prompts from the checkpoint payload
 *
 * Read path (readCheckpoint) is null-safe: a missing/corrupt file returns null
 * rather than throwing, so a broken checkpoint never blocks a respawn.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CheckpointLastToolCall = {
  name: string;
  args_digest: string;
  result_digest: string;
  ts: string;
};

export type Checkpoint = {
  terminalId: string;
  tentacleId: string;
  turnNumber: number;
  /**
   * The most recent tool call attributed to this terminal. `null` when the
   * checkpoint was written at a turn boundary (exec mode) instead of from a
   * Claude-worker tool-call hook — no "last tool call" exists in that path.
   */
  lastToolCall: CheckpointLastToolCall | null;
  workingDir: string;
  gitBranch: string | null;
  gitHead: string | null;
  updatedAt: string;
};

export type CheckpointStoreOptions = {
  /** Absolute path to the directory that holds `<terminal-id>.json` files. */
  checkpointsDir: string;
};

export type CheckpointWriteInput = {
  terminalId: string;
  tentacleId: string;
  turnNumber: number;
  workingDir: string;
  lastToolCall?: CheckpointLastToolCall | null | undefined;
  gitBranch?: string | null | undefined;
  gitHead?: string | null | undefined;
};

/** SHA-256 hex digest of the input, truncated to `bytes` bytes (default 8 → 16 hex chars). */
export const digestString = (value: string, bytes = 8): string => {
  const hash = createHash("sha256").update(value).digest("hex");
  return hash.slice(0, Math.max(1, bytes) * 2);
};

/**
 * Stable-ish digest of any JSON-serializable value. Used to fingerprint tool
 * args + tool responses without storing full payloads in the checkpoint (keeps
 * file small + avoids accidentally persisting secrets verbatim).
 */
export const digestJsonSafe = (value: unknown, bytes = 8): string => {
  if (value === undefined || value === null) {
    return digestString("", bytes);
  }

  let serialized: string;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  return digestString(serialized ?? "", bytes);
};

/**
 * Best-effort sync read of a worktree's current branch + HEAD sha. Silent on
 * failure (missing git binary, non-repo, detached HEAD, etc.) — returns
 * `null` for whichever field couldn't be captured.
 *
 * Time-bounded by execFileSync's `timeout` so a hung git can't stall a
 * hook handler indefinitely.
 */
export const readGitBranchAndHead = (
  cwd: string,
): { gitBranch: string | null; gitHead: string | null } => {
  const read = (args: string[]): string | null => {
    try {
      const out = execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 2_000,
      });
      const trimmed = out.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  };
  const branch = read(["rev-parse", "--abbrev-ref", "HEAD"]);
  // rev-parse returns "HEAD" literally in detached-HEAD state — treat that as
  // "no branch" so the checkpoint doesn't falsely claim a branch named "HEAD".
  const gitBranch = branch === "HEAD" ? null : branch;
  const gitHead = read(["rev-parse", "HEAD"]);
  return { gitBranch, gitHead };
};

const FILENAME_SAFE_RE = /[^a-zA-Z0-9._-]+/g;

/** Map a terminal id to a filesystem-safe filename (without extension). */
const safeTerminalFileStem = (terminalId: string): string => {
  const replaced = terminalId.replace(FILENAME_SAFE_RE, "_");
  // Guard against empty / all-special input — extremely unlikely since
  // terminal IDs are generator-controlled, but defensive.
  return replaced.length > 0 ? replaced : "_";
};

const isIsoString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));

const isCheckpointLastToolCall = (
  value: unknown,
): value is CheckpointLastToolCall => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    typeof record.args_digest === "string" &&
    typeof record.result_digest === "string" &&
    isIsoString(record.ts)
  );
};

const isCheckpoint = (value: unknown): value is Checkpoint => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.terminalId !== "string") return false;
  if (typeof record.tentacleId !== "string") return false;
  if (typeof record.turnNumber !== "number" || !Number.isFinite(record.turnNumber)) return false;
  if (typeof record.workingDir !== "string") return false;
  if (record.gitBranch !== null && typeof record.gitBranch !== "string") return false;
  if (record.gitHead !== null && typeof record.gitHead !== "string") return false;
  if (!isIsoString(record.updatedAt)) return false;
  if (record.lastToolCall !== null && !isCheckpointLastToolCall(record.lastToolCall)) {
    return false;
  }
  return true;
};

export class CheckpointStore {
  private readonly checkpointsDir: string;

  constructor({ checkpointsDir }: CheckpointStoreOptions) {
    this.checkpointsDir = checkpointsDir;
  }

  /** Absolute path to the checkpoint file for a given terminal. */
  checkpointPath(terminalId: string): string {
    return join(this.checkpointsDir, `${safeTerminalFileStem(terminalId)}.json`);
  }

  /**
   * Null-safe read. Returns `null` on:
   *   - file missing
   *   - file unreadable
   *   - invalid JSON
   *   - JSON does not match the Checkpoint schema
   * Never throws, so a corrupt checkpoint can't block a respawn.
   */
  readCheckpoint(terminalId: string): Checkpoint | null {
    const path = this.checkpointPath(terminalId);
    if (!existsSync(path)) return null;
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return isCheckpoint(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Atomic write: serialize to a temp sibling, fsync-free rename. On POSIX and
   * NTFS, rename within the same directory is atomic for observers — either
   * the old file is visible or the new one is, never a half-written blob.
   *
   * The temp suffix includes pid + random bytes so concurrent writers targeting
   * different terminals never collide on temp paths. (Concurrent writes to the
   * SAME terminal id should not happen in practice — one checkpoint file per
   * terminal, one hook handler at a time — but the suffix is still safe if
   * they did.)
   */
  writeCheckpoint(input: CheckpointWriteInput): Checkpoint {
    const checkpoint: Checkpoint = {
      terminalId: input.terminalId,
      tentacleId: input.tentacleId,
      turnNumber: input.turnNumber,
      lastToolCall: input.lastToolCall ?? null,
      workingDir: input.workingDir,
      gitBranch: input.gitBranch ?? null,
      gitHead: input.gitHead ?? null,
      updatedAt: new Date().toISOString(),
    };

    mkdirSync(this.checkpointsDir, { recursive: true });
    const finalPath = this.checkpointPath(input.terminalId);
    const tmpSuffix = randomBytes(6).toString("hex");
    const tmpPath = `${finalPath}.tmp-${process.pid}-${tmpSuffix}`;
    const serialized = `${JSON.stringify(checkpoint, null, 2)}\n`;
    writeFileSync(tmpPath, serialized, { encoding: "utf8" });
    renameSync(tmpPath, finalPath);
    return checkpoint;
  }
}
