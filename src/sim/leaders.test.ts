// Named-leaders tests (issue #23).
//
// These exercise leaders end-to-end: that every faction starts under a named
// leader, that leadership turns over across a run with legible transitions, that
// dispatches attribute action to people, and that the whole cast stays
// deterministic — a seed reproduces the same leaders and the same successions.

import { describe, it, expect } from "vitest";
import { createRng } from "./rng";
import { generateSector, generateLeader, type LeaderTrait } from "./world";
import { createEngine, type Engine } from "./engine";
import type { WorldEvent } from "./events";

/** Build a sector + engine from a seed, mirroring how main.ts wires it. */
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

const TRAITS: readonly LeaderTrait[] = ["ambitious", "ruthless", "cautious", "stoic"];

describe("generateLeader", () => {
  it("is deterministic for the same rng draw position", () => {
    const a = generateLeader(createRng("cast"), "militarist", 0);
    const b = generateLeader(createRng("cast"), "militarist", 0);
    expect(a).toEqual(b);
  });

  it("produces a two-part name, a fitting title, and a valid trait", () => {
    const leader = generateLeader(createRng("admiral"), "militarist", 4);
    const parts = leader.name.split(" ");
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.length > 0)).toBe(true);
    // Militarist titles are martial.
    expect(["Warlord", "Admiral", "Marshal", "General"]).toContain(leader.title);
    expect(TRAITS).toContain(leader.trait);
    expect(leader.since).toBe(4);
  });

  it("draws titles suited to each disposition", () => {
    // Sample enough that every title in a pool is hit, then check it stayed in-pool.
    const pools = {
      expansionist: ["Prefect", "Pioneer", "Envoy", "Pathfinder"],
      industrious: ["Director", "Chancellor", "Overseer", "Architect"],
      isolationist: ["Warden", "Elder", "Custodian", "Steward"],
    } as const;
    for (const [disposition, pool] of Object.entries(pools)) {
      const rng = createRng(`titles-${disposition}`);
      for (let i = 0; i < 30; i++) {
        const leader = generateLeader(rng, disposition as keyof typeof pools, 0);
        expect(pool).toContain(leader.title);
      }
    }
  });
});

describe("founding leaders", () => {
  it("seats every faction under a named leader at cycle 0", () => {
    const sector = generateSector(createRng("dawn"), { seed: "dawn" });
    for (const faction of Object.values(sector.factions)) {
      expect(faction.leader.name.length).toBeGreaterThan(0);
      expect(faction.leader.title.length).toBeGreaterThan(0);
      expect(faction.leader.since).toBe(0);
      expect(TRAITS).toContain(faction.leader.trait);
    }
  });

  it("names the founding leader in the opening dispatches", () => {
    const engine = engineFromSeed("debut");
    for (const e of engine.foundingEvents) {
      expect(e.type).toBe("FACTION_FOUNDED");
      const leader = engine.sector.factions[e.actors[0].id].leader;
      expect(e.summary).toContain(leader.name);
    }
  });
});

describe("leadership turnover", () => {
  it("turns leadership over with legible transitions across a run", () => {
    let changes = 0;
    const reasons = new Set<string>();
    for (let i = 0; i < 20; i++) {
      for (const e of run(engineFromSeed(`reign-${i}`), 200)) {
        if (e.type !== "LEADERSHIP_CHANGE") continue;
        changes++;
        reasons.add(e.data.reason);
        // A transition names both the outgoing and incoming leaders.
        expect(e.summary).toContain(e.data.predecessor.name);
        expect(e.summary).toContain(e.data.successor.name);
        expect(e.data.predecessor.name).not.toBe(e.data.successor.name);
        expect(e.data.tenure).toBeGreaterThanOrEqual(0);
      }
    }
    expect(changes).toBeGreaterThan(0);
    // The chronicle should show more than one kind of upheaval over many runs.
    expect(reasons.size).toBeGreaterThanOrEqual(2);
  });

  it("installs the successor as the faction's sitting leader", () => {
    const engine = engineFromSeed("succession");
    const seenSince = new Map<string, number>();
    for (let t = 1; t <= 200; t++) {
      for (const e of engine.tick()) {
        if (e.type !== "LEADERSHIP_CHANGE") continue;
        const faction = engine.sector.factions[e.actors[0].id];
        // The live leader matches the dispatch's named successor, dated to now.
        expect(faction.leader.name).toBe(e.data.successor.name);
        expect(faction.leader.since).toBe(t);
        // Tenure is the gap since this faction's previous installation.
        const prev = seenSince.get(faction.id) ?? 0;
        expect(e.data.tenure).toBe(t - prev);
        seenSince.set(faction.id, t);
      }
    }
  });

  it("stays an occasional beat, not a churn", () => {
    // Leadership changes should be far rarer than the conflicts/colonisation that
    // drive the history — a handful per run, not dozens.
    let leadership = 0;
    let other = 0;
    for (let i = 0; i < 10; i++) {
      for (const e of run(engineFromSeed(`cadence-${i}`), 150)) {
        if (e.type === "LEADERSHIP_CHANGE") leadership++;
        else if (e.type === "WORLD_COLONIZED" || e.type === "CONFLICT") other++;
      }
    }
    expect(leadership).toBeGreaterThan(0);
    expect(leadership).toBeLessThan(other);
  });
});

describe("determinism", () => {
  it("reproduces the same cast and successions for a seed", () => {
    const a = run(engineFromSeed("lineage"), 200).filter(
      (e) => e.type === "LEADERSHIP_CHANGE",
    );
    const b = run(engineFromSeed("lineage"), 200).filter(
      (e) => e.type === "LEADERSHIP_CHANGE",
    );
    expect(a).toEqual(b);
    // And at least one change actually occurred, so this isn't vacuously true.
    expect(a.length).toBeGreaterThan(0);
  });
});
