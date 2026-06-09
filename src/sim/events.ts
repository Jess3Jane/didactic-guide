// Event system + prose templating for Starfall.
//
// Events are the *output of record* for the whole simulation (GDD §3): every
// state change worth reading about becomes a structured `WorldEvent`, which the
// news feed renders into a human-readable dispatch. Like the rest of
// `src/sim/`, this module is pure and headless — no DOM.
//
// Two halves live here:
//   1. A typed, self-contained `WorldEvent` model. Actors and locations are
//      stored as denormalized `{ id, name }` refs so an event can be rendered
//      (or serialized) without re-consulting the sector.
//   2. Prose templating — `describe(event)` turns an event into one clear
//      sentence. Templates are kept data-driven so Phase 3 can add variety
//      without touching the engine (GDD §3, §7).
//
// The engine (issue #5) builds events via the constructor helpers below, which
// populate `summary` by running `describe`, so an event is always self-
// describing.

import type {
  Disposition,
  Faction,
  Resources,
  StarSystem,
  World,
} from "./world";

// --- Event model -------------------------------------------------------------

/**
 * The event vocabulary. Phase 2 adds `WORLD_FORTUNE` (issue #19) and
 * `SECTOR_CONCLUDED` (issue #22), the terminal dispatch that closes a history.
 */
export type WorldEventType =
  | "FACTION_FOUNDED"
  | "WORLD_COLONIZED"
  | "CONFLICT"
  | "RESOURCE_CRISIS"
  | "FIRST_CONTACT"
  | "FACTION_COLLAPSED"
  | "WORLD_FORTUNE"
  | "SECTOR_CONCLUDED";

/** Which stockpile a crisis concerns. Mirrors the keys of `Resources`. */
export type ResourceKind = keyof Resources;

/**
 * How a history ends (issue #22). `unified` — a single power outlasts every
 * rival and holds the sector; `dark` — the last faction falls and no one
 * remains to make history. Either way the run has deliberately concluded.
 */
export type SectorOutcome = "unified" | "dark";

/**
 * How a world's fortunes turned (issue #19). `discovery` enriches it, while
 * `depletion` and `disaster` are blows — the boom/bust pressure that keeps a
 * sector's economy from settling into a dead, silent equilibrium.
 */
export type FortuneKind = "discovery" | "depletion" | "disaster";

/**
 * A prose-ready reference to a named entity (faction, world, or system).
 *
 * Denormalizing the name onto the event keeps dispatches self-contained: the
 * feed never has to look an id back up in the sector, and an event log stays
 * legible even after the world has moved on.
 */
export interface EntityRef {
  id: string;
  name: string;
}

/** Fields shared by every event. `data` is added per-type by the union below. */
interface EventBase {
  /** In-world cycle the event occurred on. */
  tick: number;
  type: WorldEventType;
  /** Entities involved, in a type-specific order (e.g. [attacker, defender]). */
  actors: EntityRef[];
  /** Where it happened — a world or system — when that's meaningful. */
  location?: EntityRef;
  /** One-line prose dispatch. Populated from `describe` at construction. */
  summary: string;
}

/** A faction enters the historical record. */
export interface FactionFoundedEvent extends EventBase {
  type: "FACTION_FOUNDED";
  data: { disposition: Disposition };
}

/** A faction expands onto a previously unheld world. */
export interface WorldColonizedEvent extends EventBase {
  type: "WORLD_COLONIZED";
}

/**
 * Continuity context for an ongoing war (issue #20). A clash between two powers
 * is rarely a one-off: bordering rivals fight again and again, and `Campaign`
 * lets a dispatch place this clash within that longer war — "the fourth clash
 * of a war raging since cycle 12" — so the chronicle reads as a campaign with
 * an arc, not a stream of unrelated skirmishes.
 */
export interface Campaign {
  /** 1-based index of this clash within the current war between the pair. */
  clash: number;
  /** The cycle the current war's opening clash occurred on. */
  since: number;
}

