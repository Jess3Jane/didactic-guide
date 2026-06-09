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

/** The Phase 1 event vocabulary. Richer types arrive with Phase 2 depth. */
export type WorldEventType =
  | "FACTION_FOUNDED"
  | "WORLD_COLONIZED"
  | "CONFLICT"
  | "RESOURCE_CRISIS"
  | "FIRST_CONTACT"
  | "FACTION_COLLAPSED";

/** Which stockpile a crisis concerns. Mirrors the keys of `Resources`. */
export type ResourceKind = keyof Resources;

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

/** Two factions contest a world; `captured` records whether it changed hands. */
export interface ConflictEvent extends EventBase {
  type: "CONFLICT";
  data: { captured: boolean };
}

/** A faction's stockpile of `resource` runs critically short. */
export interface ResourceCrisisEvent extends EventBase {
  type: "RESOURCE_CRISIS";
  data: { resource: ResourceKind };
}

/** Two factions become aware of each other for the first time. */
export interface FirstContactEvent extends EventBase {
  type: "FIRST_CONTACT";
}

/** A faction loses its last holding and passes into history. */
export interface FactionCollapsedEvent extends EventBase {
  type: "FACTION_COLLAPSED";
}

/** The discriminated union the engine emits and the UI renders. */
export type WorldEvent =
  | FactionFoundedEvent
  | WorldColonizedEvent
  | ConflictEvent
  | ResourceCrisisEvent
  | FirstContactEvent
  | FactionCollapsedEvent;

/** Every Phase 1 event type, handy for iteration (tests, future filtering). */
export const EVENT_TYPES: readonly WorldEventType[] = [
  "FACTION_FOUNDED",
  "WORLD_COLONIZED",
  "CONFLICT",
  "RESOURCE_CRISIS",
  "FIRST_CONTACT",
  "FACTION_COLLAPSED",
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
      return event.data.captured
        ? `The ${attacker.name} seized ${world} from the ${defender.name}.`
        : `The ${defender.name} repelled the ${attacker.name}'s assault on ${world}.`;
    }

    case "RESOURCE_CRISIS": {
      const [faction] = event.actors;
      return CRISIS_PROSE[event.data.resource](faction.name);
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
      return `The ${faction.name} collapsed, fading from the sector.`;
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
): ConflictEvent {
  return withSummary<ConflictEvent>({
    type: "CONFLICT",
    tick,
    actors: [ref(attacker), ref(defender)],
    location: ref(world),
    data: { captured },
  });
}

/** A faction's `resource` stockpile hits a critical low. */
export function resourceCrisis(
  tick: number,
  faction: Faction,
  resource: ResourceKind,
): ResourceCrisisEvent {
  return withSummary<ResourceCrisisEvent>({
    type: "RESOURCE_CRISIS",
    tick,
    actors: [ref(faction)],
    data: { resource },
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

/** A faction loses its last world and collapses. */
export function factionCollapsed(
  tick: number,
  faction: Faction,
): FactionCollapsedEvent {
  return withSummary<FactionCollapsedEvent>({
    type: "FACTION_COLLAPSED",
    tick,
    actors: [ref(faction)],
  });
}
