/**
 * Phase 10.8.7: verifies the PostToolUse hook path writes a checkpoint for
 * the triggering terminal — covers the Claude-code worker trigger.
 *
 * The real hookProcessor depends on transcript paths, session maps, WebSocket
 * broadcast, etc. We construct a minimal harness that fills only what the
 * post-tool-use branch actually touches: the terminals map and the checkpoint
 * store. Every other dependency is a no-op.
 */

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CheckpointStore } from "../src/terminalRuntime/checkpointStore";
import { createHookProcessor } from "../src/terminalRuntime/hookProcessor";
import type { PersistedTerminal, TerminalSession } from "../src/terminalRuntime/types";

describe("hookProcessor.handleHook — post-tool-use checkpoint (Phase 10.8.7)", () => {
  let tmp: string;
  let checkpointsDir: string;
  let store: CheckpointStore;
  let terminals: Map<string, PersistedTerminal>;
  let sessions: Map<string, TerminalSession>;
  let hookProcessor: ReturnType<typeof createHookProcessor>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "hook-checkpoint-"));
    checkpointsDir = join(tmp, "checkpoints");
    store = new CheckpointStore({ checkpointsDir });
    terminals = new Map<string, PersistedTerminal>();
    sessions = new Map<string, TerminalSession>();

    terminals.set("terminal-1", {
      terminalId: "terminal-1",
      tentacleId: "tentacle-alpha",
      tentacleName: "alpha",
      createdAt: new Date().toISOString(),
      workspaceMode: "worktree",
      agentProvider: "claude-code",
      turnNumber: 5,
    });

    hookProcessor = createHookProcessor({
      terminals,
      sessions,
      transcriptDirectoryPath: join(tmp, "transcripts"),
      getApiBaseUrl: () => "http://127.0.0.1:8787",
      persistRegistry: () => {},
      deliverChannelMessages: () => 0,
      releaseSessionKeepAlive: () => false,
      checkpointStore: store,
      // Return a path that's guaranteed not to be a git repo so the git
      // lookup returns null/null — keeps the test hermetic.
      getTentacleWorkspaceCwd: () => tmp,
    });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes a checkpoint on post-tool-use with terminal metadata", () => {
    const result = hookProcessor.handleHook(
      "post-tool-use",
      {
        tool_name: "Bash",
        tool_input: { command: "ls" },
        tool_response: { stdout: "file.txt\n" },
      },
      "terminal-1",
    );
    expect(result).toEqual({ ok: true });

    const written = store.readCheckpoint("terminal-1");
    expect(written).not.toBeNull();
    expect(written?.terminalId).toBe("terminal-1");
    expect(written?.tentacleId).toBe("tentacle-alpha");
    expect(written?.turnNumber).toBe(5);
    expect(written?.workingDir).toBe(tmp);
    expect(written?.lastToolCall?.name).toBe("Bash");
    // Args + result digests are present and hex (not full payload).
    expect(written?.lastToolCall?.args_digest).toMatch(/^[0-9a-f]+$/);
    expect(written?.lastToolCall?.result_digest).toMatch(/^[0-9a-f]+$/);
  });

  it("is a no-op when the session id is absent (can't attribute the tool call)", () => {
    const result = hookProcessor.handleHook(
      "post-tool-use",
      { tool_name: "Bash" },
      undefined,
    );
    expect(result).toEqual({ ok: true });
    // No file written.
    expect(() => readdirSync(checkpointsDir)).toThrow();
  });

  it("is a no-op when the terminal is unknown", () => {
    const result = hookProcessor.handleHook(
      "post-tool-use",
      { tool_name: "Bash" },
      "not-a-real-terminal",
    );
    expect(result).toEqual({ ok: true });
    expect(() => readdirSync(checkpointsDir)).toThrow();
  });

  it("different tool inputs produce different args_digest values for the same tool name", () => {
    hookProcessor.handleHook(
      "post-tool-use",
      { tool_name: "Edit", tool_input: { file: "a.ts" } },
      "terminal-1",
    );
    const afterFirst = store.readCheckpoint("terminal-1")?.lastToolCall?.args_digest;

    hookProcessor.handleHook(
      "post-tool-use",
      { tool_name: "Edit", tool_input: { file: "b.ts" } },
      "terminal-1",
    );
    const afterSecond = store.readCheckpoint("terminal-1")?.lastToolCall?.args_digest;

    expect(afterFirst).toBeTruthy();
    expect(afterSecond).toBeTruthy();
    expect(afterFirst).not.toBe(afterSecond);
  });
});