/**
 * Two factions contest a world; `captured` records whether it changed hands.
 * `campaign` carries the war's running context (issue #20) when this is part of
 * an ongoing conflict.
 */
export interface ConflictEvent extends EventBase {
  type: "CONFLICT";
  data: { captured: boolean; campaign?: Campaign };
}

/**
 * A faction's stockpile of `resource` runs critically short. `recurrence` is
 * the 1-based count of how many times this faction has suffered *this* crisis
 * (issue #20), so a repeat reads as "the third famine", not an isolated event.
 */
export interface ResourceCrisisEvent extends EventBase {
  type: "RESOURCE_CRISIS";
  data: { resource: ResourceKind; recurrence: number };
}

/** Two factions become aware of each other for the first time. */
export interface FirstContactEvent extends EventBase {
  type: "FIRST_CONTACT";
}

/**
 * A faction loses its last holding and passes into history. `peakWorlds` is the
 * most territory it ever held (issue #20), so a collapse can read as a fall from
 * greatness rather than a flat line item.
 */
export interface FactionCollapsedEvent extends EventBase {
  type: "FACTION_COLLAPSED";
  data: { peakWorlds: number };
}

/** A world's environment turns — a discovery, depletion, or disaster. */
export interface WorldFortuneEvent extends EventBase {
  type: "WORLD_FORTUNE";
  data: { fortune: FortuneKind };
}

/**
 * The history reaches its end (issue #22). For a `unified` outcome the lone
 * surviving faction is `actors[0]`; a `dark` outcome names no one.
 */
export interface SectorConcludedEvent extends EventBase {
  type: "SECTOR_CONCLUDED";
  data: { outcome: SectorOutcome };
}

/** The discriminated union the engine emits and the UI renders. */
export type WorldEvent =
  | FactionFoundedEvent
  | WorldColonizedEvent
  | ConflictEvent
  | ResourceCrisisEvent
  | FirstContactEvent
  | FactionCollapsedEvent
  | WorldFortuneEvent
  | SectorConcludedEvent;

/** Every event type, handy for iteration (tests, future filtering). */
export const EVENT_TYPES: readonly WorldEventType[] = [
  "FACTION_FOUNDED",
  "WORLD_COLONIZED",
  "CONFLICT",
  "RESOURCE_CRISIS",
  "FIRST_CONTACT",
  "FACTION_COLLAPSED",
  "WORLD_FORTUNE",
  "SECTOR_CONCLUDED",
] as const;

// --- Prose templating --------------------------------------------------------

/**
 * Per-resource phrasings for a crisis, keyed by stockpile so each reads
 * naturally rather than "suffered a population crisis". `f` is the (already
 * lower-cased, article-less) faction name.
 */
const CRISIS_PROSE: Record<ResourceKind, (f: string) => string> = {
  population: (f) => `Famine gripped the ${f} as its colonies starved.`,
  energy: (f) => `The ${f} plunged into an energy crisis as its reactors ran dry.`,
  materials: (f) => `The ${f} ran short of the raw materials its industry demanded.`,
  influence: (f) => `The authority of the ${f} crumbled into political crisis.`,
};

/**
 * Phrasings for a *recurring* crisis (issue #20), which name the count so the
 * feed accrues a pattern — "the third famine" — rather than reporting each as if
 * it were the first. `nth` is the spelled-out ordinal (e.g. "third").
 */
const CRISIS_RECUR: Record<ResourceKind, (f: string, nth: string) => string> = {
  population: (f, nth) => `Famine returned to the ${f} — the ${nth} to scour its colonies.`,
  energy: (f, nth) => `The ${f}'s reactors failed again, its ${nth} energy crisis.`,
  materials: (f, nth) => `For the ${nth} time, the foundries of the ${f} ran short of materials.`,
  influence: (f, nth) => `Political crisis gripped the ${f} anew — the ${nth} to shake its authority.`,
};

/** Spelled-out ordinals for small counts; falls back to "Nth" past the table. */
const ORDINALS = [
  "zeroth",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
] as const;

