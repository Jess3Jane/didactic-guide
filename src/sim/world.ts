// World data model + minimal sector generation for Starfall.
//
// This is the typed substrate the engine (src/sim/engine.ts) mutates and the
// UI renders. Like the rest of `src/sim/`, it is pure and headless: no DOM, and
// all randomness flows through the injected `Rng` so a seed fully reproduces a
// sector (GDD §2, §3, §6). `Math.random()` must never appear here.

import type { Rng } from "./rng";

// --- Resources ---------------------------------------------------------------

/** The small fixed set of stockpiles that gate what a faction can do (GDD §2). */
export interface Resources {
  population: number;
  energy: number;
  materials: number;
  influence: number;
}

// --- Worlds ------------------------------------------------------------------

/**
 * A planet or moon within a star system. Traits are normalized to [0, 1] so the
 * engine can reason about them uniformly.
 *
 * - `habitability`     — how readily a population can live and grow here.
 * - `resourceRichness` — energy/materials yield when worked.
 * - `hazard`           — environmental danger (storms, radiation, instability).
 */
export interface World {
  id: string;
  name: string;
  /** The system that contains this world. */
  systemId: string;
  habitability: number;
  resourceRichness: number;
  hazard: number;
}

// --- Star systems ------------------------------------------------------------

/** A node in the sector graph, holding a cluster of worlds. */
export interface StarSystem {
  id: string;
  name: string;
  /** 2D position used for lane layout and (later) the map view. */
  position: { x: number; y: number };
  worldIds: string[];
}

/** A jump lane between two systems (an undirected edge in the sector graph). */
export type JumpLane = readonly [string, string];

// --- Factions ----------------------------------------------------------------

/**
 * A faction's broad temperament. The engine (issue #5) maps a disposition to
 * concrete per-tick actions (colonize / war / consolidate); richer goal systems
 * are Phase 2.
 */
export type Disposition =
  | "expansionist"
  | "militarist"
  | "industrious"
  | "isolationist";

// --- Leaders -----------------------------------------------------------------

/**
 * A leader's defining trait (issue #23). Each leans the faction a little —
 * `ambitious` and `ruthless` toward aggression, `cautious` away from it, `stoic`
 * not at all — so a change at the top can visibly cool or inflame a rivalry. The
 * engine owns the exact magnitudes; here the set is just the shared vocabulary.
 */
export type LeaderTrait = "ambitious" | "ruthless" | "cautious" | "stoic";

/**
 * The named head of a faction (issue #23). Leaders anchor the chronicle to
 * people — dispatches can attribute action to "Admiral Veyra Tolan" — and turn
 * over across a run (succession, coup, ascension), so this is a snapshot of who
 * holds office right now, not a full biography.
 */
export interface Leader {
  /** Full personal name, e.g. "Veyra Tolan". */
  name: string;
  /** Honorific drawn to suit the faction's disposition, e.g. "Admiral". */
  title: string;
  /** A behavioural lean that nudges how belligerent the faction acts. */
  trait: LeaderTrait;
  /** The cycle this leader took office (0 for a founding leader). */
  since: number;
}

/** An agent of history: holds territory, accrues resources, pursues a goal. */
export interface Faction {
  id: string;
  name: string;
  homeSystemId: string;
  /** Worlds this faction controls. Canonical record of ownership. */
  ownedWorldIds: string[];
  resources: Resources;
  disposition: Disposition;
  /** The figure currently in command, named in dispatches (issue #23). */
  leader: Leader;
}

// --- Sector ------------------------------------------------------------------

/**
 * The whole generated world. Systems, worlds, and factions are keyed by id for
 * O(1) lookup during the tick loop; `lanes` is the jump-lane graph over systems.
 */
export interface Sector {
  seed: string;
  systems: Record<string, StarSystem>;
  worlds: Record<string, World>;
  factions: Record<string, Faction>;
  lanes: JumpLane[];
}

// --- Generation options ------------------------------------------------------

