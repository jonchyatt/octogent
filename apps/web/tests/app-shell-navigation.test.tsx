import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { jsonResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

describe("App shell and navigation", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("renders empty view when API returns no active agents", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse([]));

    render(<App />);

    expect(await screen.findByText("No active tentacles")).toBeInTheDocument();
    expect(screen.getByText("When agents start, tentacles will appear here.")).toBeInTheDocument();
    expect(screen.getByTestId("empty-octopus")).toBeInTheDocument();
  });

  it("renders the persistent 5-zone shell with navigation hints", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse([]));

    render(<App />);

    await screen.findByText("No active tentacles");
    expect(screen.getByLabelText("Runtime status strip")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Main content canvas")).toBeInTheDocument();
    expect(screen.getByLabelText("Telemetry ticker tape")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Context search input" })).not.toBeInTheDocument();
    expect(screen.queryByText("Agent Runtime")).not.toBeInTheDocument();
    expect(await screen.findByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText("Press 0-4 to navigate")).toBeInTheDocument();
  });

  it("supports keyboard-first primary navigation with number keys 0-4", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse([]));

    render(<App />);
    await screen.findByText("No active tentacles");

    fireEvent.keyDown(window, { key: "2" });

    expect(
      screen.getByRole("button", {
        name: "[2] Monitor",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("shows OFFLINE when backend requests fail", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    render(<App />);

    const loadErrors = await screen.findAllByText("Agent data is currently unavailable.");
    expect(loadErrors.length).toBeGreaterThan(0);
    expect(await screen.findByText("OFFLINE")).toBeInTheDocument();
  });
});
