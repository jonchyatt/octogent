import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { jsonResponse, notFoundResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

describe("App usage visibility settings", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("allows toggling runtime strip, usage, monitor, and bottom telemetry settings from Settings and persists visibility", async () => {
    const uiStatePatchBodies: Array<Record<string, unknown>> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        return jsonResponse([]);
      }

      if (url.endsWith("/api/codex/usage") && method === "GET") {
        return jsonResponse({
          status: "ok",
          source: "oauth-api",
          fetchedAt: "2026-03-03T12:00:00.000Z",
          primaryUsedPercent: 12,
          secondaryUsedPercent: 28,
          creditsBalance: 15,
        });
      }

      if (url.endsWith("/api/claude/usage") && method === "GET") {
        return jsonResponse({
          status: "ok",
          source: "oauth-api",
          fetchedAt: "2026-03-03T12:00:00.000Z",
          primaryUsedPercent: 14,
          secondaryUsedPercent: 39,
        });
      }

      if (url.endsWith("/api/ui-state") && method === "GET") {
        return jsonResponse({
          isRuntimeStatusStripVisible: true,
          isMonitorVisible: true,
          isBottomTelemetryVisible: true,
          isCodexUsageVisible: true,
          isClaudeUsageVisible: true,
          isCodexUsageSectionExpanded: true,
          isClaudeUsageSectionExpanded: true,
        });
      }

      if (url.endsWith("/api/ui-state") && method === "PATCH") {
        const body = init?.body;
        if (typeof body === "string") {
          uiStatePatchBodies.push(JSON.parse(body) as Record<string, unknown>);
        }
        return new Response(body ?? "{}", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      return notFoundResponse();
    });

    render(<App />);

    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    expect(within(sidebar).getByText("Codex token usage")).toBeInTheDocument();
    expect(within(sidebar).getByText("Claude token usage")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "[5] Settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show runtime status strip" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show bottom telemetry tape" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show Monitor workspace view" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show Codex token usage in sidebar" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show Claude token usage in sidebar" }));

    expect(screen.queryByLabelText("Runtime status strip")).toBeNull();
    expect(within(sidebar).queryByText("Codex token usage")).toBeNull();
    expect(within(sidebar).queryByText("Claude token usage")).toBeNull();
    expect(screen.queryByLabelText("Telemetry ticker tape")).toBeNull();

    await waitFor(() => {
      expect(
        uiStatePatchBodies.some(
          (body) =>
            body.isRuntimeStatusStripVisible === false &&
            body.isMonitorVisible === false &&
            body.isBottomTelemetryVisible === false &&
            body.isCodexUsageVisible === false &&
            body.isClaudeUsageVisible === false,
        ),
      ).toBe(true);
    });
  });
});
