import { describe, expect, it } from "vitest";

import {
  convertTagsToReadable,
  extractBracketTags,
  extractTeammateMentions,
  stripBracketTags,
} from "../src/domain/bracketMentions";

describe("extractBracketTags", () => {
  it("returns empty for text with no tags", () => {
    expect(extractBracketTags("hello world", "@")).toEqual([]);
  });

  it("extracts a single simple @mention", () => {
    const tags = extractBracketTags("[@alice: hi there]", "@");
    expect(tags).toHaveLength(1);
    expect(tags[0].id).toBe("alice");
    expect(tags[0].message).toBe("hi there");
    expect(tags[0].start).toBe(0);
    expect(tags[0].end).toBe(18);
  });

  it("handles nested brackets in the MESSAGE portion", () => {
    const tags = extractBracketTags("[@dev: fix arr[0] then arr[1]]", "@");
    expect(tags).toHaveLength(1);
    expect(tags[0].id).toBe("dev");
    expect(tags[0].message).toBe("fix arr[0] then arr[1]");
  });

  it("rejects tags with brackets in the ID portion", () => {
    // The `[inner]` before the colon makes the id invalid; parser skips it.
    const tags = extractBracketTags("[@bad[inner]: msg]", "@");
    expect(tags).toHaveLength(0);
  });

  it("rejects tags with no colon", () => {
    expect(extractBracketTags("[@alice no-colon message]", "@")).toHaveLength(0);
  });

  it("rejects tags with empty id", () => {
    expect(extractBracketTags("[@: empty id]", "@")).toHaveLength(0);
  });

  it("extracts multiple tags in source order", () => {
    const text = "Before [@a: first] middle [@b: second] end";
    const tags = extractBracketTags(text, "@");
    expect(tags).toHaveLength(2);
    expect(tags[0].id).toBe("a");
    expect(tags[0].message).toBe("first");
    expect(tags[1].id).toBe("b");
    expect(tags[1].message).toBe("second");
  });

  it("supports # prefix for chat-room tags", () => {
    const tags = extractBracketTags("[#team-red: broadcast]", "#");
    expect(tags).toHaveLength(1);
    expect(tags[0].id).toBe("team-red");
    expect(tags[0].message).toBe("broadcast");
  });

  it("ignores @ tags when prefix is # and vice versa", () => {
    const text = "[@alice: x] [#team: y]";
    expect(extractBracketTags(text, "@")).toHaveLength(1);
    expect(extractBracketTags(text, "#")).toHaveLength(1);
  });

  it("handles unclosed brackets gracefully (returns no tag)", () => {
    // No matching ] means the bracket depth never returns to 0, tag is dropped.
    expect(extractBracketTags("[@alice: missing closing", "@")).toHaveLength(0);
  });
});

describe("stripBracketTags", () => {
  it("returns original text when no tags", () => {
    expect(stripBracketTags("plain text", "@")).toBe("plain text");
  });

  it("removes a single tag", () => {
    expect(stripBracketTags("hello [@x: world]", "@")).toBe("hello");
  });

  it("removes multiple tags and preserves surrounding context", () => {
    const text = "context [@a: msg1] middle [@b: msg2] end";
    expect(stripBracketTags(text, "@")).toBe("context  middle  end");
  });
});

describe("extractTeammateMentions", () => {
  const validTargets = new Set(["alice", "bob", "charlie"]);
  const opts = {
    isValidTarget: (id: string) => validTargets.has(id),
    fromTerminalId: "alice",
  };

  it("returns empty for text with no tags", () => {
    expect(extractTeammateMentions("hello", opts)).toEqual([]);
  });

  it("extracts a validated mention (no shared context = direct message only)", () => {
    const r = extractTeammateMentions("[@bob: pls review]", opts);
    expect(r).toEqual([{ toTerminalId: "bob", message: "pls review" }]);
  });

  it("includes shared context when both prose and tag present", () => {
    const r = extractTeammateMentions("some framing [@bob: directed part]", opts);
    expect(r).toHaveLength(1);
    expect(r[0].message).toContain("some framing");
    expect(r[0].message).toContain("------");
    expect(r[0].message).toContain("Directed to you:\ndirected part");
  });

  it("suppresses self-mentions (sender mentioning themselves)", () => {
    const r = extractTeammateMentions("[@alice: nope]", opts);
    expect(r).toEqual([]);
  });

  it("suppresses unknown targets", () => {
    const r = extractTeammateMentions("[@unknown-agent: msg]", opts);
    expect(r).toEqual([]);
  });

  it("supports comma-separated fan-out", () => {
    const r = extractTeammateMentions("[@bob,charlie: team ping]", opts);
    expect(r).toHaveLength(2);
    expect(r.map((m) => m.toTerminalId).sort()).toEqual(["bob", "charlie"]);
  });

  it("dedupes repeated mentions (first occurrence wins)", () => {
    const r = extractTeammateMentions("[@bob: first] [@bob: second]", opts);
    expect(r).toHaveLength(1);
  });

  it("filters invalid candidates out of comma lists but keeps valid ones", () => {
    const r = extractTeammateMentions("[@bob,ghost: msg]", opts);
    expect(r).toHaveLength(1);
    expect(r[0].toTerminalId).toBe("bob");
  });

  it("can suppress shared-context prefix via option", () => {
    const r = extractTeammateMentions("prose [@bob: direct]", {
      ...opts,
      includeSharedContext: false,
    });
    expect(r[0].message).toBe("direct");
  });

  it("lowercases IDs for case-insensitive match", () => {
    const r = extractTeammateMentions("[@BOB: msg]", opts);
    expect(r).toHaveLength(1);
    expect(r[0].toTerminalId).toBe("bob");
  });
});

describe("convertTagsToReadable", () => {
  it("returns text unchanged when no tags", () => {
    expect(convertTagsToReadable("plain", "alice")).toBe("plain");
  });

  it("rewrites a single tag with from prefix", () => {
    expect(convertTagsToReadable("[@bob: msg]", "alice")).toBe("@alice → @bob: msg");
  });

  it("rewrites multiple tags", () => {
    const out = convertTagsToReadable("[@a: x] between [@b: y]", "sender");
    expect(out).toBe("@sender → @a: x between @sender → @b: y");
  });

  it("works without fromTerminalId (uses → prefix)", () => {
    expect(convertTagsToReadable("[@bob: msg]")).toBe("→ @bob: msg");
  });
});
