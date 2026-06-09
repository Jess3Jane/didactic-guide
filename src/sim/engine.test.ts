import { describe, it, expect } from "vitest";
import { createRng } from "./rng";
import { generateSector, type Sector } from "./world";
import { createEngine, type Engine } from "./engine";
import type { WorldEvent, WorldEventType } from "./events";

/** Build a sector + engine from a seed, mirroring how main.ts will wire it. */
function engineFromSeed(seed: string, options = {}): Engine {
  const sector = generateSector(createRng(seed), { seed, ...options });
  return createEngine(sector, createRng(seed));
}

/** Run an engine for N ticks and collect every event emitted. */
function run(engine: Engine, ticks: number): WorldEvent[] {
  const log: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) log.push(...engine.tick());
  return log;
}

/** Assert the sector is internally consistent: valid, non-negative, unambiguous. */
function expectValid(sector: Sector): void {
  const owners = new Map<string, string>();
  for (const faction of Object.values(sector.factions)) {
    for (const r of Object.values(faction.resources)) {
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
    }
    for (const wid of faction.ownedWorldIds) {
      // Every owned world exists...
      expect(sector.worlds[wid]).toBeDefined();
      // ...and is owned by exactly one faction (no duplicate ownership).
      expect(owners.has(wid)).toBe(false);
      owners.set(wid, faction.id);
    }
  }
}

describe("createEngine", () => {
  it("founds the starting roster at tick 0", () => {
    const engine = engineFromSeed("dawn");
    const factionCount = Object.keys(engine.sector.factions).length;
    expect(engine.foundingEvents).toHaveLength(factionCount);
    for (const e of engine.foundingEvents) {
      expect(e.type).toBe("FACTION_FOUNDED");
      expect(e.tick).toBe(0);
    }
    expect(engine.getTick()).toBe(0);
  });

  it("does not mutate the caller's sector", () => {
    const sector = generateSector(createRng("frozen"), { seed: "frozen" });
    const snapshot = structuredClone(sector);
    const engine = createEngine(sector, createRng("frozen"));
    run(engine, 25);
    expect(sector).toEqual(snapshot);
  });

  it("advances the cycle counter one per tick", () => {
    const engine = engineFromSeed("clock");
    engine.tick();
    engine.tick();
    expect(engine.getTick()).toBe(2);
  });
});

describe("determinism", () => {
  it("produces an identical event log for the same seed", () => {
    const a = run(engineFromSeed("helion"), 100);
    const b = run(engineFromSeed("helion"), 100);
    expect(a).toEqual(b);
  });

  it("produces identical world state for the same seed", () => {
    const a = engineFromSeed("helion");
    const b = engineFromSeed("helion");
    run(a, 100);
    run(b, 100);
    expect(a.sector).toEqual(b.sector);
  });

  it("diverges across different seeds", () => {
    const a = run(engineFromSeed("helion"), 100);
    const b = run(engineFromSeed("drift"), 100);
    expect(a).not.toEqual(b);
  });
});

describe("invariants over a long run", () => {
  it("keeps the world valid across many seeds", () => {
    for (let i = 0; i < 30; i++) {
      const engine = engineFromSeed(`run-${i}`);
      run(engine, 120);
      expectValid(engine.sector);
    }
  });

  it("never lets total owned worlds exceed the worlds that exist", () => {
    const engine = engineFromSeed("ledger");
    for (let i = 0; i < 120; i++) {
      engine.tick();
      const owned = Object.values(engine.sector.factions).reduce(
        (n, f) => n + f.ownedWorldIds.length,
        0,
      );
      expect(owned).toBeLessThanOrEqual(
        Object.keys(engine.sector.worlds).length,
      );
    }
  });

  it("leaves collapsed factions holding nothing", () => {
    const engine = engineFromSeed("twilight");
    const log = run(engine, 150);
    for (const e of log) {
      if (e.type === "FACTION_COLLAPSED") {
        const id = e.actors[0].id;
        expect(engine.sector.factions[id].ownedWorldIds).toHaveLength(0);
      }
    }
  });

  it("stamps every event with the cycle it occurred on", () => {
    const engine = engineFromSeed("chrono");
    let last = 0;
    for (let i = 0; i < 60; i++) {
      const events = engine.tick();
      for (const e of events) expect(e.tick).toBe(engine.getTick());
      // Ticks are monotonic, so event ticks never run backwards.
      for (const e of events) expect(e.tick).toBeGreaterThanOrEqual(last);
      if (events.length) last = events[events.length - 1].tick;
    }
  });
});

describe("emergence", () => {
  it("emits a variety of event types across seeds", () => {
    const seen = new Set<WorldEventType>();
    for (let i = 0; i < 25; i++) {
      for (const e of run(engineFromSeed(`story-${i}`), 120)) seen.add(e.type);
    }
    // A lively sector should colonize, clash, strain, and meet — not just sit.
    expect(seen.has("WORLD_COLONIZED")).toBe(true);
    expect(seen.has("CONFLICT")).toBe(true);
    expect(seen.has("FIRST_CONTACT")).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it("emits world-fortune dispatches as the environment drifts", () => {
    const seen = new Set<WorldEventType>();
    for (let i = 0; i < 10; i++) {
      for (const e of run(engineFromSeed(`fortune-${i}`), 120)) seen.add(e.type);
    }
    expect(seen.has("WORLD_FORTUNE")).toBe(true);
  });

  it("only contacts a given pair of factions once", () => {
    const log = run(engineFromSeed("acquaintance"), 150);
    const pairs = log
      .filter((e) => e.type === "FIRST_CONTACT")
      .map((e) =>
        e.actors
          .map((a) => a.id)
          .sort()
          .join("|"),
      );
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("sustaining the simulation (issue #19)", () => {
  /** The last cycle on which any event was emitted over `ticks` cycles. */
  const lastEventTick = (engine: Engine, ticks: number): number => {
    let last = 0;
    for (let t = 1; t <= ticks; t++) {
      if (engine.tick().length > 0) last = t;
    }
    return last;
  };

  it("keeps emitting events well past the sub-30s fizzle, across seeds", () => {
    // At 1x (~700ms/cycle) 30 seconds is roughly cycle 43. A sustained sector
    // should still be producing news long after that, not stalling at ~cycle 20.
    const THIRTY_SECONDS = 43;
    let sustained = 0;
    const SEEDS = 20;
    for (let i = 0; i < SEEDS; i++) {
      if (lastEventTick(engineFromSeed(`sustain-${i}`), 150) > THIRTY_SECONDS) {
        sustained++;
      }
    }
    // The median run (and then some) must outlast the old fizzle point.
    expect(sustained).toBeGreaterThan(SEEDS / 2);
  });

  it("produces a steady stream, not a front-loaded burst", () => {
    // Events should keep coming in the back half of a run, not only at the start.
    const engine = engineFromSeed("steady");
    run(engine, 60); // burn through the opening
    const later = run(engine, 60); // cycles 61–120
    expect(later.length).toBeGreaterThan(0);
  });

  it("yields visibly different trajectories across seeds", () => {
    // Different seeds should not converge on the same shape: compare the
    // surviving-faction count and total event volume across a sample.
    const shapes = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const engine = engineFromSeed(`diverge-${i}`);
      const events = run(engine, 150);
      const living = Object.values(engine.sector.factions).filter(
        (f) => f.ownedWorldIds.length > 0,
      ).length;
      // Bucket event volume coarsely so trivial jitter doesn't inflate variety.
      shapes.add(`${living}:${Math.floor(events.length / 25)}`);
    }
    expect(shapes.size).toBeGreaterThan(3);
  });
});
