import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export const createShellEnvironment = (options?: {
  octogentSessionId?: string;
  // Phase 10.5.2 — handoff machinery. Both are injected for claude-code
  // workers so the /handoff slash command can write into the canonical
  // per-tentacle directory without re-deriving its path. Codex workers get
  // them too (cheap), but the slash command itself is claude-only.
  octogentTentacleId?: string;
  octogentHandoffDir?: string;
  extraEnv?: Record<string, string>;
}) => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  if (options?.octogentSessionId) {
    env.OCTOGENT_SESSION_ID = options.octogentSessionId;
  }
  if (options?.octogentTentacleId) {
    env.OCTOGENT_TENTACLE_ID = options.octogentTentacleId;
  }
  if (options?.octogentHandoffDir) {
    env.OCTOGENT_HANDOFF_DIR = options.octogentHandoffDir;
  }
  if (options?.extraEnv) {
    for (const [key, value] of Object.entries(options.extraEnv)) {
      env[key] = value;
    }
  }
  return env;
};

export const ensureNodePtySpawnHelperExecutable = () => {
  if (process.platform === "win32") {
    return;
  }

  try {
    const packageJsonPath = require.resolve("node-pty/package.json");
    const packageDir = dirname(packageJsonPath);
    const helperCandidates = [
      join(packageDir, "build", "Release", "spawn-helper"),
      join(packageDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    ];

    for (const helperPath of helperCandidates) {
      if (!existsSync(helperPath)) {
        continue;
      }

      const currentMode = statSync(helperPath).mode;
      if ((currentMode & 0o111) !== 0) {
        continue;
      }

      chmodSync(helperPath, currentMode | 0o755);
    }
  } catch {
    // Let node-pty throw the actionable error if helper lookup/setup fails.
  }
};
