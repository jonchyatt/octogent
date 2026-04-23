import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock, createShellEnvironmentMock, ensureSpawnHelperMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  createShellEnvironmentMock: vi.fn(() => ({})),
  ensureSpawnHelperMock: vi.fn(),
}));

vi.mock("node-pty", () => ({
  spawn: spawnMock,
}));

vi.mock("../src/terminalRuntime/ptyEnvironment", () => ({
  createShellEnvironment: createShellEnvironmentMock,
  ensureNodePtySpawnHelperExecutable: ensureSpawnHelperMock,
}));

import { createHookProcessor } from "../src/terminalRuntime/hookProcessor";
import {
  CONTEXT_BURN_PROMPT,
  CONTEXT_BURN_PROMPT_TEXT,
  HANDOFF_AUTO_COMPACT_PERCENT,
  HANDOFF_SLASH_COMMAND_BODY,
  HANDOFF_SLASH_COMMAND_FILENAME,
  composeInitialPromptWithPriorHandoff,
  ensureTentacleHandoffDirectory,
  getTentacleHandoffDirectoryPath,
  readMostRecentHandoff,
} from "../src/terminalRuntime/handoffTemplate";
import { createSessionRuntime } from "../src/terminalRuntime/sessionRuntime";
import type { PersistedTerminal, TerminalSession } from "../src/terminalRuntime/types";

class FakePty extends EventEmitter {
  write = vi.fn();
  resize = vi.fn();
  kill = vi.fn();
  pid = 4321;

  onData(listener: (chunk: string) => void) {
    this.on("data", listener);
    return {
      dispose: () => {
        this.off("data", listener);
      },
    };
  }

  onExit(listener: (event: { exitCode: number; signal: number }) => void) {
    this.on("exit", listener);
    return {
      dispose: () => {
        this.off("exit", listener);
      },
    };
  }
}

class FakeWebSocketServer {
  handleUpgrade = vi.fn();
}

const tempDirs: string[] = [];
const makeTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "octogent-handoff-test-"));
  tempDirs.push(dir);
  return dir;
};

/**
 * Write a handoff file with a specific mtime so most-recent-wins selection
 * is deterministic across filesystems with low (1s) mtime resolution.
 */
const writeHandoff = (dir: string, filename: string, body: string, mtimeMs?: number) => {
  mkdirSync(dir, { recursive: true });
  const absolutePath = join(dir, filename);
  writeFileSync(absolutePath, body, "utf8");
  if (typeof mtimeMs === "number") {
    const seconds = mtimeMs / 1000;
    utimesSync(absolutePath, seconds, seconds);
  }
  return absolutePath;
};

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
  vi.useRealTimers();
  spawnMock.mockReset();
  createShellEnvironmentMock.mockReset();
  createShellEnvironmentMock.mockReturnValue({});
  ensureSpawnHelperMock.mockReset();
});

describe("handoffTemplate — slash command body", () => {
  it("ships a non-empty slash command body with the canonical filename", () => {
    expect(HANDOFF_SLASH_COMMAND_FILENAME).toBe("handoff.md");
    expect(HANDOFF_SLASH_COMMAND_BODY.length).toBeGreaterThan(200);
  });

  it("contains the contract sections the next worker scans for", () => {
    expect(HANDOFF_SLASH_COMMAND_BODY).toContain("OCTOGENT_HANDOFF_DIR");
    expect(HANDOFF_SLASH_COMMAND_BODY).toContain("Completed this session");
    expect(HANDOFF_SLASH_COMMAND_BODY).toContain("In progress");
    expect(HANDOFF_SLASH_COMMAND_BODY).toContain("Next concrete step");
    expect(HANDOFF_SLASH_COMMAND_BODY).toContain("Blockers / Open questions");
    expect(HANDOFF_SLASH_COMMAND_BODY).toContain("Git state");
    // Atomic write rule (tmp + rename) is load-bearing for next-worker reads.
    expect(HANDOFF_SLASH_COMMAND_BODY).toContain("mv ");
  });

  it("mirrors the templates/claude-commands/handoff.md doc copy", () => {
    // The repo-root template is a documentation mirror of the embedded
    // constant. If the two drift, future contributors will edit the doc
    // copy and assume the worker picks it up — but the runtime installs
    // the constant. Lock them together with a content check on the
    // sections that matter.
    const docPath = join(__dirname, "..", "..", "..", "templates", "claude-commands", "handoff.md");
    if (!existsSync(docPath)) {
      // Tolerated: doc copy is for human reviewers; absent in slim builds.
      return;
    }
    const docBody = readFileSync(docPath, "utf8");
    expect(docBody).toContain("OCTOGENT_HANDOFF_DIR");
    expect(docBody).toContain("Completed this session");
    expect(docBody).toContain("Next concrete step");
  });
});

