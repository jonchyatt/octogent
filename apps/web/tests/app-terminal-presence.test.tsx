import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { MockWebSocket, jsonResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

const findTerminalSocket = (terminalId: string) =>
  MockWebSocket.instances.find((socket) => socket.url.includes(`/api/terminals/${terminalId}/ws`));

const findTerminalEventsSocket = () =>
  MockWebSocket.instances.find((socket) => socket.url.includes("/api/terminal-events/ws"));

describe("App terminal presence and runtime state", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("renders terminal columns when API returns terminal snapshots", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse([
        {
          terminalId: "terminal-1",
          label: "core-planner",
          state: "live",
          tentacleId: "tentacle-a",
          workspaceMode: "worktree",
          createdAt: "2026-02-24T10:00:00.000Z",
        },
      ]),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "[9] Board" }));
    const terminalColumn = await screen.findByLabelText("terminal-1");
    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    expect(terminalColumn).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename terminal terminal-1" })).toBeInTheDocument();
    expect(within(terminalColumn).getByText("WORKTREE")).toBeInTheDocument();
    expect(within(terminalColumn).getByText("core-planner")).toBeInTheDocument();
    expect(within(sidebar).getByText("core-planner")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-terminal-1")).toBeInTheDocument();
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    expect(findTerminalSocket("terminal-1")?.url).toContain("/api/terminals/terminal-1/ws");
  });

  it("adds a terminal live when the terminal events socket announces creation", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse([
        {
          terminalId: "terminal-1",
          label: "core-planner",
          state: "live",
          tentacleId: "tentacle-a",
          createdAt: "2026-02-24T10:00:00.000Z",
        },
      ]),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "[9] Board" }));
    await screen.findByLabelText("terminal-1");
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const eventsSocket = findTerminalEventsSocket();
    expect(eventsSocket).toBeDefined();

    eventsSocket?.emit(
      "message",
      JSON.stringify({
        type: "terminal-created",
        snapshot: {
          terminalId: "terminal-2",
          label: "docs-worker",
          state: "live",
          tentacleId: "tentacle-a",
          tentacleName: "tentacle-a",
          parentTerminalId: "terminal-1",
          workspaceMode: "shared",
          createdAt: "2026-02-24T10:05:00.000Z",
          hasUserPrompt: true,
        },
      }),
    );

    expect(await screen.findByLabelText("terminal-2")).toBeInTheDocument();
  });
  it("keeps sidebar badge synced with the terminal idle/processing state", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse([
        {
          terminalId: "terminal-1",
          label: "core-planner",
          state: "live",
          tentacleId: "tentacle-a",
          createdAt: "2026-02-24T10:00:00.000Z",
        },
      ]),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "[9] Board" }));
    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    const terminalGroup = within(sidebar).getByLabelText("Terminal terminal-1");

    await waitFor(() => {
      const idleBadge = within(terminalGroup).getByText("IDLE");
      expect(idleBadge).toHaveClass("pill", "terminal-state-badge", "idle");
    });

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    const socket = findTerminalSocket("terminal-1");
    socket?.emit("message", JSON.stringify({ type: "state", state: "processing" }));

    await waitFor(() => {
      const processingBadge = within(terminalGroup).getByText("PROCESSING");
      expect(processingBadge).toHaveClass("pill", "terminal-state-badge", "processing");
    });
  });

  it("plays a completion notification only when terminal state moves from processing to idle", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    const play = vi.fn().mockResolvedValue(undefined);
    const MockAudio = vi.fn(() => ({
      currentTime: 0,
      play,
      preload: "auto",
    }));
    vi.stubGlobal("Audio", MockAudio as unknown as typeof Audio);

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse([
        {
          terminalId: "terminal-1",
          label: "core-planner",
          state: "live",
          tentacleId: "tentacle-a",
          createdAt: "2026-02-24T10:00:00.000Z",
        },
      ]),
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "[9] Board" }));
    await screen.findByLabelText("terminal-1");
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const socket = findTerminalSocket("terminal-1");
    socket?.emit("message", JSON.stringify({ type: "state", state: "idle" }));
    socket?.emit("message", JSON.stringify({ type: "state", state: "processing" }));

    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(0);
    });

    socket?.emit("message", JSON.stringify({ type: "state", state: "idle" }));
    await waitFor(() => {
      expect(MockAudio).toHaveBeenCalledTimes(1);
      expect(play).toHaveBeenCalledTimes(1);
    });

    socket?.emit("message", JSON.stringify({ type: "state", state: "idle" }));
    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1);
    });
  });

  it("closes terminal websocket when app unmounts", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse([
        {
          terminalId: "terminal-1",
          label: "core-planner",
          state: "live",
          tentacleId: "tentacle-a",
          createdAt: "2026-02-24T10:00:00.000Z",
        },
      ]),
    );

    const { unmount } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "[9] Board" }));
    await screen.findByLabelText("terminal-1");
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const socket = findTerminalSocket("terminal-1");
    expect(socket).toBeDefined();

    unmount();
    expect(socket?.close).toHaveBeenCalledTimes(1);
  });
});
