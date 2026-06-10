// Tick engine for Starfall — faction actions + event emission.
//
// This is the heart of the simulation (GDD §3): a deterministic tick loop that
// advances the sector, lets each faction take one action toward its goal, and
// emits `WorldEvent`s describing anything noteworthy. Like the rest of
// `src/sim/`, it is pure and headless — no DOM, and every random choice flows
// through the injected `Rng`, so a seed fully reproduces a history.
//
// The design goal is "simple rules, surprising stories": the per-tick rules are
// modest, but they are coupled — expansion strains resources, strain forces
// consolidation, weakness invites conquest, conquest collapses factions — so
// interesting chains fall out the other side.

import type { Rng } from "./rng";
import {
  type Sector,
  type Faction,
  type World,
  type StarSystem,
  type LeaderTrait,
  generateLeader,
  systemNeighbors,
} from "./world";
import {
  type WorldEvent,
  type EntityRef,
  type ResourceKind,
  type FortuneKind,
  type Campaign,
  type LeadershipChange,
  factionFounded,
  worldColonized,
  conflict,
  resourceCrisis,
  firstContact,
  factionCollapsed,
  worldFortune,
  leadershipChange,
  diplomacy,
  warDeclared,
  warEnded,
  sectorConcluded,
} from "./events";
import {
  type PactKind,
  type Stance,
  RELATION,
  stanceFor,
  clampStanding,
  pactBarsWar,
} from "./relations";

// --- Tuning ------------------------------------------------------------------
//
// Phase 1 balance knobs, gathered so they are easy to read and adjust. Numbers
// are deliberately gentle: factions should grow over many ticks, not boom and
// bust in two.

/** Stockpile below which a resource is considered to be in crisis. */
const CRISIS_THRESHOLD = 10;

/** Per-action resource costs, paid by the acting faction. */
const COST = {
  colonize: { population: 15, energy: 12, materials: 12 },
  /**
   * Pressing a single clash. A multi-cycle war is many clashes (issue #24), so
   * the per-clash cost is modest — enough to bleed an over-stretched campaign
   * dry over time, but light enough that an aggressor can sustain an offensive
   * across the several cycles a front takes to break.
   */
  war: { population: 4, energy: 8, materials: 9 },
  /** Extra attrition the attacker eats when an assault is thrown back. */
  warFailure: { population: 3, energy: 3, materials: 4 },
  /** What the defender spends holding the line each clash. */
  defense: { energy: 6, materials: 6 },
} as const;

/** What a CONSOLIDATE turn recovers — the pressure-release valve. */
const CONSOLIDATE_RECOVERY = {
  energy: 8,
  materials: 6,
  influence: 4,
} as const;

const RESOURCE_KINDS: readonly ResourceKind[] = [
  "population",
  "energy",
  "materials",
  "influence",
];

// --- Phase 2: ongoing pressure (issue #19) -----------------------------------
//
// Phase 1 sectors raced to a dead equilibrium — everyone consolidating, no
// events — in under 30s. Two ongoing pressures keep the sector *changing*:
// the environment drifts (boom/bust), and peace between rivals decays into
// recurring war. Both are deterministic (all randomness via the injected Rng).

/** Boom/bust: a faction's worlds can see their fortunes turn each cycle. */
const DRIFT = {
  /**
   * Per living faction per cycle, the chance one of its worlds sees its
   * fortunes turn. Kept per-faction (not per-world) so a sprawling empire
   * doesn't flood the chronicle — coverage stays even as territory grows.
   */
  chancePerFaction: 0.1,
  /** Of those shifts, the split across discovery / depletion / disaster. */
  weights: { discovery: 0.4, depletion: 0.35, disaster: 0.25 },
  /** Resource-richness swing for a discovery (added) or depletion (removed). */
  richnessSwing: { min: 0.12, max: 0.3 },
  /** Floor a world's richness can be depleted to — never fully barren. */
  richnessFloor: 0.05,
  /** Hazard a disaster adds, and the fraction of garrison population it costs. */
  disasterHazard: { min: 0.15, max: 0.3 },
  disasterPopLoss: { min: 0.08, max: 0.18 },
} as const;

/**
 * Standing tensions: bordering powers that have met accrue friction each cycle,
 * scaled by how aggressive their dispositions are. Past `threshold` the
 * aggressor strikes even when it would otherwise sit tight; a clash vents the
 * pressure, which then rebuilds — so peace is temporary, not permanent.
 */
const TENSION = {
  /** Baseline friction a bordering, acquainted pair gains per cycle. */
  base: 1,
  /** Extra friction per point of summed disposition aggression. */
  perAggression: 0.6,
  /** Friction at which the aggressor will force a war. */
  threshold: 22,
  /** Friction a clash between the pair vents (win or lose). */
  release: 16,
} as const;

// --- Phase 2: narrative continuity (issue #20) -------------------------------
//
// The engine keeps a little memory so dispatches can reference what came before:
// repeated clashes between the same powers read as one war, recurring crises are
// counted, and a fallen faction's collapse recalls how large it once was.

/**
 * Cycles of quiet after which a fresh clash between a pair starts a *new* war
 * rather than continuing the old one. Tension rebuilds and vents on a shorter
 * cadence than this, so an active rivalry stays one campaign; only a genuine
 * lull (a long peace, a front gone cold) resets the count.
 */
const WAR_LULL = 8;

/** How belligerent each disposition is — drives tension growth and who strikes. */
const AGGRESSION: Record<string, number> = {
  militarist: 3,
  expansionist: 2,
  industrious: 1,
  isolationist: 0,
};

// --- Phase 2: named leaders (issue #23) --------------------------------------
//
// Factions are led by named figures who turn over across a run, and whose trait
// nudges how belligerent the faction acts — so a change at the top can cool or
// inflame a rivalry, and dispatches can attribute action to a person.

/**
 * Per-trait shift to a faction's effective aggression. `ruthless`/`ambitious`
 * leaders lean a faction toward war, `cautious` away from it; the sum with the
 * disposition's base is floored at 0 so friction never runs in reverse.
 */
const TRAIT_AGGRESSION: Record<LeaderTrait, number> = {
  ambitious: 1,
  ruthless: 2,
  cautious: -1,
  stoic: 0,
};

// Leadership is meant to be an occasional beat, not a churn — so changes hang
// off discrete moments (a fresh crisis, a conquest) rather than a standing state,
// and natural succession is a small per-cycle chance gated by a minimum tenure.
const LEADERSHIP = {
  /** Cycles a leader must serve before natural succession or a coup is possible. */
  minTenure: 6,
  /** Per cycle past `minTenure`, the chance an incumbent dies or steps down. */
  successionChance: 0.006,
  /** When a *fresh* crisis strikes past `minTenure`, the chance it topples the leader. */
  coupChance: 0.35,
  /** The chance a fresh conqueror's victorious commander seizes power. */
  ascensionChance: 0.25,
} as const;

