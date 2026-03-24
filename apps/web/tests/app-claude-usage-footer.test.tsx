import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { jsonResponse, notFoundResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

const mockClaudeUsageRequests = () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/agent-snapshots") && method === "GET") {
      return jsonResponse([]);
    }

    if (url.endsWith("/api/codex/usage") && method === "GET") {
      return jsonResponse({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-03-03T12:00:00.000Z",
      });
    }

    if (url.endsWith("/api/claude/usage") && method === "GET") {
      return jsonResponse({
        status: "ok",
        source: "oauth-api",
        fetchedAt: "2026-03-03T12:00:00.000Z",
        primaryUsedPercent: 13,
        secondaryUsedPercent: 41,
        sonnetUsedPercent: 22,
      });
    }

    return notFoundResponse();
  });
};

describe("App claude usage footer", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("shows Claude usage in the active agents sidebar footer", async () => {
    mockClaudeUsageRequests();

    render(<App />);

    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    expect(within(sidebar).getByText("Claude token usage")).toBeInTheDocument();
    expect(within(sidebar).getByText("Current session")).toBeInTheDocument();
    expect(within(sidebar).getByText("Current week (all models)")).toBeInTheDocument();
    expect(within(sidebar).getByText("Current week (Sonnet only)")).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("progressbar", { name: "Claude current session usage" }),
    ).toHaveAttribute("aria-valuenow", "13");
    expect(
      within(sidebar).getByRole("progressbar", { name: "Claude current week usage" }),
    ).toHaveAttribute("aria-valuenow", "41");
    expect(
      within(sidebar).getByRole("progressbar", { name: "Claude Sonnet weekly usage" }),
    ).toHaveAttribute("aria-valuenow", "22");
  });

  it("collapses and expands the claude usage section in the sidebar footer", async () => {
    mockClaudeUsageRequests();

    render(<App />);

    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    expect(
      within(sidebar).getByRole("progressbar", { name: "Claude 5H token usage" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(sidebar).getByRole("button", {
        name: "Collapse Claude token usage section",
      }),
    );

    expect(
      within(sidebar).queryByRole("progressbar", { name: "Claude 5H token usage" }),
    ).toBeNull();
    expect(
      within(sidebar).getByRole("button", {
        name: "Expand Claude token usage section",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(sidebar).getByRole("button", {
        name: "Expand Claude token usage section",
      }),
    );

    expect(
      within(sidebar).getByRole("progressbar", { name: "Claude 5H token usage" }),
    ).toBeInTheDocument();
  });

  it("shows backend unavailable reason for Claude usage", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        return jsonResponse([]);
      }

      if (url.endsWith("/api/codex/usage") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-03-03T12:00:00.000Z",
        });
      }

      if (url.endsWith("/api/claude/usage") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-03-03T12:00:00.000Z",
          message: "Rate limited. Please try again later.",
        });
      }

      return notFoundResponse();
    });

    render(<App />);

    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    expect(within(sidebar).getByText("Rate limited. Please try again later.")).toBeInTheDocument();
  });
});
