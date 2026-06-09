// Unit tests for the pure relations model (issue #24).
//
// These pin the deterministic core — how a standing and a pact collapse into a
// single stance, and that standings stay within bounds. The stateful evolution
// of relations across a run is exercised end-to-end in `diplomacy.test.ts`.

import { describe, it, expect } from "vitest";
import {
  RELATION,
  stanceFor,
  clampStanding,
  pactBarsWar,
  type PactKind,
} from "./relations";

describe("stanceFor", () => {
  it("lets a pact override sentiment outright", () => {
    // Even a hateful standing reads as peace/alliance while the pact holds —
    // the binding, not the mood, is what bars war.
    expect(stanceFor(RELATION.min, "alliance")).toBe("allied");
    expect(stanceFor(RELATION.min, "nonaggression")).toBe("atPeace");
    expect(stanceFor(RELATION.max, "nonaggression")).toBe("atPeace");
  });

  it("reads an un-pacted pair from its standing band", () => {
    expect(stanceFor(RELATION.rivalryAt)).toBe("rivalry");
    expect(stanceFor(RELATION.rivalryAt - 50)).toBe("rivalry");
    expect(stanceFor(RELATION.rivalryAt + 1)).toBe("neutral");
    expect(stanceFor(0)).toBe("neutral");
    expect(stanceFor(RELATION.max)).toBe("neutral");
  });
});

describe("clampStanding", () => {
  it("holds standings within the model's range", () => {
    expect(clampStanding(RELATION.max + 100)).toBe(RELATION.max);
    expect(clampStanding(RELATION.min - 100)).toBe(RELATION.min);
  });

  it("rounds to an integer for tidy, stable values", () => {
    expect(clampStanding(12.4)).toBe(12);
    expect(clampStanding(-12.6)).toBe(-13);
  });
});

describe("pactBarsWar", () => {
  it("treats either pact as a bar to war, and no pact as open", () => {
    const pacts: PactKind[] = ["nonaggression", "alliance"];
    for (const p of pacts) expect(pactBarsWar(p)).toBe(true);
    expect(pactBarsWar(undefined)).toBe(false);
  });
});