describe("handoffTemplate — handoff dir + scan helpers", () => {
  it("ensureTentacleHandoffDirectory creates the namespaced dir under workspaceCwd", () => {
    const cwd = makeTempDir();
    const dir = ensureTentacleHandoffDirectory(cwd, "tentacle-7");
    expect(dir).toBe(join(cwd, ".octogent", "tentacles", "tentacle-7"));
    expect(existsSync(dir)).toBe(true);
  });

  it("getTentacleHandoffDirectoryPath does NOT create the dir", () => {
    const cwd = makeTempDir();
    const dir = getTentacleHandoffDirectoryPath(cwd, "tentacle-9");
    expect(dir).toBe(join(cwd, ".octogent", "tentacles", "tentacle-9"));
    expect(existsSync(dir)).toBe(false);
  });

  it("readMostRecentHandoff returns null when dir is missing", () => {
    const cwd = makeTempDir();
    expect(readMostRecentHandoff(join(cwd, ".octogent", "tentacles", "ghost"))).toBeNull();
  });

  it("readMostRecentHandoff returns null when dir has no handoff files", () => {
    const cwd = makeTempDir();
    const dir = ensureTentacleHandoffDirectory(cwd, "t-1");
    writeFileSync(join(dir, "notes.md"), "scratch", "utf8");
    expect(readMostRecentHandoff(dir)).toBeNull();
  });

  it("ignores partial atomic-write tmp files (.handoff-*.md.tmp)", () => {
    const cwd = makeTempDir();
    const dir = ensureTentacleHandoffDirectory(cwd, "t-2");
    writeFileSync(join(dir, ".handoff-20260101T120000Z.md.tmp"), "torn write", "utf8");
    // The handoff scanner only matches `handoff-*.md` (no leading dot).
    expect(readMostRecentHandoff(dir)).toBeNull();
  });

  it("picks the most recently modified handoff file when multiple exist", () => {
    const cwd = makeTempDir();
    const dir = ensureTentacleHandoffDirectory(cwd, "t-3");
    const t0 = Date.now() - 60_000;
    writeHandoff(dir, "handoff-20260101T120000Z.md", "old body", t0);
    writeHandoff(dir, "handoff-20260101T130000Z.md", "newer body", t0 + 30_000);
    writeHandoff(dir, "handoff-20260101T140000Z.md", "newest body", t0 + 50_000);

    const found = readMostRecentHandoff(dir);
    expect(found?.filename).toBe("handoff-20260101T140000Z.md");
    expect(found?.body).toBe("newest body");
  });

  it("breaks mtime ties by filename (lexicographic descending)", () => {
    const cwd = makeTempDir();
    const dir = ensureTentacleHandoffDirectory(cwd, "t-4");
    const t0 = Date.now();
    writeHandoff(dir, "handoff-20260101T120000Z.md", "first body", t0);
    writeHandoff(dir, "handoff-20260101T130000Z.md", "second body", t0);

    const found = readMostRecentHandoff(dir);
    // ISO timestamp filenames sort lexicographically — descending = most recent.
    expect(found?.filename).toBe("handoff-20260101T130000Z.md");
  });

  it("composeInitialPromptWithPriorHandoff prepends a Resume preamble", () => {
    const composed = composeInitialPromptWithPriorHandoff(
      "Continue P1b.10 review.",
      {
        filename: "handoff-x.md",
        absolutePath: "/tmp/handoff-x.md",
        body: "## Completed this session\n- shipped foo\n",
        mtimeMs: 0,
      },
    );
    expect(composed).toContain("# Prior handoff");
    expect(composed).toContain("shipped foo");
    expect(composed).toContain("# Resume from this state:");
    expect(composed).toContain("Continue P1b.10 review.");
    // Resume preamble must come BEFORE the original prompt.
    expect(composed.indexOf("# Prior handoff")).toBeLessThan(
      composed.indexOf("# Resume from this state:"),
    );
    expect(composed.indexOf("# Resume from this state:")).toBeLessThan(
      composed.indexOf("Continue P1b.10 review."),
    );
  });

  it("composeInitialPromptWithPriorHandoff is a no-op when no prior handoff", () => {
    expect(composeInitialPromptWithPriorHandoff("fresh prompt", null)).toBe("fresh prompt");
  });
});

