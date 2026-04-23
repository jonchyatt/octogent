import { describe, expect, it } from "vitest";

import { TERMINAL_AGENT_PROVIDERS, isTerminalAgentProvider } from "../src/domain/agentRuntime";

describe("agentRuntime providers", () => {
  it("includes kimi as a first-class provider", () => {
    expect(TERMINAL_AGENT_PROVIDERS).toContain("kimi");
    expect(isTerminalAgentProvider("kimi")).toBe(true);
  });

  it("includes openclaw as a first-class provider", () => {
    expect(TERMINAL_AGENT_PROVIDERS).toContain("openclaw");
    expect(isTerminalAgentProvider("openclaw")).toBe(true);
  });
});
