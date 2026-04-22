import { describe, expect, it } from "vitest";

import {
  detectCycle,
  findUnresolvedNeeds,
  parseTodoNeeds,
  topologicalOrder,
} from "../src/domain/todoNeeds";

describe("parseTodoNeeds", () => {
  it("returns the clean text unchanged when no needs annotation", () => {
    expect(parseTodoNeeds("Build the thing")).toEqual({
      cleanText: "Build the thing",
      needs: [],
    });
  });

  it("extracts a single dependency", () => {
    expect(parseTodoNeeds("Wire UI (needs: api)")).toEqual({
      cleanText: "Wire UI",
      needs: ["api"],
    });
  });

  it("extracts multiple dependencies", () => {
    expect(parseTodoNeeds("Write tests (needs: api, ui, auth)")).toEqual({
      cleanText: "Write tests",
      needs: ["api", "ui", "auth"],
    });
  });

  it("lowercases and trims dependency ids", () => {
    expect(parseTodoNeeds("X (needs:  API , UI  )").needs).toEqual(["api", "ui"]);
  });

  it("handles the annotation in the middle of text", () => {
    expect(parseTodoNeeds("First part (needs: x) then second part")).toEqual({
      cleanText: "First part then second part",
      needs: ["x"],
    });
  });

  it("matches case-insensitively on the `needs:` keyword", () => {
    expect(parseTodoNeeds("X (NEEDS: foo)").needs).toEqual(["foo"]);
    expect(parseTodoNeeds("X (Needs: foo)").needs).toEqual(["foo"]);
  });

  it("ignores text that mentions 'needs' but not in the bracket pattern", () => {
    expect(parseTodoNeeds("This needs more work").needs).toEqual([]);
  });

  it("handles empty needs list gracefully", () => {
    expect(parseTodoNeeds("X (needs: )").needs).toEqual([]);
  });
});

describe("detectCycle", () => {
  it("returns null for an empty graph", () => {
    expect(detectCycle([])).toBeNull();
  });

  it("returns null for a linear chain a → b → c", () => {
    expect(
      detectCycle([
        { id: "a", needs: [] },
        { id: "b", needs: ["a"] },
        { id: "c", needs: ["b"] },
      ]),
    ).toBeNull();
  });

  it("returns null for a diamond a → b → d, a → c → d", () => {
    expect(
      detectCycle([
        { id: "a", needs: [] },
        { id: "b", needs: ["a"] },
        { id: "c", needs: ["a"] },
        { id: "d", needs: ["b", "c"] },
      ]),
    ).toBeNull();
  });

  it("detects a direct cycle a → b → a", () => {
    const cycle = detectCycle([
      { id: "a", needs: ["b"] },
      { id: "b", needs: ["a"] },
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain("a");
    expect(cycle).toContain("b");
  });

  it("detects a self-loop a → a", () => {
    const cycle = detectCycle([{ id: "a", needs: ["a"] }]);
    expect(cycle).toEqual(["a", "a"]);
  });

  it("detects a 3-node cycle", () => {
    const cycle = detectCycle([
      { id: "a", needs: ["c"] },
      { id: "b", needs: ["a"] },
      { id: "c", needs: ["b"] },
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(3);
  });
});

describe("findUnresolvedNeeds", () => {
  it("returns empty for a complete graph", () => {
    expect(
      findUnresolvedNeeds([
        { id: "a", needs: [] },
        { id: "b", needs: ["a"] },
      ]),
    ).toEqual([]);
  });

  it("finds references to unknown nodes", () => {
    const unresolved = findUnresolvedNeeds([
      { id: "a", needs: [] },
      { id: "b", needs: ["a", "ghost"] },
    ]);
    expect(unresolved).toEqual([{ from: "b", missing: "ghost" }]);
  });

  it("reports multiple unresolveds", () => {
    const unresolved = findUnresolvedNeeds([
      { id: "a", needs: ["ghost1", "ghost2"] },
    ]);
    expect(unresolved).toHaveLength(2);
  });
});

describe("topologicalOrder", () => {
  it("handles an empty graph", () => {
    expect(topologicalOrder([])).toEqual([]);
  });

  it("orders a linear chain", () => {
    expect(
      topologicalOrder([
        { id: "c", needs: ["b"] },
        { id: "a", needs: [] },
        { id: "b", needs: ["a"] },
      ]),
    ).toEqual(["a", "b", "c"]);
  });

  it("orders a diamond with deterministic sibling order", () => {
    const order = topologicalOrder([
      { id: "d", needs: ["b", "c"] },
      { id: "a", needs: [] },
      { id: "b", needs: ["a"] },
      { id: "c", needs: ["a"] },
    ]);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
  });

  it("throws on a cyclic graph", () => {
    expect(() =>
      topologicalOrder([
        { id: "a", needs: ["b"] },
        { id: "b", needs: ["a"] },
      ]),
    ).toThrow(/cycle/i);
  });

  it("ignores unresolved references (they're caller's problem)", () => {
    // a depends on "ghost" which doesn't exist in the node list.
    // topologicalOrder should still place a at the root (no known deps).
    const order = topologicalOrder([
      { id: "a", needs: ["ghost"] },
      { id: "b", needs: ["a"] },
    ]);
    expect(order).toEqual(["a", "b"]);
  });
});
