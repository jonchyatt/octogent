import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApiServer } from "../src/createApiServer";
import type { GitHubRepoSummarySnapshot } from "../src/githubRepoSummary";
import type { GitClient } from "../src/terminalRuntime";

class FakeGitClient implements GitClient {
  private readonly worktreeStatusByCwd = new Map<
    string,
    {
      branchName: string;
      upstreamBranchName: string | null;
      isDirty: boolean;
      aheadCount: number;
      behindCount: number;
      insertedLineCount: number;
      deletedLineCount: number;
      hasConflicts: boolean;
      changedFiles: string[];
      defaultBaseBranchName: string | null;
    }
  >();
  private readonly commitsByCwd = new Map<string, string[]>();
  private readonly pushesByCwd = new Map<string, number>();
  private readonly syncsByCwd = new Map<string, string[]>();
  private readonly pullRequestByCwd = new Map<
    string,
    {
      number: number;
      url: string;
      title: string;
      baseRef: string;
      headRef: string;
      state: "OPEN" | "MERGED" | "CLOSED";
      isDraft: boolean;
      mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
      mergeStateStatus: string | null;
    } | null
  >();
  private readonly worktrees = new Map<
    string,
    { branchName: string; baseRef: string; cwd: string }
  >();
  private readonly branches = new Set<string>();
  private repositoryAvailable = true;
  private failRemoveWorktree = false;
  private failCommit = false;
  private failPush = false;
  private failSync = false;
  private failCreatePullRequest = false;
  private failMergePullRequest = false;

  assertAvailable(): void {}

  isRepository(): boolean {
    return this.repositoryAvailable;
  }

  addWorktree({
    cwd,
    path,
    branchName,
    baseRef,
  }: {
    cwd: string;
    path: string;
    branchName: string;
    baseRef: string;
  }): void {
    if (this.worktrees.has(path)) {
      throw new Error(`Worktree already exists: ${path}`);
    }
    mkdirSync(path, { recursive: true });
    this.branches.add(branchName);
    this.worktrees.set(path, { cwd, branchName, baseRef });
    this.worktreeStatusByCwd.set(path, {
      branchName,
      upstreamBranchName: null,
      isDirty: false,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });
    this.pullRequestByCwd.set(path, null);
  }

  removeWorktree({ path }: { cwd: string; path: string }): void {
    if (this.failRemoveWorktree) {
      throw new Error(`Unable to remove worktree: ${path}`);
    }
    this.worktrees.delete(path);
    this.worktreeStatusByCwd.delete(path);
    this.commitsByCwd.delete(path);
    this.pushesByCwd.delete(path);
    this.syncsByCwd.delete(path);
    this.pullRequestByCwd.delete(path);
  }

  removeBranch({ branchName }: { cwd: string; branchName: string }): void {
    this.branches.delete(branchName);
  }

  setRepositoryAvailable(available: boolean): void {
    this.repositoryAvailable = available;
  }

  setFailRemoveWorktree(shouldFail: boolean): void {
    this.failRemoveWorktree = shouldFail;
  }

  setFailCommit(shouldFail: boolean): void {
    this.failCommit = shouldFail;
  }

  setFailPush(shouldFail: boolean): void {
    this.failPush = shouldFail;
  }

  setFailSync(shouldFail: boolean): void {
    this.failSync = shouldFail;
  }

  setFailCreatePullRequest(shouldFail: boolean): void {
    this.failCreatePullRequest = shouldFail;
  }

  setFailMergePullRequest(shouldFail: boolean): void {
    this.failMergePullRequest = shouldFail;
  }

  setWorktreeStatus(
    cwd: string,
    status: {
      branchName: string;
      upstreamBranchName: string | null;
      isDirty: boolean;
      aheadCount: number;
      behindCount: number;
      insertedLineCount: number;
      deletedLineCount: number;
      hasConflicts: boolean;
      changedFiles: string[];
      defaultBaseBranchName: string | null;
    },
  ): void {
    this.worktreeStatusByCwd.set(cwd, status);
  }

  readWorktreeStatus({
    cwd,
  }: {
    cwd: string;
  }): {
    branchName: string;
    upstreamBranchName: string | null;
    isDirty: boolean;
    aheadCount: number;
    behindCount: number;
    insertedLineCount: number;
    deletedLineCount: number;
    hasConflicts: boolean;
    changedFiles: string[];
    defaultBaseBranchName: string | null;
  } {
    const status = this.worktreeStatusByCwd.get(cwd);
    if (!status) {
      throw new Error(`Missing fake status for ${cwd}`);
    }
    return {
      ...status,
      changedFiles: [...status.changedFiles],
    };
  }

  commitAll({ cwd, message }: { cwd: string; message: string }): void {
    if (this.failCommit) {
      throw new Error("Simulated commit failure");
    }

    const status = this.worktreeStatusByCwd.get(cwd);
    if (!status) {
      throw new Error(`Missing fake status for ${cwd}`);
    }
    if (!status.isDirty) {
      throw new Error("No local changes to commit.");
    }

    const commits = this.commitsByCwd.get(cwd) ?? [];
    commits.push(message);
    this.commitsByCwd.set(cwd, commits);
    this.worktreeStatusByCwd.set(cwd, {
      ...status,
      isDirty: false,
      changedFiles: [],
      aheadCount: status.aheadCount + 1,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
    });
  }

