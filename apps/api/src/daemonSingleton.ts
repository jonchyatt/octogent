import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Phase 10.9.7 — daemon singleton lock.
//
// Why: Session 38 + 39 saw two daemons running simultaneously (different
// PIDs, each holding live terminals). The first daemon never shut down
// cleanly; a second `pnpm dev` spawned happily. Both serviced API calls,
// both fired respawn logic, both burned quota.
//
// Strategy: PID-lockfile at a known path. At startup:
//   1. If lockfile exists and PID is alive → refuse start (exit 1).
//   2. If lockfile exists and PID is dead → stale lock, overwrite.
//   3. Write our PID.
//   4. On SIGINT/SIGTERM → delete lockfile.
//   5. On unexpected exit → lockfile is left behind but (2) handles it
//      the next time anyway.
//
// Scope: this is a local-filesystem lock. It does NOT handle daemon-vs-
// daemon across hosts (OS-level process IDs aren't unique across hosts).
// Cross-host singleton coordination (if ever needed) is a separate
// problem served by the bus, not this module.

export type DaemonSingletonOptions = {
  /**
   * Where to write the PID file. Caller supplies an absolute path; this
   * module does not guess at state-dir resolution (different callers use
   * different layouts).
   */
  lockfilePath: string;
  /**
   * If true, a detected-stale-lock condition logs a warning and continues
   * instead of silently clearing. Default: true.
   */
  warnOnStale?: boolean;
};

export type DaemonSingletonGuardResult =
  | { status: "acquired"; lockfilePath: string; priorPid?: number }
  | { status: "blocked"; lockfilePath: string; activePid: number };

const readPidFromLockfile = (path: string): number | undefined => {
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid < 1) return undefined;
    return pid;
  } catch {
    return undefined;
  }
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = dead. EPERM = alive but inaccessible (still counts as alive).
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
};

/**
 * Attempt to acquire the singleton lock. If another daemon holds it, the
 * returned status is "blocked" — caller should abort startup. If
 * acquired, the caller must wire the returned `release` function into
 * signal handlers + process-exit paths.
 */
export const acquireDaemonSingletonLock = (
  options: DaemonSingletonOptions,
): DaemonSingletonGuardResult => {
  const { lockfilePath, warnOnStale = true } = options;
  const dir = dirname(lockfilePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const priorPid = readPidFromLockfile(lockfilePath);
  if (priorPid !== undefined) {
    if (priorPid === process.pid) {
      // We already own the lock from a prior startup pass in this
      // process. Re-acquire is a no-op. (Shouldn't happen under normal
      // flow, but defensive.)
      return { status: "acquired", lockfilePath, priorPid };
    }
    if (isProcessAlive(priorPid)) {
      return { status: "blocked", lockfilePath, activePid: priorPid };
    }
    if (warnOnStale) {
      console.warn(
        `[daemon-singleton] stale lockfile pid=${priorPid} (process dead) at ${lockfilePath} — overwriting`,
      );
    }
  }

  writeFileSync(lockfilePath, String(process.pid), "utf8");
  return { status: "acquired", lockfilePath, priorPid };
};

/**
 * Release the lock. Safe to call multiple times — if the file doesn't
 * exist or contains a different PID, we don't touch it.
 */
export const releaseDaemonSingletonLock = (lockfilePath: string): void => {
  const recorded = readPidFromLockfile(lockfilePath);
  if (recorded === undefined) return;
  if (recorded !== process.pid) return;
  try {
    rmSync(lockfilePath, { force: true });
  } catch {
    // Best-effort cleanup — next startup's stale-lock path handles it.
  }
};

/**
 * Resolve the canonical lockfile path. Factored out so tests can supply
 * their own path and the production call-site only has to pass the
 * project state dir.
 */
export const defaultLockfilePath = (projectStateDir: string): string =>
  join(projectStateDir, "daemon.pid");
