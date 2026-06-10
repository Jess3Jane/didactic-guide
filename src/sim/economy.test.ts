// Economic-static tests (issue #40 acceptance).
//
// The Phase 2 review found the long tail of every run was four event types on
// loop — discovery / depletion / disaster / trade were 76% of one calibration
// run, with the same two factions "striking a trade accord" 27+ times and the
// same worlds ping-ponging between boom and bust. These exercise the two
// memories that tame it: worlds rest between turns of fortune (and play out),
// and trade relationships progress instead of resetting — while routine
// commerce keeps moving resources quietly.

import { describe, it, expect } from "vitest";
import { createRng } from "./rng";
import { generateSector } from "./world";
import { createEngine, type Engine } from "./engine";
import type { WorldEvent } from "./events";

/** Build a sector + engine from a seed, mirroring how main.ts wires it. */
function engineFromSeed(seed: string): Engine {
  return createEngine(generateSector(createRng(seed), { seed }), createRng(seed));
}

/** Run an engine up to `ticks` cycles (stopping at a conclusion); full log. */
function run(engine: Engine, ticks: number): WorldEvent[] {
  const log: WorldEvent[] = [];
  for (let i = 0; i < ticks && engine.getStatus().kind === "ongoing"; i++) {
    log.push(...engine.tick());
  }
  return log;
}

const SEEDS = ["tinotol", "fecenuw", "cuxojos", "cal-1", "cal-4", "cal-8"];

describe("fortunes rest between turns (issue #40)", () => {
  it("never turns the same world's fortunes twice within the rest window", () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const lastTurn = new Map<string, number>();
      for (const e of run(engineFromSeed(seed), 400)) {
        if (e.type !== "WORLD_FORTUNE" || !e.location) continue;
        const prev = lastTurn.get(e.location.id);
        if (prev !== undefined) {
          // Mirrors FORTUNE.cooldown: a turn of fortune is an event in a
          // story, not one frame of a boom/bust strobe.
          expect(e.tick - prev, `seed ${seed}, world ${e.location.id}`)
            .toBeGreaterThanOrEqual(12);
        }
        lastTurn.set(e.location.id, e.tick);
      }
    }
  });

  it("counts each world's repeats of a fortune kind monotonically", () => {
    const log = run(engineFromSeed("boom-and-bust"), 400);
    const counts = new Map<string, number>();
    let sawRepeat = false;
    for (const e of log) {
      if (e.type !== "WORLD_FORTUNE" || !e.location) continue;
      const key = `${e.location.id}:${e.data.fortune}`;
      const expected = (counts.get(key) ?? 0) + 1;
      expect(e.data.recurrence).toBe(expected);
      counts.set(key, expected);
      if (expected >= 2) sawRepeat = true;
    }
    // The arc actually exercises its later beats, not just first finds.
    expect(sawRepeat).toBe(true);
  });

  it("ends a world's bust arc in exhaustion, then falls silent until re-lit", () => {
    // A played-out world must not keep depleting: after the exhaustion beat,
    // any further depletion there needs an intervening discovery to re-light it.
    let sawExhaustion = false;
    for (let i = 0; i < 12; i++) {
      const exhaustedWorlds = new Set<string>();
      for (const e of run(engineFromSeed(`econ-${i}`), 400)) {
        if (e.type !== "WORLD_FORTUNE" || !e.location) continue;
        const wid = e.location.id;
        if (e.data.fortune === "discovery") {
          exhaustedWorlds.delete(wid);
        } else if (e.data.fortune === "depletion") {
          expect(exhaustedWorlds.has(wid), `seed econ-${i}, world ${wid}`).toBe(false);
          if (e.data.exhausted) {
            sawExhaustion = true;
            // The terminal beat reads as an ending, not another routine bust.
            expect(e.summary).toMatch(/gave out|worked bare|exhaustion/);
            exhaustedWorlds.add(wid);
          }
        }
      }
    }
    expect(sawExhaustion).toBe(true);
  });
});