export interface GenerateOptions {
  /** A fresh sector is generated per seed; stored on the sector for reference. */
  seed?: string;
  /** Number of star systems (default 12). */
  systemCount?: number;
  /** Number of starting factions (default 3). */
  factionCount?: number;
}

const DEFAULTS = {
  systemCount: 12,
  factionCount: 3,
} as const;

/** Layout extent for system positions (arbitrary units). */
const MAP_SIZE = 1000;

// --- Name pools --------------------------------------------------------------
//
// Curated, readable placeholder names. Deeper procedural naming is Phase 3
// (GDD §7); for now we draw uniquely from these pools and fall back to a numeric
// designation if a pool is exhausted.

const SYSTEM_NAMES = [
  "Helion",
  "Vega",
  "Kepler",
  "Aldebaran",
  "Cygnus",
  "Lyra",
  "Tycho",
  "Orion",
  "Rigel",
  "Antares",
  "Polaris",
  "Draco",
  "Mensa",
  "Corvus",
  "Phoenix",
  "Eridani",
  "Sirius",
  "Halcyon",
  "Maia",
  "Caelum",
] as const;

const FACTION_ADJECTIVES = [
  "Helion",
  "Crimson",
  "Iron",
  "Verdant",
  "Obsidian",
  "Astral",
  "Gilded",
  "Sundered",
  "Argent",
  "Umbral",
] as const;

const FACTION_NOUNS = [
  "Compact",
  "Dominion",
  "Concord",
  "Hegemony",
  "Collective",
  "Ascendancy",
  "Coalition",
  "Syndicate",
  "Imperium",
  "Accord",
] as const;

/** Every disposition, exported so mid-run foundings (issue #39) can draw one. */
export const DISPOSITIONS: readonly Disposition[] = [
  "expansionist",
  "militarist",
  "industrious",
  "isolationist",
];

// --- Leader name pools (issue #23) -------------------------------------------
//
// Procedural leader names: a given name + surname drawn from these pools, with a
// title suited to the faction's disposition. The pools are large enough that
// collisions across a single run's small cast are rare, and — like everything
// in `sim/` — every draw flows through the injected Rng so a seed reproduces the
// same cast.

const LEADER_GIVEN_NAMES = [
  "Veyra",
  "Soren",
  "Tamsin",
  "Cassia",
  "Dax",
  "Lio",
  "Cael",
  "Renn",
  "Sabel",
  "Halix",
  "Yara",
  "Nox",
  "Vash",
  "Eron",
  "Pell",
  "Quill",
  "Sarn",
  "Theda",
  "Ulric",
  "Wren",
  "Orla",
  "Brannic",
  "Calla",
  "Idris",
  "Mira",
  "Toren",
  "Zephyr",
  "Anselm",
] as const;

const LEADER_SURNAMES = [
  "Tolan",
  "Vex",
  "Marrow",
  "Okonro",
  "Sallow",
  "Drake",
  "Voss",
  "Kell",
  "Asher",
  "Renko",
  "Sable",
  "Thorne",
  "Calder",
  "Bishop",
  "Halloran",
  "Strand",
  "Veldt",
  "Oort",
  "Rastan",
  "Quint",
  "Ferro",
  "Lund",
  "Mireles",
  "Caspar",
  "Doran",
  "Nyx",
  "Praxis",
  "Wode",
] as const;

/** Titles flavoured by disposition, so a warlord and a chancellor read apart. */
const LEADER_TITLES: Record<Disposition, readonly string[]> = {
  militarist: ["Warlord", "Admiral", "Marshal", "General"],
  expansionist: ["Prefect", "Pioneer", "Envoy", "Pathfinder"],
  industrious: ["Director", "Chancellor", "Overseer", "Architect"],
  isolationist: ["Warden", "Elder", "Custodian", "Steward"],
};

const LEADER_TRAITS: readonly LeaderTrait[] = [
  "ambitious",
  "ruthless",
  "cautious",
  "stoic",
];

const ROMAN = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
] as const;

// --- Helpers -----------------------------------------------------------------

