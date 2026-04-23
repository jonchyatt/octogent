import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { TENTACLE_WORKTREE_BRANCH_PREFIX, TENTACLE_WORKTREE_RELATIVE_PATH } from "./constants";
import { toErrorMessage } from "./systemClients";
import type { GitClient, PersistedTerminal } from "./types";
import { RuntimeInputError } from "./types";

// Phase 10.9.8 — detect git errors that indicate metadata is already gone
// (so the dir can be safely rm -rf'd). These messages are stable across
// recent git versions on Windows + POSIX. A match means "git no longer
// knows about this worktree" — the correct cleanup is to delete the dir
// directly and move on, not fail the whole operation.
const GIT_METADATA_GONE_PATTERNS: readonly RegExp[] = [
  /is not a working tree/i,
  /not a working tree/i,
  /no such file or directory/i,
  /does not exist/i,
  /already exists.*[\n]*.*is not a working tree/i,
];

const isGitMetadataGone = (error: unknown): boolean => {
  const msg = toErrorMessage(error);
  return GIT_METADATA_GONE_PATTERNS.some((pattern) => pattern.test(msg));
};

// Phase 10.9.8 — branch errors that indicate the branch is already gone.
// Same idea: don't fail cleanup when the deletion target is already deleted.
const GIT_BRANCH_GONE_PATTERNS: readonly RegExp[] = [
  /branch.*not found/i,
  /not found:/i,
  /error:.*branch.*doesn['']t exist/i,
  /no such branch/i,
];

const isGitBranchGone = (error: unknown): boolean => {
  const msg = toErrorMessage(error);
  return GIT_BRANCH_GONE_PATTERNS.some((pattern) => pattern.test(msg));
};

type CreateWorktreeManagerOptions = {
  workspaceCwd: string;
  gitClient: GitClient;
  terminals: Map<string, PersistedTerminal>;
};

type RemoveTentacleWorktreeOptions = {
  bestEffort?: boolean;
};

/** Resolve the effective worktree identifier for a terminal. */
const getEffectiveWorktreeId = (terminal: PersistedTerminal): string =>
  terminal.worktreeId ?? terminal.tentacleId;

/** Find any terminal whose effective worktree identifier matches. */
const findTerminalForWorktree = (
  terminals: Map<string, PersistedTerminal>,
  worktreeIdentifier: string,
): PersistedTerminal | undefined => {
  for (const terminal of terminals.values()) {
    if (getEffectiveWorktreeId(terminal) === worktreeIdentifier) {
      return terminal;
    }
  }
  return undefined;
};

export const createWorktreeManager = ({
  workspaceCwd,
  gitClient,
  terminals,
}: CreateWorktreeManagerOptions) => {
  const getTentacleWorktreePath = (tentacleId: string) =>
    join(workspaceCwd, TENTACLE_WORKTREE_RELATIVE_PATH, tentacleId);
  const getTentacleBranchName = (tentacleId: string) =>
    `${TENTACLE_WORKTREE_BRANCH_PREFIX}${tentacleId}`;

  const getTentacleWorkspaceCwd = (worktreeIdentifier: string) => {
    const terminal = findTerminalForWorktree(terminals, worktreeIdentifier);
    if (!terminal) {
      throw new Error(`No terminal found for worktree: ${worktreeIdentifier}`);
    }

    if (terminal.workspaceMode === "worktree") {
      return getTentacleWorktreePath(worktreeIdentifier);
    }

    return workspaceCwd;
  };

  const assertWorktreeCreationSupported = () => {
    gitClient.assertAvailable();
    if (!gitClient.isRepository(workspaceCwd)) {
      throw new RuntimeInputError(
        "Worktree terminals require a git repository at the workspace root.",
      );
    }
  };

  const createTentacleWorktree = (tentacleId: string, baseRef = "HEAD") => {
    assertWorktreeCreationSupported();
    const worktreePath = getTentacleWorktreePath(tentacleId);
    if (existsSync(worktreePath)) {
      throw new RuntimeInputError(`Worktree path already exists: ${worktreePath}`);
    }

    try {
      gitClient.addWorktree({
        cwd: workspaceCwd,
        path: worktreePath,
        branchName: `${TENTACLE_WORKTREE_BRANCH_PREFIX}${tentacleId}`,
        baseRef,
      });
    } catch (error) {
      throw new Error(`Unable to create worktree for ${tentacleId}: ${toErrorMessage(error)}`);
    }
  };

  const hasTentacleWorktree = (tentacleId: string): boolean =>
    existsSync(getTentacleWorktreePath(tentacleId));

  const removeTentacleWorktree = (
    tentacleId: string,
    options: RemoveTentacleWorktreeOptions = {},
  ) => {
    const { bestEffort = false } = options;
    const worktreePath = getTentacleWorktreePath(tentacleId);
    const branchName = getTentacleBranchName(tentacleId);

    if (existsSync(worktreePath)) {
      try {
        gitClient.removeWorktree({
          cwd: workspaceCwd,
          path: worktreePath,
        });
      } catch (error) {
        // Phase 10.9.8 — if git says "not a working tree" or the metadata
        // is already gone, the correct cleanup is still to delete the dir.
        // This happens when a worktree was created via `git worktree add`
        // but the daemon was killed before registering it, OR when a
        // prior `git worktree prune` already removed metadata. Without
        // this fallback, stale dirs accumulate forever and the UI's
        // DELETE ALL button fails with a cryptic git error (S39 live
        // failure: Jon hit "Failed to delete" because terminal-3/4 dirs
        // existed on disk but git had no metadata for them).
        if (isGitMetadataGone(error)) {
          try {
            rmSync(worktreePath, { recursive: true, force: true });
          } catch {
            // If even rm fails, the dir is locked or permission-blocked.
            // In bestEffort mode, return cleanly; otherwise bubble up
            // the ORIGINAL git error so the operator sees the true cause.
            if (bestEffort) return;
            throw new RuntimeInputError(
              `Unable to remove worktree for ${tentacleId}: ${toErrorMessage(error)}`,
            );
          }
          // rm succeeded. Fall through to branch cleanup — the branch
          // likely also needs removing if git metadata was stale.
        } else if (bestEffort) {
          return;
        } else {
          throw new RuntimeInputError(
            `Unable to remove worktree for ${tentacleId}: ${toErrorMessage(error)}`,
          );
        }
      }
    }

    try {
      gitClient.removeBranch({
        cwd: workspaceCwd,
        branchName,
      });
    } catch (error) {
      // Phase 10.9.8 — branch-gone errors should not fail cleanup. If the
      // branch is already deleted (operator used `git branch -D`, or a
      // prior removeWorktree ran both halves already), we're done.
      if (isGitBranchGone(error)) {
        return;
      }
      if (bestEffort) {
        return;
      }
      throw new RuntimeInputError(
        `Unable to remove branch for ${tentacleId}: ${toErrorMessage(error)}`,
      );
    }
  };

  return {
    getTentacleWorkspaceCwd,
    createTentacleWorktree,
    hasTentacleWorktree,
    removeTentacleWorktree,
  };
};