  pushCurrentBranch({ cwd }: { cwd: string }): void {
    if (this.failPush) {
      throw new Error("Simulated push failure");
    }

    const status = this.worktreeStatusByCwd.get(cwd);
    if (!status) {
      throw new Error(`Missing fake status for ${cwd}`);
    }

    this.pushesByCwd.set(cwd, (this.pushesByCwd.get(cwd) ?? 0) + 1);
    this.worktreeStatusByCwd.set(cwd, {
      ...status,
      upstreamBranchName: status.upstreamBranchName ?? `origin/${status.branchName}`,
      aheadCount: 0,
    });
  }

  syncWithBase({ cwd, baseRef }: { cwd: string; baseRef: string }): void {
    if (this.failSync) {
      throw new Error("Simulated sync failure");
    }

    const status = this.worktreeStatusByCwd.get(cwd);
    if (!status) {
      throw new Error(`Missing fake status for ${cwd}`);
    }
    const syncs = this.syncsByCwd.get(cwd) ?? [];
    syncs.push(baseRef);
    this.syncsByCwd.set(cwd, syncs);
    this.worktreeStatusByCwd.set(cwd, {
      ...status,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
    });
  }

  setWorktreePullRequest(
    cwd: string,
    pullRequest: {
      number: number;
      url: string;
      title: string;
      baseRef: string;
      headRef: string;
      state: "OPEN" | "MERGED" | "CLOSED";
      isDraft: boolean;
      mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
      mergeStateStatus: string | null;
    } | null,
  ): void {
    this.pullRequestByCwd.set(cwd, pullRequest);
  }

  readCurrentBranchPullRequest({
    cwd,
  }: {
    cwd: string;
  }): {
    number: number;
    url: string;
    title: string;
    baseRef: string;
    headRef: string;
    state: "OPEN" | "MERGED" | "CLOSED";
    isDraft: boolean;
    mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
    mergeStateStatus: string | null;
  } | null {
    const pullRequest = this.pullRequestByCwd.get(cwd);
    if (pullRequest === undefined || pullRequest === null) {
      return null;
    }

    return {
      ...pullRequest,
    };
  }

  createPullRequest({
    cwd,
    title,
    baseRef,
    headRef,
  }: {
    cwd: string;
    title: string;
    body: string;
    baseRef: string;
    headRef: string;
  }): {
    number: number;
    url: string;
    title: string;
    baseRef: string;
    headRef: string;
    state: "OPEN" | "MERGED" | "CLOSED";
    isDraft: boolean;
    mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
    mergeStateStatus: string | null;
  } | null {
    if (this.failCreatePullRequest) {
      throw new Error("Simulated create PR failure");
    }

    const nextNumber = (this.pullRequestByCwd.get(cwd)?.number ?? 100) + 1;
    const pullRequest = {
      number: nextNumber,
      url: `https://github.com/hesamsheikh/octogent/pull/${nextNumber}`,
      title,
      baseRef,
      headRef,
      state: "OPEN" as const,
      isDraft: false,
      mergeable: "MERGEABLE" as const,
      mergeStateStatus: "CLEAN",
    };
    this.pullRequestByCwd.set(cwd, pullRequest);
    return pullRequest;
  }

  mergeCurrentBranchPullRequest({
    cwd,
  }: {
    cwd: string;
    strategy: "squash" | "merge" | "rebase";
  }): void {
    if (this.failMergePullRequest) {
      throw new Error("Simulated merge PR failure");
    }

    const pullRequest = this.pullRequestByCwd.get(cwd);
    if (!pullRequest) {
      throw new Error("No open pull request for this branch.");
    }

    this.pullRequestByCwd.set(cwd, {
      ...pullRequest,
      state: "MERGED",
      mergeable: "UNKNOWN",
      mergeStateStatus: "MERGED",
    });
  }

  getWorktree(path: string): { branchName: string; baseRef: string; cwd: string } | null {
    return this.worktrees.get(path) ?? null;
  }

  hasBranch(branchName: string): boolean {
    return this.branches.has(branchName);
  }

  getLastCommitMessage(cwd: string): string | null {
    const commits = this.commitsByCwd.get(cwd);
    if (!commits || commits.length === 0) {
      return null;
    }
    return commits[commits.length - 1] ?? null;
  }

  getPushCount(cwd: string): number {
    return this.pushesByCwd.get(cwd) ?? 0;
  }

  getSyncBaseRefs(cwd: string): string[] {
    return [...(this.syncsByCwd.get(cwd) ?? [])];
  }

  getPullRequestState(cwd: string): "OPEN" | "MERGED" | "CLOSED" | null {
    return this.pullRequestByCwd.get(cwd)?.state ?? null;
  }
}