/** Render `n` as a spelled-out ordinal ("third"), or "Nth" for larger counts. */
function ordinal(n: number): string {
  return ORDINALS[n] ?? `${n}th`;
}

/**
 * Render an event into a single, grammatical dispatch.
 *
 * Derives prose purely from the event's structured fields; it never reads
 * `summary`, so it is safe to call while *building* an event. Adding phrasing
 * variety later means editing only this function.
 */
export function describe(event: WorldEvent): string {
  switch (event.type) {
    case "FACTION_FOUNDED": {
      const [faction] = event.actors;
      const where = event.location
        ? ` in the ${event.location.name} system`
        : "";
      return `The ${faction.name} rose to power${where}.`;
    }

    case "WORLD_COLONIZED": {
      const [faction] = event.actors;
      const world = event.location?.name ?? "an uncharted world";
      return `The ${faction.name} colonized ${world}.`;
    }

    case "CONFLICT": {
      const [attacker, defender] = event.actors;
      const world = event.location?.name ?? "contested ground";
      // A clash that continues a war (clash ≥ 2) carries the campaign's age,
      // so the reader can follow one conflict across many cycles.
      const campaign = event.data.campaign;
      const tail =
        campaign && campaign.clash >= 2
          ? ` — the ${ordinal(campaign.clash)} clash of a war raging since cycle ${campaign.since}`
          : "";
      return event.data.captured
        ? `The ${attacker.name} seized ${world} from the ${defender.name}${tail}.`
        : `The ${defender.name} repelled the ${attacker.name}'s assault on ${world}${tail}.`;
    }

    case "RESOURCE_CRISIS": {
      const [faction] = event.actors;
      const { resource, recurrence } = event.data;
      return recurrence >= 2
        ? CRISIS_RECUR[resource](faction.name, ordinal(recurrence))
        : CRISIS_PROSE[resource](faction.name);
    }

    case "FIRST_CONTACT": {
      const [a, b] = event.actors;
      const where = event.location
        ? ` in the ${event.location.name} reach`
        : "";
      return `First contact between the ${a.name} and the ${b.name}${where}.`;
    }

    case "FACTION_COLLAPSED": {
      const [faction] = event.actors;
      // A power that expanded beyond its homeworld before it fell gets a
      // fall-from-greatness framing, so its rise-and-decline arc lands in the
      // closing line (issue #20). Factions that never grew get the plain epitaph.
      if (event.data.peakWorlds >= 2) {
        return `Having once held ${event.data.peakWorlds} worlds, the ${faction.name} collapsed, fading from the sector.`;
      }
      return `The ${faction.name} collapsed, fading from the sector.`;
    }

    case "WORLD_FORTUNE": {
      const [faction] = event.actors;
      const world = event.location?.name ?? "a frontier world";
      const holder = faction ? ` held by the ${faction.name}` : "";
      switch (event.data.fortune) {
        case "discovery":
          return `Prospectors struck rich new deposits on ${world}${holder}.`;
        case "depletion":
          return `The lodes of ${world}${holder} ran thin, dimming its yield.`;
        case "disaster":
          return `Catastrophe swept ${world}${holder}, scattering its people.`;
      }
    }

    case "SECTOR_CONCLUDED": {
      if (event.data.outcome === "unified") {
        const victor = event.actors[0]?.name ?? "a lone power";
        return `The ${victor} stands unrivaled — the sector unifies under a single banner.`;
      }
      return `Silence falls across the sector; no power remains to shape its history.`;
    }

    default: {
      // Exhaustiveness guard: a new event type must extend this switch.
      const _never: never = event;
      return _never;
    }
  }
}

// --- Construction helpers ----------------------------------------------------

/** Denormalize any id+name entity into a prose-ready `EntityRef`. */
function ref(entity: { id: string; name: string }): EntityRef {
  return { id: entity.id, name: entity.name };
}

