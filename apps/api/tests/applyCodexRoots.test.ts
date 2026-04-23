import { describe, expect, it } from "vitest";

import {
  applyCodexRoots,
  buildExecCommand,
  buildResumeCommand,
  computeEffectiveRoots,
} from "../src/terminalRuntime/constants";

describe("applyCodexRoots", () => {
  it("passes through unchanged when roots is undefined", () => {
    expect(applyCodexRoots(["exec", "--dangerously-bypass-approvals-and-sandbox"], undefined)).toEqual([
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
  });

  it("passes through unchanged when roots is empty", () => {
    expect(applyCodexRoots(["exec", "--dangerously-bypass-approvals-and-sandbox"], [])).toEqual([
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
  });

  it("preserves bypass flag and appends add-dir flags when roots present", () => {
    const result = applyCodexRoots(
      ["exec", "--dangerously-bypass-approvals-and-sandbox"],
      ["/path/to/visopscreen"],
    );
    expect(result).toEqual([
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--add-dir",
      "/path/to/visopscreen",
    ]);
  });

  it("emits one --add-dir per root, preserving order", () => {
    const result = applyCodexRoots(
      ["exec", "--dangerously-bypass-approvals-and-sandbox"],
      ["/a", "/b", "/c"],
    );
    expect(result).toEqual([
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--add-dir",
      "/a",
      "--add-dir",
      "/b",
      "--add-dir",
      "/c",
    ]);
  });

  it("leaves args without bypass flag untouched except for root injection", () => {
    const result = applyCodexRoots(["exec", "--json"], ["/a"]);
    expect(result).toEqual(["exec", "--json", "--add-dir", "/a"]);
  });
});

describe("buildExecCommand", () => {
  it("emits codex bypass mode when roots absent (default posture preserved)", () => {
    const { command, args } = buildExecCommand("codex", "hello", "/tmp/out.json");
    expect(command).toBe("codex");
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("--sandbox");
    expect(args.slice(-3)).toEqual(["--output-last-message", "/tmp/out.json", "-"]);
  });

  it("keeps codex bypass mode and appends --add-dir when roots present", () => {
    const { command, args } = buildExecCommand("codex", "hello", "/tmp/out.json", ["/r1", "/r2"]);
    expect(command).toBe("codex");
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("workspace-write");
    expect(args.filter((a) => a === "--add-dir").length).toBe(2);
    expect(args).toContain("/r1");
    expect(args).toContain("/r2");
    expect(args.slice(-3)).toEqual(["--output-last-message", "/tmp/out.json", "-"]);
  });

  it("ignores roots for claude-code, which has no equivalent flag today", () => {
    const { args: argsWithRoots } = buildExecCommand("claude-code", "hi", "/tmp/o.json", ["/r"]);
    const { args: argsWithout } = buildExecCommand("claude-code", "hi", "/tmp/o.json");
    expect(argsWithRoots).toEqual(argsWithout);
  });

  it("ignores roots for openclaw, which has no equivalent flag today", () => {
    const { args: argsWithRoots } = buildExecCommand("openclaw", "hi", "/tmp/o.json", ["/r"]);
    const { args: argsWithout } = buildExecCommand("openclaw", "hi", "/tmp/o.json");
    expect(argsWithRoots).toEqual(argsWithout);
  });

  it("passes roots through to Kimi via --add-dir", () => {
    const { args } = buildExecCommand("kimi", "hi", "/tmp/o.json", ["/r1", "/r2"]);
    expect(args).toEqual(["--print", "--add-dir", "/r1", "--add-dir", "/r2"]);
  });
});

describe("buildResumeCommand", () => {
  // Phase 10.9.7 — `codex exec resume` rejects `--sandbox` and
  // `--dangerously-bypass-approvals-and-sandbox` ("unknown flag"). Resume
  // inherits sandbox posture from the original session, so we don't pass
  // either flag. This updates the contract the earlier tests codified.
  it("codex resume without roots has NO sandbox / bypass flag", () => {
    const { command, args } = buildResumeCommand("codex", "go", "/tmp/out.json", "session-abc");
    expect(command).toBe("codex");
    expect(args).toContain("exec");
    expect(args).toContain("resume");
    expect(args).toContain("session-abc");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("workspace-write");
  });

  it("codex resume WITH roots emits --add-dir entries but NO --sandbox", () => {
    const { command, args } = buildResumeCommand(
      "codex",
      "go",
      "/tmp/out.json",
      "session-abc",
      ["/cross-repo"],
    );
    expect(command).toBe("codex");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("workspace-write");
    expect(args).toContain("--add-dir");
    expect(args).toContain("/cross-repo");
    expect(args).toContain("resume");
    expect(args).toContain("session-abc");
  });

  it("defaults resume target to --last when sessionId absent", () => {
    const { args } = buildResumeCommand("codex", "go", "/tmp/out.json");
    expect(args).toContain("--last");
  });
});

describe("computeEffectiveRoots (Phase 0.01.3.2 auto-prepend project root)", () => {
  const PROJECT_ROOT = "/c/Users/jonch/Projects/jarvis";

  it("returns undefined when userRoots is undefined → bypass mode preserved", () => {
    expect(computeEffectiveRoots(PROJECT_ROOT, undefined)).toBeUndefined();
  });

  it("returns undefined when userRoots is empty → bypass mode preserved", () => {
    expect(computeEffectiveRoots(PROJECT_ROOT, [])).toBeUndefined();
  });

  it("prepends project root when userRoots is non-empty", () => {
    expect(
      computeEffectiveRoots(PROJECT_ROOT, ["/c/Users/jonch/Projects/Visopscreen"]),
    ).toEqual([
      PROJECT_ROOT,
      "/c/Users/jonch/Projects/Visopscreen",
    ]);
  });

  it("preserves user-supplied order after the prepended project root", () => {
    expect(
      computeEffectiveRoots(PROJECT_ROOT, ["/a", "/b", "/c"]),
    ).toEqual([PROJECT_ROOT, "/a", "/b", "/c"]);
  });

  it("dedupes: if user re-supplies project root, it appears only once (first-seen order)", () => {
    expect(
      computeEffectiveRoots(PROJECT_ROOT, [PROJECT_ROOT, "/c/other"]),
    ).toEqual([PROJECT_ROOT, "/c/other"]);
  });

  it("dedupes: user-supplied duplicates collapse, preserving first occurrence", () => {
    expect(
      computeEffectiveRoots(PROJECT_ROOT, ["/a", "/b", "/a", "/c", "/b"]),
    ).toEqual([PROJECT_ROOT, "/a", "/b", "/c"]);
  });

  it("skips empty-string entries defensively (shouldn't be reachable via isTerminalRoots but harmless)", () => {
    expect(
      computeEffectiveRoots(PROJECT_ROOT, ["", "/a", ""]),
    ).toEqual([PROJECT_ROOT, "/a"]);
  });

  it("handles an empty projectRoot gracefully (no prepend if projectRoot itself is empty)", () => {
    // Edge case: if somehow workspaceCwd is "", we still honor user roots
    // without polluting the list with an empty string.
    expect(computeEffectiveRoots("", ["/a"])).toEqual(["/a"]);
  });
});
