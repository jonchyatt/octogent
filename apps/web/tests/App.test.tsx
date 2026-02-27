import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readonly url: string;
  private listeners = new Map<string, Set<(event: { data: unknown }) => void>>();

  close = vi.fn();
  send = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    const bucket = this.listeners.get(type) ?? new Set<(event: { data: unknown }) => void>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, data?: unknown) {
    const event = { data };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
  });

  it("renders empty view when API returns no active agents", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    render(<App />);

    expect(await screen.findByText("No active tentacles")).toBeInTheDocument();
    expect(screen.getByText("When agents start, tentacles will appear here.")).toBeInTheDocument();
    expect(screen.getByTestId("empty-octopus")).toBeInTheDocument();
  });

  it("renders the persistent 5-zone shell with navigation hints", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    render(<App />);

    await screen.findByText("No active tentacles");
    expect(screen.getByLabelText("Runtime status strip")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Main content canvas")).toBeInTheDocument();
    expect(screen.getByLabelText("Telemetry ticker tape")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Context search input" })).toBeInTheDocument();
    expect(screen.getByText("Press 0-6 to navigate · Type context to search")).toBeInTheDocument();
  });

  it("supports keyboard-first primary navigation with number keys 0-6", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    render(<App />);
    await screen.findByText("No active tentacles");

    fireEvent.keyDown(window, { key: "4" });

    expect(
      screen.getByRole("button", {
        name: "[4] Pipelines",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("shows codex usage in the active agents sidebar footer", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      if (url.endsWith("/api/codex/usage") && method === "GET") {
        return new Response(
          JSON.stringify({
            status: "ok",
            source: "oauth-api",
            fetchedAt: "2026-02-25T12:00:00.000Z",
            primaryUsedPercent: 12,
            secondaryUsedPercent: 34,
            creditsBalance: 15.5,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      return new Response("not-found", { status: 404 });
    });

    render(<App />);

    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    expect(within(sidebar).getByText("Codex token usage")).toBeInTheDocument();
    expect(within(sidebar).getByText("5H tokens")).toBeInTheDocument();
    expect(within(sidebar).getByText("Week tokens")).toBeInTheDocument();
    expect(within(sidebar).getByRole("progressbar", { name: "5H token usage" })).toHaveAttribute(
      "aria-valuenow",
      "12",
    );
    expect(
      within(sidebar).getByRole("progressbar", { name: "Weekly token usage" }),
    ).toHaveAttribute("aria-valuenow", "34");
    expect(within(sidebar).getByText("12%")).toBeInTheDocument();
    expect(within(sidebar).getByText("34%")).toBeInTheDocument();
    expect(within(sidebar).getByText("Credits $15.50")).toBeInTheDocument();
  });

  it("collapses and expands the codex usage section in the sidebar footer", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      if (url.endsWith("/api/codex/usage") && method === "GET") {
        return new Response(
          JSON.stringify({
            status: "ok",
            source: "oauth-api",
            fetchedAt: "2026-02-25T12:00:00.000Z",
            primaryUsedPercent: 12,
            secondaryUsedPercent: 34,
            creditsBalance: 15.5,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      return new Response("not-found", { status: 404 });
    });

    render(<App />);

    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    expect(
      within(sidebar).getByRole("progressbar", { name: "5H token usage" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(sidebar).getByRole("button", {
        name: "Collapse Codex token usage section",
      }),
    );

    expect(within(sidebar).queryByRole("progressbar", { name: "5H token usage" })).toBeNull();
    expect(
      within(sidebar).getByRole("button", {
        name: "Expand Codex token usage section",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(sidebar).getByRole("button", {
        name: "Expand Codex token usage section",
      }),
    );

    expect(
      within(sidebar).getByRole("progressbar", { name: "5H token usage" }),
    ).toBeInTheDocument();
  });

  it("renders tentacle columns when API returns agent snapshots", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            agentId: "agent-1",
            label: "core-planner",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleWorkspaceMode: "worktree",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    render(<App />);

    const tentacleColumn = await screen.findByLabelText("tentacle-a");
    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    expect(tentacleColumn).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename tentacle tentacle-a" })).toBeInTheDocument();
    expect(within(tentacleColumn).getByText("WORKTREE")).toBeInTheDocument();
    expect(within(tentacleColumn).queryByText("core-planner")).toBeNull();
    expect(within(sidebar).getByText("core-planner")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-tentacle-a")).toBeInTheDocument();
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    expect(MockWebSocket.instances[0]?.url).toContain("/api/terminals/tentacle-a/ws");
  });

  it("keeps sidebar root badge synced with the terminal idle/processing state", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            agentId: "agent-1",
            label: "core-planner",
            state: "live",
            tentacleId: "tentacle-a",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    render(<App />);

    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    const tentacleGroup = within(sidebar).getByLabelText("Active agents in tentacle-a");

    await waitFor(() => {
      const idleBadge = within(tentacleGroup).getByText("IDLE");
      expect(idleBadge).toHaveClass("pill", "terminal-state-badge", "idle");
    });

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    const socket = MockWebSocket.instances[0];
    socket?.emit("message", JSON.stringify({ type: "state", state: "processing" }));

    await waitFor(() => {
      const processingBadge = within(tentacleGroup).getByText("PROCESSING");
      expect(processingBadge).toHaveClass("pill", "terminal-state-badge", "processing");
    });
  });

  it("creates a shared-codebase tentacle and refreshes columns plus sidebar listings", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        const afterCreate = fetchMock.mock.calls.some(
          ([calledUrl, calledInit]) =>
            String(calledUrl).endsWith("/api/tentacles") &&
            (calledInit?.method ?? "GET") === "POST",
        );

        return new Response(
          JSON.stringify(
            afterCreate
              ? [
                  {
                    agentId: "tentacle-1-root",
                    label: "tentacle-1-root",
                    state: "live",
                    tentacleId: "tentacle-1",
                    createdAt: "2026-02-24T10:00:00.000Z",
                  },
                  {
                    agentId: "tentacle-2-root",
                    label: "tentacle-2-root",
                    state: "live",
                    tentacleId: "tentacle-2",
                    createdAt: "2026-02-24T10:05:00.000Z",
                  },
                ]
              : [
                  {
                    agentId: "tentacle-1-root",
                    label: "tentacle-1-root",
                    state: "live",
                    tentacleId: "tentacle-1",
                    createdAt: "2026-02-24T10:00:00.000Z",
                  },
                ],
          ),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      if (url.endsWith("/api/tentacles") && method === "POST") {
        expect(init?.body).toBe(JSON.stringify({ workspaceMode: "shared" }));
        return new Response(
          JSON.stringify({
            agentId: "tentacle-2-root",
            label: "tentacle-2-root",
            state: "live",
            tentacleId: "tentacle-2",
            createdAt: "2026-02-24T10:05:00.000Z",
          }),
          {
            status: 201,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      return new Response("not-found", { status: 404 });
    });

    render(<App />);

    await screen.findByLabelText("tentacle-1");
    fireEvent.click(screen.getByRole("button", { name: "Create tentacle in main codebase" }));

    const tentacleTwoColumn = await screen.findByLabelText("tentacle-2");
    const sidebar = await screen.findByLabelText("Active Agents sidebar");

    expect(tentacleTwoColumn).toBeInTheDocument();
    expect(within(sidebar).getByLabelText("Active agents in tentacle-1")).toBeInTheDocument();
    expect(within(sidebar).getByLabelText("Active agents in tentacle-2")).toBeInTheDocument();
    await waitFor(() => {
      expect(MockWebSocket.instances.some((socket) => socket.url.includes("/tentacle-2/ws"))).toBe(
        true,
      );
    });
  });

  it("creates an isolated-worktree tentacle and starts inline editing immediately", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        const afterCreate = fetchMock.mock.calls.some(
          ([calledUrl, calledInit]) =>
            String(calledUrl).endsWith("/api/tentacles") &&
            (calledInit?.method ?? "GET") === "POST",
        );

        return new Response(
          JSON.stringify(
            afterCreate
              ? [
                  {
                    agentId: "tentacle-1-root",
                    label: "tentacle-1-root",
                    state: "live",
                    tentacleId: "tentacle-1",
                    tentacleName: "tentacle-1",
                    createdAt: "2026-02-24T10:00:00.000Z",
                  },
                  {
                    agentId: "tentacle-2-root",
                    label: "tentacle-2-root",
                    state: "live",
                    tentacleId: "tentacle-2",
                    tentacleName: "tentacle-2",
                    createdAt: "2026-02-24T10:05:00.000Z",
                  },
                ]
              : [
                  {
                    agentId: "tentacle-1-root",
                    label: "tentacle-1-root",
                    state: "live",
                    tentacleId: "tentacle-1",
                    tentacleName: "tentacle-1",
                    createdAt: "2026-02-24T10:00:00.000Z",
                  },
                ],
          ),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      if (url.endsWith("/api/tentacles") && method === "POST") {
        expect(init?.body).toBe(JSON.stringify({ workspaceMode: "worktree" }));
        return new Response(
          JSON.stringify({
            agentId: "tentacle-2-root",
            label: "tentacle-2-root",
            state: "live",
            tentacleId: "tentacle-2",
            tentacleName: "tentacle-2",
            createdAt: "2026-02-24T10:05:00.000Z",
          }),
          {
            status: 201,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      return new Response("not-found", { status: 404 });
    });

    render(<App />);

    await screen.findByLabelText("tentacle-1");
    fireEvent.click(
      screen.getByRole("button", { name: "Create tentacle with isolated worktree" }),
    );

    const nameEditor = await screen.findByLabelText("Tentacle name for tentacle-2");
    expect(nameEditor).toHaveValue("tentacle-2");
    expect(document.activeElement).toBe(nameEditor);
    expect((nameEditor as HTMLInputElement).selectionStart).toBe(0);
    expect((nameEditor as HTMLInputElement).selectionEnd).toBe("tentacle-2".length);
  });

  it("renames an existing tentacle inline from the column header", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    let tentacleName = "tentacle-a";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              agentId: "agent-1",
              label: "core-planner",
              state: "live",
              tentacleId: "tentacle-a",
              tentacleName,
              createdAt: "2026-02-24T10:00:00.000Z",
            },
          ]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      if (url.endsWith("/api/tentacles/tentacle-a") && method === "PATCH") {
        expect(init?.body).toBe(JSON.stringify({ name: "research" }));
        tentacleName = "research";
        return new Response(
          JSON.stringify({
            agentId: "tentacle-a-root",
            label: "tentacle-a-root",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName,
            createdAt: "2026-02-24T10:00:00.000Z",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      return new Response("not-found", { status: 404 });
    });

    render(<App />);
    const tentacleColumn = await screen.findByLabelText("tentacle-a");
    fireEvent.click(screen.getByRole("button", { name: "Rename tentacle tentacle-a" }));
    const nameEditor = await within(tentacleColumn).findByLabelText("Tentacle name for tentacle-a");
    fireEvent.change(nameEditor, { target: { value: "research" } });
    fireEvent.keyDown(nameEditor, { key: "Enter" });

    await waitFor(() => {
      expect(within(tentacleColumn).getByRole("button", { name: "research" })).toBeInTheDocument();
    });
  });

  it("deletes a tentacle from the header action and refreshes board and sidebar", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    let includeTentacleB = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        return new Response(
          JSON.stringify(
            includeTentacleB
              ? [
                  {
                    agentId: "tentacle-a-root",
                    label: "tentacle-a-root",
                    state: "live",
                    tentacleId: "tentacle-a",
                    tentacleName: "tentacle-a",
                    createdAt: "2026-02-24T10:00:00.000Z",
                  },
                  {
                    agentId: "tentacle-b-root",
                    label: "tentacle-b-root",
                    state: "live",
                    tentacleId: "tentacle-b",
                    tentacleName: "tentacle-b",
                    createdAt: "2026-02-24T10:05:00.000Z",
                  },
                ]
              : [
                  {
                    agentId: "tentacle-a-root",
                    label: "tentacle-a-root",
                    state: "live",
                    tentacleId: "tentacle-a",
                    tentacleName: "tentacle-a",
                    createdAt: "2026-02-24T10:00:00.000Z",
                  },
                ],
          ),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      if (url.endsWith("/api/tentacles/tentacle-b") && method === "DELETE") {
        includeTentacleB = false;
        return new Response(null, { status: 204 });
      }

      return new Response("not-found", { status: 404 });
    });

    render(<App />);

    const tentacleBColumn = await screen.findByLabelText("tentacle-b");
    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    expect(within(sidebar).getByLabelText("Active agents in tentacle-b")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete tentacle tentacle-b" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete confirmation for tentacle-b" });
    expect(deleteDialog).toBeInTheDocument();
    expect(within(deleteDialog).getByText("This action cannot be undone.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete tentacle-b" }));

    await waitFor(() => {
      expect(tentacleBColumn).not.toBeInTheDocument();
      expect(within(sidebar).queryByLabelText("Active agents in tentacle-b")).toBeNull();
    });
  });

  it("closes the delete confirmation dialog with Escape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            agentId: "tentacle-a-root",
            label: "tentacle-a-root",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName: "tentacle-a",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    render(<App />);
    await screen.findByLabelText("tentacle-a");

    fireEvent.click(screen.getByRole("button", { name: "Delete tentacle tentacle-a" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete confirmation for tentacle-a" });
    expect(deleteDialog).toBeInTheDocument();

    fireEvent.keyDown(deleteDialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Delete confirmation for tentacle-a" })).toBeNull();
  });

  it("minimizes tentacles from the header and maximizes them from the sidebar", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            agentId: "tentacle-a-root",
            label: "tentacle-a-root",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName: "tentacle-a",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
          {
            agentId: "tentacle-b-root",
            label: "tentacle-b-root",
            state: "live",
            tentacleId: "tentacle-b",
            tentacleName: "tentacle-b",
            createdAt: "2026-02-24T10:05:00.000Z",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    render(<App />);

    await screen.findByLabelText("tentacle-a");
    await screen.findByLabelText("tentacle-b");
    const sidebar = await screen.findByLabelText("Active Agents sidebar");

    fireEvent.click(screen.getByRole("button", { name: "Minimize tentacle tentacle-b" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("tentacle-b")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Maximize tentacle tentacle-b" }),
      ).toBeInTheDocument();
      expect(within(sidebar).getByLabelText("Active agents in tentacle-b")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Maximize tentacle tentacle-b" }));

    expect(await screen.findByLabelText("tentacle-b")).toBeInTheDocument();
  });

  it("resizes adjacent tentacle panes from the divider", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            agentId: "tentacle-1-root",
            label: "tentacle-1-root",
            state: "live",
            tentacleId: "tentacle-1",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
          {
            agentId: "tentacle-2-root",
            label: "tentacle-2-root",
            state: "live",
            tentacleId: "tentacle-2",
            createdAt: "2026-02-24T10:05:00.000Z",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    render(<App />);

    const leftPane = await screen.findByLabelText("tentacle-1");
    const rightPane = await screen.findByLabelText("tentacle-2");
    const divider = screen.getByRole("separator", {
      name: "Resize between tentacle-1 and tentacle-2",
    });

    expect(leftPane).toHaveStyle({ width: "497px" });
    expect(rightPane).toHaveStyle({ width: "497px" });

    fireEvent.keyDown(divider, { key: "ArrowRight" });

    await waitFor(() => {
      expect(leftPane).toHaveStyle({ width: "521px" });
      expect(rightPane).toHaveStyle({ width: "473px" });
    });
  });

  it("closes terminal websocket when app unmounts", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            agentId: "agent-1",
            label: "core-planner",
            state: "live",
            tentacleId: "tentacle-a",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const { unmount } = render(<App />);
    await screen.findByLabelText("tentacle-a");
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const socket = MockWebSocket.instances[0];
    expect(socket).toBeDefined();

    unmount();
    expect(socket?.close).toHaveBeenCalledTimes(1);
  });

  it("renders active agents grouped by tentacle in the sidebar", async () => {
    const longWorkerLabel = "worker-1-with-a-very-long-label-that-should-truncate-in-the-sidebar";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
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
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            agentId: "agent-1",
            label: "core-planner",
            state: "live",
            tentacleId: "tentacle-a",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

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

  it("hydrates ui state from the API and persists ui changes back to the API", async () => {
    const uiStatePatchBodies: Array<Record<string, unknown>> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              agentId: "agent-1",
              label: "core-planner",
              state: "live",
              tentacleId: "tentacle-a",
              tentacleName: "tentacle-a",
              createdAt: "2026-02-24T10:00:00.000Z",
            },
          ]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      if (url.endsWith("/api/codex/usage") && method === "GET") {
        return new Response(
          JSON.stringify({
            status: "unavailable",
            fetchedAt: "2026-02-24T10:00:00.000Z",
            source: "none",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      if (url.endsWith("/api/ui-state") && method === "GET") {
        return new Response(
          JSON.stringify({
            isAgentsSidebarVisible: true,
            sidebarWidth: 380,
            isActiveAgentsSectionExpanded: true,
            isCodexUsageSectionExpanded: false,
            minimizedTentacleIds: ["tentacle-a"],
            tentacleWidths: {
              "tentacle-a": 450,
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
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

      return new Response("not-found", { status: 404 });
    });

    render(<App />);

    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    await waitFor(() => {
      expect(sidebar).toHaveStyle({ width: "380px" });
    });
    expect(
      within(sidebar).getByRole("button", {
        name: "Expand Codex token usage section",
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("All tentacles minimized")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Maximize tentacle tentacle-a" }));

    await waitFor(() => {
      expect(uiStatePatchBodies.some((body) => Array.isArray(body.minimizedTentacleIds))).toBe(
        true,
      );
    });
    expect(uiStatePatchBodies.at(-1)?.minimizedTentacleIds).toEqual([]);
  });

  it("scrolls the board horizontally from tentacle headers without hijacking terminal wheel events", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/agent-snapshots")) {
        return new Response(
          JSON.stringify([
            {
              agentId: "agent-1",
              label: "core-planner",
              state: "live",
              tentacleId: "tentacle-a",
              tentacleName: "tentacle-a",
              createdAt: "2026-02-24T10:00:00.000Z",
            },
          ]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      if (url.endsWith("/api/codex/usage")) {
        return new Response(
          JSON.stringify({
            status: "unavailable",
            fetchedAt: "2026-02-24T10:00:00.000Z",
            source: "none",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      return new Response("not-found", { status: 404 });
    });

    render(<App />);

    const board = await screen.findByLabelText("Tentacle board");
    const headerNameButton = await screen.findByRole("button", { name: "tentacle-a" });
    const terminal = await screen.findByTestId("terminal-tentacle-a");

    expect(board.scrollLeft).toBe(0);

    fireEvent.wheel(headerNameButton, { deltaY: 120 });
    expect(board.scrollLeft).toBe(120);

    fireEvent.wheel(terminal, { deltaY: 120 });
    expect(board.scrollLeft).toBe(120);
  });
});
