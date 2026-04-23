import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquireDaemonSingletonLock,
  defaultLockfilePath,
  releaseDaemonSingletonLock,
} from "../src/daemonSingleton";

// Phase 10.9.7 — daemon singleton lock tests.
//
// The lock catches the S38/S39 split-brain case where two `pnpm dev`
// invocations each held live state. These tests don't spawn real
// daemons; they drive the lock functions directly.

describe("daemonSingleton", () => {
  let tmpRoot: string;
  let lockfile: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `octogent-singleton-test-${process.pid}-${Date.now()}`);
    mkdirSync(tmpRoot, { recursive: true });
    lockfile = join(tmpRoot, "daemon.pid");
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  });

  it("acquires lock when file does not exist", () => {
    const result = acquireDaemonSingletonLock({ lockfilePath: lockfile });
    expect(result.status).toBe("acquired");
    expect(existsSync(lockfile)).toBe(true);
    expect(readFileSync(lockfile, "utf8").trim()).toBe(String(process.pid));
  });

  it("blocks when another live process holds the lock", () => {
    // Simulate a live peer daemon by writing the test runner's OWN pid to
    // the lockfile — then try to acquire. Since process.pid is alive, we
    // expect "blocked".
    writeFileSync(lockfile, String(process.pid), "utf8");
    const result = acquireDaemonSingletonLock({ lockfilePath: lockfile });
    // Same-pid path returns "acquired" (re-entrant), not "blocked".
    expect(result.status).toBe("acquired");

    // For a TRUE peer simulation, write a fake pid that IS alive but
    // different. On POSIX, pid 1 is always alive (init). On Windows,
    // pid 4 (System) is always alive. Cross-platform: the test runner's
    // parent pid ppid is alive and different from our pid.
    const ppid = process.ppid;
    if (ppid && ppid !== process.pid) {
      writeFileSync(lockfile, String(ppid), "utf8");
      const result2 = acquireDaemonSingletonLock({ lockfilePath: lockfile });
      expect(result2.status).toBe("blocked");
      if (result2.status === "blocked") {
        expect(result2.activePid).toBe(ppid);
      }
    }
  });

  it("overwrites stale lockfile (pid no longer alive)", () => {
    // A pid that essentially cannot be live: pick a very high value that
    // is extremely unlikely to be in use. 99_999_999 is above most
    // systems' pid ceiling. If this flake-fails in CI, swap for a
    // jest.spyOn approach.
    writeFileSync(lockfile, "99999999", "utf8");
    const result = acquireDaemonSingletonLock({
      lockfilePath: lockfile,
      warnOnStale: false,
    });
    expect(result.status).toBe("acquired");
    expect(result.priorPid).toBe(99999999);
    expect(readFileSync(lockfile, "utf8").trim()).toBe(String(process.pid));
  });

  it("handles malformed lockfile contents as stale", () => {
    writeFileSync(lockfile, "not-a-number-at-all", "utf8");
    const result = acquireDaemonSingletonLock({
      lockfilePath: lockfile,
      warnOnStale: false,
    });
    expect(result.status).toBe("acquired");
  });

  it("releaseDaemonSingletonLock removes the file we wrote", () => {
    acquireDaemonSingletonLock({ lockfilePath: lockfile });
    expect(existsSync(lockfile)).toBe(true);
    releaseDaemonSingletonLock(lockfile);
    expect(existsSync(lockfile)).toBe(false);
  });

  it("releaseDaemonSingletonLock does NOT remove lockfile owned by another pid", () => {
    writeFileSync(lockfile, "12345", "utf8");
    releaseDaemonSingletonLock(lockfile);
    expect(existsSync(lockfile)).toBe(true);
  });

  it("releaseDaemonSingletonLock is safe to call when file does not exist", () => {
    expect(() => releaseDaemonSingletonLock(lockfile)).not.toThrow();
  });

  it("defaultLockfilePath resolves under the project state dir", () => {
    expect(defaultLockfilePath("/some/state/dir")).toBe(
      join("/some/state/dir", "daemon.pid"),
    );
  });

  it("creates state dir if it does not yet exist", () => {
    const nested = join(tmpRoot, "fresh", "state", "dir");
    const nestedLock = join(nested, "daemon.pid");
    const result = acquireDaemonSingletonLock({ lockfilePath: nestedLock });
    expect(result.status).toBe("acquired");
    expect(existsSync(nestedLock)).toBe(true);
  });
});
