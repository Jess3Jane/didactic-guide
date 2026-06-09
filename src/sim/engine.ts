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
  systemNeighbors,
} from "./world";
import {
  type WorldEvent,
  type EntityRef,
  type ResourceKind,
  type FortuneKind,
  factionFounded,
  worldColonized,
  conflict,
  resourceCrisis,
  firstContact,
  factionCollapsed,
  worldFortune,
  sectorConcluded,
} from "./events";

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
  /** Mounting an assault. */
  war: { population: 8, energy: 15, materials: 18 },
  /** Extra attrition the attacker eats when an assault fails. */
  warFailure: { population: 5, energy: 5, materials: 5 },
  /** What the defender spends holding the line. */
  defense: { energy: 8, materials: 8 },
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

/** How belligerent each disposition is — drives tension growth and who strikes. */
const AGGRESSION: Record<string, number> = {
  militarist: 3,
  expansionist: 2,
  industrious: 1,
  isolationist: 0,
};

// --- Engine state ------------------------------------------------------------

/** A single faction action resolved during a tick. */
type ActionKind = "COLONIZE" | "WAR" | "CONSOLIDATE";

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

  const factionIds = Object.keys(world.factions).sort(byId);
  for (const id of factionIds) inCrisis.set(id, new Set());

  /** Canonical, order-independent key for a faction pair. */
  const pairKey = (a: string, b: string): string =>
    byId(a, b) <= 0 ? `${a}|${b}` : `${b}|${a}`;

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
        events.push(resourceCrisis(tick, faction, kind));
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
          events.push(firstContact(tick, a, b, where));
        }
      }
    }
    return events;
  };

  // --- Step 2b: standing tensions --------------------------------------------

  /** Grow friction between acquainted powers that still share a border. */
  const accrueTension = (): void => {
    const alive = living();
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const key = pairKey(a.id, b.id);
        if (!met.has(`${a.id}|${b.id}`)) continue;
        if (!contactSystem(a, b)) continue; // friction needs a shared frontier
        const aggression = AGGRESSION[a.disposition] + AGGRESSION[b.disposition];
        const gain = TENSION.base + aggression * TENSION.perAggression;
        tension.set(key, (tension.get(key) ?? 0) + gain);
      }
    }
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
    const mine = AGGRESSION[faction.disposition];
    const theirs = AGGRESSION[rival.disposition];
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
        if (ownerId && ownerId !== faction.id && !collapsed.has(ownerId)) {
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
  ): { kind: ActionKind; target?: World } => {
    const r = faction.resources;
    const colonize = colonizeTargets(faction, owner);
    const war = warTargets(faction, owner);
    const canColonize = colonize.length > 0 && canAfford(faction, COST.colonize);
    const canWar = war.length > 0 && canAfford(faction, COST.war);

    // Boiling-over tension forces a strike even on a faction that would rather
    // rest — peace between rivals is temporary, not a permanent equilibrium.
    if (canAfford(faction, COST.war)) {
      const grudge = tensionWarTarget(faction, owner);
      if (grudge) return { kind: "WAR", target: grudge };
    }

    // A faction stretched thin recovers before it overreaches further.
    const strained =
      r.influence < CRISIS_THRESHOLD ||
      r.population < 30 ||
      (r.energy < CRISIS_THRESHOLD && r.materials < CRISIS_THRESHOLD);
    if (strained) return { kind: "CONSOLIDATE" };

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
    const { kind, target } = chooseAction(faction, owner);

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
      pay(faction, COST.war);

      // Capture odds weigh the attacker against the defender, who fights from
      // home ground (hazardous worlds are harder to wrest away).
      const attack = strength(faction);
      const defend = strength(defender) * (1 + target.hazard * 0.5);
      const captured = rng.next() < attack / (attack + defend);

      if (captured) {
        defender.ownedWorldIds = defender.ownedWorldIds.filter(
          (id) => id !== target.id,
        );
        faction.ownedWorldIds.push(target.id);
        owner.set(target.id, faction.id);
      } else {
        pay(faction, COST.warFailure);
        pay(defender, { ...COST.defense });
      }
      settleResources(faction);
      settleResources(defender);
      ventTension(faction.id, defender.id);
      return [conflict(tick, faction, defender, target, captured)];
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
        events.push(factionCollapsed(tick, faction));
      }
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

    // 3. Each faction takes one action toward its goal. Ownership is tracked
    //    live so a world taken early in the tick is seen as held later in it.
    const owner = buildOwnership();
    for (const faction of living()) {
      if (faction.ownedWorldIds.length === 0) continue; // lost everything mid-tick
      events.push(...resolveAction(faction, owner, t));
    }

    // 4. Collapse anyone who was conquered down to nothing.
    events.push(...detectCollapses(t));

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
  };
}
