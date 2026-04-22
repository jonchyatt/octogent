import { describe, expect, it } from "vitest";

import { applyCodexRoots, buildExecCommand, buildResumeCommand } from "../src/terminalRuntime/constants";

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

  it("strips bypass flag and prepends workspace-write sandbox when roots present", () => {
    const result = applyCodexRoots(
      ["exec", "--dangerously-bypass-approvals-and-sandbox"],
      ["/path/to/visopscreen"],
    );
    expect(result).toEqual(["--sandbox", "workspace-write", "exec", "--add-dir", "/path/to/visopscreen"]);
  });

  it("emits one --add-dir per root, preserving order", () => {
    const result = applyCodexRoots(
      ["exec", "--dangerously-bypass-approvals-and-sandbox"],
      ["/a", "/b", "/c"],
    );
    expect(result).toEqual([
      "--sandbox",
      "workspace-write",
      "exec",
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
    expect(result).toEqual(["--sandbox", "workspace-write", "exec", "--json", "--add-dir", "/a"]);
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

  it("switches to --sandbox workspace-write + --add-dir when roots present", () => {
    const { command, args } = buildExecCommand("codex", "hello", "/tmp/out.json", ["/r1", "/r2"]);
    expect(command).toBe("codex");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).toContain("--sandbox");
    expect(args).toContain("workspace-write");
    expect(args.filter((a) => a === "--add-dir").length).toBe(2);
    expect(args).toContain("/r1");
    expect(args).toContain("/r2");
    expect(args.slice(-3)).toEqual(["--output-last-message", "/tmp/out.json", "-"]);
  });

  it("ignores roots for non-codex providers (claude-code has no equivalent flag)", () => {
    const { args: argsWithRoots } = buildExecCommand("claude-code", "hi", "/tmp/o.json", ["/r"]);
    const { args: argsWithout } = buildExecCommand("claude-code", "hi", "/tmp/o.json");
    expect(argsWithRoots).toEqual(argsWithout);
  });
});

describe("buildResumeCommand", () => {
  it("emits bypass-mode resume when roots absent", () => {
    const { command, args } = buildResumeCommand("codex", "go", "/tmp/out.json", "session-abc");
    expect(command).toBe("codex");
    expect(args).toContain("exec");
    expect(args).toContain("resume");
    expect(args).toContain("session-abc");
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("--sandbox");
  });

  it("emits workspace-write + --add-dir resume when roots present", () => {
    const { command, args } = buildResumeCommand(
      "codex",
      "go",
      "/tmp/out.json",
      "session-abc",
      ["/cross-repo"],
    );
    expect(command).toBe("codex");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).toContain("--sandbox");
    expect(args).toContain("workspace-write");
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
