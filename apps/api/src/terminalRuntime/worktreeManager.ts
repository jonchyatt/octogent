import { existsSync } from "node:fs";
import { join } from "node:path";

import { TENTACLE_WORKTREE_BRANCH_PREFIX, TENTACLE_WORKTREE_RELATIVE_PATH } from "./constants";
import { toErrorMessage } from "./systemClients";
import type { GitClient, PersistedTentacle } from "./types";
import { RuntimeInputError } from "./types";

type CreateWorktreeManagerOptions = {
  workspaceCwd: string;
  gitClient: GitClient;
  tentacles: Map<string, PersistedTentacle>;
};

type RemoveTentacleWorktreeOptions = {
  bestEffort?: boolean;
};

export const createWorktreeManager = ({
  workspaceCwd,
  gitClient,
  tentacles,
}: CreateWorktreeManagerOptions) => {
  const getTentacleWorktreePath = (tentacleId: string) =>
    join(workspaceCwd, TENTACLE_WORKTREE_RELATIVE_PATH, tentacleId);

  const getTentacleWorkspaceCwd = (tentacleId: string) => {
    const tentacle = tentacles.get(tentacleId);
    if (!tentacle) {
      throw new Error(`Unknown tentacle: ${tentacleId}`);
    }

    if (tentacle.workspaceMode === "worktree") {
      return getTentacleWorktreePath(tentacleId);
    }

    return workspaceCwd;
  };

  const assertWorktreeCreationSupported = () => {
    gitClient.assertAvailable();
    if (!gitClient.isRepository(workspaceCwd)) {
      throw new RuntimeInputError(
        "Worktree tentacles require a git repository at the workspace root.",
      );
    }
  };

  const createTentacleWorktree = (tentacleId: string) => {
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
        baseRef: "HEAD",
      });
    } catch (error) {
      throw new Error(`Unable to create worktree for ${tentacleId}: ${toErrorMessage(error)}`);
    }
  };

  const removeTentacleWorktree = (
    tentacleId: string,
    options: RemoveTentacleWorktreeOptions = {},
  ) => {
    const { bestEffort = false } = options;
    const worktreePath = getTentacleWorktreePath(tentacleId);
    if (!existsSync(worktreePath)) {
      return;
    }

    try {
      gitClient.removeWorktree({
        cwd: workspaceCwd,
        path: worktreePath,
      });
    } catch (error) {
      if (bestEffort) {
        return;
      }
      throw new RuntimeInputError(
        `Unable to remove worktree for ${tentacleId}: ${toErrorMessage(error)}`,
      );
    }
  };

  return {
    getTentacleWorkspaceCwd,
    createTentacleWorktree,
    removeTentacleWorktree,
  };
};