describe("hookProcessor — slash command + PreCompact installation", () => {
  it("writes the /handoff slash command into <cwd>/.claude/commands/handoff.md", () => {
    const cwd = makeTempDir();
    const processor = createHookProcessor({
      terminals: new Map(),
      sessions: new Map(),
      transcriptDirectoryPath: makeTempDir(),
      getApiBaseUrl: () => "http://api.test",
      persistRegistry: () => undefined,
      deliverChannelMessages: () => 0,
      releaseSessionKeepAlive: () => true,
    });

    processor.installHooksInDirectory(cwd);

    const slashCommandPath = join(cwd, ".claude", "commands", HANDOFF_SLASH_COMMAND_FILENAME);
    expect(existsSync(slashCommandPath)).toBe(true);
    expect(readFileSync(slashCommandPath, "utf8")).toBe(HANDOFF_SLASH_COMMAND_BODY);
  });

  it("adds a PreCompact hook entry + auto-compact env override to settings.json", () => {
    const cwd = makeTempDir();
    const processor = createHookProcessor({
      terminals: new Map(),
      sessions: new Map(),
      transcriptDirectoryPath: makeTempDir(),
      getApiBaseUrl: () => "http://api.test",
      persistRegistry: () => undefined,
      deliverChannelMessages: () => 0,
      releaseSessionKeepAlive: () => true,
    });

    processor.installHooksInDirectory(cwd);

    const settingsPath = join(cwd, ".claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks?: { PreCompact?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
      env?: Record<string, string>;
    };
    const preCompactEntries = parsed.hooks?.PreCompact ?? [];
    expect(preCompactEntries.length).toBeGreaterThan(0);
    const innerCommand = preCompactEntries[0]?.hooks?.[0]?.command ?? "";
    expect(innerCommand).toContain("/api/hooks/pre-compact");
    expect(innerCommand).toContain("OCTOGENT_SESSION_ID");
    // The env override moves Claude Code auto-compact down to the configured
    // percent so PreCompact fires near "30%" instead of the default ~95%.
    expect(parsed.env?.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE).toBe(HANDOFF_AUTO_COMPACT_PERCENT);
  });

  it("merges with existing settings.json without dropping unrelated keys", () => {
    const cwd = makeTempDir();
    const claudeDir = join(cwd, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({ model: "claude-opus", customField: 42, env: { EXISTING: "yes" } }),
      "utf8",
    );

    const processor = createHookProcessor({
      terminals: new Map(),
      sessions: new Map(),
      transcriptDirectoryPath: makeTempDir(),
      getApiBaseUrl: () => "http://api.test",
      persistRegistry: () => undefined,
      deliverChannelMessages: () => 0,
      releaseSessionKeepAlive: () => true,
    });

    processor.installHooksInDirectory(cwd);

    const merged = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    expect(merged.model).toBe("claude-opus");
    expect(merged.customField).toBe(42);
    expect(merged.hooks?.PreCompact?.length).toBeGreaterThan(0);
    expect(merged.env?.EXISTING).toBe("yes");
    expect(merged.env?.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE).toBe(HANDOFF_AUTO_COMPACT_PERCENT);
  });
});

