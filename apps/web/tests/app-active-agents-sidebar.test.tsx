import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { jsonResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

describe("App active agents sidebar", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("renders active agents grouped by tentacle in the sidebar", async () => {
    const longWorkerLabel = "worker-1-with-a-very-long-label-that-should-truncate-in-the-sidebar";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse([
        {
          agentId: "agent-1",
          label: "core-planner",
          state: "live",
          tentacleId: "tentacle-a",
          createdAt: "2026-02-24T10:00:00.000Z",
        },
        {
          agentId: "agent-2",
          label: longWorkerLabel,
          state: "idle",
          tentacleId: "tentacle-a",
          parentAgentId: "agent-1",
          createdAt: "2026-02-24T10:05:00.000Z",
        },
        {
          agentId: "agent-3",
          label: "reviewer",
          state: "idle",
          tentacleId: "tentacle-b",
          createdAt: "2026-02-24T11:00:00.000Z",
        },
      ]),
    );

    render(<App />);

    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    const tentacleAGroup = within(sidebar).getByLabelText("Active agents in tentacle-a");
    const tentacleBGroup = within(sidebar).getByLabelText("Active agents in tentacle-b");

    expect(within(tentacleAGroup).getByText("2 agents")).toBeInTheDocument();
    expect(within(tentacleBGroup).getByText("1 agent")).toBeInTheDocument();
    expect(within(tentacleAGroup).getByText("core-planner")).toBeInTheDocument();
    expect(within(tentacleAGroup).getByText(longWorkerLabel)).toBeInTheDocument();
    expect(within(tentacleBGroup).getByText("reviewer")).toBeInTheDocument();

    const rootAgentRow = within(tentacleAGroup).getByText("core-planner").closest("li");
    expect(rootAgentRow).toHaveClass("active-agents-agent-row", "active-agents-agent-row--root");

    const childAgentLabel = within(tentacleAGroup).getByText(longWorkerLabel);
    expect(childAgentLabel).toHaveAttribute("title", longWorkerLabel);
    const childAgentRow = childAgentLabel.closest("li");
    expect(childAgentRow).toHaveClass("active-agents-agent-row", "active-agents-agent-row--child");
  });

  it("collapses and expands the active agents sidebar section", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse([
        {
          agentId: "agent-1",
          label: "core-planner",
          state: "live",
          tentacleId: "tentacle-a",
          createdAt: "2026-02-24T10:00:00.000Z",
        },
      ]),
    );

    render(<App />);

    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    const tentacleGroupLabel = "Active agents in tentacle-a";
    expect(within(sidebar).getByLabelText(tentacleGroupLabel)).toBeInTheDocument();

    const collapseButton = within(sidebar).getByRole("button", {
      name: "Collapse Active Agents section",
    });
    fireEvent.click(collapseButton);

    expect(within(sidebar).queryByLabelText(tentacleGroupLabel)).toBeNull();
    expect(
      within(sidebar).getByRole("button", {
        name: "Expand Active Agents section",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(sidebar).getByRole("button", {
        name: "Expand Active Agents section",
      }),
    );

    expect(within(sidebar).getByLabelText(tentacleGroupLabel)).toBeInTheDocument();
  });

  it("toggles the active agents sidebar", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse([]));

    render(<App />);

    await screen.findByLabelText("Active Agents sidebar");
    const hideButton = screen.getByRole("button", {
      name: "Hide Active Agents sidebar",
    });

    fireEvent.click(hideButton);

    expect(screen.queryByLabelText("Active Agents sidebar")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "Resize Active Agents sidebar" })).toBeNull();
    expect(screen.getByLabelText("Tentacle board").closest(".workspace-shell")).toHaveClass(
      "workspace-shell--full",
    );
    expect(screen.getByRole("button", { name: "Show Active Agents sidebar" })).toBeInTheDocument();
  });

  it("resizes the active agents sidebar from its border without a separate separator strip", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse([]));

    render(<App />);

    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    const resizer = await screen.findByTestId("active-agents-border-resizer");

    expect(sidebar).toHaveStyle({ width: "240px" });
    expect(screen.queryByRole("separator", { name: "Resize Active Agents sidebar" })).toBeNull();

    fireEvent.mouseDown(resizer, { clientX: 320 });
    fireEvent.mouseMove(window, { clientX: 380 });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect(sidebar).toHaveStyle({ width: "380px" });
    });
  });
});