describe("createApiServer", () => {
  let stopServer: (() => Promise<void>) | null = null;
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    if (stopServer) {
      await stopServer();
      stopServer = null;
    }

    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  const startServer = async (options: Partial<Parameters<typeof createApiServer>[0]> = {}) => {
    const workspaceCwd =
      options.workspaceCwd ??
      (() => {
        const directory = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
        temporaryDirectories.push(directory);
        return directory;
      })();
    const apiServer = createApiServer({
      workspaceCwd,
      gitClient: options.gitClient ?? new FakeGitClient(),
      ...options,
    });
    const address = await apiServer.start(0, "127.0.0.1");
    stopServer = () => apiServer.stop();
    return `http://${address.host}:${address.port}`;
  };

  const toWebSocketBaseUrl = (httpBaseUrl: string) =>
    httpBaseUrl.startsWith("https://")
      ? httpBaseUrl.replace("https://", "wss://")
      : httpBaseUrl.replace("http://", "ws://");

  const writeConversationTranscript = (
    workspaceCwd: string,
    sessionId: string,
    events: unknown[],
  ) => {
    const transcriptDirectory = join(workspaceCwd, ".octogent", "state", "transcripts");
    mkdirSync(transcriptDirectory, { recursive: true });
    const transcriptPath = join(transcriptDirectory, `${encodeURIComponent(sessionId)}.jsonl`);
    writeFileSync(
      transcriptPath,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
  };

  const writeClaudeTurns = (
    workspaceCwd: string,
    sessionId: string,
    turns: Array<{ turnId: string; role: string; content: string; startedAt: string; endedAt: string }>,
  ) => {
    const transcriptDirectory = join(workspaceCwd, ".octogent", "state", "transcripts");
    mkdirSync(transcriptDirectory, { recursive: true });
    const turnsPath = join(transcriptDirectory, `${encodeURIComponent(sessionId)}.claude-turns.json`);
    writeFileSync(turnsPath, JSON.stringify(turns), "utf8");
  };

  it("returns snapshots for GET /api/agent-snapshots", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/agent-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  it("returns session summaries for GET /api/conversations", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    writeConversationTranscript(workspaceCwd, "tentacle-1-root", [
      {
        type: "session_start",
        eventId: "tentacle-1-root:1",
        sessionId: "tentacle-1-root",
        tentacleId: "tentacle-1",
        timestamp: "2026-03-05T10:00:00.000Z",
      },
      {
        type: "session_end",
        eventId: "tentacle-1-root:5",
        sessionId: "tentacle-1-root",
        tentacleId: "tentacle-1",
        reason: "pty_exit",
        exitCode: 0,
        signal: 0,
        timestamp: "2026-03-05T10:00:04.000Z",
      },
    ]);
    writeClaudeTurns(workspaceCwd, "tentacle-1-root", [
      {
        turnId: "turn-1",
        role: "user",
        content: "build export",
        startedAt: "2026-03-05T10:00:01.000Z",
        endedAt: "2026-03-05T10:00:01.000Z",
      },
      {
        turnId: "turn-2",
        role: "assistant",
        content: "implemented",
        startedAt: "2026-03-05T10:00:02.000Z",
        endedAt: "2026-03-05T10:00:03.000Z",
      },
    ]);

    const baseUrl = await startServer({
      workspaceCwd,
    });

    const response = await fetch(`${baseUrl}/api/conversations`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        sessionId: "tentacle-1-root",
        tentacleId: "tentacle-1",
        startedAt: "2026-03-05T10:00:00.000Z",
        endedAt: "2026-03-05T10:00:04.000Z",
        lastEventAt: "2026-03-05T10:00:04.000Z",
        eventCount: 2,
        turnCount: 2,
        userTurnCount: 1,
        assistantTurnCount: 1,
        firstUserTurnPreview: "build export",
        lastUserTurnPreview: "build export",
        lastAssistantTurnPreview: "implemented",
      },
    ]);
  });

  it("returns assembled conversation details and export payloads", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    writeConversationTranscript(workspaceCwd, "tentacle-2-agent-1", [
      {
        type: "session_start",
        eventId: "tentacle-2-agent-1:1",
        sessionId: "tentacle-2-agent-1",
        tentacleId: "tentacle-2",
        timestamp: "2026-03-05T11:00:00.000Z",
      },
    ]);
    writeClaudeTurns(workspaceCwd, "tentacle-2-agent-1", [
      {
        turnId: "turn-1",
        role: "user",
        content: "summarize",
        startedAt: "2026-03-05T11:00:01.000Z",
        endedAt: "2026-03-05T11:00:01.000Z",
      },
      {
        turnId: "turn-2",
        role: "assistant",
        content: "summary ready",
        startedAt: "2026-03-05T11:00:02.000Z",
        endedAt: "2026-03-05T11:00:03.000Z",
      },
    ]);

    const baseUrl = await startServer({
      workspaceCwd,
    });

    const detailResponse = await fetch(`${baseUrl}/api/conversations/tentacle-2-agent-1`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      sessionId: "tentacle-2-agent-1",
      turnCount: 2,
      turns: [
        {
          role: "user",
          content: "summarize",
        },
        {
          role: "assistant",
          content: "summary ready",
        },
      ],
    });

    const jsonExportResponse = await fetch(
      `${baseUrl}/api/conversations/tentacle-2-agent-1/export?format=json`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
    );
    expect(jsonExportResponse.status).toBe(200);
    await expect(jsonExportResponse.json()).resolves.toMatchObject({
      sessionId: "tentacle-2-agent-1",
      turnCount: 2,
    });

    const markdownExportResponse = await fetch(
      `${baseUrl}/api/conversations/tentacle-2-agent-1/export?format=md`,
      {
        method: "GET",
      },
    );
    expect(markdownExportResponse.status).toBe(200);
    expect(markdownExportResponse.headers.get("content-type")).toContain("text/markdown");
    const markdownBody = await markdownExportResponse.text();
    expect(markdownBody).toContain("## User");
    expect(markdownBody).toContain("summarize");
    expect(markdownBody).toContain("## Assistant");
    expect(markdownBody).toContain("summary ready");
  });

  it("returns 400 for unsupported conversation export format", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    writeConversationTranscript(workspaceCwd, "tentacle-3-agent-1", [
      {
        type: "session_start",
        eventId: "tentacle-3-agent-1:1",
        sessionId: "tentacle-3-agent-1",
        tentacleId: "tentacle-3",
        timestamp: "2026-03-05T12:00:00.000Z",
      },
    ]);

    const baseUrl = await startServer({
      workspaceCwd,
    });

    const response = await fetch(
      `${baseUrl}/api/conversations/tentacle-3-agent-1/export?format=txt`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported conversation export format.",
    });
  });

  it("rejects non-local browser origins for HTTP endpoints", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/agent-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Origin: "https://attacker.example",
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Origin not allowed.",
    });
  });

  it("allows loopback browser origins and reflects CORS origin", async () => {
    const baseUrl = await startServer();
    const origin = "http://localhost:5173";

    const response = await fetch(`${baseUrl}/api/agent-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Origin: origin,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("rejects non-local CORS preflight requests", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/tentacles`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(response.status).toBe(403);
  });

  it("rejects websocket upgrades from non-local origins", async () => {
    const baseUrl = await startServer();
    const wsUrl = new URL(`${toWebSocketBaseUrl(baseUrl)}/api/terminals/tentacle-1/ws`);

    const opened = await new Promise<boolean>((resolve) => {
      const socket = createConnection({
        host: wsUrl.hostname,
        port: Number.parseInt(wsUrl.port, 10),
      });
      let settled = false;
      let responseHead = "";

      const finish = (didOpen: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(didOpen);
      };

      socket.on("connect", () => {
        socket.write(
          `GET ${wsUrl.pathname} HTTP/1.1\r\nHost: ${wsUrl.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: https://attacker.example\r\n\r\n`,
        );
      });
      socket.on("data", (chunk) => {
        responseHead += chunk.toString("utf8");
        if (responseHead.includes("101 Switching Protocols")) {
          finish(true);
        }
      });
      socket.on("error", () => finish(false));
      socket.on("close", () => finish(false));
      setTimeout(() => finish(false), 1_000);
    });

    expect(opened).toBe(false);
  });

  it("returns 405 for unsupported methods on /api/agent-snapshots", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/agent-snapshots`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });

  it("sanitizes unexpected internal errors from API responses", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/tentacles/%E0%A4%A`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
    });
  });

  it("returns codex usage snapshot for GET /api/codex/usage", async () => {
    const codexSnapshot = {
      status: "ok",
      source: "oauth-api",
      fetchedAt: "2026-02-25T12:00:00.000Z",
      planType: "pro",
      primaryUsedPercent: 12,
      secondaryUsedPercent: 28,
      creditsBalance: 88.5,
      creditsUnlimited: false,
    } as const;

    const baseUrl = await startServer({
      readCodexUsageSnapshot: async () => codexSnapshot,
    });

    const response = await fetch(`${baseUrl}/api/codex/usage`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(codexSnapshot);
  });

  it("returns claude usage snapshot for GET /api/claude/usage", async () => {
    const claudeSnapshot = {
      status: "ok",
      source: "oauth-api",
      fetchedAt: "2026-03-03T12:00:00.000Z",
      planType: "pro",
      primaryUsedPercent: 11,
      primaryResetAt: "2026-03-03T15:00:00.000Z",
      secondaryUsedPercent: 27,
      secondaryResetAt: "2026-03-05T00:00:00.000Z",
      sonnetUsedPercent: 19,
      sonnetResetAt: "2026-03-05T00:00:00.000Z",
    } as const;

    const baseUrl = await startServer({
      readClaudeUsageSnapshot: async () => claudeSnapshot,
    });

    const response = await fetch(`${baseUrl}/api/claude/usage`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(claudeSnapshot);
  });

  it("returns github summary for GET /api/github/summary", async () => {
    const githubSummary: GitHubRepoSummarySnapshot = {
      status: "ok",
      fetchedAt: "2026-02-27T12:00:00.000Z",
      source: "gh-cli",
      repo: "hesamsheikh/octogent",
      stargazerCount: 42,
      openIssueCount: 7,
      openPullRequestCount: 3,
      commitsPerDay: [
        { date: "2026-02-25", count: 4 },
        { date: "2026-02-26", count: 6 },
        { date: "2026-02-27", count: 8 },
      ],
      recentCommits: [
        {
          hash: "d8f2d9b7aa9f53f8fa254d8e0f3a13270435e321",
          shortHash: "d8f2d9b",
          subject: "tighten monitor polling backoff strategy",
          authorName: "Hesam Sheikh",
          authorEmail: "hesam@example.com",
          authoredAt: "2026-02-27T10:12:00.000Z",
          body: "Reduce the backoff multiplier from 2x to 1.5x to improve\nresponsiveness when rate limits recover.",
          filesChanged: 3,
          insertions: 42,
          deletions: 7,
        },
      ],
    };

    const baseUrl = await startServer({
      readGithubRepoSummary: async () => githubSummary,
    });

    const response = await fetch(`${baseUrl}/api/github/summary`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(githubSummary);
  });

  it("returns 405 for unsupported methods on /api/codex/usage", async () => {
    const baseUrl = await startServer({
      readCodexUsageSnapshot: async () => ({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-02-25T12:00:00.000Z",
      }),
    });

    const response = await fetch(`${baseUrl}/api/codex/usage`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });

  it("returns 405 for unsupported methods on /api/claude/usage", async () => {
    const baseUrl = await startServer({
      readClaudeUsageSnapshot: async () => ({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-03-03T12:00:00.000Z",
      }),
    });

    const response = await fetch(`${baseUrl}/api/claude/usage`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });

  it("returns 405 for unsupported methods on /api/github/summary", async () => {
    const baseUrl = await startServer({
      readGithubRepoSummary: async () => ({
        status: "unavailable",
        fetchedAt: "2026-02-27T12:00:00.000Z",
        source: "none",
        message: "GitHub CLI not available.",
      }),
    });

    const response = await fetch(`${baseUrl}/api/github/summary`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });

  it("returns 405 for unsupported methods on /api/ui-state", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });

  it("returns 413 when create tentacle body exceeds size limit", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "x".repeat(1024 * 1024 + 1),
      }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request body too large.",
    });
  });

  it("returns 413 when ui-state patch body exceeds size limit", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/ui-state`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        minimizedTentacleIds: ["tentacle-1"],
        blob: "x".repeat(1024 * 1024 + 1),
      }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request body too large.",
    });
  });

  it("returns 400 for unsupported tentacle completion sound values", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/ui-state`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tentacleCompletionSound: "laser-zap",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "tentacleCompletionSound must be one of the supported sound identifiers.",
    });
  });

  it("restores ui state across API restarts using persisted registry", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);

    const firstBaseUrl = await startServer({
      workspaceCwd,
    });

    const createResponse = await fetch(`${firstBaseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);

    const patchResponse = await fetch(`${firstBaseUrl}/api/ui-state`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isAgentsSidebarVisible: false,
        sidebarWidth: 380,
        isActiveAgentsSectionExpanded: false,
        isRuntimeStatusStripVisible: false,
        isMonitorVisible: false,
        isBottomTelemetryVisible: false,
        isCodexUsageVisible: false,
        isClaudeUsageVisible: false,
        isClaudeUsageSectionExpanded: false,
        isCodexUsageSectionExpanded: false,
        tentacleCompletionSound: "double-beep",
        minimizedTentacleIds: ["tentacle-1"],
        tentacleWidths: {
          "tentacle-1": 420,
        },
      }),
    });
    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toEqual({
      isAgentsSidebarVisible: false,
      sidebarWidth: 380,
      isActiveAgentsSectionExpanded: false,
      isRuntimeStatusStripVisible: false,
      isMonitorVisible: false,
      isBottomTelemetryVisible: false,
      isCodexUsageVisible: false,
      isClaudeUsageVisible: false,
      isClaudeUsageSectionExpanded: false,
      isCodexUsageSectionExpanded: false,
      tentacleCompletionSound: "double-beep",
      minimizedTentacleIds: ["tentacle-1"],
      tentacleWidths: {
        "tentacle-1": 420,
      },
    });

    if (stopServer) {
      await stopServer();
      stopServer = null;
    }

    const secondBaseUrl = await startServer({
      workspaceCwd,
    });

    const getResponse = await fetch(`${secondBaseUrl}/api/ui-state`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual({
      isAgentsSidebarVisible: false,
      sidebarWidth: 380,
      isActiveAgentsSectionExpanded: false,
      isRuntimeStatusStripVisible: false,
      isMonitorVisible: false,
      isBottomTelemetryVisible: false,
      isCodexUsageVisible: false,
      isClaudeUsageVisible: false,
      isClaudeUsageSectionExpanded: false,
      isCodexUsageSectionExpanded: false,
      tentacleCompletionSound: "double-beep",
      minimizedTentacleIds: ["tentacle-1"],
      tentacleWidths: {
        "tentacle-1": 420,
      },
    });
  });

  it("creates new tentacles with unique incremental ids", async () => {
    const baseUrl = await startServer();

    const createFirstResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "planner" }),
    });

    expect(createFirstResponse.status).toBe(201);
    await expect(createFirstResponse.json()).resolves.toEqual(
      expect.objectContaining({
        agentId: "tentacle-1-root",
        label: "tentacle-1-root",
        state: "live",
        tentacleId: "tentacle-1",
        tentacleName: "planner",
        tentacleWorkspaceMode: "shared",
      }),
    );

    const createSecondResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });

    expect(createSecondResponse.status).toBe(201);
    await expect(createSecondResponse.json()).resolves.toEqual(
      expect.objectContaining({
        agentId: "tentacle-2-root",
        label: "tentacle-2-root",
        state: "live",
        tentacleId: "tentacle-2",
        tentacleName: "tentacle-2",
        tentacleWorkspaceMode: "shared",
      }),
    );

    const renameResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-2`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "reviewer" }),
    });

    expect(renameResponse.status).toBe(200);
    await expect(renameResponse.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "tentacle-2",
        tentacleName: "reviewer",
      }),
    );

    const listResponse = await fetch(`${baseUrl}/api/agent-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "tentacle-1-root",
          tentacleId: "tentacle-1",
          tentacleName: "planner",
          tentacleWorkspaceMode: "shared",
        }),
        expect.objectContaining({
          agentId: "tentacle-1-agent-1",
          tentacleId: "tentacle-1",
          parentAgentId: "tentacle-1-root",
        }),
        expect.objectContaining({
          agentId: "tentacle-2-root",
          tentacleId: "tentacle-2",
          tentacleName: "reviewer",
          tentacleWorkspaceMode: "shared",
        }),
        expect.objectContaining({
          agentId: "tentacle-2-agent-1",
          tentacleId: "tentacle-2",
          parentAgentId: "tentacle-2-root",
        }),
      ]),
    );
  });

  it("reuses the minimum available tentacle number after deletions", async () => {
    const baseUrl = await startServer();

    const createFirstResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createFirstResponse.status).toBe(201);

    const createSecondResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createSecondResponse.status).toBe(201);

    const deleteFirstResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    expect(deleteFirstResponse.status).toBe(204);

    const createThirdResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createThirdResponse.status).toBe(201);
    await expect(createThirdResponse.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "tentacle-1",
      }),
    );
  });

  it("creates child terminal agents above or below an anchor terminal", async () => {
    const baseUrl = await startServer();

    const createTentacleResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createTentacleResponse.status).toBe(201);

    const addBelowRootResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/agents`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        anchorAgentId: "tentacle-1-root",
        placement: "down",
      }),
    });
    expect(addBelowRootResponse.status).toBe(201);
    await expect(addBelowRootResponse.json()).resolves.toEqual(
      expect.objectContaining({
        agentId: "tentacle-1-agent-2",
        tentacleId: "tentacle-1",
      }),
    );

    const addAboveChildResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/agents`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        anchorAgentId: "tentacle-1-agent-1",
        placement: "up",
      }),
    });
    expect(addAboveChildResponse.status).toBe(201);
    await expect(addAboveChildResponse.json()).resolves.toEqual(
      expect.objectContaining({
        agentId: "tentacle-1-agent-3",
        tentacleId: "tentacle-1",
      }),
    );

    const listResponse = await fetch(`${baseUrl}/api/agent-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({
        agentId: "tentacle-1-root",
        tentacleId: "tentacle-1",
      }),
      expect.objectContaining({
        agentId: "tentacle-1-agent-2",
        tentacleId: "tentacle-1",
      }),
      expect.objectContaining({
        agentId: "tentacle-1-agent-3",
        tentacleId: "tentacle-1",
      }),
      expect.objectContaining({
        agentId: "tentacle-1-agent-1",
        tentacleId: "tentacle-1",
      }),
    ]);

    const deleteAgentResponse = await fetch(
      `${baseUrl}/api/tentacles/tentacle-1/agents/tentacle-1-agent-1`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/json",
        },
      },
    );
    expect(deleteAgentResponse.status).toBe(204);

    const listAfterDeleteResponse = await fetch(`${baseUrl}/api/agent-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(listAfterDeleteResponse.status).toBe(200);
    await expect(listAfterDeleteResponse.json()).resolves.toEqual([
      expect.objectContaining({
        agentId: "tentacle-1-root",
        tentacleId: "tentacle-1",
      }),
      expect.objectContaining({
        agentId: "tentacle-1-agent-2",
        tentacleId: "tentacle-1",
        parentAgentId: "tentacle-1-root",
      }),
      expect.objectContaining({
        agentId: "tentacle-1-agent-3",
        tentacleId: "tentacle-1",
        parentAgentId: "tentacle-1-root",
      }),
    ]);
  });

  it("returns 409 when deleting the root terminal through the agent endpoint", async () => {
    const baseUrl = await startServer();

    const createTentacleResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createTentacleResponse.status).toBe(201);

    const deleteRootResponse = await fetch(
      `${baseUrl}/api/tentacles/tentacle-1/agents/tentacle-1-root`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/json",
        },
      },
    );
    expect(deleteRootResponse.status).toBe(409);
    await expect(deleteRootResponse.json()).resolves.toEqual({
      error: "Root terminal cannot be deleted from terminal controls.",
    });
  });

  it("ignores stale persisted nextTentacleNumber values and starts from the minimum available id", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const registryPath = join(workspaceCwd, ".octogent", "state", "tentacles.json");
    mkdirSync(join(workspaceCwd, ".octogent", "state"), { recursive: true });
    writeFileSync(
      registryPath,
      `${JSON.stringify(
        {
          version: 2,
          nextTentacleNumber: 19,
          tentacles: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const baseUrl = await startServer({
      workspaceCwd,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "tentacle-1",
      }),
    );
  });

  it("skips tentacle ids that already have an existing worktree directory", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    mkdirSync(join(workspaceCwd, ".octogent", "worktrees", "tentacle-1"), {
      recursive: true,
    });

    const baseUrl = await startServer({
      workspaceCwd,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "tentacle-2",
      }),
    );
  });

  it("persists tentacle metadata without runtime bootstrap flags", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const baseUrl = await startServer({
      workspaceCwd,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "planner" }),
    });
    expect(createResponse.status).toBe(201);

    const registryPath = join(workspaceCwd, ".octogent", "state", "tentacles.json");
    const registryDocument = JSON.parse(readFileSync(registryPath, "utf8")) as {
      tentacles: Array<{ tentacleId: string; workspaceMode: "shared" | "worktree" }>;
    };
    expect(registryDocument.tentacles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tentacleId: "tentacle-1",
          workspaceMode: "shared",
        }),
      ]),
    );
  });

  it("creates isolated worktree tentacles with dedicated cwd", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "planner",
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "tentacle-1",
        tentacleName: "planner",
        tentacleWorkspaceMode: "worktree",
      }),
    );

    const expectedWorktreePath = join(workspaceCwd, ".octogent", "worktrees", "tentacle-1");
    expect(gitClient.getWorktree(expectedWorktreePath)).toEqual(
      expect.objectContaining({
        cwd: workspaceCwd,
        branchName: "octogent/tentacle-1",
        baseRef: "HEAD",
      }),
    );

    const registryPath = join(workspaceCwd, ".octogent", "state", "tentacles.json");
    const registryDocument = JSON.parse(readFileSync(registryPath, "utf8")) as {
      tentacles: Array<{ tentacleId: string; workspaceMode: "shared" | "worktree" }>;
    };
    expect(registryDocument.tentacles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tentacleId: "tentacle-1",
          workspaceMode: "worktree",
        }),
      ]),
    );
  });

  it("returns git status for worktree tentacles", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "tentacle-1");
    gitClient.setWorktreeStatus(worktreePath, {
      branchName: "octogent/tentacle-1",
      upstreamBranchName: "origin/octogent/tentacle-1",
      isDirty: true,
      aheadCount: 2,
      behindCount: 1,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: ["apps/web/src/App.tsx", "README.md"],
      defaultBaseBranchName: "main",
    });

    const statusResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/git/status`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toEqual({
      tentacleId: "tentacle-1",
      workspaceMode: "worktree",
      branchName: "octogent/tentacle-1",
      upstreamBranchName: "origin/octogent/tentacle-1",
      isDirty: true,
      aheadCount: 2,
      behindCount: 1,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: ["apps/web/src/App.tsx", "README.md"],
      defaultBaseBranchName: "main",
    });
  });

  it("returns 409 for git status on shared tentacles", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);

    const statusResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/git/status`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(statusResponse.status).toBe(409);
    await expect(statusResponse.json()).resolves.toEqual({
      error: "Git lifecycle actions are only available for worktree tentacles.",
    });
  });

  it("commits pending worktree changes with a required message", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "tentacle-1");
    gitClient.setWorktreeStatus(worktreePath, {
      branchName: "octogent/tentacle-1",
      upstreamBranchName: "origin/octogent/tentacle-1",
      isDirty: true,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: ["apps/web/src/App.tsx"],
      defaultBaseBranchName: "main",
    });

    const commitResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/git/commit`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "feat: add worktree git actions",
      }),
    });
    expect(commitResponse.status).toBe(200);
    expect(gitClient.getLastCommitMessage(worktreePath)).toBe("feat: add worktree git actions");
    await expect(commitResponse.json()).resolves.toEqual({
      tentacleId: "tentacle-1",
      workspaceMode: "worktree",
      branchName: "octogent/tentacle-1",
      upstreamBranchName: "origin/octogent/tentacle-1",
      isDirty: false,
      aheadCount: 1,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });
  });

  it("returns 400 for commit when message is empty", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "tentacle-1");
    const commitResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/git/commit`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "   ",
      }),
    });
    expect(commitResponse.status).toBe(400);
    expect(gitClient.getLastCommitMessage(worktreePath)).toBeNull();
    await expect(commitResponse.json()).resolves.toEqual({
      error: "Commit message cannot be empty.",
    });
  });

  it("pushes worktree branch and updates ahead count", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "tentacle-1");
    gitClient.setWorktreeStatus(worktreePath, {
      branchName: "octogent/tentacle-1",
      upstreamBranchName: null,
      isDirty: false,
      aheadCount: 3,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });

    const pushResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/git/push`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(pushResponse.status).toBe(200);
    expect(gitClient.getPushCount(worktreePath)).toBe(1);
    await expect(pushResponse.json()).resolves.toEqual({
      tentacleId: "tentacle-1",
      workspaceMode: "worktree",
      branchName: "octogent/tentacle-1",
      upstreamBranchName: "origin/octogent/tentacle-1",
      isDirty: false,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });
  });

  it("syncs worktree branch with base ref", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "tentacle-1");
    gitClient.setWorktreeStatus(worktreePath, {
      branchName: "octogent/tentacle-1",
      upstreamBranchName: "origin/octogent/tentacle-1",
      isDirty: false,
      aheadCount: 0,
      behindCount: 4,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });

    const syncResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/git/sync`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        baseRef: "main",
      }),
    });
    expect(syncResponse.status).toBe(200);
    expect(gitClient.getSyncBaseRefs(worktreePath)).toEqual(["main"]);
    await expect(syncResponse.json()).resolves.toEqual({
      tentacleId: "tentacle-1",
      workspaceMode: "worktree",
      branchName: "octogent/tentacle-1",
      upstreamBranchName: "origin/octogent/tentacle-1",
      isDirty: false,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });
  });

  it("returns PR status for worktree tentacles", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "tentacle-1");
    gitClient.setWorktreePullRequest(worktreePath, {
      number: 142,
      url: "https://github.com/hesamsheikh/octogent/pull/142",
      title: "feat: worktree git lifecycle menu",
      baseRef: "main",
      headRef: "octogent/tentacle-1",
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
    });

    const prStatusResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/git/pr`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(prStatusResponse.status).toBe(200);
    await expect(prStatusResponse.json()).resolves.toEqual({
      tentacleId: "tentacle-1",
      workspaceMode: "worktree",
      status: "open",
      number: 142,
      url: "https://github.com/hesamsheikh/octogent/pull/142",
      title: "feat: worktree git lifecycle menu",
      baseRef: "main",
      headRef: "octogent/tentacle-1",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
    });
  });

  it("creates PR for worktree tentacles and returns PR snapshot", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "tentacle-1");
    gitClient.setWorktreeStatus(worktreePath, {
      branchName: "octogent/tentacle-1",
      upstreamBranchName: "origin/octogent/tentacle-1",
      isDirty: false,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });

    const createPrResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/git/pr`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "feat: expose worktree lifecycle actions",
        body: "Adds PR controls in the tentacle header.",
        baseRef: "main",
      }),
    });
    expect(createPrResponse.status).toBe(200);
    await expect(createPrResponse.json()).resolves.toEqual({
      tentacleId: "tentacle-1",
      workspaceMode: "worktree",
      status: "open",
      number: 101,
      url: "https://github.com/hesamsheikh/octogent/pull/101",
      title: "feat: expose worktree lifecycle actions",
      baseRef: "main",
      headRef: "octogent/tentacle-1",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
    });
  });

  it("returns 409 when creating a PR and an open PR already exists for the branch", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "tentacle-1");
    gitClient.setWorktreeStatus(worktreePath, {
      branchName: "octogent/tentacle-1",
      upstreamBranchName: "origin/octogent/tentacle-1",
      isDirty: false,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });
    gitClient.setWorktreePullRequest(worktreePath, {
      number: 142,
      url: "https://github.com/hesamsheikh/octogent/pull/142",
      title: "feat: existing worktree lifecycle PR",
      baseRef: "main",
      headRef: "octogent/tentacle-1",
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
    });

    const createPrResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/git/pr`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "feat: should not create duplicate PR",
        body: "Should fail because the branch already has an open PR.",
        baseRef: "main",
      }),
    });
    expect(createPrResponse.status).toBe(409);
    await expect(createPrResponse.json()).resolves.toEqual({
      error: "An open pull request already exists for this branch.",
    });

    expect(gitClient.getPullRequestState(worktreePath)).toBe("OPEN");
  });

  it("merges the current branch PR for worktree tentacles", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "tentacle-1");
    gitClient.setWorktreePullRequest(worktreePath, {
      number: 190,
      url: "https://github.com/hesamsheikh/octogent/pull/190",
      title: "feat: ship worktree lifecycle",
      baseRef: "main",
      headRef: "octogent/tentacle-1",
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
    });

    const mergeResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/git/pr/merge`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(mergeResponse.status).toBe(200);
    expect(gitClient.getPullRequestState(worktreePath)).toBe("MERGED");
    await expect(mergeResponse.json()).resolves.toEqual({
      tentacleId: "tentacle-1",
      workspaceMode: "worktree",
      status: "merged",
      number: 190,
      url: "https://github.com/hesamsheikh/octogent/pull/190",
      title: "feat: ship worktree lifecycle",
      baseRef: "main",
      headRef: "octogent/tentacle-1",
      isDraft: false,
      mergeable: "UNKNOWN",
      mergeStateStatus: "MERGED",
    });
  });

  it("returns 409 for PR actions on shared tentacles", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);

    const prStatusResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1/git/pr`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(prStatusResponse.status).toBe(409);
    await expect(prStatusResponse.json()).resolves.toEqual({
      error: "Git lifecycle actions are only available for worktree tentacles.",
    });
  });

  it("removes isolated worktree metadata when deleting a worktree tentacle", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const expectedWorktreePath = join(workspaceCwd, ".octogent", "worktrees", "tentacle-1");
    expect(gitClient.getWorktree(expectedWorktreePath)).toEqual(
      expect.objectContaining({
        cwd: workspaceCwd,
        branchName: "octogent/tentacle-1",
      }),
    );

    const deleteResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    expect(deleteResponse.status).toBe(204);
    expect(gitClient.getWorktree(expectedWorktreePath)).toBeNull();
    expect(gitClient.hasBranch("octogent/tentacle-1")).toBe(false);
  });

  it("returns 409 and keeps tentacle state when worktree deletion fails", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const expectedWorktreePath = join(workspaceCwd, ".octogent", "worktrees", "tentacle-1");
    gitClient.setFailRemoveWorktree(true);

    const deleteResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    expect(deleteResponse.status).toBe(409);
    await expect(deleteResponse.json()).resolves.toEqual({
      error: expect.stringContaining("Unable to remove worktree for tentacle-1"),
    });
    expect(gitClient.getWorktree(expectedWorktreePath)).toEqual(
      expect.objectContaining({
        cwd: workspaceCwd,
        branchName: "octogent/tentacle-1",
      }),
    );

    const listResponse = await fetch(`${baseUrl}/api/agent-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "tentacle-1-root",
          tentacleId: "tentacle-1",
        }),
        expect.objectContaining({
          agentId: "tentacle-1-agent-1",
          tentacleId: "tentacle-1",
          parentAgentId: "tentacle-1-root",
        }),
      ]),
    );
  });

  it("returns 400 when workspace mode is invalid", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "invalid-mode",
      }),
    });

    expect(createResponse.status).toBe(400);
    await expect(createResponse.json()).resolves.toEqual({
      error: "Tentacle workspace mode must be either 'shared' or 'worktree'.",
    });
  });

  it("returns 400 when creating worktree tentacle outside a git repository", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    gitClient.setRepositoryAvailable(false);
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(400);
    await expect(createResponse.json()).resolves.toEqual({
      error: "Worktree tentacles require a git repository at the workspace root.",
    });

    const listResponse = await fetch(`${baseUrl}/api/agent-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([]);
  });

  it("returns 400 when tentacle name is empty after trimming", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: " " }),
    });

    expect(createResponse.status).toBe(400);

    const validCreateResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(validCreateResponse.status).toBe(201);

    const renameResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: " " }),
    });

    expect(renameResponse.status).toBe(400);
  });

  it("deletes a tentacle and removes it from snapshots", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);

    const deleteResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    expect(deleteResponse.status).toBe(204);

    const listResponse = await fetch(`${baseUrl}/api/agent-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([]);

    const missingResponse = await fetch(`${baseUrl}/api/tentacles/tentacle-1`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    expect(missingResponse.status).toBe(404);
  });

  it("restores tentacles across API restarts using persisted registry", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);

    const firstBaseUrl = await startServer({
      workspaceCwd,
    });

    const createResponse = await fetch(`${firstBaseUrl}/api/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "planner" }),
    });
    expect(createResponse.status).toBe(201);

    if (stopServer) {
      await stopServer();
      stopServer = null;
    }

    const secondBaseUrl = await startServer({
      workspaceCwd,
    });

    const listResponse = await fetch(`${secondBaseUrl}/api/agent-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "tentacle-1-root",
          tentacleId: "tentacle-1",
          tentacleName: "planner",
        }),
        expect.objectContaining({
          agentId: "tentacle-1-agent-1",
          tentacleId: "tentacle-1",
          parentAgentId: "tentacle-1-root",
        }),
      ]),
    );
  });
});
