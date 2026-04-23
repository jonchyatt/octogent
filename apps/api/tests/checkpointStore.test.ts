/**
 * Unit tests for checkpointStore (Phase 10.8.7).
 *
 * Covers the three must-haves from the design contract:
 *   (a) atomic write — the final file always contains a complete, well-formed
 *       checkpoint, never a partial one. A crash mid-write leaves only the
 *       temp sibling, not a corrupt target file.
 *   (b) schema valid on read-back — every field round-trips exactly through
 *       JSON + the schema-validating reader.
 *   (c) concurrent writes from parallel terminals do not corrupt each other's
 *       files — each terminal's checkpoint is isolated.
 *
 * Plus companion coverage for:
 *   - null-safe read on missing / corrupt files
 *   - schema validation rejecting malformed checkpoints
 *   - digest helpers deterministic + distinguishing inputs
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CheckpointStore,
  digestJsonSafe,
  digestString,
} from "../src/terminalRuntime/checkpointStore";

describe("CheckpointStore", () => {
  let tmp: string;
  let store: CheckpointStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "checkpoint-store-"));
    store = new CheckpointStore({ checkpointsDir: tmp });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const baseInput = (overrides: Record<string, unknown> = {}) => ({
    terminalId: "terminal-1",
    tentacleId: "tentacle-alpha",
    turnNumber: 2,
    workingDir: "/tmp/work/alpha",
    lastToolCall: {
      name: "Bash",
      args_digest: "abcdef0123456789",
      result_digest: "0011223344556677",
      ts: "2026-04-22T12:34:56.000Z",
    },
    gitBranch: "a2-checkpointing",
    gitHead: "3697d01abcdef",
    ...overrides,
  });

  it("(a) writes atomically: no temp files remain and final file is complete JSON", () => {
    store.writeCheckpoint(baseInput());

    const files = readdirSync(tmp);
    // Exactly one file — the final checkpoint. No stray .tmp siblings.
    expect(files).toEqual(["terminal-1.json"]);

    const raw = readFileSync(store.checkpointPath("terminal-1"), "utf8");
    // JSON.parse succeeds on the complete payload — a partial write would
    // throw on an unterminated object.
    const parsed = JSON.parse(raw);
    expect(parsed.terminalId).toBe("terminal-1");
    expect(parsed.turnNumber).toBe(2);
  });

  it("(b) schema round-trips every field exactly on read-back", () => {
    const input = baseInput();
    const written = store.writeCheckpoint(input);

    const loaded = store.readCheckpoint("terminal-1");
    expect(loaded).not.toBeNull();
    // The writer decides updatedAt, so compare that against the returned
    // in-memory copy (which used the same Date.now). Every other field must
    // match the input verbatim.
    expect(loaded).toEqual({
      terminalId: input.terminalId,
      tentacleId: input.tentacleId,
      turnNumber: input.turnNumber,
      workingDir: input.workingDir,
      lastToolCall: input.lastToolCall,
      gitBranch: input.gitBranch,
      gitHead: input.gitHead,
      updatedAt: written.updatedAt,
    });
  });

  it("(c) concurrent writes from parallel terminals isolate their files", () => {
    // Simulate four different terminals writing their own checkpoints
    // interleaved. Each file MUST end up with only its own terminal's data.
    const ids = ["terminal-1", "terminal-2", "terminal-3", "terminal-4"];

    for (let round = 0; round < 5; round += 1) {
      for (const terminalId of ids) {
        store.writeCheckpoint({
          ...baseInput({
            terminalId,
            tentacleId: `tentacle-${terminalId}`,
            turnNumber: round,
            workingDir: `/tmp/work/${terminalId}`,
          }),
        });
      }
    }

    // Every terminal should have exactly its own file + the last written
    // round (5 iterations → final turnNumber = 4).
    for (const terminalId of ids) {
      const loaded = store.readCheckpoint(terminalId);
      expect(loaded).not.toBeNull();
      expect(loaded?.terminalId).toBe(terminalId);
      expect(loaded?.tentacleId).toBe(`tentacle-${terminalId}`);
      expect(loaded?.turnNumber).toBe(4);
      expect(loaded?.workingDir).toBe(`/tmp/work/${terminalId}`);
    }

    // No stray temp files remain after all rename()s.
    const files = readdirSync(tmp).sort();
    expect(files).toEqual(
      ids.map((id) => `${id}.json`).sort(),
    );
  });

  it("treats missing checkpoint file as null (no throw)", () => {
    expect(store.readCheckpoint("never-written")).toBeNull();
  });

  it("returns null for a corrupt JSON file instead of throwing", () => {
    writeFileSync(store.checkpointPath("corrupt"), "{not valid json", "utf8");
    expect(store.readCheckpoint("corrupt")).toBeNull();
  });

  it("returns null when the JSON parses but fails schema validation", () => {
    writeFileSync(
      store.checkpointPath("bogus"),
      JSON.stringify({ terminalId: 42, turnNumber: "two" }),
      "utf8",
    );
    expect(store.readCheckpoint("bogus")).toBeNull();
  });

  it("accepts a checkpoint with lastToolCall=null (turn-boundary writes from the coordinator)", () => {
    const written = store.writeCheckpoint({
      terminalId: "t-exec",
      tentacleId: "tentacle-exec",
      turnNumber: 3,
      workingDir: "/tmp/exec",
      gitBranch: null,
      gitHead: null,
    });

    const loaded = store.readCheckpoint("t-exec");
    expect(loaded).not.toBeNull();
    expect(loaded?.lastToolCall).toBeNull();
    expect(loaded?.gitBranch).toBeNull();
    expect(loaded?.gitHead).toBeNull();
    expect(loaded?.updatedAt).toBe(written.updatedAt);
  });

  it("sanitizes unsafe characters in the terminal id for the filename", () => {
    store.writeCheckpoint({
      ...baseInput({
        terminalId: "../dangerous/path",
      }),
    });

    // Dots and slashes are replaced by underscore — the written path stays
    // inside the checkpoints dir, not traversing parents.
    const files = readdirSync(tmp);
    expect(files.length).toBe(1);
    const filename = files[0] ?? "";
    expect(filename.includes("/")).toBe(false);
    expect(filename.includes("\\")).toBe(false);
    // Extension still .json so readCheckpoint can find it via the same stem.
    expect(filename.endsWith(".json")).toBe(true);
  });

  it("overwrites in place — second write for the same terminal replaces the first atomically", () => {
    store.writeCheckpoint({
      ...baseInput({ turnNumber: 1 }),
    });
    store.writeCheckpoint({
      ...baseInput({ turnNumber: 2 }),
    });

    const files = readdirSync(tmp);
    expect(files).toEqual(["terminal-1.json"]);
    expect(store.readCheckpoint("terminal-1")?.turnNumber).toBe(2);
  });

  it("checkpointPath is deterministic given the terminal id", () => {
    expect(store.checkpointPath("t-1")).toBe(store.checkpointPath("t-1"));
  });

  it("creates the checkpoints directory on first write", () => {
    const nested = join(tmp, "nested", "deep");
    const s = new CheckpointStore({ checkpointsDir: nested });
    expect(existsSync(nested)).toBe(false);
    s.writeCheckpoint({ ...baseInput() });
    expect(existsSync(nested)).toBe(true);
  });
});

describe("digestString / digestJsonSafe", () => {
  it("digestString is deterministic for the same input", () => {
    expect(digestString("hello")).toBe(digestString("hello"));
  });

  it("digestString returns different digests for different inputs", () => {
    expect(digestString("hello")).not.toBe(digestString("world"));
  });

  it("digestJsonSafe handles null/undefined without throwing", () => {
    expect(digestJsonSafe(null)).toBe(digestJsonSafe(undefined));
  });

  it("digestJsonSafe distinguishes structured inputs", () => {
    expect(digestJsonSafe({ a: 1 })).not.toBe(digestJsonSafe({ a: 2 }));
  });

  it("digestJsonSafe strings are hex, default 16 chars (8 bytes)", () => {
    const d = digestJsonSafe("payload");
    expect(d).toMatch(/^[0-9a-f]{16}$/);
  });
});