/** Squared Euclidean distance between two positioned systems. */
function distSq(a: StarSystem, b: StarSystem): number {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  return dx * dx + dy * dy;
}

/** Canonical key for an undirected lane, so duplicates collapse regardless of order. */
function laneKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Round a float trait to two decimals to keep values tidy and stable. */
function trait(rng: Rng, min = 0, max = 1): number {
  return Math.round((min + rng.next() * (max - min)) * 100) / 100;
}

/** Draw the next unique name from a shuffled pool, falling back to a suffix. */
function uniqueNamer(rng: Rng, pool: readonly string[]): () => string {
  const bag = rng.shuffle(pool);
  let i = 0;
  return () => {
    if (i < bag.length) return bag[i++];
    // Pool exhausted: cycle with a numeric designation to stay unique.
    const base = bag[i % bag.length];
    const n = Math.floor(i / bag.length) + 1;
    i++;
    return `${base} ${ROMAN[n] ?? n + 1}`;
  };
}

/**
 * Draw a fresh leader for a faction of `disposition`, taking office on `since`.
 *
 * Used both to seat founding leaders and, in the engine, to install successors
 * when leadership turns over (issue #23). Deterministic: all four draws (given
 * name, surname, title, trait) flow through `rng`.
 */
export function generateLeader(
  rng: Rng,
  disposition: Disposition,
  since: number,
): Leader {
  const given = rng.pick(LEADER_GIVEN_NAMES);
  const surname = rng.pick(LEADER_SURNAMES);
  const title = rng.pick(LEADER_TITLES[disposition]);
  const trait = rng.pick(LEADER_TRAITS);
  return { name: `${given} ${surname}`, title, trait, since };
}

/**
 * Draw a faction name not already in `taken` (issue #39). Mid-run foundings —
 * rebel states seceding from a troubled power — draw from the same pools as
 * worldgen, retrying a few times on collision and then falling back to a
 * numbered designation so the name stays unique even deep into a long history.
 * Deterministic: all draws flow through `rng`.
 */
export function generateFactionName(
  rng: Rng,
  taken: ReadonlySet<string>,
): string {
  let base = "";
  for (let i = 0; i < 8; i++) {
    base = `${rng.pick(FACTION_ADJECTIVES)} ${rng.pick(FACTION_NOUNS)}`;
    if (!taken.has(base)) return base;
  }
  for (let n = 2; ; n++) {
    const name = `${base} ${ROMAN[n - 1] ?? n}`;
    if (!taken.has(name)) return name;
  }
}

// --- Generation --------------------------------------------------------------

/**
 * Generate a small but plausible star sector from a seeded RNG.
 *
 * The result is internally consistent: the system graph is connected, every
 * owned world exists, and factions start in distinct home systems. Determinism
 * is guaranteed by routing *all* randomness through `rng`.
 */
