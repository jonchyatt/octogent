import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApiServer } from "../src/createApiServer";
import type { TmuxClient } from "../src/terminalRuntime";

class FakeTmuxClient implements TmuxClient {
  private readonly sessions = new Map<string, { cwd: string; command: string }>();

  assertAvailable(): void {}

  hasSession(sessionName: string): boolean {
    return this.sessions.has(sessionName);
  }

  capturePane(sessionName: string): string {
    return this.sessions.has(sessionName) ? "fake tmux snapshot\n" : "";
  }

  createSession({
    sessionName,
    cwd,
    command,
  }: {
    sessionName: string;
    cwd: string;
    command: string;
  }): void {
    if (this.sessions.has(sessionName)) {
      throw new Error(`Session already exists: ${sessionName}`);
    }
    this.sessions.set(sessionName, { cwd, command });
  }

  killSession(sessionName: string): void {
    this.sessions.delete(sessionName);
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

  const startServer = async (
    options: Partial<Parameters<typeof createApiServer>[0]> = {},
  ) => {
    const workspaceCwd =
      options.workspaceCwd ??
      (() => {
        const directory = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
        temporaryDirectories.push(directory);
        return directory;
      })();
    const apiServer = createApiServer({
      workspaceCwd,
      tmuxClient: options.tmuxClient ?? new FakeTmuxClient(),
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
          `GET ${wsUrl.pathname} HTTP/1.1\r\n` +
            `Host: ${wsUrl.host}\r\n` +
            "Connection: Upgrade\r\n" +
            "Upgrade: websocket\r\n" +
            "Sec-WebSocket-Version: 13\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
            "Origin: https://attacker.example\r\n\r\n",
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
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({ tentacleId: "tentacle-1", tentacleName: "planner" }),
      expect.objectContaining({ tentacleId: "tentacle-2", tentacleName: "reviewer" }),
    ]);
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
    const tmuxClient = new FakeTmuxClient();

    const firstBaseUrl = await startServer({
      workspaceCwd,
      tmuxClient,
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
      tmuxClient,
    });

    const listResponse = await fetch(`${secondBaseUrl}/api/agent-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({
        tentacleId: "tentacle-1",
        tentacleName: "planner",
      }),
    ]);
  });

  it("ignores existing tmux sessions when no registry file exists", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const tmuxClient = new FakeTmuxClient();
    tmuxClient.createSession({
      sessionName: "octogent_tentacle-99",
      cwd: workspaceCwd,
      command: "codex",
    });

    const baseUrl = await startServer({
      workspaceCwd,
      tmuxClient,
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
});
