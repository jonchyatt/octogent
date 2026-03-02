import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { GitClient, TmuxClient } from "./types";

export const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const readCommandErrorOutput = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return "";
  }

  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string") {
    return stderr;
  }
  if (stderr instanceof Buffer) {
    return stderr.toString("utf8");
  }
  return "";
};

const isMissingTmuxSessionError = (error: unknown) => {
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { status?: unknown }).status === "number" &&
    (error as { status: number }).status === 1
  ) {
    return true;
  }

  const output = readCommandErrorOutput(error).toLowerCase();
  return output.includes("can't find session") || output.includes("no server running");
};

export const createDefaultTmuxClient = (): TmuxClient => ({
  assertAvailable() {
    try {
      execFileSync("tmux", ["-V"], { stdio: "ignore" });
    } catch (error) {
      throw new Error(`tmux is required for terminal runtime: ${toErrorMessage(error)}`);
    }
  },

  hasSession(sessionName) {
    try {
      execFileSync("tmux", ["has-session", "-t", sessionName], { stdio: "pipe" });
      return true;
    } catch (error) {
      if (isMissingTmuxSessionError(error)) {
        return false;
      }
      throw error;
    }
  },

  configureSession(sessionName) {
    execFileSync("tmux", ["set-option", "-t", sessionName, "status", "off"], {
      stdio: "pipe",
    });
  },

  capturePane(sessionName) {
    try {
      return execFileSync(
        "tmux",
        ["capture-pane", "-a", "-e", "-p", "-S", "-32768", "-t", sessionName],
        {
          encoding: "utf8",
          stdio: "pipe",
        },
      );
    } catch (error) {
      if (isMissingTmuxSessionError(error)) {
        return "";
      }
      throw error;
    }
  },

  createSession({ sessionName, cwd, command }) {
    const args = ["new-session", "-d", "-s", sessionName, "-c", cwd];
    if (command && command.length > 0) {
      args.push(command);
    }
    execFileSync("tmux", args, {
      stdio: "pipe",
    });
  },

  killSession(sessionName) {
    try {
      execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "pipe" });
    } catch (error) {
      if (isMissingTmuxSessionError(error)) {
        return;
      }
      throw error;
    }
  },
});

export const createDefaultGitClient = (): GitClient => ({
  assertAvailable() {
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
    } catch (error) {
      throw new Error(`git is required for worktree tentacles: ${toErrorMessage(error)}`);
    }
  },

  isRepository(cwd) {
    try {
      const output = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
      });
      return output.trim() === "true";
    } catch {
      return false;
    }
  },

  addWorktree({ cwd, path, branchName, baseRef }) {
    mkdirSync(dirname(path), { recursive: true });
    execFileSync("git", ["worktree", "add", "-b", branchName, path, baseRef], {
      cwd,
      stdio: "pipe",
    });
  },

  removeWorktree({ cwd, path }) {
    execFileSync("git", ["worktree", "remove", "--force", path], {
      cwd,
      stdio: "pipe",
    });
  },

  removeBranch({ cwd, branchName }) {
    const output = execFileSync(
      "git",
      ["branch", "--list", "--format=%(refname:short)", branchName],
      {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    const existingBranches = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (!existingBranches.includes(branchName)) {
      return;
    }

    execFileSync("git", ["branch", "-D", branchName], {
      cwd,
      stdio: "pipe",
    });
  },
});