describe("trade with memory (issue #40)", () => {
  it("progresses each pair's accords instead of resetting them", () => {
    // Legal arcs per pair: a first accord (no trade memory), renewals counting
    // up, a deepening at the partnership threshold, then silence until a
    // lapse's resumption restarts the arc at 1. Never two "firsts", never a
    // renewal after the relationship has deepened.
    let sawDeepening = false;
    for (const seed of SEEDS) {
      const arc = new Map<string, number>(); // pair -> last accord count
      for (const e of run(engineFromSeed(seed), 400)) {
        if (e.type !== "DIPLOMACY" || e.data.kind !== "trade") continue;
        const key = e.actors.map((a) => a.id).sort().join("|");
        const prev = arc.get(key);
        const trade = e.data.trade;
        const label = `seed ${seed}, pair ${key}, cycle ${e.tick}`;
        if (trade === undefined) {
          // A bare accord is the pair's very first; it opens the arc.
          expect(prev, label).toBeUndefined();
          arc.set(key, 1);
          continue;
        }
        expect(prev, label).toBeDefined();
        if (trade.phase === "resumption") {
          expect(trade.count, label).toBe(1);
        } else if (trade.phase === "renewal") {
          expect(trade.count, label).toBe((prev ?? 0) + 1);
          expect(trade.count, label).toBeLessThan(4);
        } else {
          // Deepening: the accord that matures the pair into a partnership.
          expect(trade.count, label).toBe(4);
          sawDeepening = true;
        }
        arc.set(key, trade.count);
      }
    }
    expect(sawDeepening).toBe(true);
  });

  it("lets settled partnerships trade quietly instead of spamming the feed", () => {
    // The Phase 2 symptom: one pair "striking a trade accord" 27+ times. With
    // memory, a pair's dispatches are bounded by its arcs (4 per arc, and a
    // lapse-resumption between arcs), not by how often it actually trades.
    for (const seed of SEEDS) {
      const perPair = new Map<string, number>();
      for (const e of run(engineFromSeed(seed), 400)) {
        if (e.type !== "DIPLOMACY" || e.data.kind !== "trade") continue;
        const key = e.actors.map((a) => a.id).sort().join("|");
        perPair.set(key, (perPair.get(key) ?? 0) + 1);
      }
      for (const [pair, n] of perPair) {
        expect(n, `seed ${seed}, pair ${pair}`).toBeLessThanOrEqual(16);
      }
    }
  });
});

describe("the feed is no longer economic static (issue #40 acceptance)", () => {
  it("keeps any identical economic dispatch to a handful per 400-cycle run", () => {
    for (const seed of SEEDS) {
      const summaries = new Map<string, number>();
      for (const e of run(engineFromSeed(seed), 400)) {
        const economic =
          e.type === "WORLD_FORTUNE" ||
          (e.type === "DIPLOMACY" && e.data.kind === "trade");
        if (!economic) continue;
        summaries.set(e.summary, (summaries.get(e.summary) ?? 0) + 1);
      }
      for (const [line, n] of summaries) {
        expect(n, `seed ${seed}: "${line}"`).toBeLessThanOrEqual(5);
      }
    }
  });

  it("keeps economic events from dominating a 400-cycle run", () => {
    // The Phase 2 calibration run was 76% economic churn. Structural and
    // character events must now be findable without filtering.
    for (const seed of SEEDS) {
      const log = run(engineFromSeed(seed), 400);
      const economic = log.filter(
        (e) =>
          e.type === "WORLD_FORTUNE" ||
          (e.type === "DIPLOMACY" && e.data.kind === "trade"),
      );
      expect(
        economic.length / log.length,
        `seed ${seed}: ${economic.length}/${log.length} economic`,
      ).toBeLessThan(0.45);
    }
  });
});

describe("determinism", () => {
  it("reproduces identical economic memory for the same seed", () => {
    const a = run(engineFromSeed("ledger"), 400);
    const b = run(engineFromSeed("ledger"), 400);
    expect(a).toEqual(b);
  });
});
