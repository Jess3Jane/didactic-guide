// @vitest-environment jsdom
import { describe as group, it, expect, beforeEach } from "vitest";
import { createRng } from "../sim/rng";
import { generateSector, type Sector } from "../sim/world";
import {
  createSectorMap,
  factionColor,
  factionColors,
  systemControl,
  NEUTRAL_COLOR,
} from "./map";

// A small hand-built sector exercises the pure projections without leaning on
// worldgen's exact output: two systems, one held, one contested, one empty.
function fixture(): Sector {
  return {
    seed: "t",
    systems: {
      "sys-0": { id: "sys-0", name: "Helion", position: { x: 100, y: 100 }, worldIds: ["sys-0-w0"] },
      "sys-1": {
        id: "sys-1",
        name: "Vega",
        position: { x: 900, y: 100 },
        worldIds: ["sys-1-w0", "sys-1-w1"],
      },
      "sys-2": { id: "sys-2", name: "Lyra", position: { x: 500, y: 800 }, worldIds: ["sys-2-w0"] },
    },
    worlds: {
      "sys-0-w0": { id: "sys-0-w0", name: "Helion I", systemId: "sys-0", habitability: 0.5, resourceRichness: 0.5, hazard: 0.1 },
      "sys-1-w0": { id: "sys-1-w0", name: "Vega I", systemId: "sys-1", habitability: 0.5, resourceRichness: 0.5, hazard: 0.1 },
      "sys-1-w1": { id: "sys-1-w1", name: "Vega II", systemId: "sys-1", habitability: 0.5, resourceRichness: 0.5, hazard: 0.1 },
      "sys-2-w0": { id: "sys-2-w0", name: "Lyra I", systemId: "sys-2", habitability: 0.5, resourceRichness: 0.5, hazard: 0.1 },
    },
    factions: {
      "fac-0": mkFaction("fac-0", "Helion Compact", ["sys-0-w0", "sys-1-w0"]),
      "fac-1": mkFaction("fac-1", "Iron Dominion", ["sys-1-w1"]),
    },
    lanes: [["sys-0", "sys-1"], ["sys-1", "sys-2"]],
  };
}

function mkFaction(id: string, name: string, owned: string[]) {
  return {
    id,
    name,
    homeSystemId: "sys-0",
    ownedWorldIds: owned,
    resources: { population: 100, energy: 60, materials: 60, influence: 20 },
    disposition: "expansionist" as const,
    leader: { name: "Veyra Tolan", title: "Prefect", trait: "ambitious" as const, since: 0 },
  };
}

group("systemControl", () => {
  it("attributes a system to its sole owner", () => {
    expect(systemControl(fixture(), "sys-0")).toEqual({
      controller: "fac-0",
      contested: false,
    });
  });

  it("flags a system owned by two factions as contested", () => {
    // sys-1: fac-0 holds one world, fac-1 the other — a tie, so contested, and
    // the lower id wins the colour for stability.
    expect(systemControl(fixture(), "sys-1")).toEqual({
      controller: "fac-0",
      contested: true,
    });
  });

  it("gives the majority holder the system without contest when one leads", () => {
    const sector = fixture();
    // Hand fac-0 both Vega worlds: now it leads outright, uncontested.
    sector.factions["fac-0"].ownedWorldIds = ["sys-0-w0", "sys-1-w0", "sys-1-w1"];
    sector.factions["fac-1"].ownedWorldIds = [];
    expect(systemControl(sector, "sys-1")).toEqual({
      controller: "fac-0",
      contested: false,
    });
  });

  it("reports an unowned system as unclaimed", () => {
    expect(systemControl(fixture(), "sys-2")).toEqual({
      controller: null,
      contested: false,
    });
  });

  it("returns unclaimed for an unknown system id", () => {
    expect(systemControl(fixture(), "sys-nope")).toEqual({
      controller: null,
      contested: false,
    });
  });
});

group("faction colours", () => {
  it("is stable and distinct for the first several factions", () => {
    const a = factionColor(0);
    const b = factionColor(1);
    expect(a).toBe(factionColor(0)); // deterministic
    expect(a).not.toBe(b);
  });

  it("falls back to a generated hue beyond the curated palette", () => {
    expect(factionColor(99)).toMatch(/^hsl\(/);
  });

  it("keys colours by faction id in generation order", () => {
    const colors = factionColors(fixture());
    expect(colors["fac-0"]).toBe(factionColor(0));
    expect(colors["fac-1"]).toBe(factionColor(1));
  });
});

group("createSectorMap", () => {
  let map: ReturnType<typeof createSectorMap>;

  beforeEach(() => {
    map = createSectorMap();
  });

  it("mounts without a sector and renders no systems yet", () => {
    expect(map.element.querySelectorAll(".map__system")).toHaveLength(0);
  });

  it("draws one node per system and one line per lane", () => {
    map.reset(fixture());
    expect(map.element.querySelectorAll(".map__system")).toHaveLength(3);
    expect(map.element.querySelectorAll(".map__lane")).toHaveLength(2);
  });

  it("colours a held system by its controller and marks contested ones", () => {
    map.reset(fixture());
    const nodes = map.element.querySelectorAll(".map__node");
    // sys-0 is fac-0's, solid; sys-1 is contested; sys-2 neutral.
    const held = nodes[0].querySelector(".map__system")!;
    expect(held.getAttribute("fill")).toBe(factionColor(0));
    const contested = map.element.querySelector(".map__system--contested");
    expect(contested).not.toBeNull();
    const neutral = map.element.querySelector(".map__system--neutral");
    expect(neutral?.getAttribute("fill")).toBe(NEUTRAL_COLOR);
  });

  it("lists every founding faction in the legend with its world count", () => {
    map.reset(fixture());
    const items = map.element.querySelectorAll(".map__legend-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Helion Compact");
    expect(items[0].textContent).toContain("2 worlds");
  });

  it("repaints ownership on update as territory changes", () => {
    const sector = fixture();
    map.reset(sector);
    // fac-1 seizes the unclaimed Lyra system in place.
    sector.factions["fac-1"].ownedWorldIds.push("sys-2-w0");
    map.update();
    const nodes = map.element.querySelectorAll(".map__node");
    const lyra = nodes[2].querySelector(".map__system")!;
    expect(lyra.getAttribute("fill")).toBe(factionColor(1));
    expect(lyra.classList.contains("map__system--neutral")).toBe(false);
  });

  it("marks a faction with no worlds left as fallen in the legend", () => {
    const sector = fixture();
    map.reset(sector);
    sector.factions["fac-1"].ownedWorldIds = [];
    map.update();
    const fallen = map.element.querySelector(".map__legend-item--fallen");
    expect(fallen?.textContent).toContain("fallen");
  });

  it("toggles the body collapsed when the toggle is clicked", () => {
    map.reset(fixture());
    const toggle = map.element.querySelector<HTMLButtonElement>(".map__toggle")!;
    expect(map.element.classList.contains("map--collapsed")).toBe(false);
    toggle.click();
    expect(map.element.classList.contains("map--collapsed")).toBe(true);
    expect(toggle.textContent).toBe("Show map");
  });

  it("rebinds to a fresh generated sector on reset", () => {
    const rng = createRng("alpha");
    const sector = generateSector(rng, { seed: "alpha", systemCount: 8, factionCount: 3 });
    map.reset(sector);
    expect(map.element.querySelectorAll(".map__system")).toHaveLength(8);
    expect(map.element.querySelectorAll(".map__legend-item")).toHaveLength(3);
  });
});
