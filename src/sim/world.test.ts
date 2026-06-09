import { describe, it, expect } from "vitest";
import { createRng } from "./rng";
import {
  generateSector,
  systemNeighbors,
  ownerOf,
  type Sector,
} from "./world";

/** Build a sector from a seed using the standard RNG, for terse test setup. */
function sectorFromSeed(seed: string, options = {}): Sector {
  return generateSector(createRng(seed), { seed, ...options });
}

/** BFS the jump-lane graph and report whether every system is reachable. */
function isConnected(sector: Sector): boolean {
  const ids = Object.keys(sector.systems);
  if (ids.length === 0) return true;
  const seen = new Set<string>([ids[0]]);
  const queue = [ids[0]];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of systemNeighbors(sector, cur)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size === ids.length;
}

describe("generateSector", () => {
  it("is deterministic for a given seed", () => {
    const a = sectorFromSeed("helion");
    const b = sectorFromSeed("helion");
    expect(a).toEqual(b);
  });

  it("diverges for different seeds", () => {
    const a = sectorFromSeed("helion");
    const b = sectorFromSeed("drift");
    expect(a).not.toEqual(b);
  });

  it("honours the requested system and faction counts", () => {
    const sector = sectorFromSeed("counts", {
      systemCount: 12,
      factionCount: 3,
    });
    expect(Object.keys(sector.systems)).toHaveLength(12);
    expect(Object.keys(sector.factions)).toHaveLength(3);
  });

  it("produces a connected system graph", () => {
    // Many seeds, since connectivity depends on generated geometry.
    for (let i = 0; i < 50; i++) {
      const sector = sectorFromSeed(`graph-${i}`);
      expect(isConnected(sector)).toBe(true);
    }
  });

  it("has no duplicate or self jump lanes", () => {
    const sector = sectorFromSeed("lanes");
    const keys = new Set<string>();
    for (const [a, b] of sector.lanes) {
      expect(a).not.toBe(b);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
  });

  it("gives every system at least one world, all back-referenced", () => {
    const sector = sectorFromSeed("worlds");
    for (const system of Object.values(sector.systems)) {
      expect(system.worldIds.length).toBeGreaterThanOrEqual(1);
      for (const wid of system.worldIds) {
        const world = sector.worlds[wid];
        expect(world).toBeDefined();
        expect(world.systemId).toBe(system.id);
      }
    }
  });

  it("keeps world traits within [0, 1]", () => {
    const sector = sectorFromSeed("traits");
    for (const world of Object.values(sector.worlds)) {
      for (const t of [
        world.habitability,
        world.resourceRichness,
        world.hazard,
      ]) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    }
  });

  it("seats factions in distinct systems, each owning an existing world", () => {
    const sector = sectorFromSeed("factions");
    const homes = new Set<string>();
    for (const faction of Object.values(sector.factions)) {
      expect(sector.systems[faction.homeSystemId]).toBeDefined();
      expect(homes.has(faction.homeSystemId)).toBe(false);
      homes.add(faction.homeSystemId);

      expect(faction.ownedWorldIds.length).toBeGreaterThanOrEqual(1);
      for (const wid of faction.ownedWorldIds) {
        const world = sector.worlds[wid];
        expect(world).toBeDefined();
        expect(world.systemId).toBe(faction.homeSystemId);
      }
    }
  });

  it("starts factions with positive resource stockpiles", () => {
    const sector = sectorFromSeed("resources");
    for (const faction of Object.values(sector.factions)) {
      const { population, energy, materials, influence } = faction.resources;
      for (const r of [population, energy, materials, influence]) {
        expect(r).toBeGreaterThan(0);
      }
    }
  });

  it("gives systems and worlds unique ids and readable names", () => {
    const sector = sectorFromSeed("names");
    const ids = Object.keys(sector.systems);
    expect(new Set(ids).size).toBe(ids.length);
    for (const system of Object.values(sector.systems)) {
      expect(system.name.length).toBeGreaterThan(0);
    }
    for (const world of Object.values(sector.worlds)) {
      expect(world.name.length).toBeGreaterThan(0);
    }
  });

  it("clamps degenerate options without throwing", () => {
    // factionCount can't exceed systemCount; both have sane floors.
    const sector = sectorFromSeed("tiny", { systemCount: 2, factionCount: 9 });
    expect(Object.keys(sector.systems)).toHaveLength(2);
    expect(Object.keys(sector.factions).length).toBeLessThanOrEqual(2);
  });
});

describe("systemNeighbors", () => {
  it("is symmetric across every lane", () => {
    const sector = sectorFromSeed("neighbors");
    for (const [a, b] of sector.lanes) {
      expect(systemNeighbors(sector, a)).toContain(b);
      expect(systemNeighbors(sector, b)).toContain(a);
    }
  });
});

describe("ownerOf", () => {
  it("resolves owned worlds to their faction and unclaimed worlds to null", () => {
    const sector = sectorFromSeed("ownership");
    const faction = Object.values(sector.factions)[0];
    const ownedId = faction.ownedWorldIds[0];
    expect(ownerOf(sector, ownedId)?.id).toBe(faction.id);

    const allOwned = new Set(
      Object.values(sector.factions).flatMap((f) => f.ownedWorldIds),
    );
    const unclaimed = Object.keys(sector.worlds).find((id) => !allOwned.has(id));
    if (unclaimed) {
      expect(ownerOf(sector, unclaimed)).toBeNull();
    }
  });
});