/**
 * Stamp an event with its `summary` by running `describe`.
 *
 * Callers pass everything but `summary`; this fills it in so every emitted
 * event is self-describing. `describe` ignores the placeholder summary.
 */
function withSummary<E extends WorldEvent>(event: Omit<E, "summary">): E {
  const full = { ...event, summary: "" } as E;
  full.summary = describe(full);
  return full;
}

/** A faction enters the record, optionally tagged with its home system. */
export function factionFounded(
  tick: number,
  faction: Faction,
  homeSystem?: StarSystem,
): FactionFoundedEvent {
  return withSummary<FactionFoundedEvent>({
    type: "FACTION_FOUNDED",
    tick,
    actors: [ref(faction)],
    location: homeSystem ? ref(homeSystem) : undefined,
    data: { disposition: faction.disposition },
  });
}

/** A faction colonizes `world`. */
export function worldColonized(
  tick: number,
  faction: Faction,
  world: World,
): WorldColonizedEvent {
  return withSummary<WorldColonizedEvent>({
    type: "WORLD_COLONIZED",
    tick,
    actors: [ref(faction)],
    location: ref(world),
  });
}

/**
 * A clash over `world`. `captured` is true when the attacker takes the world,
 * false when the defender holds.
 */
export function conflict(
  tick: number,
  attacker: Faction,
  defender: Faction,
  world: World,
  captured: boolean,
  campaign?: Campaign,
): ConflictEvent {
  return withSummary<ConflictEvent>({
    type: "CONFLICT",
    tick,
    actors: [ref(attacker), ref(defender)],
    location: ref(world),
    data: campaign ? { captured, campaign } : { captured },
  });
}

/**
 * A faction's `resource` stockpile hits a critical low. `recurrence` (default 1)
 * is how many times this faction has hit *this* crisis, so repeats can be
 * counted in the prose (issue #20).
 */
export function resourceCrisis(
  tick: number,
  faction: Faction,
  resource: ResourceKind,
  recurrence = 1,
): ResourceCrisisEvent {
  return withSummary<ResourceCrisisEvent>({
    type: "RESOURCE_CRISIS",
    tick,
    actors: [ref(faction)],
    data: { resource, recurrence },
  });
}

/** Two factions discover each other, optionally within a system. */
export function firstContact(
  tick: number,
  a: Faction,
  b: Faction,
  system?: StarSystem,
): FirstContactEvent {
  return withSummary<FirstContactEvent>({
    type: "FIRST_CONTACT",
    tick,
    actors: [ref(a), ref(b)],
    location: system ? ref(system) : undefined,
  });
}

/**
 * A faction loses its last world and collapses. `peakWorlds` (default: the
 * faction's current holdings) is the most territory it ever held, so the
 * dispatch can frame a fall from greatness (issue #20).
 */
export function factionCollapsed(
  tick: number,
  faction: Faction,
  peakWorlds = faction.ownedWorldIds.length,
): FactionCollapsedEvent {
  return withSummary<FactionCollapsedEvent>({
    type: "FACTION_COLLAPSED",
    tick,
    actors: [ref(faction)],
    data: { peakWorlds },
  });
}

/** A world's fortunes turn, for good (`discovery`) or ill. */
export function worldFortune(
  tick: number,
  faction: Faction | null,
  world: World,
  fortune: FortuneKind,
): WorldFortuneEvent {
  return withSummary<WorldFortuneEvent>({
    type: "WORLD_FORTUNE",
    tick,
    actors: faction ? [ref(faction)] : [],
    location: ref(world),
    data: { fortune },
  });
}

/**
 * The history concludes. A `unified` outcome names its `victor`, the last
 * faction standing; a `dark` outcome takes none — the sector has emptied.
 */
export function sectorConcluded(
  tick: number,
  outcome: SectorOutcome,
  victor?: Faction,
): SectorConcludedEvent {
  return withSummary<SectorConcludedEvent>({
    type: "SECTOR_CONCLUDED",
    tick,
    actors: victor ? [ref(victor)] : [],
    data: { outcome },
  });
}
