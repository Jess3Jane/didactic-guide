import { describe as group, it, expect } from "vitest";
import type { Faction, StarSystem, World } from "./world";
import {
  describe,
  EVENT_TYPES,
  factionFounded,
  factionSeceded,
  worldColonized,
  worldAbandoned,
  conflict,
  resourceCrisis,
  firstContact,
  factionCollapsed,
  worldFortune,
  leadershipChange,
  diplomacy,
  warDeclared,
  warEnded,
  factionDoctrine,
  sectorConcluded,
  type DiplomacyKind,
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
  leader: { name: "Veyra Tolan", title: "Prefect", trait: "ambitious", since: 0 },
};

const iron: Faction = {
  id: "fac-1",
  name: "Iron Dominion",
  homeSystemId: "sys-1",
  ownedWorldIds: ["sys-1-w0"],
  resources: { population: 90, energy: 50, materials: 70, influence: 15 },
  disposition: "militarist",
  leader: { name: "Castor Vane", title: "Admiral", trait: "ruthless", since: 0 },
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

/** A dispatch reads as a finished sentence: capitalised and end-punctuated. */
function isGrammatical(s: string): boolean {
  return (
    s.length > 0 && s[0] === s[0].toUpperCase() && /[.!?]$/.test(s.trim())
  );
}

group("describe", () => {
  it("renders FACTION_FOUNDED, with and without a home system", () => {
    const sited = factionFounded(0, helion, aldebaran);
    expect(sited.summary).toContain("Helion Compact");
    expect(sited.summary).toContain("Aldebaran system");
    expect(isGrammatical(sited.summary)).toBe(true);

    const placeless = factionFounded(0, helion);
    expect(placeless.summary).toContain("Helion Compact");
    expect(placeless.summary).not.toContain("system");
    expect(isGrammatical(placeless.summary)).toBe(true);
  });

  it("renders WORLD_COLONIZED naming faction and world", () => {
    const e = worldColonized(3, helion, vex);
    expect(e.summary).toContain("Helion Compact");
    expect(e.summary).toContain("Vex-9");
    expect(isGrammatical(e.summary)).toBe(true);
  });

  it("renders a CONFLICT the attacker wins", () => {
    const e = conflict(5, iron, helion, vex, true);
    // Capture phrasings all name attacker, defender, and the prize.
    expect(e.summary).toContain("Iron Dominion");
    expect(e.summary).toContain("Helion Compact");
    expect(e.summary).toContain("Vex-9");
    expect(isGrammatical(e.summary)).toBe(true);
  });

  it("renders a CONFLICT the defender holds", () => {
    const e = conflict(5, iron, helion, vex, false);
    expect(e.summary).toContain("Iron Dominion");
    expect(e.summary).toContain("Helion Compact");
    expect(e.summary).toContain("Vex-9");
    expect(isGrammatical(e.summary)).toBe(true);
  });

  it("renders a RESOURCE_CRISIS per resource kind", () => {
    const kinds: ResourceKind[] = ["population", "energy", "materials", "influence"];
    for (const kind of kinds) {
      const e = resourceCrisis(7, helion, kind);
      expect(e.summary).toContain("Helion Compact");
      expect(isGrammatical(e.summary)).toBe(true);
    }
    // Each stockpile reads in its own register, not a generic "resource crisis".
    expect(resourceCrisis(7, helion, "population").summary).toMatch(/famine|starv/i);
    expect(resourceCrisis(7, helion, "energy").summary).toMatch(/reactor|power|energy|dark/i);
  });

  it("renders FIRST_CONTACT with and without a location", () => {
    const sited = firstContact(9, helion, iron, aldebaran);
    expect(sited.summary).toContain("Helion Compact");
    expect(sited.summary).toContain("Iron Dominion");
    expect(sited.summary).toContain("Aldebaran reach");
    expect(isGrammatical(sited.summary)).toBe(true);

    const placeless = firstContact(9, helion, iron);
    expect(placeless.summary).toContain("Helion Compact");
    expect(placeless.summary).toContain("Iron Dominion");
    expect(placeless.summary).not.toContain("reach");
    expect(isGrammatical(placeless.summary)).toBe(true);
  });

  it("renders FACTION_COLLAPSED", () => {
    const e = factionCollapsed(12, iron);
    expect(e.summary).toContain("Iron Dominion");
    expect(isGrammatical(e.summary)).toBe(true);
  });

  it("renders WORLD_FORTUNE per fortune kind, naming the holder", () => {
    const kinds: FortuneKind[] = ["discovery", "depletion", "disaster"];
    for (const kind of kinds) {
      const e = worldFortune(8, helion, vex, kind);
      expect(e.summary).toContain("Vex-9");
      expect(e.summary).toContain("Helion Compact");
      expect(isGrammatical(e.summary)).toBe(true);
    }
  });

  it("renders WORLD_FORTUNE without a holding faction", () => {
    const e = worldFortune(8, null, vex, "disaster");
    expect(e.actors).toEqual([]);
    expect(e.summary).toContain("Vex-9");
    expect(e.summary).not.toContain("held by");
    expect(isGrammatical(e.summary)).toBe(true);
  });

  it("renders DIPLOMACY per kind, naming both parties", () => {
    const kinds: DiplomacyKind[] = [
      "pact",
      "alliance",
      "peace",
      "trade",
      "threat",
      "betrayal",
      "renounce",
    ];
    for (const kind of kinds) {
      const e = diplomacy(10, kind, helion, iron, aldebaran);
      expect(e.actors).toEqual([
        { id: "fac-0", name: "Helion Compact" },
        { id: "fac-1", name: "Iron Dominion" },
      ]);
      expect(e.data.kind).toBe(kind);
      expect(e.summary).toContain("Helion Compact");
      expect(e.summary).toContain("Iron Dominion");
      expect(isGrammatical(e.summary)).toBe(true);
    }
  });

  it("renders WORLD_ABANDONED naming faction and world", () => {
    const e = worldAbandoned(15, helion, vex);
    expect(e.actors).toEqual([{ id: "fac-0", name: "Helion Compact" }]);
    expect(e.location).toEqual({ id: "sys-2-w1", name: "Vex-9" });
    expect(e.summary).toContain("Helion Compact");
    expect(e.summary).toContain("Vex-9");
    expect(isGrammatical(e.summary)).toBe(true);
  });

  it("renders FACTION_SECEDED naming rebel, parent, leader, and scale", () => {
    const rebel: Faction = {
      id: "fac-2",
      name: "Sundered Accord",
      homeSystemId: "sys-2",
      ownedWorldIds: ["sys-2-w0", "sys-2-w1"],
      resources: { population: 40, energy: 20, materials: 20, influence: 8 },
      disposition: "militarist",
      leader: { name: "Orla Vex", title: "Marshal", trait: "ambitious", since: 18 },
    };
    const e = factionSeceded(18, rebel, helion, aldebaran);
    expect(e.actors.map((a) => a.id)).toEqual(["fac-2", "fac-0"]);
    expect(e.data.worlds).toBe(2);
    expect(e.summary).toContain("Sundered Accord");
    expect(e.summary).toContain("Helion Compact");
    expect(e.summary).toContain("Marshal Orla Vex");
    expect(e.summary).toContain("2 outlying worlds");
    expect(isGrammatical(e.summary)).toBe(true);

    // A single seceding world reads in the singular.
    const lone = factionSeceded(18, rebel, helion, aldebaran, 1);
    expect(lone.summary).toContain("an outlying world");
  });

  it("renders SECTOR_CONCLUDED, naming the victor when unified", () => {
    const unified = sectorConcluded(40, "unified", helion);
    expect(unified.actors).toEqual([{ id: "fac-0", name: "Helion Compact" }]);
    expect(unified.summary).toContain("Helion Compact");
    expect(isGrammatical(unified.summary)).toBe(true);

    const dark = sectorConcluded(40, "dark");
    expect(dark.actors).toEqual([]);
    expect(dark.summary).toContain("sector");
    expect(dark.summary).not.toContain("Helion");
    expect(isGrammatical(dark.summary)).toBe(true);
  });

  it("produces a grammatical, non-empty sentence for every event type", () => {
    const samples = [
      factionFounded(0, helion, aldebaran),
      factionSeceded(10, iron, helion, aldebaran),
      worldColonized(1, helion, vex),
      worldAbandoned(2, helion, vex),
      conflict(2, iron, helion, vex, true),
      resourceCrisis(3, helion, "energy"),
      firstContact(4, helion, iron, aldebaran),
      factionCollapsed(5, iron),
      worldFortune(6, helion, vex, "discovery"),
      leadershipChange(
        7,
        helion,
        "succession",
        { name: "Sarn Okonro", title: "Pioneer", trait: "stoic", since: 0 },
        7,
      ),
      diplomacy(8, "alliance", helion, iron, aldebaran),
      warDeclared(8, iron, helion, aldebaran),
      warEnded(9, iron, helion, "conquest", 3, 4),
      factionDoctrine(9, helion, "hegemonic", aldebaran),
      sectorConcluded(8, "unified", helion),
    ];
    // One sample per declared type, and each reads as a finished sentence.
    expect(new Set(samples.map((s) => s.type))).toEqual(new Set(EVENT_TYPES));
    for (const e of samples) {
      expect(isGrammatical(e.summary)).toBe(true);
    }
  });
});

group("prose variety (issue #21)", () => {
  // The Phase 1 chronicle had one template per type and read like a log file.
  // Each type should now phrase the same kind of event several ways across a
  // run, while staying fully deterministic.

  it("is deterministic: equal events render identically", () => {
    // Same constructor args ⇒ same summary, every time (seed reproduces prose).
    expect(worldColonized(3, helion, vex).summary).toBe(
      worldColonized(3, helion, vex).summary,
    );
    expect(conflict(5, iron, helion, vex, true).summary).toBe(
      conflict(5, iron, helion, vex, true).summary,
    );
    // describe() over the same event object is stable too.
    const e = resourceCrisis(7, helion, "energy");
    expect(describe(e)).toBe(describe(e));
    expect(describe(e)).toBe(e.summary);
  });

  it("spreads a repeated event type across multiple phrasings", () => {
    // A long run colonises many worlds; the wording should vary cycle to cycle.
    const lines = new Set(
      Array.from({ length: 30 }, (_, t) => worldColonized(t, helion, vex).summary),
    );
    expect(lines.size).toBeGreaterThan(1);

    const crises = new Set(
      Array.from(
        { length: 30 },
        (_, t) => resourceCrisis(t, helion, "population").summary,
      ),
    );
    expect(crises.size).toBeGreaterThan(1);

    const clashes = new Set(
      Array.from({ length: 30 }, (_, t) => conflict(t, iron, helion, vex, true).summary),
    );
    expect(clashes.size).toBeGreaterThan(1);
  });

  it("keeps every variant grammatical and on-topic", () => {
    // Sweep many cycles so the hash visits each phrasing, and check they all
    // hold the line: capitalised, punctuated, and still naming the entities.
    for (let t = 0; t < 50; t++) {
      const c = conflict(t, iron, helion, vex, true);
      expect(isGrammatical(c.summary)).toBe(true);
      expect(c.summary).toContain("Vex-9");

      const repelled = conflict(t, iron, helion, vex, false);
      expect(isGrammatical(repelled.summary)).toBe(true);
      expect(repelled.summary).toContain("Vex-9");

      const fortune = worldFortune(t, helion, vex, "disaster");
      expect(isGrammatical(fortune.summary)).toBe(true);
      expect(fortune.summary).toContain("Vex-9");
    }
  });
});

group("narrative continuity (issue #20)", () => {
  it("frames a continuing clash as one ongoing war", () => {
    const fourth = conflict(20, iron, helion, vex, true, { clash: 4, since: 10 });
    expect(fourth.summary).toContain(
      "the fourth clash of a war raging since cycle 10",
    );
    const held = conflict(22, iron, helion, vex, false, { clash: 5, since: 10 });
    expect(held.summary).toContain(
      "the fifth clash of a war raging since cycle 10",
    );
  });

  it("leaves the opening clash of a war unadorned", () => {
    const opener = conflict(10, iron, helion, vex, true, { clash: 1, since: 10 });
    expect(opener.summary).not.toContain("clash of a war");
    // A clash with no campaign context likewise carries no war tail.
    expect(conflict(10, iron, helion, vex, true).summary).not.toContain(
      "clash of a war",
    );
  });

  it("numbers a recurring crisis in the prose", () => {
    const third = resourceCrisis(30, helion, "population", 3);
    expect(third.summary).toContain("third");
    expect(third.summary).toContain("Helion Compact");
    // The first occurrence is not numbered.
    expect(resourceCrisis(7, helion, "population", 1).summary).not.toContain(
      "third",
    );
  });

  it("numbers a world's repeated fortunes in the prose (issue #40)", () => {
    const third = worldFortune(60, helion, vex, "depletion", 3);
    expect(third.data.recurrence).toBe(3);
    expect(third.summary).toContain("third");
    expect(third.summary).toContain("Vex-9");
    expect(isGrammatical(third.summary)).toBe(true);
    // The first occurrence is not numbered.
    expect(worldFortune(8, helion, vex, "depletion").summary).not.toContain("third");
    // Every kind reads its repeats distinctly, still grammatical.
    for (const kind of ["discovery", "depletion", "disaster"] as const) {
      for (let t = 0; t < 12; t++) {
        const e = worldFortune(t, helion, vex, kind, 2);
        expect(isGrammatical(e.summary)).toBe(true);
        expect(e.summary).toContain("Vex-9");
      }
    }
  });

  it("reads a world's exhaustion as an ending, not another bust (issue #40)", () => {
    for (let t = 0; t < 12; t++) {
      const e = worldFortune(t, helion, vex, "depletion", 4, true);
      expect(e.data.exhausted).toBe(true);
      expect(e.summary).toMatch(/gave out|worked bare|exhaustion/);
      expect(e.summary).toContain("Vex-9");
      expect(isGrammatical(e.summary)).toBe(true);
    }
  });

  it("progresses a trade relationship's prose through its phases (issue #40)", () => {
    // A first accord carries no memory and keeps the original phrasing family.
    const first = diplomacy(5, "trade", helion, iron, aldebaran);
    expect(first.data.trade).toBeUndefined();

    for (let t = 0; t < 12; t++) {
      const renewal = diplomacy(t, "trade", helion, iron, aldebaran, {
        phase: "renewal",
        count: 2,
      });
      expect(renewal.summary).toMatch(/renew|extended|carried on/);
      expect(isGrammatical(renewal.summary)).toBe(true);

      const deepening = diplomacy(t, "trade", helion, iron, aldebaran, {
        phase: "deepening",
        count: 4,
      });
      expect(deepening.summary).toMatch(/compact|for good|institution/);
      expect(isGrammatical(deepening.summary)).toBe(true);

      const resumption = diplomacy(t, "trade", helion, iron, aldebaran, {
        phase: "resumption",
        count: 1,
      });
      expect(resumption.summary).toMatch(/resumed|reopened|dusted off|once more/);
      expect(isGrammatical(resumption.summary)).toBe(true);

      for (const e of [renewal, deepening, resumption]) {
        expect(e.summary).toContain("Helion Compact");
        expect(e.summary).toContain("Iron Dominion");
      }
    }
  });

  it("reads a once-grown faction's collapse as a fall", () => {
    const fall = factionCollapsed(40, iron, 5);
    expect(fall.summary).toContain("5 worlds");
    expect(fall.summary).toContain("Iron Dominion");
    // A faction that never expanded past its homeworld gets the plain epitaph.
    expect(factionCollapsed(40, iron, 1).summary).not.toContain("worlds");
  });
});

group("named leaders (issue #23)", () => {
  it("names the founding leader in a FACTION_FOUNDED dispatch", () => {
    const e = factionFounded(0, helion, aldebaran);
    expect(e.summary).toContain("Prefect Veyra Tolan");
    expect(e.summary).toContain("Helion Compact");
    expect(isGrammatical(e.summary)).toBe(true);
  });

  it("attributes some colonization and conflict dispatches to a leader", () => {
    // Sweep cycles so the hash visits the leader-flavoured phrasings too.
    const colonized = new Set(
      Array.from({ length: 30 }, (_, t) => worldColonized(t, helion, vex).summary),
    );
    expect([...colonized].some((s) => s.includes("Veyra Tolan"))).toBe(true);

    const clashes = new Set(
      Array.from({ length: 30 }, (_, t) => conflict(t, iron, helion, vex, true).summary),
    );
    expect([...clashes].some((s) => s.includes("Admiral Castor Vane"))).toBe(true);
    // Every clash still names attacker, defender, and the contested world.
    for (const s of clashes) {
      expect(s).toContain("Iron Dominion");
      expect(s).toContain("Helion Compact");
      expect(s).toContain("Vex-9");
    }
  });

  it("renders each LEADERSHIP_CHANGE reason, naming both leaders", () => {
    const reasons = ["succession", "coup", "ascension"] as const;
    const out = {
      name: "Castor Vane",
      title: "Admiral",
      trait: "ruthless" as const,
      since: 2,
    };
    for (const reason of reasons) {
      // The successor is read off the faction, so swap iron's leader in.
      const successor = {
        ...iron,
        leader: { name: "Mira Drake", title: "Warlord", trait: "ambitious" as const, since: 14 },
      };
      const e = leadershipChange(14, successor, reason, out, 12);
      expect(e.data.reason).toBe(reason);
      expect(e.summary).toContain("Castor Vane"); // predecessor
      expect(e.summary).toContain("Mira Drake"); // successor
      expect(e.summary).toContain("Iron Dominion"); // faction
      expect(isGrammatical(e.summary)).toBe(true);
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
