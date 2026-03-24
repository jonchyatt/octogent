import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import {
  MockWebSocket,
  jsonResponse,
  notFoundResponse,
  resetAppTestHarness,
} from "./test-utils/appTestHarness";

describe("App tentacle create/rename/delete actions", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
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

        return jsonResponse(
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
                  agentId: "tentacle-1-agent-1",
                  label: "tentacle-1-agent-1",
                  state: "live",
                  tentacleId: "tentacle-1",
                  parentAgentId: "tentacle-1-root",
                  createdAt: "2026-02-24T10:00:30.000Z",
                },
                {
                  agentId: "tentacle-2-root",
                  label: "tentacle-2-root",
                  state: "live",
                  tentacleId: "tentacle-2",
                  createdAt: "2026-02-24T10:05:00.000Z",
                },
                {
                  agentId: "tentacle-2-agent-1",
                  label: "tentacle-2-agent-1",
                  state: "live",
                  tentacleId: "tentacle-2",
                  parentAgentId: "tentacle-2-root",
                  createdAt: "2026-02-24T10:05:30.000Z",
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
                {
                  agentId: "tentacle-1-agent-1",
                  label: "tentacle-1-agent-1",
                  state: "live",
                  tentacleId: "tentacle-1",
                  parentAgentId: "tentacle-1-root",
                  createdAt: "2026-02-24T10:00:30.000Z",
                },
              ],
        );
      }

      if (url.endsWith("/api/tentacles") && method === "POST") {
        expect(init?.body).toBe(JSON.stringify({ workspaceMode: "shared" }));
        return jsonResponse(
          {
            agentId: "tentacle-2-root",
            label: "tentacle-2-root",
            state: "live",
            tentacleId: "tentacle-2",
            createdAt: "2026-02-24T10:05:00.000Z",
          },
          201,
        );
      }

      return notFoundResponse();
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
      expect(
        MockWebSocket.instances.some((socket) => socket.url.includes("/tentacle-2-agent-1/ws")),
      ).toBe(true);
    });
  });

  it("creates child terminal agents above or below a selected terminal", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    const snapshots: Array<{
      agentId: string;
      label: string;
      state: "live";
      tentacleId: string;
      tentacleName: string;
      createdAt: string;
      parentAgentId?: string;
    }> = [
      {
        agentId: "tentacle-a-root",
        label: "tentacle-a-root",
        state: "live",
        tentacleId: "tentacle-a",
        tentacleName: "tentacle-a",
        createdAt: "2026-02-24T10:00:00.000Z",
      },
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        return jsonResponse(snapshots);
      }

      if (url.endsWith("/api/tentacles/tentacle-a/agents") && method === "POST") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as {
          anchorAgentId?: string;
          placement?: string;
        };

        if (payload.anchorAgentId === "tentacle-a-root" && payload.placement === "down") {
          snapshots.push({
            agentId: "tentacle-a-agent-1",
            label: "tentacle-a-agent-1",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName: "tentacle-a",
            createdAt: "2026-02-24T10:01:00.000Z",
            parentAgentId: "tentacle-a-root",
          });
          return jsonResponse(
            {
              agentId: "tentacle-a-agent-1",
            },
            201,
          );
        }

        if (payload.anchorAgentId === "tentacle-a-agent-1" && payload.placement === "up") {
          snapshots.splice(1, 0, {
            agentId: "tentacle-a-agent-2",
            label: "tentacle-a-agent-2",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName: "tentacle-a",
            createdAt: "2026-02-24T10:02:00.000Z",
            parentAgentId: "tentacle-a-root",
          });
          return jsonResponse(
            {
              agentId: "tentacle-a-agent-2",
            },
            201,
          );
        }
      }

      if (
        url.match(/\/api\/tentacles\/tentacle-a\/agents\/tentacle-a-agent-[0-9]+$/) &&
        method === "DELETE"
      ) {
        const agentId = url.split("/").at(-1) ?? "";
        const index = snapshots.findIndex((snapshot) => snapshot.agentId === agentId);
        if (index >= 0) {
          snapshots.splice(index, 1);
        }
        for (const snapshot of snapshots) {
          if (snapshot.parentAgentId === agentId) {
            snapshot.parentAgentId = "tentacle-a-root";
          }
        }
        return new Response(null, { status: 204 });
      }

      return notFoundResponse();
    });

    render(<App />);

    await screen.findByLabelText("tentacle-a");
    expect(
      screen.getByRole("button", { name: "Create first terminal in tentacle-a" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create first terminal in tentacle-a" }));
    await screen.findByRole("button", { name: "Add terminal below tentacle-a-agent-1" });

    fireEvent.click(screen.getByRole("button", { name: "Add terminal above tentacle-a-agent-1" }));

    await waitFor(() => {
      const mountedTerminalLabels = screen
        .getAllByLabelText(/^Terminal /)
        .map((element) => element.getAttribute("aria-label"));
      expect(mountedTerminalLabels).toEqual([
        "Terminal tentacle-a-agent-2",
        "Terminal tentacle-a-agent-1",
      ]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete terminal tentacle-a-agent-1" }));

    await waitFor(() => {
      const mountedTerminalLabels = screen
        .getAllByLabelText(/^Terminal /)
        .map((element) => element.getAttribute("aria-label"));
      expect(mountedTerminalLabels).toEqual(["Terminal tentacle-a-agent-2"]);
      expect(
        screen.queryByRole("button", { name: "Delete terminal tentacle-a-agent-1" }),
      ).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete terminal tentacle-a-agent-2" }));
    await waitFor(() => {
      expect(screen.queryByLabelText("Terminal tentacle-a-agent-2")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Create first terminal in tentacle-a" }),
      ).toBeInTheDocument();
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

        return jsonResponse(
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
        );
      }

      if (url.endsWith("/api/tentacles") && method === "POST") {
        expect(init?.body).toBe(JSON.stringify({ workspaceMode: "worktree" }));
        return jsonResponse(
          {
            agentId: "tentacle-2-root",
            label: "tentacle-2-root",
            state: "live",
            tentacleId: "tentacle-2",
            tentacleName: "tentacle-2",
            createdAt: "2026-02-24T10:05:00.000Z",
          },
          201,
        );
      }

      return notFoundResponse();
    });

    render(<App />);

    await screen.findByLabelText("tentacle-1");
    fireEvent.click(screen.getByRole("button", { name: "Create tentacle with isolated worktree" }));

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
        return jsonResponse([
          {
            agentId: "agent-1",
            label: "core-planner",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName,
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]);
      }

      if (url.endsWith("/api/tentacles/tentacle-a") && method === "PATCH") {
        expect(init?.body).toBe(JSON.stringify({ name: "research" }));
        tentacleName = "research";
        return jsonResponse({
          agentId: "tentacle-a-root",
          label: "tentacle-a-root",
          state: "live",
          tentacleId: "tentacle-a",
          tentacleName,
          createdAt: "2026-02-24T10:00:00.000Z",
        });
      }

      return notFoundResponse();
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
        return jsonResponse(
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
        );
      }

      if (url.endsWith("/api/tentacles/tentacle-b") && method === "DELETE") {
        includeTentacleB = false;
        return new Response(null, { status: 204 });
      }

      return notFoundResponse();
    });

    render(<App />);

    const tentacleBColumn = await screen.findByLabelText("tentacle-b");
    const sidebar = await screen.findByLabelText("Active Agents sidebar");
    expect(within(sidebar).getByLabelText("Active agents in tentacle-b")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete tentacle tentacle-b" }));
    const deletePanel = within(sidebar).getByLabelText("Delete confirmation for tentacle-b");
    expect(deletePanel).toBeInTheDocument();
    expect(within(deletePanel).getByText("This action cannot be undone.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Delete confirmation for tentacle-b" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete tentacle-b" }));

    await waitFor(() => {
      expect(tentacleBColumn).not.toBeInTheDocument();
      expect(within(sidebar).queryByLabelText("Active agents in tentacle-b")).toBeNull();
    });
  });

  it("closes the delete confirmation panel with Escape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([
        {
          agentId: "tentacle-a-root",
          label: "tentacle-a-root",
          state: "live",
          tentacleId: "tentacle-a",
          tentacleName: "tentacle-a",
          createdAt: "2026-02-24T10:00:00.000Z",
        },
      ]),
    );

    render(<App />);
    await screen.findByLabelText("tentacle-a");
    const sidebar = screen.getByLabelText("Active Agents sidebar");

    fireEvent.click(screen.getByRole("button", { name: "Delete tentacle tentacle-a" }));
    const deletePanel = within(sidebar).getByLabelText("Delete confirmation for tentacle-a");
    expect(deletePanel).toBeInTheDocument();
    expect(
      within(deletePanel).getByRole("button", { name: "Close sidebar action panel" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(deletePanel, { key: "Escape" });
    expect(screen.queryByLabelText("Delete confirmation for tentacle-a")).toBeNull();
  });

  it("shows git actions for worktree tentacles and commits with user message", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        return jsonResponse([
          {
            agentId: "tentacle-a-root",
            label: "tentacle-a-root",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName: "tentacle-a",
            tentacleWorkspaceMode: "shared",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
          {
            agentId: "tentacle-b-root",
            label: "tentacle-b-root",
            state: "live",
            tentacleId: "tentacle-b",
            tentacleName: "tentacle-b",
            tentacleWorkspaceMode: "worktree",
            createdAt: "2026-02-24T10:05:00.000Z",
          },
        ]);
      }

      if (url.endsWith("/api/tentacles/tentacle-b/git/status") && method === "GET") {
        return jsonResponse({
          tentacleId: "tentacle-b",
          workspaceMode: "worktree",
          branchName: "octogent/tentacle-b",
          upstreamBranchName: "origin/octogent/tentacle-b",
          isDirty: true,
          aheadCount: 1,
          behindCount: 0,
          hasConflicts: false,
          changedFiles: ["apps/web/src/App.tsx"],
          defaultBaseBranchName: "main",
        });
      }

      if (url.endsWith("/api/tentacles/tentacle-b/git/commit") && method === "POST") {
        expect(init?.body).toBe(JSON.stringify({ message: "feat: ship worktree git menu" }));
        return jsonResponse({
          tentacleId: "tentacle-b",
          workspaceMode: "worktree",
          branchName: "octogent/tentacle-b",
          upstreamBranchName: "origin/octogent/tentacle-b",
          isDirty: false,
          aheadCount: 2,
          behindCount: 0,
          hasConflicts: false,
          changedFiles: [],
          defaultBaseBranchName: "main",
        });
      }

      return notFoundResponse();
    });

    render(<App />);

    await screen.findByLabelText("tentacle-b");
    const sidebar = screen.getByLabelText("Active Agents sidebar");
    expect(screen.queryByRole("button", { name: "Open git actions for tentacle-a" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open git actions for tentacle-b" }));

    const gitPanel = await within(sidebar).findByLabelText("Git actions for tentacle-b");
    expect(screen.queryByRole("dialog", { name: "Git actions for tentacle-b" })).toBeNull();
    expect(
      within(gitPanel).getByRole("button", { name: "Close sidebar action panel" }),
    ).toBeInTheDocument();
    expect(within(gitPanel).getByText("octogent/tentacle-b")).toBeInTheDocument();
    const commitInput = within(gitPanel).getByLabelText("Commit message for tentacle-b");
    fireEvent.change(commitInput, { target: { value: "feat: ship worktree git menu" } });
    fireEvent.click(within(gitPanel).getByRole("button", { name: "Commit changes" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([calledUrl, calledInit]) =>
            String(calledUrl).endsWith("/api/tentacles/tentacle-b/git/commit") &&
            (calledInit?.method ?? "GET") === "POST",
        ),
      ).toBe(true);
    });
  });

  it("merges existing pull requests from worktree git actions dialog", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        return jsonResponse([
          {
            agentId: "tentacle-pr-root",
            label: "tentacle-pr-root",
            state: "live",
            tentacleId: "tentacle-pr",
            tentacleName: "tentacle-pr",
            tentacleWorkspaceMode: "worktree",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]);
      }

      if (url.endsWith("/api/tentacles/tentacle-pr/git/status") && method === "GET") {
        return jsonResponse({
          tentacleId: "tentacle-pr",
          workspaceMode: "worktree",
          branchName: "octogent/tentacle-pr",
          upstreamBranchName: "origin/octogent/tentacle-pr",
          isDirty: false,
          aheadCount: 1,
          behindCount: 0,
          hasConflicts: false,
          changedFiles: [],
          defaultBaseBranchName: "main",
        });
      }

      if (url.endsWith("/api/tentacles/tentacle-pr/git/pr") && method === "GET") {
        return jsonResponse({
          tentacleId: "tentacle-pr",
          workspaceMode: "worktree",
          status: "open",
          number: 215,
          url: "https://github.com/hesamsheikh/octogent/pull/215",
          title: "feat: add PR lifecycle actions",
          baseRef: "main",
          headRef: "octogent/tentacle-pr",
          isDraft: false,
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
        });
      }

      if (url.endsWith("/api/tentacles/tentacle-pr/git/pr/merge") && method === "POST") {
        return jsonResponse({
          tentacleId: "tentacle-pr",
          workspaceMode: "worktree",
          status: "merged",
          number: 215,
          url: "https://github.com/hesamsheikh/octogent/pull/215",
          title: "feat: add PR lifecycle actions",
          baseRef: "main",
          headRef: "octogent/tentacle-pr",
          isDraft: false,
          mergeable: "UNKNOWN",
          mergeStateStatus: "MERGED",
        });
      }

      return notFoundResponse();
    });

    render(<App />);

    const tentacleColumn = await screen.findByLabelText("tentacle-pr");
    const sidebar = screen.getByLabelText("Active Agents sidebar");
    fireEvent.click(screen.getByRole("button", { name: "Open git actions for tentacle-pr" }));

    const gitPanel = await within(sidebar).findByLabelText("Git actions for tentacle-pr");
    expect(
      within(gitPanel).getByRole("button", { name: "Open pull request in GitHub" }),
    ).toBeEnabled();

    fireEvent.click(within(gitPanel).getByRole("button", { name: "Merge pull request" }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([calledUrl, calledInit]) =>
            String(calledUrl).endsWith("/api/tentacles/tentacle-pr/git/pr/merge") &&
            (calledInit?.method ?? "GET") === "POST",
        ),
      ).toBe(true);
    });

    await waitFor(() => {
      expect(within(tentacleColumn).getByText("PR MERGED #215")).toBeInTheDocument();
    });
  });

  it("shows explicit disable reasons for blocked git actions", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        return jsonResponse([
          {
            agentId: "tentacle-blocked-root",
            label: "tentacle-blocked-root",
            state: "live",
            tentacleId: "tentacle-blocked",
            tentacleName: "tentacle-blocked",
            tentacleWorkspaceMode: "worktree",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]);
      }

      if (url.endsWith("/api/tentacles/tentacle-blocked/git/status") && method === "GET") {
        return jsonResponse({
          tentacleId: "tentacle-blocked",
          workspaceMode: "worktree",
          branchName: "octogent/tentacle-blocked",
          upstreamBranchName: "origin/octogent/tentacle-blocked",
          isDirty: true,
          aheadCount: 0,
          behindCount: 0,
          hasConflicts: false,
          changedFiles: ["apps/web/src/App.tsx"],
          defaultBaseBranchName: "main",
        });
      }

      if (url.endsWith("/api/tentacles/tentacle-blocked/git/pr") && method === "GET") {
        return jsonResponse({
          tentacleId: "tentacle-blocked",
          workspaceMode: "worktree",
          status: "open",
          number: 219,
          url: "https://github.com/hesamsheikh/octogent/pull/219",
          title: "feat: blocked lifecycle",
          baseRef: "main",
          headRef: "octogent/tentacle-blocked",
          isDraft: false,
          mergeable: "CONFLICTING",
          mergeStateStatus: "DIRTY",
        });
      }

      return notFoundResponse();
    });

    render(<App />);

    await screen.findByLabelText("tentacle-blocked");
    const sidebar = screen.getByLabelText("Active Agents sidebar");
    fireEvent.click(screen.getByRole("button", { name: "Open git actions for tentacle-blocked" }));

    const gitPanel = await within(sidebar).findByLabelText("Git actions for tentacle-blocked");
    fireEvent.click(within(gitPanel).getByRole("button", { name: "Open commit options" }));
    expect(within(gitPanel).getByRole("button", { name: "Commit changes" })).toBeDisabled();
    expect(within(gitPanel).getByRole("menuitem", { name: "Sync with Base" })).toBeDisabled();
    expect(within(gitPanel).getByRole("button", { name: "Merge pull request" })).toBeDisabled();

    expect(
      within(gitPanel).getByText("Commit blocked: enter a commit message."),
    ).toBeInTheDocument();
    expect(
      within(gitPanel).getByText("Sync blocked: worktree has uncommitted changes."),
    ).toBeInTheDocument();
    expect(
      within(gitPanel).getByText("Merge blocked: pull request has merge conflicts."),
    ).toBeInTheDocument();
  });

  it("requires explicit confirmation before cleanup of a worktree tentacle", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    let includeWorktreeTentacle = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/agent-snapshots") && method === "GET") {
        return jsonResponse(
          includeWorktreeTentacle
            ? [
                {
                  agentId: "tentacle-main-root",
                  label: "tentacle-main-root",
                  state: "live",
                  tentacleId: "tentacle-main",
                  tentacleName: "tentacle-main",
                  tentacleWorkspaceMode: "shared",
                  createdAt: "2026-02-24T10:00:00.000Z",
                },
                {
                  agentId: "tentacle-wt-root",
                  label: "tentacle-wt-root",
                  state: "live",
                  tentacleId: "tentacle-wt",
                  tentacleName: "tentacle-wt",
                  tentacleWorkspaceMode: "worktree",
                  createdAt: "2026-02-24T10:05:00.000Z",
                },
              ]
            : [
                {
                  agentId: "tentacle-main-root",
                  label: "tentacle-main-root",
                  state: "live",
                  tentacleId: "tentacle-main",
                  tentacleName: "tentacle-main",
                  tentacleWorkspaceMode: "shared",
                  createdAt: "2026-02-24T10:00:00.000Z",
                },
              ],
        );
      }

      if (url.endsWith("/api/tentacles/tentacle-wt/git/status") && method === "GET") {
        return jsonResponse({
          tentacleId: "tentacle-wt",
          workspaceMode: "worktree",
          branchName: "octogent/tentacle-wt",
          upstreamBranchName: "origin/octogent/tentacle-wt",
          isDirty: false,
          aheadCount: 0,
          behindCount: 0,
          hasConflicts: false,
          changedFiles: [],
          defaultBaseBranchName: "main",
        });
      }

      if (url.endsWith("/api/tentacles/tentacle-wt/git/pr") && method === "GET") {
        return jsonResponse({
          tentacleId: "tentacle-wt",
          workspaceMode: "worktree",
          status: "none",
          number: null,
          url: null,
          title: null,
          baseRef: null,
          headRef: null,
          isDraft: null,
          mergeable: null,
          mergeStateStatus: null,
        });
      }

      if (url.endsWith("/api/tentacles/tentacle-wt") && method === "DELETE") {
        includeWorktreeTentacle = false;
        return new Response(null, { status: 204 });
      }

      return notFoundResponse();
    });

    render(<App />);

    await screen.findByLabelText("tentacle-wt");
    const sidebar = screen.getByLabelText("Active Agents sidebar");
    fireEvent.click(screen.getByRole("button", { name: "Open git actions for tentacle-wt" }));

    const gitPanel = await within(sidebar).findByLabelText("Git actions for tentacle-wt");
    fireEvent.click(within(gitPanel).getByRole("button", { name: "Cleanup worktree" }));

    const deleteDialog = await within(sidebar).findByLabelText(
      "Delete confirmation for tentacle-wt",
    );
    expect(
      within(deleteDialog).getByText(
        "This action removes the worktree directory and local branch.",
      ),
    ).toBeInTheDocument();

    const confirmButton = within(deleteDialog).getByRole("button", {
      name: "Confirm delete tentacle-wt",
    });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(within(deleteDialog).getByLabelText("Type tentacle ID to confirm cleanup"), {
      target: { value: "tentacle-wt" },
    });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.queryByLabelText("tentacle-wt")).toBeNull();
    });
  });
});
