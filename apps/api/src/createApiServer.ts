import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";

import {
  type CodexUsageSnapshot,
  readCodexUsageSnapshot as readCodexUsageSnapshotDefault,
} from "./codexUsage";
import { createTerminalRuntime, type TmuxClient } from "./terminalRuntime";

type CreateApiServerOptions = {
  workspaceCwd?: string;
  tmuxClient?: TmuxClient;
  readCodexUsageSnapshot?: () => Promise<CodexUsageSnapshot>;
};

const withCors = (headers: Record<string, string>) => ({
  ...headers,
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const payload = Buffer.concat(chunks).toString("utf8").trim();
  if (payload.length === 0) {
    return null;
  }

  return JSON.parse(payload);
};

const parseTentacleName = (payload: unknown) => {
  if (payload === null || payload === undefined) {
    return {
      provided: false,
      name: undefined as string | undefined,
      error: null as string | null,
    };
  }

  if (typeof payload !== "object") {
    return {
      provided: true,
      name: undefined as string | undefined,
      error: "Expected a JSON object body.",
    };
  }

  const rawName = (payload as Record<string, unknown>).name;
  if (rawName === undefined) {
    return {
      provided: false,
      name: undefined as string | undefined,
      error: null as string | null,
    };
  }

  if (typeof rawName !== "string") {
    return {
      provided: true,
      name: undefined as string | undefined,
      error: "Tentacle name must be a string.",
    };
  }

  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    return {
      provided: true,
      name: undefined as string | undefined,
      error: "Tentacle name cannot be empty.",
    };
  }

  return {
    provided: true,
    name: trimmed,
    error: null as string | null,
  };
};

export const createApiServer = ({
  workspaceCwd,
  tmuxClient,
  readCodexUsageSnapshot = readCodexUsageSnapshotDefault,
}: CreateApiServerOptions = {}) => {
  const runtimeOptions: Parameters<typeof createTerminalRuntime>[0] = {
    workspaceCwd: workspaceCwd ?? resolve(process.cwd(), "../.."),
  };
  if (tmuxClient) {
    runtimeOptions.tmuxClient = tmuxClient;
  }

  const runtime = createTerminalRuntime(runtimeOptions);

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "OPTIONS") {
      response.writeHead(204, withCors({}));
      response.end();
      return;
    }

    if (requestUrl.pathname === "/api/agent-snapshots") {
      if (request.method !== "GET") {
        response.writeHead(405, withCors({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      const payload = runtime.listAgentSnapshots();
      response.writeHead(200, withCors({ "Content-Type": "application/json" }));
      response.end(JSON.stringify(payload));
      return;
    }

    if (requestUrl.pathname === "/api/codex/usage") {
      if (request.method !== "GET") {
        response.writeHead(405, withCors({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      const payload = await readCodexUsageSnapshot();
      response.writeHead(200, withCors({ "Content-Type": "application/json" }));
      response.end(JSON.stringify(payload));
      return;
    }

    if (requestUrl.pathname === "/api/tentacles") {
      if (request.method !== "POST") {
        response.writeHead(405, withCors({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      let bodyPayload: unknown = null;
      try {
        bodyPayload = await readJsonBody(request);
      } catch {
        response.writeHead(400, withCors({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ error: "Invalid JSON body." }));
        return;
      }

      const nameResult = parseTentacleName(bodyPayload);
      if (nameResult.error) {
        response.writeHead(400, withCors({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ error: nameResult.error }));
        return;
      }

      const payload = runtime.createTentacle(nameResult.name);
      response.writeHead(201, withCors({ "Content-Type": "application/json" }));
      response.end(JSON.stringify(payload));
      return;
    }

    const renameMatch = requestUrl.pathname.match(/^\/api\/tentacles\/([^/]+)$/);
    if (renameMatch) {
      if (request.method !== "PATCH" && request.method !== "DELETE") {
        response.writeHead(405, withCors({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      const tentacleId = decodeURIComponent(renameMatch[1] ?? "");
      if (request.method === "DELETE") {
        const deleted = runtime.deleteTentacle(tentacleId);
        if (!deleted) {
          response.writeHead(404, withCors({ "Content-Type": "application/json" }));
          response.end(JSON.stringify({ error: "Tentacle not found." }));
          return;
        }

        response.writeHead(204, withCors({}));
        response.end();
        return;
      }

      let bodyPayload: unknown = null;
      try {
        bodyPayload = await readJsonBody(request);
      } catch {
        response.writeHead(400, withCors({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ error: "Invalid JSON body." }));
        return;
      }

      const nameResult = parseTentacleName(bodyPayload);
      if (nameResult.error) {
        response.writeHead(400, withCors({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ error: nameResult.error }));
        return;
      }

      if (!nameResult.provided || !nameResult.name) {
        response.writeHead(400, withCors({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ error: "Tentacle name is required." }));
        return;
      }

      const payload = runtime.renameTentacle(tentacleId, nameResult.name);
      if (!payload) {
        response.writeHead(404, withCors({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ error: "Tentacle not found." }));
        return;
      }

      response.writeHead(200, withCors({ "Content-Type": "application/json" }));
      response.end(JSON.stringify(payload));
      return;
    }

    response.writeHead(404, withCors({ "Content-Type": "application/json" }));
    response.end(JSON.stringify({ error: "Not found" }));
  });

  server.on("upgrade", (request, socket, head) => {
    if (!runtime.handleUpgrade(request, socket, head)) {
      socket.destroy();
    }
  });

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
      });
    },
  };
};