// --- Phase 2: inter-faction relations & diplomacy (issue #24) ----------------
//
// Every acquainted pair carries a `standing` (how they feel) that drifts each
// cycle, and may hold a negotiated `pact` (non-aggression or alliance) that
// bars war between them. Together these give the sector a political layer:
// rivalries that boil over, friendships that hold the peace, and the betrayals
// that break them — so who fights whom is no longer a fixed function of
// disposition alone. The pure model (bands, stance derivation) lives in
// `relations.ts`; the stateful, RNG-driven evolution lives here.

/** Per-cycle nudges to a pair's standing (added, then clamped to RELATION's range). */
const RELATIONS = {
  /** Per point of summed aggression, a bordering pair sours each cycle. */
  friction: 1.5,
  /** A pact damps but does not erase that friction, so a pact can still fray. */
  pactFrictionScale: 0.85,
  /** Enemy-of-my-enemy: a shared rival warms a pair toward alliance each cycle. */
  sharedRivalWarmth: 3,
  /** A standing pact builds trust over time, all else equal. */
  pactTrust: 1.5,
  /** A war clash sours the combatants' standing sharply. */
  clashBlow: 18,
} as const;

/**
 * Diplomacy odds and effects. Each cycle every acquainted, living pair gets at
 * most one move, gated by these per-cycle chances so politics is an occasional
 * beat rather than noise; the standing rewards/penalties steer relations toward
 * the next move. All draws flow through the injected Rng.
 */
const DIPLOMACY = {
  chance: {
    /** A battered pair at war may lay it down — but many wars still run to a result. */
    peace: 0.22,
    alliance: 0.16,
    pact: 0.18,
    trade: 0.08,
    /** A wary neutral pair is leaned on by an aggressor, escalating toward rivalry. */
    threat: 0.06,
    /** A soured pact, broken by an opportunistic aggressor. Uncommon and dramatic. */
    betrayal: 0.1,
  },
  /** Standing each move moves the pair (peace/trade/pacts warm; threats sour). */
  standing: {
    peace: 25,
    alliance: 15,
    pact: 10,
    trade: 5,
    threat: -18,
  },
  /** A trade accord enriches both sides a little; values added to each stockpile. */
  tradeBoost: { energy: 6, materials: 6, influence: 2 },
  /** A threat raises war pressure as well as souring standing. */
  threatTension: 10,
  /** Minimum effective aggression for a power to coerce or betray. */
  aggressorFloor: 2,
  /** A pact tempts betrayal only once standing has soured to/below this. */
  betrayalStanding: -8,
  /** And only when the betrayer outweighs its mark by at least this factor. */
  betrayalEdge: 1.3,
} as const;

// --- Phase 2: multi-cycle wars (issue #24) -----------------------------------
//
// Phase 1 resolved a war in a single roll: one clash, one world flips. That made
// conquest feel like a coin toss and gave a war no shape. Here a war is a moving
// *front* with momentum: each clash pushes the line forward (an `advance`) or
// back (a `repulse`), and a world changes hands only once the attacker has built
// enough momentum to break through. Momentum also tilts the next clash's odds —
// a side that's winning presses its edge — so wars gather and lose steam legibly
// across cycles, and end either decisively (the foe broken, or the offensive
// spent) or by a negotiated peace. Momentum is oriented toward each war's
// recorded aggressor; a clash struck by the other side (after a leadership change
// flips who is the aggressor) pushes it the other way.
const WAR = {
  /** Ground an attacker win gains on the front. */
  advance: 34,
  /** Ground a defender win takes back. */
  repulse: 26,
  /** Momentum at which the front cracks and the contested world changes hands. */
  breakthrough: 60,
  /**
   * Momentum shed once a world falls — less than a full reset, so a broken front
   * keeps crumbling: a routed foe loses world after world in quick succession,
   * which is how a war reaches a decisive conquest rather than stalling forever.
   */
  breakthroughRelief: 30,
  /** Momentum (against the attacker) at which its offensive collapses — repelled. */
  collapse: 96,
  /** Momentum's pull on each clash's capture odds, per point. */
  swing: 0.005,
  /** Capture odds are kept off the rails so momentum tilts but never dictates. */
  oddsFloor: 0.05,
  oddsCeil: 0.95,
  /**
   * A war is only laid down by negotiation while it hangs in the balance: once
   * the front has swung decisively (|momentum| past this), the winning side
   * presses for a battlefield result instead of settling, so lopsided wars reach
   * a conquest or a repulse rather than fizzling into peace.
   */
  peaceMomentum: 42,
} as const;

// --- Engine state ------------------------------------------------------------

/** A single faction action resolved during a tick. */
type ActionKind = "COLONIZE" | "WAR" | "CONSOLIDATE";

/**
 * A read-only view of one acquainted pair's relationship (issue #24), for the
 * UI and tests. `a`/`b` are faction ids in canonical (id-sorted) order.
 */
export interface RelationSnapshot {
  a: string;
  b: string;
  standing: number;
  pact?: PactKind;
  stance: Stance;
}

/**
 * Where a run stands (issue #22). `ongoing` while more than one power survives;
 * `unified` once a single faction outlasts every rival (it is the `victor`);
 * `dark` once the last faction falls. The two terminal states are deliberate
 * ends — the engine stops advancing and the UI surfaces them as "ended".
 */
export type Conclusion =
  | { kind: "ongoing" }
  | { kind: "unified"; victor: EntityRef }
  | { kind: "dark" };

/**
 * The live simulation. `sector` is the engine's own mutable copy of the world,
 * safe for the UI to read between ticks; `tick()` advances it one cycle and
 * returns the events produced. `foundingEvents` seeds a fresh feed with the
 * initial roster so a chronicle opens on the factions' arrival.
 */
export interface Engine {
  /** The live world state, mutated in place each tick. Read-only to callers. */
  readonly sector: Sector;
  /** FACTION_FOUNDED events for the starting roster, at tick 0. */
  readonly foundingEvents: readonly WorldEvent[];
  /** Advance one cycle; returns the events emitted this tick. */
  tick(): WorldEvent[];
  /** The current in-world cycle (starts at 0, before the first tick). */
  getTick(): number;
  /** Whether the run is still going, or has concluded (and how). */
  getStatus(): Conclusion;
  /** A snapshot of the current relations between every acquainted pair (issue #24). */
  getRelations(): RelationSnapshot[];
}

// --- Helpers -----------------------------------------------------------------

