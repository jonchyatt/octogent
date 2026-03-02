import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { jsonResponse, notFoundResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

describe("App Monitor runtime", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
    vi.useRealTimers();
  });

  it("saves X credentials, renders monitor feed rows, and supports manual refresh", async () => {
    const monitorConfigPatchBodies: Array<Record<string, unknown>> = [];
    let refreshCount = 0;

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
          fetchedAt: "2026-02-28T12:00:00.000Z",
        });
      }

      if (url.endsWith("/api/github/summary") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
          commitsPerDay: [],
        });
      }

      if (url.endsWith("/api/ui-state") && method === "GET") {
        return jsonResponse({});
      }

      if (url.endsWith("/api/ui-state") && method === "PATCH") {
        return jsonResponse({});
      }

      if (url.endsWith("/api/monitor/config") && method === "GET") {
        return jsonResponse({
          providerId: "x",
          queryTerms: ["Codex"],
          refreshPolicy: {
            maxCacheAgeMs: 86400000,
            maxPosts: 30,
            searchWindowDays: 7,
          },
          providers: {
            x: {
              credentials: {
                isConfigured: false,
                bearerTokenHint: null,
                apiKeyHint: null,
                hasApiSecret: false,
                hasAccessToken: false,
                hasAccessTokenSecret: false,
                updatedAt: null,
              },
            },
          },
        });
      }

      if (url.endsWith("/api/monitor/config") && method === "PATCH") {
        if (typeof init?.body === "string") {
          monitorConfigPatchBodies.push(JSON.parse(init.body) as Record<string, unknown>);
        }

        return jsonResponse({
          providerId: "x",
          queryTerms: ["Codex"],
          refreshPolicy: {
            maxCacheAgeMs: 86400000,
            maxPosts: 30,
            searchWindowDays: 7,
          },
          providers: {
            x: {
              credentials: {
                isConfigured: true,
                bearerTokenHint: "***********oken",
                apiKeyHint: null,
                hasApiSecret: false,
                hasAccessToken: false,
                hasAccessTokenSecret: false,
                updatedAt: "2026-02-28T12:00:00.000Z",
              },
            },
          },
        });
      }

      if (url.endsWith("/api/monitor/feed") && method === "GET") {
        return jsonResponse({
          providerId: "x",
          queryTerms: ["Codex"],
          refreshPolicy: {
            maxCacheAgeMs: 86400000,
            maxPosts: 30,
            searchWindowDays: 7,
          },
          lastFetchedAt: "2026-02-28T12:00:00.000Z",
          staleAfter: "2026-03-01T12:00:00.000Z",
          isStale: false,
          lastError: null,
          usage: {
            status: "ok",
            source: "x-api",
            fetchedAt: "2026-02-28T12:00:00.000Z",
            cap: 1000,
            used: 220,
            remaining: 780,
            resetAt: "2026-03-01T00:00:00.000Z",
          },
          posts: [
            {
              source: "x",
              id: "1",
              text: "Codex is shipping faster loops",
              author: "octogent",
              createdAt: "2026-02-28T10:00:00.000Z",
              likeCount: 123,
              permalink: "https://x.com/octogent/status/1",
              matchedQueryTerm: "Codex",
            },
          ],
        });
      }

      if (url.endsWith("/api/monitor/refresh") && method === "POST") {
        refreshCount += 1;
        return jsonResponse({
          providerId: "x",
          queryTerms: ["Codex"],
          refreshPolicy: {
            maxCacheAgeMs: 86400000,
            maxPosts: 30,
            searchWindowDays: 7,
          },
          lastFetchedAt: "2026-02-28T12:05:00.000Z",
          staleAfter: "2026-03-01T12:05:00.000Z",
          isStale: false,
          lastError: null,
          usage: {
            status: "ok",
            source: "x-api",
            fetchedAt: "2026-02-28T12:05:00.000Z",
            cap: 1000,
            used: 250,
            remaining: 750,
            resetAt: "2026-03-01T00:00:00.000Z",
          },
          posts: [
            {
              source: "x",
              id: "2",
              text: "Manual refresh delivered this post",
              author: "indy",
              createdAt: "2026-02-28T12:04:00.000Z",
              likeCount: 222,
              permalink: "https://x.com/indy/status/2",
              matchedQueryTerm: "Agent Ops",
            },
          ],
        });
      }

      return notFoundResponse();
    });

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "[2] Monitor",
      }),
    );

    const telemetryTape = screen.getByLabelText("Telemetry ticker tape");
    await waitFor(() => {
      expect(within(telemetryTape).getAllByText("@octogent")).toHaveLength(2);
      expect(within(telemetryTape).getAllByText("♥ 123")).toHaveLength(2);
      expect(within(telemetryTape).getAllByText("𝕏")).toHaveLength(2);
      const resourceLinks = within(telemetryTape).getAllByRole("link");
      expect(resourceLinks.length).toBeGreaterThan(0);
      expect(resourceLinks[0]).toHaveAttribute("href", "https://x.com/octogent/status/1");
    });

    const monitorView = await screen.findByLabelText("Monitor primary view");
    expect(within(monitorView).getByRole("button", { name: "Resources" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(within(monitorView).getByRole("button", { name: "Configure" }));
    expect(within(monitorView).getByRole("button", { name: "Configure" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(monitorView).queryByRole("textbox", { name: "Monitor query terms" })).not.toBeInTheDocument();
    fireEvent.click(within(monitorView).getByRole("radio", { name: "3D" }));
    fireEvent.change(within(monitorView).getByLabelText("Add monitor query term"), {
      target: {
        value: "Agent Ops",
      },
    });
    fireEvent.click(within(monitorView).getByRole("button", { name: "Add query term" }));
    fireEvent.click(within(monitorView).getByRole("button", { name: "Save monitor settings" }));

    await waitFor(() => {
      expect(
        monitorConfigPatchBodies.some((body) =>
          Array.isArray(body.queryTerms) ? body.queryTerms.includes("Agent Ops") : false,
        ),
      ).toBe(true);
    });
    expect(
      monitorConfigPatchBodies.some(
        (body) =>
          typeof body.refreshPolicy === "object" &&
          body.refreshPolicy !== null &&
          (body.refreshPolicy as { searchWindowDays?: number }).searchWindowDays === 3,
      ),
    ).toBe(true);

    fireEvent.change(within(monitorView).getByLabelText("X bearer token"), {
      target: {
        value: "my-x-token",
      },
    });
    fireEvent.click(within(monitorView).getByRole("button", { name: "Save monitor settings" }));

    await waitFor(() => {
      expect(monitorConfigPatchBodies.length).toBeGreaterThan(0);
    });
    expect(monitorConfigPatchBodies.at(-1)).toMatchObject({
      providerId: "x",
      credentials: {
        bearerToken: "my-x-token",
      },
    });

    fireEvent.click(within(monitorView).getByRole("button", { name: "Resources" }));
    expect(within(monitorView).getByText("Codex is shipping faster loops")).toBeInTheDocument();
    expect(within(monitorView).getByText("Codex")).toBeInTheDocument();
    fireEvent.click(within(monitorView).getByRole("button", { name: "Refresh monitor feed" }));

    expect(await within(monitorView).findByText("Manual refresh delivered this post")).toBeInTheDocument();
    expect(refreshCount).toBe(1);
  });

  it("polls monitor feed and updates stale view automatically", async () => {
    let feedRequestCount = 0;
    const intervalCallbacks: Array<() => void> = [];

    vi.spyOn(window, "setInterval").mockImplementation(((handler: TimerHandler) => {
      if (typeof handler === "function") {
        intervalCallbacks.push(() => {
          (handler as () => void)();
        });
      }
      return 1;
    }) as typeof window.setInterval);
    vi.spyOn(window, "clearInterval").mockImplementation((() => {}) as typeof window.clearInterval);

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
          fetchedAt: "2026-02-28T12:00:00.000Z",
        });
      }

      if (url.endsWith("/api/github/summary") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
          commitsPerDay: [],
        });
      }

      if (url.endsWith("/api/ui-state") && method === "GET") {
        return jsonResponse({});
      }

      if (url.endsWith("/api/ui-state") && method === "PATCH") {
        return jsonResponse({});
      }

      if (url.endsWith("/api/monitor/config") && method === "GET") {
        return jsonResponse({
          providerId: "x",
          queryTerms: ["Codex"],
          refreshPolicy: {
            maxCacheAgeMs: 86400000,
            maxPosts: 30,
            searchWindowDays: 7,
          },
          providers: {
            x: {
              credentials: {
                isConfigured: true,
                bearerTokenHint: "****oken",
                apiKeyHint: null,
                hasApiSecret: false,
                hasAccessToken: false,
                hasAccessTokenSecret: false,
                updatedAt: "2026-02-28T12:00:00.000Z",
              },
            },
          },
        });
      }

      if (url.endsWith("/api/monitor/feed") && method === "GET") {
        feedRequestCount += 1;
        if (feedRequestCount === 1) {
          return jsonResponse({
            providerId: "x",
            queryTerms: ["Codex"],
            refreshPolicy: {
              maxCacheAgeMs: 86400000,
              maxPosts: 30,
              searchWindowDays: 7,
            },
            lastFetchedAt: "2026-02-26T12:00:00.000Z",
            staleAfter: "2026-02-27T12:00:00.000Z",
            isStale: true,
            lastError: null,
            usage: null,
            posts: [
              {
                source: "x",
                id: "1",
                text: "Older stale post",
                author: "agent",
                createdAt: "2026-02-26T10:00:00.000Z",
                likeCount: 10,
                permalink: "https://x.com/agent/status/1",
                matchedQueryTerm: "Codex",
              },
            ],
          });
        }

        return jsonResponse({
          providerId: "x",
          queryTerms: ["Codex"],
          refreshPolicy: {
            maxCacheAgeMs: 86400000,
            maxPosts: 30,
            searchWindowDays: 7,
          },
          lastFetchedAt: "2026-02-28T12:01:00.000Z",
          staleAfter: "2026-03-01T12:01:00.000Z",
          isStale: false,
          lastError: null,
          usage: null,
          posts: [
            {
              source: "x",
              id: "2",
              text: "Fresh post after auto refresh",
              author: "agent",
              createdAt: "2026-02-28T12:01:00.000Z",
              likeCount: 88,
              permalink: "https://x.com/agent/status/2",
              matchedQueryTerm: "Codex",
            },
          ],
        });
      }

      return notFoundResponse();
    });

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "[2] Monitor",
      }),
    );

    const monitorView = await screen.findByLabelText("Monitor primary view");
    expect(within(monitorView).getByText("Older stale post")).toBeInTheDocument();
    expect(within(monitorView).getByText("STALE")).toBeInTheDocument();

    for (const callback of intervalCallbacks) {
      callback();
    }

    await waitFor(() => {
      expect(within(monitorView).getByText("Fresh post after auto refresh")).toBeInTheDocument();
    });
    expect(within(monitorView).getByText("FRESH")).toBeInTheDocument();
    expect(feedRequestCount).toBeGreaterThanOrEqual(2);
  });
});
