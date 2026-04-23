import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  handleExecOutputItemRoute,
  handleExecOutputsCollectionRoute,
} from "../src/createApiServer/execOutputRoutes";

// Phase 10.9.6 — unit tests for the exec-output HTTP endpoints.
// These don't spin up a full server; they invoke the handler functions
// directly with a lightweight mock response recorder.

type CapturedResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const makeMockResponse = (): {
  response: import("node:http").ServerResponse;
  captured: CapturedResponse;
} => {
  const captured: CapturedResponse = { statusCode: 0, headers: {}, body: "" };
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
    },
    writeHead(status: number) {
      captured.statusCode = status;
      this.statusCode = status;
    },
    end(chunk?: string | Buffer) {
      if (captured.statusCode === 0) captured.statusCode = this.statusCode;
      if (typeof chunk === "string") captured.body = chunk;
      else if (chunk) captured.body = chunk.toString();
    },
  } as unknown as import("node:http").ServerResponse;
  return { response, captured };
};

const makeDeps = (projectStateDir: string) =>
  ({
    projectStateDir,
    workspaceCwd: projectStateDir,
    promptsDir: "",
    userPromptsDir: "",
    runtime: null as unknown,
    invalidateClaudeUsageCache: () => {},
    readClaudeUsageSnapshot: async () => null,
  }) as unknown as Parameters<typeof handleExecOutputsCollectionRoute>[1];

describe("handleExecOutputsCollectionRoute", () => {
  let tmpRoot: string;
  let stateDir: string;
  let execDir: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `octogent-exec-test-${process.pid}-${Date.now()}`);
    stateDir = join(tmpRoot, ".octogent");
    execDir = join(stateDir, "state", "exec-output");
    mkdirSync(execDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  const invoke = async (
    method: string,
    pathname: string,
  ): Promise<CapturedResponse> => {
    const { response, captured } = makeMockResponse();
    const requestUrl = new URL(`http://localhost${pathname}`);
    const request = { method } as unknown as import("node:http").IncomingMessage;
    await handleExecOutputsCollectionRoute(
      { request, response, requestUrl, corsOrigin: null },
      makeDeps(stateDir),
    );
    return captured;
  };

  it("returns empty entries when exec-output dir missing", async () => {
    rmSync(execDir, { recursive: true, force: true });
    const r = await invoke("GET", "/api/exec-outputs");
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).entries).toEqual([]);
  });

  it("lists .log files with bytes + mtime, newest first", async () => {
    writeFileSync(join(execDir, "terminal-1.log"), "older log", "utf8");
    // Ensure distinct mtime.
    await new Promise((resolve) => setTimeout(resolve, 20));
    writeFileSync(join(execDir, "terminal-2.log"), "newer log content", "utf8");
    const r = await invoke("GET", "/api/exec-outputs");
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].terminalId).toBe("terminal-2");
    expect(body.entries[1].terminalId).toBe("terminal-1");
    expect(body.entries[0].bytes).toBe("newer log content".length);
    expect(body.entries[1].bytes).toBe("older log".length);
  });

  it("ignores non-.log files (e.g. the .json metadata sidecar)", async () => {
    writeFileSync(join(execDir, "terminal-1.log"), "log", "utf8");
    writeFileSync(join(execDir, "terminal-1.json"), "{}", "utf8");
    writeFileSync(join(execDir, "README.txt"), "txt", "utf8");
    const r = await invoke("GET", "/api/exec-outputs");
    const body = JSON.parse(r.body);
    expect(body.entries.map((e: { terminalId: string }) => e.terminalId)).toEqual([
      "terminal-1",
    ]);
  });

  it("rejects non-GET methods", async () => {
    const r = await invoke("POST", "/api/exec-outputs");
    expect(r.statusCode).toBe(405);
  });

  it("returns false for unrelated pathnames", async () => {
    const { response, captured } = makeMockResponse();
    const requestUrl = new URL("http://localhost/api/something-else");
    const request = { method: "GET" } as unknown as import("node:http").IncomingMessage;
    const handled = await handleExecOutputsCollectionRoute(
      { request, response, requestUrl, corsOrigin: null },
      makeDeps(stateDir),
    );
    expect(handled).toBe(false);
    expect(captured.statusCode).toBe(0);
  });
});

describe("handleExecOutputItemRoute", () => {
  let tmpRoot: string;
  let stateDir: string;
  let execDir: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `octogent-exec-item-test-${process.pid}-${Date.now()}`);
    stateDir = join(tmpRoot, ".octogent");
    execDir = join(stateDir, "state", "exec-output");
    mkdirSync(execDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  const invoke = async (
    method: string,
    pathname: string,
  ): Promise<CapturedResponse> => {
    const { response, captured } = makeMockResponse();
    const requestUrl = new URL(`http://localhost${pathname}`);
    const request = { method } as unknown as import("node:http").IncomingMessage;
    await handleExecOutputItemRoute(
      { request, response, requestUrl, corsOrigin: null },
      makeDeps(stateDir),
    );
    return captured;
  };

  it("returns the raw log content as text/plain", async () => {
    writeFileSync(join(execDir, "terminal-42.log"), "hello world", "utf8");
    const r = await invoke("GET", "/api/exec-outputs/terminal-42");
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe("hello world");
  });

  it("returns 404 when the log file does not exist", async () => {
    const r = await invoke("GET", "/api/exec-outputs/terminal-does-not-exist");
    expect(r.statusCode).toBe(404);
  });

  it("rejects path-traversal attempts with 400", async () => {
    const r = await invoke("GET", "/api/exec-outputs/..%2F..%2Fetc%2Fpasswd");
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/invalid/i);
  });

  it("rejects terminal IDs with slashes or dots (defense in depth)", async () => {
    // Note: Node's URL parser normalizes bare ".." in the path segment
    // before the handler sees it, so we can't test the literal ".." case
    // through new URL(). The defenses that matter are for URL-encoded
    // traversal attempts and dotted filenames — those reach the handler
    // post-decode and must be rejected by the SAFE_TERMINAL_ID_PATTERN.
    const cases = [
      "../../x", // encoded slashes survive URL normalization as %2F
      "sub/id", // encoded slash in the terminal id segment
      "file.log", // dots in filename
      "id.with.dots",
    ];
    for (const id of cases) {
      const r = await invoke("GET", `/api/exec-outputs/${encodeURIComponent(id)}`);
      expect(r.statusCode, `case=${id}`).toBe(400);
    }
  });

  it("accepts valid IDs (letters, digits, hyphen, underscore)", async () => {
    writeFileSync(join(execDir, "terminal-abc_123.log"), "ok", "utf8");
    const r = await invoke("GET", "/api/exec-outputs/terminal-abc_123");
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe("ok");
  });

  it("rejects non-GET methods", async () => {
    const r = await invoke("DELETE", "/api/exec-outputs/terminal-1");
    expect(r.statusCode).toBe(405);
  });
});