/** Sort ids with numeric awareness so "fac-2" precedes "fac-10" deterministically. */
function byId(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

/** A faction's military weight: stockpiles plus held territory. */
function strength(faction: Faction): number {
  const { materials, energy, population } = faction.resources;
  return (
    materials * 0.4 +
    energy * 0.3 +
    population * 0.3 +
    faction.ownedWorldIds.length * 10
  );
}

/** Clamp a world trait to [0, 1], rounded to two decimals to stay tidy. */
function clamp01(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

/**
 * Whether a faction is stretched thin — short on governance or people, or
 * starved of both energy and materials. A strained power pulls back to recover
 * rather than overreach, and is the one willing to sue for peace (issue #24).
 */
function isStrained(faction: Faction): boolean {
  const r = faction.resources;
  return (
    r.influence < CRISIS_THRESHOLD ||
    r.population < 30 ||
    (r.energy < CRISIS_THRESHOLD && r.materials < CRISIS_THRESHOLD)
  );
}

/** Clamp every stockpile to a non-negative integer, in place. */
function settleResources(faction: Faction): void {
  const r = faction.resources;
  for (const kind of RESOURCE_KINDS) {
    r[kind] = Math.max(0, Math.round(r[kind]));
  }
}

// --- Engine ------------------------------------------------------------------

/**
 * Create a tick engine over a sector. The engine takes ownership of a private
 * clone, so the caller's sector is never mutated and two engines from the same
 * seed evolve identically.
 */
export function createEngine(sector: Sector, rng: Rng): Engine {
  // Own a private, mutable copy: determinism must not depend on the caller's
  // object surviving untouched.
  const world: Sector = structuredClone(sector);

  let currentTick = 0;

  // Where the run stands. Once terminal (unified/dark) the engine stops
  // advancing: a concluded history is read, not re-run.
  let conclusion: Conclusion = { kind: "ongoing" };

  // Factions that have passed into history; they neither act nor are acted upon.
  const collapsed = new Set<string>();
  // Faction pairs that have already made first contact ("fac-0|fac-1").
  const met = new Set<string>();
  // Per-faction record of which resources are currently in crisis, so a crisis
  // fires once on the way down rather than every tick it stays low.
  const inCrisis = new Map<string, Set<ResourceKind>>();
  // Standing friction per acquainted, bordering pair ("fac-0|fac-1"). Decays
  // into war past TENSION.threshold; a clash vents it.
  const tension = new Map<string, number>();

  // --- Continuity memory (issue #20) ---
  // Cumulative count of each crisis a faction has suffered, so a famine can
  // announce itself as "the third to scour its colonies".
  const crisisHistory = new Map<string, Record<ResourceKind, number>>();
  // The running war per acquainted pair: who opened it, when it began, when it
  // last flared, how many clashes it has seen, and the front's current momentum
  // (oriented toward `attacker`; + means the aggressor is winning ground). So
  // repeated battles read as one multi-cycle campaign with a shifting front.
  const wars = new Map<
    string,
    { attacker: string; since: number; lastClash: number; clash: number; momentum: number }
  >();
  // The most worlds each faction has ever held, so its collapse can recall the
  // height it fell from.
  const peakWorlds = new Map<string, number>();

  // --- Relations memory (issue #24) ---
  // Standing per acquainted pair ("fac-0|fac-1"), set to 0 at first contact and
  // drifting each cycle; and the negotiated pact, if any, that bars war between
  // them. Both are keyed by the canonical pair key.
  const standing = new Map<string, number>();
  const pacts = new Map<string, PactKind>();

  const factionIds = Object.keys(world.factions).sort(byId);
  for (const id of factionIds) {
    inCrisis.set(id, new Set());
    crisisHistory.set(id, { population: 0, energy: 0, materials: 0, influence: 0 });
    peakWorlds.set(id, world.factions[id].ownedWorldIds.length);
  }

  /** Canonical, order-independent key for a faction pair. */
  const pairKey = (a: string, b: string): string =>
    byId(a, b) <= 0 ? `${a}|${b}` : `${b}|${a}`;

  // --- Relation helpers (issue #24) ---

  /** Current standing between a pair (0 — wary neutral — if not yet recorded). */
  const standingOf = (a: string, b: string): number =>
    standing.get(pairKey(a, b)) ?? 0;

  /** The pact governing a pair, if any. */
  const pactOf = (a: string, b: string): PactKind | undefined =>
    pacts.get(pairKey(a, b));

  /** The discrete stance between a pair, derived from standing and pact. */
  const stanceOf = (a: string, b: string): Stance =>
    stanceFor(standingOf(a, b), pactOf(a, b));

  /** Whether a non-aggression pact or alliance bars war between a pair. */
  const atPeace = (a: string, b: string): boolean => pactBarsWar(pactOf(a, b));

  /** Move a pair's standing by `delta`, clamped to the model's range. */
  const adjustStanding = (a: string, b: string, delta: number): void => {
    const key = pairKey(a, b);
    standing.set(key, clampStanding((standing.get(key) ?? 0) + delta));
  };

  // Founding dispatches for the starting roster, derived once.
  const foundingEvents: WorldEvent[] = factionIds.map((id) => {
    const faction = world.factions[id];
    const home = world.systems[faction.homeSystemId];
    return factionFounded(0, faction, home);
  });

  /** Living factions in deterministic order. */
  const living = (): Faction[] =>
    factionIds
      .filter((id) => !collapsed.has(id))
      .map((id) => world.factions[id]);

  /** The systems a faction holds a world in. */
  const controlledSystems = (faction: Faction): Set<string> => {
    const out = new Set<string>();
    for (const wid of faction.ownedWorldIds) {
      out.add(world.worlds[wid].systemId);
    }
    return out;
  };

  /** Systems a faction can reach: those it holds plus their lane neighbours. */
  const reachableSystems = (faction: Faction): Set<string> => {
    const reach = controlledSystems(faction);
    for (const sysId of [...reach]) {
      for (const n of systemNeighbors(world, sysId)) reach.add(n);
    }
    return reach;
  };

  /** A worldId → owning factionId map over the current ownership state. */
  const buildOwnership = (): Map<string, string> => {
    const owner = new Map<string, string>();
    for (const id of factionIds) {
      for (const wid of world.factions[id].ownedWorldIds) owner.set(wid, id);
    }
    return owner;
  };

  // --- Step 1: resource dynamics --------------------------------------------

  /** Update one faction's stockpiles and return any crisis events it incurs. */
  const updateResources = (faction: Faction, tick: number): WorldEvent[] => {
    const owned = faction.ownedWorldIds.map((wid) => world.worlds[wid]);
    let energyYield = 0;
    let materialYield = 0;
    let habitability = 0;
    let hazard = 0;
    for (const w of owned) {
      energyYield += w.resourceRichness;
      materialYield += w.resourceRichness;
      habitability += w.habitability;
      hazard += w.hazard;
    }

    const r = faction.resources;

    // Population: logistic growth toward a habitability-driven carrying
    // capacity, minus hazard attrition, minus starvation when supplies fail.
    const capacity = 30 + habitability * 60;
    const crowding = r.population / capacity;
    let popDelta = r.population * 0.05 * (1 - crowding) - hazard * 2;
    if (r.energy <= 0) popDelta -= r.population * 0.1;
    if (r.materials <= 0) popDelta -= r.population * 0.05;

    // Production scales with worked worlds; consumption scales with population.
    r.population += popDelta;
    r.energy += energyYield * 6 - r.population * 0.05;
    r.materials += materialYield * 5 - r.population * 0.04;
    // Governance: influence is spent holding territory, recovered by consolidating.
    r.influence += 1 - faction.ownedWorldIds.length * 0.4;

    settleResources(faction);

    // Detect crisis transitions: fire once as a resource drops into the red.
    const flags = inCrisis.get(faction.id)!;
    const events: WorldEvent[] = [];
    for (const kind of RESOURCE_KINDS) {
      const low = r[kind] < CRISIS_THRESHOLD;
      if (low && !flags.has(kind)) {
        flags.add(kind);
        // Count this crisis so a recurrence can be numbered in the dispatch.
        const history = crisisHistory.get(faction.id)!;
        history[kind] += 1;
        events.push(resourceCrisis(tick, faction, kind, history[kind]));
      } else if (!low && flags.has(kind)) {
        flags.delete(kind);
      }
    }
    return events;
  };

  // --- Step 1b: environmental drift (boom/bust) ------------------------------

  /** Pick a fortune kind from DRIFT.weights using a single rng draw. */
  const rollFortune = (): FortuneKind => {
    const r = rng.next();
    const { discovery, depletion } = DRIFT.weights;
    if (r < discovery) return "discovery";
    if (r < discovery + depletion) return "depletion";
    return "disaster";
  };

  /** A value in [min, max], drawn from the rng. */
  const span = (range: { min: number; max: number }): number =>
    range.min + rng.next() * (range.max - range.min);

  /**
   * Drift faction holdings' fortunes so the economy never settles flat.
   * Discoveries enrich, depletion erodes, disasters wound (hazard up, garrison
   * population down) — keeping yields, crises, and pressure in motion across a
   * long run. One world per faction may turn per cycle, chosen via the rng.
   */
  const driftWorlds = (tick: number): WorldEvent[] => {
    const events: WorldEvent[] = [];
    for (const faction of living()) {
      if (faction.ownedWorldIds.length === 0) continue;
      if (!rng.bool(DRIFT.chancePerFaction)) continue;
      const held = faction.ownedWorldIds.slice().sort(byId);
      const w = world.worlds[held[rng.int(0, held.length - 1)]];
      const fortune = rollFortune();

      if (fortune === "discovery") {
        w.resourceRichness = clamp01(w.resourceRichness + span(DRIFT.richnessSwing));
      } else if (fortune === "depletion") {
        w.resourceRichness = Math.max(
          DRIFT.richnessFloor,
          clamp01(w.resourceRichness - span(DRIFT.richnessSwing)),
        );
      } else {
        w.hazard = clamp01(w.hazard + span(DRIFT.disasterHazard));
        // A disaster scatters part of the holding faction's population.
        faction.resources.population *= 1 - span(DRIFT.disasterPopLoss);
        settleResources(faction);
      }

      events.push(worldFortune(tick, faction, w, fortune));
    }
    return events;
  };

  // --- Step 2: first contact -------------------------------------------------

  /** The shared/adjacent system through which two factions meet, if any. */
  const contactSystem = (a: Faction, b: Faction): StarSystem | null => {
    const aSys = controlledSystems(a);
    const bSys = controlledSystems(b);
    const candidates: string[] = [];
    for (const sysId of aSys) {
      if (bSys.has(sysId)) {
        candidates.push(sysId); // sharing a system is the closest contact
        continue;
      }
      for (const n of systemNeighbors(world, sysId)) {
        if (bSys.has(n)) {
          candidates.push(sysId);
          break;
        }
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort(byId);
    return world.systems[candidates[0]];
  };

  /** Emit FIRST_CONTACT for any newly-adjacent pair of living factions. */
  const detectContacts = (tick: number): WorldEvent[] => {
    const events: WorldEvent[] = [];
    const alive = living();
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const key = `${a.id}|${b.id}`;
        if (met.has(key)) continue;
        const where = contactSystem(a, b);
        if (where) {
          met.add(key);
          // Powers meet as wary strangers: standing opens at neutral 0 and
          // evolves from here through bordering friction and diplomacy.
          standing.set(pairKey(a.id, b.id), 0);
          events.push(firstContact(tick, a, b, where));
        }
      }
    }
    return events;
  };

  // --- Step 2b: standing tensions --------------------------------------------

  /**
   * A faction's effective aggression: its disposition's base, shifted by the
   * trait of whoever currently leads it (issue #23), floored at 0 so a placid
   * leader cools a rivalry without ever reversing the friction.
   */
  const aggressionOf = (faction: Faction): number =>
    Math.max(0, AGGRESSION[faction.disposition] + TRAIT_AGGRESSION[faction.leader.trait]);

  /** Grow friction between acquainted powers that still share a border. */
  const accrueTension = (): void => {
    const alive = living();
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const key = pairKey(a.id, b.id);
        if (!met.has(`${a.id}|${b.id}`)) continue;
        if (atPeace(a.id, b.id)) continue; // a pact stays the war pressure
        if (!contactSystem(a, b)) continue; // friction needs a shared frontier
        const aggression = aggressionOf(a) + aggressionOf(b);
        const gain = TENSION.base + aggression * TENSION.perAggression;
        tension.set(key, (tension.get(key) ?? 0) + gain);
      }
    }
  };

  /**
   * Open or continue the war between an aggressor and a defender, returning the
   * live war record and whether this clash *opened* it (issue #24). A clash
   * within `WAR_LULL` cycles of the last continues the campaign — accruing
   * clashes and carrying its momentum forward; a longer gap (or a first strike)
   * opens a fresh war, oriented toward the striking `aggressor`.
   */
  const pressWar = (
    aggressor: string,
    defender: string,
    tick: number,
  ): { war: { attacker: string; since: number; lastClash: number; clash: number; momentum: number }; declared: boolean } => {
    const key = pairKey(aggressor, defender);
    const existing = wars.get(key);
    if (!existing || tick - existing.lastClash > WAR_LULL) {
      const war = { attacker: aggressor, since: tick, lastClash: tick, clash: 1, momentum: 0 };
      wars.set(key, war);
      return { war, declared: true };
    }
    existing.clash += 1;
    existing.lastClash = tick;
    return { war: existing, declared: false };
  };

  /** Vent the friction a clash between two factions releases. */
  const ventTension = (a: string, b: string): void => {
    const key = pairKey(a, b);
    const current = tension.get(key);
    if (current === undefined) return;
    tension.set(key, Math.max(0, current - TENSION.release));
  };

  /** True when `faction` is the designated aggressor against `rival`. */
  const isAggressor = (faction: Faction, rival: Faction): boolean => {
    const mine = aggressionOf(faction);
    const theirs = aggressionOf(rival);
    if (mine !== theirs) return mine > theirs;
    return byId(faction.id, rival.id) < 0; // tie-break so only one side strikes
  };

  /**
   * The world a faction would strike to vent its hottest standing tension, if
   * any rival is past the threshold and holds a world within reach.
   */
  const tensionWarTarget = (
    faction: Faction,
    owner: Map<string, string>,
  ): World | null => {
    const reach = reachableSystems(faction);
    let bestRival: string | null = null;
    let bestTension: number = TENSION.threshold;
    for (const rival of living()) {
      if (rival.id === faction.id) continue;
      if (atPeace(faction.id, rival.id)) continue; // a pact holds the peace
      if (!isAggressor(faction, rival)) continue;
      const t = tension.get(pairKey(faction.id, rival.id)) ?? 0;
      if (t >= bestTension) {
        // Ties broken by id so the choice stays deterministic.
        if (t > bestTension || bestRival === null || byId(rival.id, bestRival) < 0) {
          bestTension = t;
          bestRival = rival.id;
        }
      }
    }
    if (!bestRival) return null;

    const targets: World[] = [];
    for (const sysId of [...reach].sort(byId)) {
      for (const wid of world.systems[sysId].worldIds) {
        if (owner.get(wid) === bestRival) targets.push(world.worlds[wid]);
      }
    }
    targets.sort((x, y) => x.hazard - y.hazard || byId(x.id, y.id));
    return targets[0] ?? null;
  };

  // --- Step 2c: relations drift & diplomacy (issue #24) ----------------------

  /** Whether `a` and `b` are in an active war (a clash within the lull window). */
  const atWar = (a: string, b: string, tick: number): boolean => {
    const war = wars.get(pairKey(a, b));
    return war !== undefined && tick - war.lastClash <= WAR_LULL;
  };

  /** Whether some living third power is a rival to both `a` and `b`. */
  const sharesRival = (a: string, b: string): boolean => {
    for (const c of living()) {
      if (c.id === a || c.id === b) continue;
      if (stanceOf(a, c.id) === "rivalry" && stanceOf(b, c.id) === "rivalry") {
        return true;
      }
    }
    return false;
  };

  /**
   * Drift every acquainted pair's standing one cycle. Bordering powers grate on
   * one another in proportion to their aggression (a pact damps but does not
   * erase this, so even allies can sour into betrayal); a shared rival warms a
   * pair toward alliance — the enemy-of-my-enemy that gives the sector its
   * structure; and a standing pact builds trust over time. Pure arithmetic — no
   * RNG — so it never perturbs the draw stream that drives the rest of the tick.
   */
  const driftRelations = (): void => {
    const alive = living();
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        if (!met.has(`${a.id}|${b.id}`)) continue;
        const pact = pactOf(a.id, b.id);
        let delta = 0;
        if (contactSystem(a, b) !== null) {
          const aggression = aggressionOf(a) + aggressionOf(b);
          const scale = pact ? RELATIONS.pactFrictionScale : 1;
          delta -= RELATIONS.friction * aggression * scale;
        }
        if (sharesRival(a.id, b.id)) delta += RELATIONS.sharedRivalWarmth;
        if (pact) delta += RELATIONS.pactTrust;
        if (delta !== 0) adjustStanding(a.id, b.id, delta);
      }
    }
  };

  /** Apply a trade accord's mutual enrichment to both parties. */
  const applyTrade = (a: Faction, b: Faction): void => {
    for (const f of [a, b]) {
      f.resources.energy += DIPLOMACY.tradeBoost.energy;
      f.resources.materials += DIPLOMACY.tradeBoost.materials;
      f.resources.influence += DIPLOMACY.tradeBoost.influence;
      settleResources(f);
    }
  };

  /**
   * Resolve at most one diplomatic move per acquainted, living pair this cycle.
   * Moves are chosen by circumstance and gated by per-cycle odds, so politics
   * stays an occasional beat rather than noise. Effects are symmetric, but each
   * dispatch names an initiator — the lower-id party for a mutual accord, the
   * aggressor for a threat — so it can be attributed. `living()` is id-sorted,
   * so `a` is always the lower id; every random draw flows through the rng in a
   * fixed pair order, preserving determinism. Betrayal is not here: it is an act
   * of war, resolved in the action step.
   */
  const runDiplomacy = (tick: number): WorldEvent[] => {
    const events: WorldEvent[] = [];
    const alive = living();
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        if (!met.has(`${a.id}|${b.id}`)) continue;

        const key = pairKey(a.id, b.id);
        const pact = pactOf(a.id, b.id);
        const s = standingOf(a.id, b.id);
        const where = contactSystem(a, b) ?? undefined;
        const healthy = !isStrained(a) && !isStrained(b);

        // A war both sides are weary of is laid down before anything else — but
        // only while it still hangs in the balance; a war one side is clearly
        // winning is pressed to a battlefield result, not negotiated away.
        if (atWar(a.id, b.id, tick)) {
          const balanced = Math.abs(wars.get(key)?.momentum ?? 0) < WAR.peaceMomentum;
          if (
            balanced &&
            (isStrained(a) || isStrained(b)) &&
            rng.bool(DIPLOMACY.chance.peace)
          ) {
            pacts.set(key, "nonaggression");
            adjustStanding(a.id, b.id, DIPLOMACY.standing.peace);
            ventTension(a.id, b.id);
            // Peace closes the war's arc: the front dissolves, momentum and all.
            wars.delete(key);
            events.push(diplomacy(tick, "peace", a, b, where));
          }
          continue; // a pair at war pursues nothing else this cycle
        }

        // A pact binds the pair: it may deepen into alliance, and partners trade
        // freely — even while rebuilding — which is how a peace recovers.
        if (pact) {
          if (
            pact === "nonaggression" &&
            s >= RELATION.allianceAt &&
            rng.bool(DIPLOMACY.chance.alliance)
          ) {
            pacts.set(key, "alliance");
            adjustStanding(a.id, b.id, DIPLOMACY.standing.alliance);
            events.push(diplomacy(tick, "alliance", a, b, where));
          } else if (rng.bool(DIPLOMACY.chance.trade)) {
            applyTrade(a, b);
            adjustStanding(a.id, b.id, DIPLOMACY.standing.trade);
            events.push(diplomacy(tick, "trade", a, b, where));
          }
          continue;
        }

        // No pact: warmth invites pacts and alliances; an aggressor leans on a
        // wary neutral; warm un-pacted neighbours may simply trade.
        if (s >= RELATION.allianceAt && rng.bool(DIPLOMACY.chance.alliance)) {
          pacts.set(key, "alliance");
          adjustStanding(a.id, b.id, DIPLOMACY.standing.alliance);
          events.push(diplomacy(tick, "alliance", a, b, where));
        } else if (s >= RELATION.pactAt && rng.bool(DIPLOMACY.chance.pact)) {
          pacts.set(key, "nonaggression");
          adjustStanding(a.id, b.id, DIPLOMACY.standing.pact);
          events.push(diplomacy(tick, "pact", a, b, where));
        } else if (
          where &&
          s > RELATION.rivalryAt &&
          s < RELATION.pactAt &&
          Math.max(aggressionOf(a), aggressionOf(b)) >= DIPLOMACY.aggressorFloor &&
          rng.bool(DIPLOMACY.chance.threat)
        ) {
          // A bordering aggressor leans on a wary neighbour — not on a settled
          // rival (already hostile) — souring relations and raising war pressure.
          const coercer = aggressionOf(a) >= aggressionOf(b) ? a : b;
          const target = coercer === a ? b : a;
          adjustStanding(a.id, b.id, DIPLOMACY.standing.threat);
          tension.set(key, (tension.get(key) ?? 0) + DIPLOMACY.threatTension);
          events.push(diplomacy(tick, "threat", coercer, target, where));
        } else if (s > 0 && healthy && rng.bool(DIPLOMACY.chance.trade)) {
          applyTrade(a, b);
          adjustStanding(a.id, b.id, DIPLOMACY.standing.trade);
          events.push(diplomacy(tick, "trade", a, b, where));
        }
      }
    }
    return events;
  };

  // --- Step 3: faction actions ----------------------------------------------

  /** Reachable worlds that no faction owns, richest-to-live-on first. */
  const colonizeTargets = (
    faction: Faction,
    owner: Map<string, string>,
  ): World[] => {
    const reach = reachableSystems(faction);
    const targets: World[] = [];
    for (const sysId of [...reach].sort(byId)) {
      for (const wid of world.systems[sysId].worldIds) {
        if (!owner.has(wid)) targets.push(world.worlds[wid]);
      }
    }
    targets.sort((a, b) => b.habitability - a.habitability || byId(a.id, b.id));
    return targets;
  };

  /** Reachable worlds held by another living faction, weakest defender first. */
  const warTargets = (
    faction: Faction,
    owner: Map<string, string>,
  ): World[] => {
    const reach = reachableSystems(faction);
    const targets: World[] = [];
    for (const sysId of [...reach].sort(byId)) {
      for (const wid of world.systems[sysId].worldIds) {
        const ownerId = owner.get(wid);
        if (
          ownerId &&
          ownerId !== faction.id &&
          !collapsed.has(ownerId) &&
          !atPeace(faction.id, ownerId) // a pact spares its holdings from open war
        ) {
          targets.push(world.worlds[wid]);
        }
      }
    }
    targets.sort(
      (a, b) =>
        strength(world.factions[owner.get(a.id)!]) -
          strength(world.factions[owner.get(b.id)!]) || byId(a.id, b.id),
    );
    return targets;
  };

  /**
   * The world to press in an already-running war (issue #24). Once a war is
   * declared it has its own momentum: the aggressor keeps the offensive up every
   * cycle it can, not only when fresh tension boils over — so a campaign sustains
   * across cycles and the front actually moves, rather than fizzling between
   * sporadic clashes. Returns the weakest reachable world held by a foe this
   * faction is the standing aggressor against, or null if it presses no war.
   */
  const activeWarTarget = (
    faction: Faction,
    owner: Map<string, string>,
  ): World | null => {
    for (const w of warTargets(faction, owner)) {
      const ownerId = owner.get(w.id)!;
      const war = wars.get(pairKey(faction.id, ownerId));
      if (war && war.attacker === faction.id && currentTick - war.lastClash <= WAR_LULL) {
        return w;
      }
    }
    return null;
  };

  /**
   * A pact partner's holding an aggressor may betray, if any (issue #24).
   * Betrayal tempts only a sufficiently aggressive power whose pact has already
   * soured (standing at or below the betrayal line) and which clearly outweighs
   * its mark — then a single rng roll decides whether faith breaks this cycle.
   * Returns the weakest such holding to seize, or null if no betrayal is on the
   * table. The caller dissolves the pact and announces the treachery.
   */
  const betrayalTarget = (
    faction: Faction,
    owner: Map<string, string>,
  ): World | null => {
    if (aggressionOf(faction) < DIPLOMACY.aggressorFloor) return null;
    const reach = reachableSystems(faction);
    const marks: World[] = [];
    for (const sysId of [...reach].sort(byId)) {
      for (const wid of world.systems[sysId].worldIds) {
        const ownerId = owner.get(wid);
        if (!ownerId || ownerId === faction.id || collapsed.has(ownerId)) continue;
        if (!atPeace(faction.id, ownerId)) continue; // betrayal is of a pact partner
        if (standingOf(faction.id, ownerId) > DIPLOMACY.betrayalStanding) continue;
        const edge = strength(world.factions[ownerId]) * DIPLOMACY.betrayalEdge;
        if (strength(faction) < edge) continue;
        marks.push(world.worlds[wid]);
      }
    }
    if (marks.length === 0 || !rng.bool(DIPLOMACY.chance.betrayal)) return null;
    marks.sort(
      (a, b) =>
        strength(world.factions[owner.get(a.id)!]) -
          strength(world.factions[owner.get(b.id)!]) || byId(a.id, b.id),
    );
    return marks[0];
  };

  const canAfford = (
    faction: Faction,
    cost: { population?: number; energy?: number; materials?: number },
  ): boolean => {
    const r = faction.resources;
    return (
      r.population >= (cost.population ?? 0) &&
      r.energy >= (cost.energy ?? 0) &&
      r.materials >= (cost.materials ?? 0)
    );
  };

  /** Choose this faction's single action, by disposition and circumstance. */
  const chooseAction = (
    faction: Faction,
    owner: Map<string, string>,
  ): { kind: ActionKind; target?: World; betrayal?: boolean } => {
    const r = faction.resources;
    const colonize = colonizeTargets(faction, owner);
    const war = warTargets(faction, owner);
    const canColonize = colonize.length > 0 && canAfford(faction, COST.colonize);
    const canWar = war.length > 0 && canAfford(faction, COST.war);

    if (canAfford(faction, COST.war)) {
      // Boiling-over tension forces a strike even on a faction that would rather
      // rest — peace between rivals is temporary, not a permanent equilibrium.
      const grudge = tensionWarTarget(faction, owner);
      if (grudge) return { kind: "WAR", target: grudge };
      // A war already under way presses on under its own momentum, every cycle
      // the aggressor can sustain it — so the front moves across cycles instead
      // of stalling between fresh flare-ups (issue #24).
      const press = activeWarTarget(faction, owner);
      if (press) return { kind: "WAR", target: press };
      // A soured pact may tempt an aggressor into an opportunistic betrayal.
      const mark = betrayalTarget(faction, owner);
      if (mark) return { kind: "WAR", target: mark, betrayal: true };
    }

    // A faction stretched thin recovers before it overreaches further.
    if (isStrained(faction)) return { kind: "CONSOLIDATE" };

    switch (faction.disposition) {
      case "expansionist":
        if (canColonize) return { kind: "COLONIZE", target: colonize[0] };
        if (canWar) return { kind: "WAR", target: war[0] };
        return { kind: "CONSOLIDATE" };

      case "militarist":
        if (canWar) return { kind: "WAR", target: war[0] };
        if (canColonize) return { kind: "COLONIZE", target: colonize[0] };
        return { kind: "CONSOLIDATE" };

      case "industrious":
        // Builds up first; expands only once comfortably supplied.
        if (canColonize && r.energy > 40 && r.materials > 40) {
          return { kind: "COLONIZE", target: colonize[0] };
        }
        return { kind: "CONSOLIDATE" };

      case "isolationist":
        // Mostly keeps to itself, with the occasional cautious expansion.
        if (canColonize && rng.bool(0.15)) {
          return { kind: "COLONIZE", target: colonize[0] };
        }
        return { kind: "CONSOLIDATE" };
    }
  };

  const pay = (
    faction: Faction,
    cost: { population?: number; energy?: number; materials?: number },
  ): void => {
    const r = faction.resources;
    r.population -= cost.population ?? 0;
    r.energy -= cost.energy ?? 0;
    r.materials -= cost.materials ?? 0;
  };

  /** Resolve one faction's action, mutating the world and ownership map. */
  const resolveAction = (
    faction: Faction,
    owner: Map<string, string>,
    tick: number,
  ): WorldEvent[] => {
    const { kind, target, betrayal } = chooseAction(faction, owner);

    if (kind === "CONSOLIDATE") {
      const r = faction.resources;
      r.energy += CONSOLIDATE_RECOVERY.energy;
      r.materials += CONSOLIDATE_RECOVERY.materials;
      r.influence += CONSOLIDATE_RECOVERY.influence;
      settleResources(faction);
      return []; // recovery is quiet; the feed has livelier news to carry
    }

    if (kind === "COLONIZE" && target) {
      pay(faction, COST.colonize);
      faction.ownedWorldIds.push(target.id);
      owner.set(target.id, faction.id);
      settleResources(faction);
      return [worldColonized(tick, faction, target)];
    }

    if (kind === "WAR" && target) {
      const defender = world.factions[owner.get(target.id)!];
      const events: WorldEvent[] = [];

      // A betrayal breaks faith first, then strikes: dissolve the pact and let
      // the broken word read before the assault it opens (issue #24).
      if (betrayal) {
        pacts.delete(pairKey(faction.id, defender.id));
        events.push(
          diplomacy(tick, "betrayal", faction, defender, world.systems[target.systemId]),
        );
      }

      pay(faction, COST.war);

      // Open or continue the war, then resolve this clash as a push on its front
      // (issue #24). A betrayal's opening strike doesn't announce a separate
      // declaration — the broken pact already reads as hostilities opening.
      const { war, declared } = pressWar(faction.id, defender.id, tick);
      if (declared && !betrayal) {
        events.push(
          warDeclared(tick, faction, defender, world.systems[target.systemId]),
        );
      }

      // Capture odds weigh the attacker against the defender, who fights from
      // home ground (hazardous worlds are harder to wrest away), then tilt with
      // the front's momentum so a winning side presses its edge.
      const attack = strength(faction);
      const defend = strength(defender) * (1 + target.hazard * 0.5);
      const base = attack / (attack + defend);
      // Momentum is stored toward the war's aggressor; `mine` re-orients it to
      // whoever is striking now (the same faction, unless a leadership change has
      // since flipped which side is the aggressor).
      const sign = faction.id === war.attacker ? 1 : -1;
      let mine = sign * war.momentum;
      const odds = Math.max(
        WAR.oddsFloor,
        Math.min(WAR.oddsCeil, base + mine * WAR.swing),
      );
      const won = rng.next() < odds;

      let push: "advance" | "breakthrough" | "repulse";
      let captured = false;
      if (won) {
        mine += WAR.advance;
        if (mine >= WAR.breakthrough) {
          // The front cracks: the world changes hands and the line re-forms.
          push = "breakthrough";
          captured = true;
          mine -= WAR.breakthroughRelief;
          defender.ownedWorldIds = defender.ownedWorldIds.filter(
            (id) => id !== target.id,
          );
          faction.ownedWorldIds.push(target.id);
          owner.set(target.id, faction.id);
          pay(defender, { ...COST.defense });
        } else {
          // Ground gained, but the world holds — the siege presses on.
          push = "advance";
          pay(defender, { ...COST.defense });
        }
      } else {
        // Thrown back: the attacker eats extra attrition holding the assault open.
        push = "repulse";
        mine -= WAR.repulse;
        pay(faction, COST.warFailure);
        pay(defender, { ...COST.defense });
      }
      war.momentum = sign * mine;

      settleResources(faction);
      settleResources(defender);
      ventTension(faction.id, defender.id);
      // Fighting sours the combatants' standing sharply, win or lose, so a war
      // deepens the rivalry that drives the next clash (issue #24).
      adjustStanding(faction.id, defender.id, -RELATIONS.clashBlow);
      // Place this clash within the ongoing war so the dispatch can read as a
      // campaign rather than an isolated skirmish (issue #20).
      const campaign: Campaign = { clash: war.clash, since: war.since };
      events.push(conflict(tick, faction, defender, target, captured, campaign, push));

      // A decisive end (issue #24): the foe is broken (conquest) when the
      // breakthrough takes their last world, or the offensive collapses
      // (repelled) once the striker is pushed past the breaking point.
      const key = pairKey(faction.id, defender.id);
      if (captured && defender.ownedWorldIds.length === 0) {
        wars.delete(key);
        events.push(
          warEnded(tick, faction, defender, "conquest", war.since, war.clash),
        );
      } else if (mine <= -WAR.collapse) {
        wars.delete(key);
        ventTension(faction.id, defender.id);
        events.push(
          warEnded(tick, defender, faction, "repelled", war.since, war.clash),
        );
      }
      return events;
    }

    return [];
  };

  // --- Step 4: collapse ------------------------------------------------------

  /** Retire any living faction that has lost its last world. */
  const detectCollapses = (tick: number): WorldEvent[] => {
    const events: WorldEvent[] = [];
    for (const faction of living()) {
      if (faction.ownedWorldIds.length === 0) {
        collapsed.add(faction.id);
        // Recall the height it fell from, captured before this collapse.
        events.push(
          factionCollapsed(tick, faction, peakWorlds.get(faction.id) ?? 0),
        );
      }
    }
    return events;
  };

  // --- Step 4b: leadership turnover (issue #23) ------------------------------

  /**
   * Turn over leadership where the moment calls for it. A fresh conqueror's
   * victorious commander may seize power (`ascension`); a leader struck by a
   * fresh crisis past a minimum tenure may be deposed (`coup`); and any seasoned
   * leader may simply pass on (`succession`). Each installs a procedurally-named
   * successor and emits a legible transition. The two upheavals hang off discrete
   * moments this tick — a conquest, a new crisis — rather than a standing state,
   * so leadership reads as an occasional beat, not a churn. Triggers are checked
   * in priority order and draw from the rng only when their preconditions hold,
   * keeping the change deterministic.
   */
  const updateLeadership = (
    tick: number,
    conquerors: Set<string>,
    freshCrises: Set<string>,
  ): WorldEvent[] => {
    const events: WorldEvent[] = [];
    for (const faction of living()) {
      if (faction.ownedWorldIds.length === 0) continue;
      const leader = faction.leader;
      const tenure = tick - leader.since;
      const seasoned = tenure >= LEADERSHIP.minTenure;

      let reason: LeadershipChange | null = null;
      if (conquerors.has(faction.id) && rng.bool(LEADERSHIP.ascensionChance)) {
        reason = "ascension";
      } else if (
        seasoned &&
        freshCrises.has(faction.id) &&
        rng.bool(LEADERSHIP.coupChance)
      ) {
        reason = "coup";
      } else if (seasoned && rng.bool(LEADERSHIP.successionChance)) {
        reason = "succession";
      }
      if (!reason) continue;

      const predecessor = leader;
      // A turnover installs a *new* person: re-draw on the rare name collision so
      // the chronicle never reads "X passed; X took up the mantle".
      let successor = generateLeader(rng, faction.disposition, tick);
      while (successor.name === predecessor.name) {
        successor = generateLeader(rng, faction.disposition, tick);
      }
      faction.leader = successor;
      events.push(
        leadershipChange(
          tick,
          faction,
          reason,
          predecessor,
          tenure,
          world.systems[faction.homeSystemId],
        ),
      );
    }
    return events;
  };

  // --- Step 5: conclusion ----------------------------------------------------

  /**
   * Decide whether this cycle ends the history, and announce it. The sector
   * concludes when the field of rivals empties to one (`unified`) or none
   * (`dark`). "Unified" presumes there was a contest to win, so a single-faction
   * sector never trips it — it simply runs until it goes dark. Fires once.
   */
  const assessConclusion = (tick: number): WorldEvent[] => {
    if (conclusion.kind !== "ongoing") return [];
    const survivors = living();
    if (survivors.length === 0) {
      conclusion = { kind: "dark" };
      return [sectorConcluded(tick, "dark")];
    }
    if (survivors.length === 1 && factionIds.length > 1) {
      const victor = survivors[0];
      conclusion = { kind: "unified", victor: { id: victor.id, name: victor.name } };
      return [sectorConcluded(tick, "unified", victor)];
    }
    return [];
  };

  // --- The tick --------------------------------------------------------------

  const tick = (): WorldEvent[] => {
    // A concluded history is settled: stop the clock and emit nothing further.
    if (conclusion.kind !== "ongoing") return [];

    currentTick += 1;
    const t = currentTick;
    const events: WorldEvent[] = [];

    // 1. Resource production, consumption, growth and decline.
    for (const faction of living()) {
      events.push(...updateResources(faction, t));
    }

    // 1b. The environment drifts — discoveries, depletion, disasters — so the
    //     economy keeps moving instead of settling into a silent plateau.
    events.push(...driftWorlds(t));

    // 2. First contact between newly-adjacent powers (recorded before any
    //    hostilities this tick, so the meeting reads before the war).
    events.push(...detectContacts(t));

    // 2b. Bordering rivals grow more restive; high tension boils into war below.
    accrueTension();

    // 2c. Relations drift beneath the surface: bordering powers sour by their
    //     aggression, shared rivals warm toward each other, and standing pacts
    //     build trust — the slow politics that diplomacy then acts on.
    driftRelations();

    // 2d. Diplomacy: acquainted pairs may strike a pact, forge or deepen an
    //     alliance, sue for peace, trade, or issue threats — at most one move
    //     each, gated so the politics reads as an occasional beat (issue #24).
    events.push(...runDiplomacy(t));

    // 3. Each faction takes one action toward its goal. Ownership is tracked
    //    live so a world taken early in the tick is seen as held later in it.
    const owner = buildOwnership();
    for (const faction of living()) {
      if (faction.ownedWorldIds.length === 0) continue; // lost everything mid-tick
      events.push(...resolveAction(faction, owner, t));
    }

    // 3b. Note each faction's high-water mark in territory, so a later collapse
    //     can recall how large the faction once grew (issue #20). Captured after
    //     actions resolve and before any collapse, so a wiped-out faction keeps
    //     the peak it reached while it still held ground.
    for (const id of factionIds) {
      if (collapsed.has(id)) continue;
      const held = world.factions[id].ownedWorldIds.length;
      if (held > peakWorlds.get(id)!) peakWorlds.set(id, held);
    }

    // 4. Collapse anyone who was conquered down to nothing.
    events.push(...detectCollapses(t));

    // 4a. Retire any war a collapse has left one-sided. A war the aggressor won
    //     outright already closed with a WAR_ENDED conquest above; one whose
    //     combatant fell to a *third* power (or alongside it) just dissolves —
    //     there is no surviving front to fight over.
    for (const key of [...wars.keys()]) {
      const [a, b] = key.split("|");
      if (collapsed.has(a) || collapsed.has(b)) wars.delete(key);
    }

    // 4b. Leadership may turn over: a victorious commander rises, a fresh crisis
    //     topples a leader, or a long reign ends. Both upheavals key off this
    //     tick's own dispatches — conquerors are the attackers who took a world,
    //     fresh crises the factions that just dropped into the red.
    const conquerors = new Set<string>();
    const freshCrises = new Set<string>();
    for (const e of events) {
      if (e.type === "CONFLICT" && e.data.captured) conquerors.add(e.actors[0].id);
      else if (e.type === "RESOURCE_CRISIS") freshCrises.add(e.actors[0].id);
    }
    events.push(...updateLeadership(t, conquerors, freshCrises));

    // 5. If the field has narrowed to one power (or none), the history ends.
    events.push(...assessConclusion(t));

    return events;
  };

  return {
    sector: world,
    foundingEvents,
    tick,
    getTick: () => currentTick,
    getStatus: () => conclusion,
    getRelations: () => {
      const out: RelationSnapshot[] = [];
      for (const [key, s] of standing) {
        const [a, b] = key.split("|");
        const pact = pacts.get(key);
        out.push({ a, b, standing: s, pact, stance: stanceFor(s, pact) });
      }
      out.sort((x, y) => byId(x.a, y.a) || byId(x.b, y.b));
      return out;
    },
  };
}
