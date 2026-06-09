import { describe as group, it, expect } from "vitest";
import type { Faction, StarSystem, World } from "./world";
import {
  describe,
  EVENT_TYPES,
  factionFounded,
  worldColonized,
  conflict,
  resourceCrisis,
  firstContact,
  factionCollapsed,
  worldFortune,
  type FortuneKind,
  type ResourceKind,
} from "./events";

// --- Fixtures ----------------------------------------------------------------
// Minimal, hand-built domain objects. The event layer only reads id/name (and
// disposition), so we don't need a full generated sector here.

const helion: Faction = {
  id: "fac-0",
  name: "Helion Compact",
  homeSystemId: "sys-0",
  ownedWorldIds: ["sys-0-w0"],
  resources: { population: 100, energy: 60, materials: 60, influence: 20 },
  disposition: "expansionist",
};

const iron: Faction = {
  id: "fac-1",
  name: "Iron Dominion",
  homeSystemId: "sys-1",
  ownedWorldIds: ["sys-1-w0"],
  resources: { population: 90, energy: 50, materials: 70, influence: 15 },
  disposition: "militarist",
};

const vex: World = {
  id: "sys-2-w1",
  name: "Vex-9",
  systemId: "sys-2",
  habitability: 0.4,
  resourceRichness: 0.8,
  hazard: 0.3,
};

const aldebaran: StarSystem = {
  id: "sys-2",
  name: "Aldebaran",
  position: { x: 100, y: 200 },
  worldIds: ["sys-2-w0", "sys-2-w1"],
};

group("describe", () => {
  it("renders FACTION_FOUNDED with its home system", () => {
    const e = factionFounded(0, helion, aldebaran);
    expect(e.summary).toBe("The Helion Compact rose to power in the Aldebaran system.");
  });

  it("renders FACTION_FOUNDED without a location", () => {
    const e = factionFounded(0, helion);
    expect(e.summary).toBe("The Helion Compact rose to power.");
  });

  it("renders WORLD_COLONIZED", () => {
    const e = worldColonized(3, helion, vex);
    expect(e.summary).toBe("The Helion Compact colonized Vex-9.");
  });

  it("renders a CONFLICT the attacker wins", () => {
    const e = conflict(5, iron, helion, vex, true);
    expect(e.summary).toBe("The Iron Dominion seized Vex-9 from the Helion Compact.");
  });

  it("renders a CONFLICT the defender holds", () => {
    const e = conflict(5, iron, helion, vex, false);
    expect(e.summary).toBe(
      "The Helion Compact repelled the Iron Dominion's assault on Vex-9.",
    );
  });

  it("renders a RESOURCE_CRISIS per resource kind", () => {
    const kinds: ResourceKind[] = ["population", "energy", "materials", "influence"];
    for (const kind of kinds) {
      const e = resourceCrisis(7, helion, kind);
      expect(e.summary).toContain("Helion Compact");
      expect(e.summary).toMatch(/\.$/);
    }
    expect(resourceCrisis(7, helion, "population").summary).toBe(
      "Famine gripped the Helion Compact as its colonies starved.",
    );
  });

  it("renders FIRST_CONTACT with and without a location", () => {
    expect(firstContact(9, helion, iron, aldebaran).summary).toBe(
      "First contact between the Helion Compact and the Iron Dominion in the Aldebaran reach.",
    );
    expect(firstContact(9, helion, iron).summary).toBe(
      "First contact between the Helion Compact and the Iron Dominion.",
    );
  });

  it("renders FACTION_COLLAPSED", () => {
    const e = factionCollapsed(12, iron);
    expect(e.summary).toBe("The Iron Dominion collapsed, fading from the sector.");
  });

  it("renders WORLD_FORTUNE per fortune kind, naming the holder", () => {
    const kinds: FortuneKind[] = ["discovery", "depletion", "disaster"];
    for (const kind of kinds) {
      const e = worldFortune(8, helion, vex, kind);
      expect(e.summary).toContain("Vex-9");
      expect(e.summary).toContain("Helion Compact");
      expect(e.summary).toMatch(/\.$/);
    }
    expect(worldFortune(8, helion, vex, "discovery").summary).toBe(
      "Prospectors struck rich new deposits on Vex-9 held by the Helion Compact.",
    );
  });

  it("renders WORLD_FORTUNE without a holding faction", () => {
    const e = worldFortune(8, null, vex, "disaster");
    expect(e.actors).toEqual([]);
    expect(e.summary).toBe("Catastrophe swept Vex-9, scattering its people.");
  });

  it("produces a grammatical, non-empty sentence for every event type", () => {
    const samples = [
      factionFounded(0, helion, aldebaran),
      worldColonized(1, helion, vex),
      conflict(2, iron, helion, vex, true),
      resourceCrisis(3, helion, "energy"),
      firstContact(4, helion, iron, aldebaran),
      factionCollapsed(5, iron),
      worldFortune(6, helion, vex, "discovery"),
    ];
    // One sample per declared type, and each reads as a finished sentence.
    expect(new Set(samples.map((s) => s.type))).toEqual(new Set(EVENT_TYPES));
    for (const e of samples) {
      expect(e.summary.length).toBeGreaterThan(0);
      expect(e.summary[0]).toBe(e.summary[0].toUpperCase());
      expect(e.summary).toMatch(/\.$/);
    }
  });
});

group("event construction", () => {
  it("stamps summary equal to describe()", () => {
    const e = conflict(5, iron, helion, vex, true);
    expect(e.summary).toBe(describe(e));
  });

  it("carries the tick and denormalized actor/location refs", () => {
    const e = worldColonized(42, helion, vex);
    expect(e.tick).toBe(42);
    expect(e.actors).toEqual([{ id: "fac-0", name: "Helion Compact" }]);
    expect(e.location).toEqual({ id: "sys-2-w1", name: "Vex-9" });
  });

  it("orders conflict actors as [attacker, defender]", () => {
    const e = conflict(5, iron, helion, vex, false);
    expect(e.actors.map((a) => a.id)).toEqual(["fac-1", "fac-0"]);
    expect(e.data.captured).toBe(false);
  });

  it("keeps refs decoupled from the source entity", () => {
    const e = factionFounded(0, helion, aldebaran);
    // Mutating the event's ref must not reach back into the faction.
    e.actors[0].name = "Renamed";
    expect(helion.name).toBe("Helion Compact");
  });
});
