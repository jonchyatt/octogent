import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChannelStore } from "../src/terminalRuntime/channelStore";

describe("ChannelStore", () => {
  let tmp: string;
  let dbPath: string;
  let store: ChannelStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "channel-store-"));
    dbPath = join(tmp, "channels.db");
    store = new ChannelStore({ dbPath, useWal: false });
  });

  afterEach(() => {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const mk = (messageId: string, to = "terminal-A", from = "terminal-B") => ({
    messageId,
    fromTerminalId: from,
    toTerminalId: to,
    content: `hello from ${from}`,
    timestamp: new Date().toISOString(),
    delivered: false,
  });

  it("enqueues a new message", () => {
    const id = store.enqueue(mk("msg-1"));
    expect(id).toBeGreaterThan(0);
    const list = store.listForTerminal("terminal-A");
    expect(list).toHaveLength(1);
    expect(list[0].messageId).toBe("msg-1");
    expect(list[0].delivered).toBe(false);
  });

  it("is idempotent on duplicate messageId", () => {
    store.enqueue(mk("msg-dup"));
    const second = store.enqueue(mk("msg-dup"));
    expect(second).toBeNull();
    expect(store.listForTerminal("terminal-A")).toHaveLength(1);
  });

  it("claims pending messages atomically (pending → queued)", () => {
    store.enqueue(mk("m1"));
    store.enqueue(mk("m2"));
    store.enqueue(mk("m-other", "terminal-OTHER"));

    const claimed = store.claimPendingFor("terminal-A");
    expect(claimed.map((m) => m.messageId).sort()).toEqual(["m1", "m2"]);

    // Subsequent claim returns nothing — they're queued now, not pending.
    const second = store.claimPendingFor("terminal-A");
    expect(second).toHaveLength(0);

    // Other terminal's messages untouched.
    const otherClaimed = store.claimPendingFor("terminal-OTHER");
    expect(otherClaimed).toHaveLength(1);
  });

  it("marks processing → delivered transitions", () => {
    store.enqueue(mk("m1"));
    store.claimPendingFor("terminal-A");
    store.markProcessing("m1");
    store.markDelivered("m1");

    const counts = store.getStatusCounts();
    expect(counts.completed).toBe(1);
    expect(counts.pending + counts.queued + counts.processing).toBe(0);

    // listForTerminal still returns the row; delivered flag is true.
    const list = store.listForTerminal("terminal-A");
    expect(list[0].delivered).toBe(true);
  });

  it("marks failed messages and dead-letters after MAX_RETRIES", () => {
    const s = new ChannelStore({ dbPath: ":memory:", useWal: false, maxRetries: 2 });
    s.enqueue(mk("m1"));
    s.claimPendingFor("terminal-A");
    s.markFailed("m1", "first error"); // retry=1, back to pending
    expect(s.getStatusCounts().pending).toBe(1);
    expect(s.getStatusCounts().dead).toBe(0);

    s.claimPendingFor("terminal-A");
    s.markFailed("m1", "second error"); // retry=2 >= max, → dead
    expect(s.getStatusCounts().pending).toBe(0);
    expect(s.getStatusCounts().dead).toBe(1);
    s.close();
  });

  it("recovers stale queued/processing messages after threshold", async () => {
    store.enqueue(mk("m1"));
    store.claimPendingFor("terminal-A"); // → queued
    store.markProcessing("m1"); // → processing

    // With threshold 0ms, everything non-terminal is stale.
    const recovered = store.recoverStale(0);
    expect(recovered).toBe(1);
    expect(store.getStatusCounts().pending).toBe(1);
    expect(store.getStatusCounts().processing).toBe(0);
  });

  it("does not recover completed or dead messages", () => {
    store.enqueue(mk("c1"));
    store.claimPendingFor("terminal-A");
    store.markProcessing("c1");
    store.markDelivered("c1");

    const recovered = store.recoverStale(0);
    expect(recovered).toBe(0);
    expect(store.getStatusCounts().completed).toBe(1);
  });

  it("survives DB file reopen — messages persist across store instances", () => {
    store.enqueue(mk("persist-1"));
    store.close();

    const reopened = new ChannelStore({ dbPath, useWal: false });
    const list = reopened.listForTerminal("terminal-A");
    expect(list).toHaveLength(1);
    expect(list[0].messageId).toBe("persist-1");
    reopened.close();
  });

  it("purgeCompleted removes old completed rows", async () => {
    store.enqueue(mk("old-done"));
    store.claimPendingFor("terminal-A");
    store.markDelivered("old-done");
    // Threshold 0 = everything completed is "old enough."
    const purged = store.purgeCompleted(0);
    expect(purged).toBe(1);
    expect(store.getStatusCounts().completed).toBe(0);
  });

  it("getStatusCounts returns all five lifecycle buckets", () => {
    const counts = store.getStatusCounts();
    expect(counts).toEqual({
      pending: 0,
      queued: 0,
      processing: 0,
      completed: 0,
      dead: 0,
    });
  });
});
