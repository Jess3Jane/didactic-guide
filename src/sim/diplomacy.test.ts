// Inter-faction relations & diplomacy tests (issue #24).
//
// These exercise the political layer end-to-end: that a spread of diplomatic
// beats appears across a run, that a pact actually bars war between its parties
// until it is broken, that a betrayal breaks a standing pact in the act of
// striking, and that all of it — standings included — stays deterministic.

import { describe, it, expect } from "vitest";
import { createRng } from "./rng";
import { generateSector } from "./world";
import { createEngine, type Engine } from "./engine";
import type { DiplomacyKind, WorldEvent } from "./events";
import { stanceFor } from "./relations";

/** Build a sector + engine from a seed, mirroring how main.ts wires it. */
function engineFromSeed(seed: string): Engine {
  return createEngine(generateSector(createRng(seed), { seed }), createRng(seed));
}

/** Run an engine for N ticks and collect every event emitted. */
function run(engine: Engine, ticks: number): WorldEvent[] {
  const log: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) log.push(...engine.tick());
  return log;
}

/** Canonical, order-independent key for the pair an event concerns. */
function pairOf(e: WorldEvent): string {
  return e.actors
    .map((a) => a.id)
    .sort()
    .join("|");
}

describe("diplomacy across a run", () => {
  it("emits a varied spread of diplomatic beats across seeds", () => {
    const kinds = new Set<DiplomacyKind>();
    for (let i = 0; i < 40; i++) {
      for (const e of run(engineFromSeed(`politics-${i}`), 150)) {
        if (e.type === "DIPLOMACY") kinds.add(e.data.kind);
      }
    }
    // The sector should grow real political structure, not just one move: the
    // common beats — pacts/alliances, peace, trade, and coercion — all appear.
    expect(kinds.has("peace")).toBe(true);
    expect(kinds.has("trade")).toBe(true);
    expect(kinds.has("alliance")).toBe(true);
    expect(kinds.has("threat")).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });
});

describe("a pact gates who fights whom", () => {
  it("never lets a pact-bound pair clash while the pact holds", () => {
    // Replaying the log in emission order, a pair is "bound" once it strikes a
    // pact (or makes peace, or allies) and unbound only by a betrayal — which is
    // announced *before* the strike it opens. So a CONFLICT must never name a
    // pair that is bound at that moment.
    for (let i = 0; i < 20; i++) {
      const bound = new Set<string>();
      let sawBound = false;
      for (const e of run(engineFromSeed(`gate-${i}`), 200)) {
        if (e.type === "DIPLOMACY") {
          const key = pairOf(e);
          if (e.data.kind === "betrayal") {
            bound.delete(key);
          } else if (
            e.data.kind === "pact" ||
            e.data.kind === "alliance" ||
            e.data.kind === "peace"
          ) {
            bound.add(key);
            sawBound = true;
          }
        } else if (e.type === "CONFLICT") {
          expect(bound.has(pairOf(e))).toBe(false);
        }
      }
      // The seeds aren't vacuous: at least some did form binding pacts.
      if (sawBound) return;
    }
    throw new Error("expected at least one binding pact across the swept seeds");
  });
});

describe("betrayal", () => {
  it("breaks a standing pact in the very act of striking", () => {
    // Sweep for a betrayal, then prove its shape: the pair had struck a binding
    // pact beforehand, and a clash between them follows on the same cycle.
    for (let i = 0; i < 60; i++) {
      const log = run(engineFromSeed(`feud-${i}`), 120);
      for (let k = 0; k < log.length; k++) {
        const e = log[k];
        if (e.type !== "DIPLOMACY" || e.data.kind !== "betrayal") continue;
        const key = pairOf(e);

        // Faith existed to break: an earlier pact/alliance/peace bound the pair.
        const hadPact = log
          .slice(0, k)
          .some(
            (p) =>
              p.type === "DIPLOMACY" &&
              pairOf(p) === key &&
              (p.data.kind === "pact" ||
                p.data.kind === "alliance" ||
                p.data.kind === "peace"),
          );
        expect(hadPact).toBe(true);

        // And the betrayal opens an assault: a clash between the pair, same cycle.
        const clash = log.find(
          (c) => c.type === "CONFLICT" && c.tick === e.tick && pairOf(c) === key,
        );
        expect(clash).toBeDefined();
        expect(e.summary).toMatch(/pact|word|Treachery/);
        return;
      }
    }
    throw new Error("expected a betrayal across the swept seeds");
  });
});

describe("relations state", () => {
  it("exposes a stance consistent with each pair's standing and pact", () => {
    const engine = engineFromSeed("relations-snapshot");
    run(engine, 120);
    const relations = engine.getRelations();
    expect(relations.length).toBeGreaterThan(0);
    for (const r of relations) {
      // The reported stance is exactly what the pure model derives.
      expect(r.stance).toBe(stanceFor(r.standing, r.pact));
      // Pairs are canonically ordered, and standing stays within model bounds.
      expect(r.a < r.b).toBe(true);
      expect(r.standing).toBeGreaterThanOrEqual(-100);
      expect(r.standing).toBeLessThanOrEqual(100);
    }
  });

  it("reproduces identical relations for the same seed", () => {
    const a = engineFromSeed("mirror-pol");
    const b = engineFromSeed("mirror-pol");
    run(a, 150);
    run(b, 150);
    expect(a.getRelations()).toEqual(b.getRelations());
  });
});