export function generateSector(rng: Rng, options: GenerateOptions = {}): Sector {
  const seed = options.seed ?? "";
  const systemCount = Math.max(2, options.systemCount ?? DEFAULTS.systemCount);
  const factionCount = Math.max(
    1,
    Math.min(options.factionCount ?? DEFAULTS.factionCount, systemCount),
  );

  const systems: Record<string, StarSystem> = {};
  const worlds: Record<string, World> = {};
  const factions: Record<string, Faction> = {};

  const nameSystem = uniqueNamer(rng, SYSTEM_NAMES);
  const systemList: StarSystem[] = [];

  // 1. Place systems and populate each with 1–3 worlds.
  for (let s = 0; s < systemCount; s++) {
    const id = `sys-${s}`;
    const name = nameSystem();
    const system: StarSystem = {
      id,
      name,
      position: {
        x: rng.int(0, MAP_SIZE),
        y: rng.int(0, MAP_SIZE),
      },
      worldIds: [],
    };

    const worldCount = rng.int(1, 3);
    for (let w = 0; w < worldCount; w++) {
      const worldId = `${id}-w${w}`;
      worlds[worldId] = {
        id: worldId,
        name: `${name} ${ROMAN[w] ?? String(w + 1)}`,
        systemId: id,
        habitability: trait(rng),
        resourceRichness: trait(rng),
        hazard: trait(rng),
      };
      system.worldIds.push(worldId);
    }

    systems[id] = system;
    systemList.push(system);
  }

  // 2. Build a connected graph: a nearest-neighbour spanning tree guarantees
  //    reachability, then a few extra lanes add cycles for interesting routing.
  const lanes: JumpLane[] = [];
  const laneSet = new Set<string>();
  const addLane = (a: string, b: string): boolean => {
    if (a === b) return false;
    const key = laneKey(a, b);
    if (laneSet.has(key)) return false;
    laneSet.add(key);
    lanes.push([a, b] as const);
    return true;
  };

  for (let i = 1; i < systemList.length; i++) {
    const current = systemList[i];
    let nearest = systemList[0];
    let best = distSq(current, nearest);
    for (let j = 1; j < i; j++) {
      const d = distSq(current, systemList[j]);
      if (d < best) {
        best = d;
        nearest = systemList[j];
      }
    }
    addLane(current.id, nearest.id);
  }

  // Extra lanes (~30% of system count) connecting each chosen system to its
  // nearest not-yet-adjacent neighbour.
  const extraLanes = Math.round(systemCount * 0.3);
  for (let e = 0; e < extraLanes; e++) {
    const from = rng.pick(systemList);
    let target: StarSystem | null = null;
    let best = Infinity;
    for (const candidate of systemList) {
      if (candidate.id === from.id) continue;
      if (laneSet.has(laneKey(from.id, candidate.id))) continue;
      const d = distSq(from, candidate);
      if (d < best) {
        best = d;
        target = candidate;
      }
    }
    if (target) addLane(from.id, target.id);
  }

  // 3. Seat factions in distinct home systems and grant each its home's most
  //    habitable world.
  const nameAdjective = uniqueNamer(rng, FACTION_ADJECTIVES);
  const nameNoun = uniqueNamer(rng, FACTION_NOUNS);
  const homeSystems = rng.shuffle(systemList).slice(0, factionCount);

  homeSystems.forEach((home, f) => {
    const id = `fac-${f}`;
    const homeWorlds = home.worldIds.map((wid) => worlds[wid]);
    const capital = homeWorlds.reduce((a, b) =>
      b.habitability > a.habitability ? b : a,
    );

    factions[id] = {
      id,
      name: `${nameAdjective()} ${nameNoun()}`,
      homeSystemId: home.id,
      ownedWorldIds: [capital.id],
      resources: {
        population: rng.int(80, 120),
        energy: rng.int(40, 80),
        materials: rng.int(40, 80),
        influence: rng.int(10, 30),
      },
      disposition: rng.pick(DISPOSITIONS),
      // Founding leaders are installed in the pass below, so adding them never
      // shifts the generation draws above — older seeds reproduce unchanged.
      leader: { name: "", title: "", trait: "stoic", since: 0 },
    };
  });

  // 4. Seat a founding leader on each faction now that every disposition exists.
  for (let f = 0; f < homeSystems.length; f++) {
    const faction = factions[`fac-${f}`];
    faction.leader = generateLeader(rng, faction.disposition, 0);
  }

  return { seed, systems, worlds, factions, lanes };
}

// --- Read helpers ------------------------------------------------------------

/** System ids directly reachable from `systemId` via a jump lane. */
export function systemNeighbors(sector: Sector, systemId: string): string[] {
  const out: string[] = [];
  for (const [a, b] of sector.lanes) {
    if (a === systemId) out.push(b);
    else if (b === systemId) out.push(a);
  }
  return out;
}

/** The faction that owns `worldId`, or null if the world is unclaimed. */
export function ownerOf(sector: Sector, worldId: string): Faction | null {
  for (const faction of Object.values(sector.factions)) {
    if (faction.ownedWorldIds.includes(worldId)) return faction;
  }
  return null;
}
