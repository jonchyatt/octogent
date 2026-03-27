import { createServer } from "node:http";
import { resolve } from "node:path";

import { scanClaudeUsageChart } from "./claudeSessionScanner";
import {
  invalidateUsageCache as invalidateUsageCacheDefault,
  readClaudeUsageSnapshot as readClaudeUsageSnapshotDefault,
} from "./claudeUsage";
import { readCodexUsageSnapshot as readCodexUsageSnapshotDefault } from "./codexUsage";
import { createApiRequestHandler } from "./createApiServer/requestHandler";
import type { CreateApiServerOptions } from "./createApiServer/types";
import { createUpgradeHandler } from "./createApiServer/upgradeHandler";
import { readGithubRepoSummary as readGithubRepoSummaryDefault } from "./githubRepoSummary";
import { createMonitorService } from "./monitor";
import { createTerminalRuntime } from "./terminalRuntime";

export const createApiServer = ({
  workspaceCwd,
  gitClient,
  readClaudeUsageSnapshot = readClaudeUsageSnapshotDefault,
  readCodexUsageSnapshot = readCodexUsageSnapshotDefault,
  readGithubRepoSummary,
  scanUsageHeatmap,
  monitorService,
  invalidateClaudeUsageCache = invalidateUsageCacheDefault,
  allowRemoteAccess = false,
}: CreateApiServerOptions = {}) => {
  const resolvedWorkspaceCwd = workspaceCwd ?? resolve(process.cwd(), "../..");
  const readGithubRepoSummaryWithDefault =
    readGithubRepoSummary ??
    (() =>
      readGithubRepoSummaryDefault({
        cwd: resolvedWorkspaceCwd,
      }));

  const runtimeOptions: Parameters<typeof createTerminalRuntime>[0] = {
    workspaceCwd: resolvedWorkspaceCwd,
  };
  if (gitClient) {
    runtimeOptions.gitClient = gitClient;
  }

  const runtime = createTerminalRuntime(runtimeOptions);
  const monitorServiceWithDefault =
    monitorService ??
    createMonitorService({
      workspaceCwd: resolvedWorkspaceCwd,
    });
  const scanUsageHeatmapWithDefault =
    scanUsageHeatmap ??
    ((scope: "all" | "project") => scanClaudeUsageChart(scope, resolvedWorkspaceCwd));

  const requestHandler = createApiRequestHandler({
    runtime,
    workspaceCwd: resolvedWorkspaceCwd,
    readClaudeUsageSnapshot,
    readCodexUsageSnapshot,
    readGithubRepoSummary: readGithubRepoSummaryWithDefault,
    scanUsageHeatmap: scanUsageHeatmapWithDefault,
    monitorService: monitorServiceWithDefault,
    invalidateClaudeUsageCache,
    allowRemoteAccess,
  });

  const server = createServer(requestHandler);

  server.on(
    "upgrade",
    createUpgradeHandler({
      runtime,
      allowRemoteAccess,
    }),
  );

  return {
    server,
    async start(port = 8787, host = "127.0.0.1") {
      await new Promise<void>((resolveStart, rejectStart) => {
        server.listen(port, host, () => resolveStart());
        server.once("error", rejectStart);
      });

      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;

      return { host, port: resolvedPort };
    },
    async stop() {
      runtime.close();
      await new Promise<void>((resolveStop, rejectStop) => {
        server.close((error) => {
          if (error) {
            rejectStop(error);
            return;
          }
          resolveStop();
        });
        server.closeAllConnections();
      });
    },
  };
};