describe("hookProcessor — context-burn injection", () => {
  type ProcessorBundle = ReturnType<typeof buildProcessor>;

  function buildProcessor(writeInputArg?: ReturnType<typeof vi.fn>) {
    const writeInput = writeInputArg ?? vi.fn(() => true);
    const terminals = new Map<string, PersistedTerminal>();
    const sessions = new Map<string, TerminalSession>();
    const fakeSession = {
      terminalId: "t-burn",
      tentacleId: "t-burn",
      agentState: "idle",
    } as unknown as TerminalSession;
    sessions.set("t-burn", fakeSession);
    terminals.set("t-burn", {
      terminalId: "t-burn",
      tentacleId: "t-burn",
      tentacleName: "burn-test",
      createdAt: new Date().toISOString(),
      workspaceMode: "shared",
    });

    const processor = createHookProcessor({
      terminals,
      sessions,
      transcriptDirectoryPath: makeTempDir(),
      getApiBaseUrl: () => "http://api.test",
      persistRegistry: () => undefined,
      deliverChannelMessages: () => 0,
      releaseSessionKeepAlive: () => true,
      writeInput,
    });
    return { processor, terminals, sessions, writeInput };
  }

  it("pre-compact injects the burn prompt via writeInput exactly once", () => {
    const { processor, writeInput } = buildProcessor();

    const first = processor.handleHook("pre-compact", {}, "t-burn");
    const second = processor.handleHook("pre-compact", {}, "t-burn");

    expect(writeInput).toHaveBeenCalledTimes(1);
    expect(writeInput).toHaveBeenCalledWith("t-burn", CONTEXT_BURN_PROMPT);
    // First firing returns block decision so Claude Code sees an explicit
    // "do this" reason in the hook response. Re-fires return plain ok.
    expect(first.decision).toBe("block");
    expect(first.reason).toBe(CONTEXT_BURN_PROMPT_TEXT);
    expect(second.decision).toBeUndefined();
  });

  it("pre-compact is a no-op when no octogent_session is provided", () => {
    const { processor, writeInput } = buildProcessor();

    processor.handleHook("pre-compact", {}, undefined);

    expect(writeInput).not.toHaveBeenCalled();
  });

  it("pre-compact does not fire when no live session matches", () => {
    const writeInput = vi.fn(() => true);
    const processor = createHookProcessor({
      terminals: new Map(),
      sessions: new Map(),
      transcriptDirectoryPath: makeTempDir(),
      getApiBaseUrl: () => "http://api.test",
      persistRegistry: () => undefined,
      deliverChannelMessages: () => 0,
      releaseSessionKeepAlive: () => true,
      writeInput,
    });

    processor.handleHook("pre-compact", {}, "ghost-session");

    expect(writeInput).not.toHaveBeenCalled();
  });

  it("does not throw when writeInput dep is omitted (legacy callers)", () => {
    const terminals = new Map<string, PersistedTerminal>();
    const sessions = new Map<string, TerminalSession>();
    sessions.set("t-burn", {
      terminalId: "t-burn",
      tentacleId: "t-burn",
      agentState: "idle",
    } as unknown as TerminalSession);
    const processor = createHookProcessor({
      terminals,
      sessions,
      transcriptDirectoryPath: makeTempDir(),
      getApiBaseUrl: () => "http://api.test",
      persistRegistry: () => undefined,
      deliverChannelMessages: () => 0,
      releaseSessionKeepAlive: () => true,
      // writeInput intentionally omitted
    });

    // Should not throw. Burn injection is silently skipped.
    expect(() => processor.handleHook("pre-compact", {}, "t-burn")).not.toThrow();
  });
});

describe("sessionRuntime — handoff env injection at spawn", () => {
  it("calls getTentacleHandoffDir and threads the path into the PTY env", () => {
    const tentacleId = "tentacle-handoff-1";
    const cwd = makeTempDir();

    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const pty = new FakePty();
    spawnMock.mockReturnValue(pty);

    const transcriptDirectoryPath = makeTempDir();
    const websocketServer = new FakeWebSocketServer();
    const expectedHandoffDir = join(cwd, ".octogent", "tentacles", tentacleId);
    const getTentacleHandoffDir = vi.fn((id: string) =>
      ensureTentacleHandoffDirectory(cwd, id),
    );

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      getTentacleHandoffDir,
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      execOutputDirectoryPath: transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 1024,
    });

    expect(runtime.startSession(tentacleId)).toBe(true);
    expect(getTentacleHandoffDir).toHaveBeenCalledWith(tentacleId);
    expect(existsSync(expectedHandoffDir)).toBe(true);

    expect(createShellEnvironmentMock).toHaveBeenCalled();
    const lastEnvCall = createShellEnvironmentMock.mock.calls.at(-1)?.[0] as
      | { octogentTentacleId?: string; octogentHandoffDir?: string; octogentSessionId?: string }
      | undefined;
    expect(lastEnvCall?.octogentTentacleId).toBe(tentacleId);
    expect(lastEnvCall?.octogentHandoffDir).toBe(expectedHandoffDir);

    runtime.close();
  });

  it("survives a handoff dir resolver throw without blocking spawn", () => {
    const tentacleId = "tentacle-handoff-2";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const pty = new FakePty();
    spawnMock.mockReturnValue(pty);

    const transcriptDirectoryPath = makeTempDir();
    const websocketServer = new FakeWebSocketServer();

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      getTentacleHandoffDir: () => {
        throw new Error("disk full");
      },
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      execOutputDirectoryPath: transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 1024,
    });

    expect(runtime.startSession(tentacleId)).toBe(true);
    expect(sessions.has(tentacleId)).toBe(true);

    runtime.close();
  });
});
