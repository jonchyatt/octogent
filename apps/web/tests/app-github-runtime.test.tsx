import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { jsonResponse, notFoundResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

const mockGithubRuntimeRequests = () => {
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
        fetchedAt: "2026-02-27T12:00:00.000Z",
      });
    }

    if (url.endsWith("/api/github/summary") && method === "GET") {
      return jsonResponse({
        status: "ok",
        source: "gh-cli",
        fetchedAt: "2026-02-27T12:00:00.000Z",
        repo: "hesamsheikh/octogent",
        stargazerCount: 42,
        openIssueCount: 7,
        openPullRequestCount: 3,
        commitsPerDay: [
          { date: "2026-02-25", count: 4 },
          { date: "2026-02-26", count: 6 },
          { date: "2026-02-27", count: 8 },
        ],
      });
    }

    return notFoundResponse();
  });
};

describe("App GitHub runtime views", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("renders github repo metrics in the runtime status strip", async () => {
    mockGithubRuntimeRequests();

    const { container } = render(<App />);

    const strip = await screen.findByLabelText("Runtime status strip");
    expect(within(strip).getByText("hesamsheikh/octogent")).toBeInTheDocument();
    expect(within(strip).getByText("42")).toBeInTheDocument();
    expect(within(strip).getByText("COMMITS/DAY · LAST 30 DAYS")).toBeInTheDocument();
    expect(within(strip).getByText("7")).toBeInTheDocument();
    expect(within(strip).getByText("3")).toBeInTheDocument();
    expect(within(strip).getByText("18")).toBeInTheDocument();

    const sparkline = container.querySelector(".console-status-sparkline polyline");
    expect(sparkline).not.toBeNull();
    expect(sparkline?.getAttribute("points")).not.toBe("");
  });

  it("renders [1] GitHub with an Overview subtab and hoverable overview graph", async () => {
    mockGithubRuntimeRequests();

    const { container } = render(<App />);
    await screen.findByText("No active tentacles");

    fireEvent.click(
      screen.getByRole("button", {
        name: "[1] GitHub",
      }),
    );

    const githubView = await screen.findByLabelText("GitHub primary view");
    expect(
      within(githubView).getByRole("navigation", { name: "GitHub subtabs" }),
    ).toBeInTheDocument();
    expect(within(githubView).getByRole("button", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(githubView).getByText("hesamsheikh/octogent")).toBeInTheDocument();
    expect(
      within(githubView).getByRole("button", { name: "Refresh GitHub overview data" }),
    ).toBeInTheDocument();

    const graphPoint = container.querySelector(
      ".github-overview-graph-point[aria-label='2026-02-27 · 8 commits']",
    );
    expect(graphPoint).not.toBeNull();
    expect(container.querySelectorAll(".github-overview-graph-point")).toHaveLength(3);
    fireEvent.mouseEnter(graphPoint as Element);

    const hoverMeta = container.querySelector(".github-overview-graph-meta span");
    expect(hoverMeta).not.toBeNull();
    expect(hoverMeta).toHaveTextContent("2026-02-27 · 8 commits");

    const graphSvg = container.querySelector(".github-overview-graph-surface svg") as SVGElement | null;
    expect(graphSvg).not.toBeNull();
    if (!graphSvg) {
      return;
    }

    vi.spyOn(graphSvg, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 40,
      top: 40,
      left: 100,
      right: 740,
      bottom: 220,
      width: 640,
      height: 180,
      toJSON: () => ({}),
    });

    fireEvent.mouseMove(graphSvg, { clientX: 738 });
    expect(hoverMeta).toHaveTextContent("2026-02-27 · 8 commits");
    const graphTooltip = container.querySelector(".github-overview-graph-tooltip");
    expect(graphTooltip).not.toBeNull();
    expect(graphTooltip).toHaveTextContent("2026-02-27 · 8 commits");
  });
});
