import { describe, expect, it } from "vitest";

import { retainActiveTentacleEntries, retainActiveTentacleIds } from "../src/app/tentacleState";

describe("tentacleState helpers", () => {
  it("retains active tentacle ids and preserves reference when unchanged", () => {
    const currentTentacleIds = ["tentacle-1", "tentacle-2"];
    const activeTentacleIds = new Set(["tentacle-1", "tentacle-2", "tentacle-3"]);

    const nextTentacleIds = retainActiveTentacleIds(currentTentacleIds, activeTentacleIds);

    expect(nextTentacleIds).toBe(currentTentacleIds);
  });

  it("filters removed tentacle ids", () => {
    const currentTentacleIds = ["tentacle-1", "tentacle-2"];
    const activeTentacleIds = new Set(["tentacle-2"]);

    const nextTentacleIds = retainActiveTentacleIds(currentTentacleIds, activeTentacleIds);

    expect(nextTentacleIds).toEqual(["tentacle-2"]);
  });

  it("retains active tentacle state entries and preserves reference when unchanged", () => {
    const currentState = {
      "tentacle-1": "idle",
      "tentacle-2": "processing",
    };
    const activeTentacleIds = new Set(["tentacle-1", "tentacle-2"]);

    const nextState = retainActiveTentacleEntries(currentState, activeTentacleIds);

    expect(nextState).toBe(currentState);
  });

  it("filters removed tentacle state entries", () => {
    const currentState = {
      "tentacle-1": "idle",
      "tentacle-2": "processing",
    };
    const activeTentacleIds = new Set(["tentacle-2"]);

    const nextState = retainActiveTentacleEntries(currentState, activeTentacleIds);

    expect(nextState).toEqual({
      "tentacle-2": "processing",
    });
  });
});
