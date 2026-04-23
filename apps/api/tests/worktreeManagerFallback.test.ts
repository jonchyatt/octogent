import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWorktreeManager } from "../src/terminalRuntime/worktreeManager";
import type { GitClient, PersistedTerminal } from "../src/terminalRuntime/types";
import { RuntimeInputError } from "../src/terminalRuntime/types";

// Phase 10.9.8 — when `git worktree remove` fails because git metadata is
// already gone (dir exists on disk but git doesn't know about it), the
// manager must rm -rf the dir instead of failing the whole request. Tests
// cover: metadata-gone → fallback succeeds; branch-gone → silent success;
// other git errors → bubble up; bestEffort honored; rm failure after
// fallback preserved for operator diagnosis.

type GitCall = { method: string; args: Record<string, unknown> };

const makeGitClient = (
  shouldThrow: {
    removeWorktree?: Error | null;
    removeBranch?: Error | null;
  } = {},
): { client: GitClient; calls: GitCall[] } => {
  const calls: GitCall[] = [];
  const client: GitClient = {
    addWorktree: async () => {
      throw new Error("not implemented in test");
    },
    removeWorktree: (args) => {
      calls.push({ method: "removeWorktree", args: args as Record<string, unknown> });
      if (shouldThrow.removeWorktree) throw shouldThrow.removeWorktree;
    },
    removeBranch: (args) => {
      calls.push({ method: "removeBranch", args: args as Record<string, unknown> });
      if (shouldThrow.removeBranch) throw shouldThrow.removeBranch;
    },
    worktreePrune: () => {
      calls.push({ method: "worktreePrune", args: {} });
    },
  } as unknown as GitClient;
  return { client, calls };
};

describe("removeTentacleWorktree (Phase 10.9.8 fallback)", () => {
  let tmpRoot: string;
  let worktreesDir: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `octogent-wt-test-${process.pid}-${Date.now()}`);
    worktreesDir = join(tmpRoot, ".octogent", "worktrees");
    mkdirSync(worktreesDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // cleanup is best-effort
    }
  });

  const setupStaleWorktreeDir = (tentacleId: string): string => {
    const dir = join(worktreesDir, tentacleId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "marker.txt"), "stale", "utf-8");
    return dir;
  };

  it("rm -rf fallback kicks in when git says 'is not a working tree'", () => {
    const dir = setupStaleWorktreeDir("terminal-3");
    const { client } = makeGitClient({
      removeWorktree: new Error(
        "Command failed: git worktree remove --force\nfatal: 'C:\\...\\terminal-3' is not a working tree",
      ),
    });

    const manager = createWorktreeManager({
      workspaceCwd: tmpRoot,
      gitClient: client,
      terminals: new Map<string, PersistedTerminal>(),
    });

    expect(existsSync(dir)).toBe(true);
    expect(() => manager.removeTentacleWorktree("terminal-3")).not.toThrow();
    expect(existsSync(dir)).toBe(false);
  });

  it("rm -rf fallback kicks in when git says 'does not exist'", () => {
    const dir = setupStaleWorktreeDir("terminal-4");
    const { client } = makeGitClient({
      removeWorktree: new Error("fatal: path does not exist"),
    });

    const manager = createWorktreeManager({
      workspaceCwd: tmpRoot,
      gitClient: client,
      terminals: new Map<string, PersistedTerminal>(),
    });

    expect(() => manager.removeTentacleWorktree("terminal-4")).not.toThrow();
    expect(existsSync(dir)).toBe(false);
  });

  it("branch-gone errors are swallowed silently after worktree removal", () => {
    setupStaleWorktreeDir("terminal-5");
    const { client, calls } = makeGitClient({
      removeWorktree: new Error("fatal: is not a working tree"),
      removeBranch: new Error("error: branch not found: octogent/terminal-5"),
    });

    const manager = createWorktreeManager({
      workspaceCwd: tmpRoot,
      gitClient: client,
      terminals: new Map<string, PersistedTerminal>(),
    });

    expect(() => manager.removeTentacleWorktree("terminal-5")).not.toThrow();
    // Both gitClient methods should have been attempted.
    expect(calls.filter((c) => c.method === "removeWorktree")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "removeBranch")).toHaveLength(1);
  });

  it("non-metadata-gone git errors still bubble up (not bestEffort)", () => {
    setupStaleWorktreeDir("terminal-6");
    const { client } = makeGitClient({
      removeWorktree: new Error("permission denied: cannot write to .git/worktrees"),
    });

    const manager = createWorktreeManager({
      workspaceCwd: tmpRoot,
      gitClient: client,
      terminals: new Map<string, PersistedTerminal>(),
    });

    expect(() => manager.removeTentacleWorktree("terminal-6")).toThrow(RuntimeInputError);
    expect(() => manager.removeTentacleWorktree("terminal-6")).toThrow(/permission denied/);
  });

  it("bestEffort swallows non-metadata-gone errors too", () => {
    setupStaleWorktreeDir("terminal-7");
    const { client } = makeGitClient({
      removeWorktree: new Error("permission denied"),
    });

    const manager = createWorktreeManager({
      workspaceCwd: tmpRoot,
      gitClient: client,
      terminals: new Map<string, PersistedTerminal>(),
    });

    expect(() =>
      manager.removeTentacleWorktree("terminal-7", { bestEffort: true }),
    ).not.toThrow();
  });

  it("branch removal NOT-branch-gone error propagates (not bestEffort)", () => {
    // No worktree dir exists (already cleaned); worktree step is a no-op.
    // Branch removal hits a hard permission error.
    const { client } = makeGitClient({
      removeBranch: new Error("permission denied"),
    });

    const manager = createWorktreeManager({
      workspaceCwd: tmpRoot,
      gitClient: client,
      terminals: new Map<string, PersistedTerminal>(),
    });

    expect(() => manager.removeTentacleWorktree("terminal-8")).toThrow(
      /Unable to remove branch/,
    );
  });

  it("no-op when neither worktree dir nor branch exists (both already gone)", () => {
    const { client, calls } = makeGitClient();
    const manager = createWorktreeManager({
      workspaceCwd: tmpRoot,
      gitClient: client,
      terminals: new Map<string, PersistedTerminal>(),
    });

    expect(() => manager.removeTentacleWorktree("terminal-nonexistent")).not.toThrow();
    // removeWorktree skipped (dir doesn't exist), removeBranch attempted.
    expect(calls.filter((c) => c.method === "removeWorktree")).toHaveLength(0);
    expect(calls.filter((c) => c.method === "removeBranch")).toHaveLength(1);
  });
});
