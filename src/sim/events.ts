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
  Leader,
  Resources,
  StarSystem,
  World,
} from "./world";
import type { PostureShift } from "./posture";

// --- Event model -------------------------------------------------------------

/**
 * The event vocabulary. Phase 2 adds `WORLD_FORTUNE` (issue #19),
 * `SECTOR_CONCLUDED` (issue #22), `DIPLOMACY` (issue #24) — the political beats
 * between powers — and the `WAR_DECLARED`/`WAR_ENDED` bookends (issue #24) that
 * frame a multi-cycle war as one arc: declared, fought across many clashes, and
 * brought to a decisive end. Phase 3 adds the destabilizers (issue #39):
 * `FACTION_SECEDED` — a troubled power fracturing into a rebel successor state —
 * and `WORLD_ABANDONED` — a strained power returning a world to the unclaimed
 * pool, re-opening the frontier.
 */
export type WorldEventType =
  | "FACTION_FOUNDED"
  | "WORLD_COLONIZED"
  | "WORLD_ABANDONED"
  | "WAR_DECLARED"
  | "CONFLICT"
  | "WAR_ENDED"
  | "RESOURCE_CRISIS"
  | "FIRST_CONTACT"
  | "FACTION_COLLAPSED"
  | "FACTION_SECEDED"
  | "WORLD_FORTUNE"
  | "LEADERSHIP_CHANGE"
  | "DIPLOMACY"
  | "FACTION_DOCTRINE"
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
 * How a leadership turned over (issue #23). `succession` — the incumbent died or
 * stepped down after a long tenure; `coup` — they were cast down amid crisis;
 * `ascension` — a commander rose on the back of a conquest. Each reads as a
 * distinct, legible transition in the chronicle.
 */
export type LeadershipChange = "succession" | "coup" | "ascension";

/**
 * A political move between two powers (issue #24). `pact` — a non-aggression
 * pact; `alliance` — a warmer bond formed or upgraded into; `peace` — a war
 * laid down; `trade` — an accord that enriches both and warms relations;
 * `threat` — coercion that sours them toward rivalry; `betrayal` — a standing
 * pact broken in the act of attacking; `renounce` (issue #39) — a long-soured
 * pact cast off openly, short of an attack but re-opening the road to war. Each
 * reads as a distinct beat in the chronicle's politics.
 */
export type DiplomacyKind =
  | "pact"
  | "alliance"
  | "peace"
  | "trade"
  | "threat"
  | "betrayal"
  | "renounce";

/**
 * How a clash sat within its multi-cycle war (issue #24). A war is fought as a
 * moving front, not a single roll: `advance` is ground gained with the target
 * world still in enemy hands, `breakthrough` is the front finally cracking and
 * the world changing hands, and `repulse` is the assault thrown back. So a world
 * falls only after the attacker has pressed an `advance` (often several) into a
 * `breakthrough` — legible progression rather than an instant flip.
 */
export type ConflictPush = "advance" | "breakthrough" | "repulse";

/**
 * How a war ended decisively (issue #24). `conquest` — the aggressor broke its
 * foe, taking the contested front (and often the last of its worlds);
 * `repelled` — the defender held until the aggressor's offensive collapsed.
 * Wars also end by negotiated `peace`, but that is carried as a `DIPLOMACY`
 * event; `WarOutcome` covers only the two battlefield resolutions.
 */
export type WarOutcome = "conquest" | "repelled";

/**
 * A prose-ready snapshot of a leader (issue #23). Like `EntityRef`, the name and
 * title are denormalized onto the event so a dispatch can attribute action to a
 * person without re-consulting the faction — and stays legible even after that
 * leader has been succeeded.
 */
export interface LeaderRef {
  name: string;
  title: string;
}

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

/** A faction enters the historical record, under its founding leader. */
export interface FactionFoundedEvent extends EventBase {
  type: "FACTION_FOUNDED";
  data: { disposition: Disposition; leader: LeaderRef };
}

/** A faction expands onto a previously unheld world, at its leader's command. */
export interface WorldColonizedEvent extends EventBase {
  type: "WORLD_COLONIZED";
  data: { leader: LeaderRef };
}

/**
 * A strained faction withdraws from a world it can no longer hold (issue #39),
 * returning it to the unclaimed pool — so the frontier, long since claimed up,
 * can re-open and colonization can return to a settled sector.
 */
export interface WorldAbandonedEvent extends EventBase {
  type: "WORLD_ABANDONED";
  data: { leader: LeaderRef };
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
 * an ongoing conflict, and `push` (issue #24) how the clash moved the front —
 * `advance` and `breakthrough` are attacker wins (`captured` is true only for a
 * `breakthrough`), `repulse` a defender hold. Omitting `push` falls back to the
 * Phase 1 captured/held reading, so a bare clash still renders.
 */
export interface ConflictEvent extends EventBase {
  type: "CONFLICT";
  data: {
    captured: boolean;
    campaign?: Campaign;
    push?: ConflictPush;
    leader: LeaderRef;
  };
}

/**
 * War breaks out between two powers (issue #24). `actors[0]` is the aggressor
 * opening hostilities, led by `leader`; `actors[1]` the power it falls upon.
 * `location`, when present, is the frontier system the war ignites along. It
 * opens an arc that one or more `CONFLICT` clashes continue and a `WAR_ENDED`
 * (or a negotiated `DIPLOMACY` peace) closes.
 */
export interface WarDeclaredEvent extends EventBase {
  type: "WAR_DECLARED";
  data: { leader: LeaderRef };
}

/**
 * A war reaches a decisive battlefield end (issue #24). `actors[0]` is the
 * victor, led by `leader`; `actors[1]` the vanquished. `outcome` is `conquest`
 * when the aggressor broke its foe, `repelled` when the defender outlasted the
 * offensive. `since` is the cycle the war opened and `clashes` how many battles
 * it took — so a long campaign reads with due weight.
 */
export interface WarEndedEvent extends EventBase {
  type: "WAR_ENDED";
  data: { outcome: WarOutcome; since: number; clashes: number; leader: LeaderRef };
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

/**
 * A troubled power fractures (issue #39): its outlying worlds break away as a
 * new rebel faction. `actors[0]` is the rebel state, led by `leader`;
 * `actors[1]` the parent it broke from. `location` is the rebel's new seat, and
 * `worlds` how many it carried off — so the rupture reads with due weight.
 */
export interface FactionSecededEvent extends EventBase {
  type: "FACTION_SECEDED";
  data: { disposition: Disposition; leader: LeaderRef; worlds: number };
}

/** A world's environment turns — a discovery, depletion, or disaster. */
export interface WorldFortuneEvent extends EventBase {
  type: "WORLD_FORTUNE";
  data: { fortune: FortuneKind };
}

/**
 * A faction's leadership turns over (issue #23). `actors[0]` is the faction, now
 * led by `successor`; `predecessor` is who they replaced, and `tenure` the
 * cycles that leader served — so a long reign ending reads with due weight.
 */
export interface LeadershipChangeEvent extends EventBase {
  type: "LEADERSHIP_CHANGE";
  data: {
    reason: LeadershipChange;
    predecessor: LeaderRef;
    successor: LeaderRef;
    tenure: number;
  };
}

/**
 * A political move between two powers (issue #24). `actors[0]` is the initiator
 * (for a `threat` the coercer, for a `betrayal` the one breaking faith), led by
 * `leader`; `actors[1]` is the other party. `location`, when present, is the
 * frontier system through which they deal.
 */
export interface DiplomacyEvent extends EventBase {
  type: "DIPLOMACY";
  data: { kind: DiplomacyKind; leader: LeaderRef };
}

/**
 * A faction's strategic footing shifts with its fortunes (issue #24). `actors[0]`
 * is the faction, led by `leader`; `shift` is the posture it has entered — a
 * battered power turned `defensive` to hold what remains, or an ascendant one
 * turned `hegemonic` to press for mastery. `location`, when present, is its home
 * system. Only these two notable turns are reported; a quiet return to its
 * baseline temperament is not an event. The `PostureShift` vocabulary lives with
 * the posture model in `posture.ts`.
 */
export interface FactionDoctrineEvent extends EventBase {
  type: "FACTION_DOCTRINE";
  data: { shift: PostureShift; leader: LeaderRef };
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
  | WorldAbandonedEvent
  | WarDeclaredEvent
  | ConflictEvent
  | WarEndedEvent
  | ResourceCrisisEvent
  | FirstContactEvent
  | FactionCollapsedEvent
  | FactionSecededEvent
  | WorldFortuneEvent
  | LeadershipChangeEvent
  | DiplomacyEvent
  | FactionDoctrineEvent
  | SectorConcludedEvent;

/** Every event type, handy for iteration (tests, future filtering). */
export const EVENT_TYPES: readonly WorldEventType[] = [
  "FACTION_FOUNDED",
  "WORLD_COLONIZED",
  "WORLD_ABANDONED",
  "WAR_DECLARED",
  "CONFLICT",
  "WAR_ENDED",
  "RESOURCE_CRISIS",
  "FIRST_CONTACT",
  "FACTION_COLLAPSED",
  "FACTION_SECEDED",
  "WORLD_FORTUNE",
  "LEADERSHIP_CHANGE",
  "DIPLOMACY",
  "FACTION_DOCTRINE",
  "SECTOR_CONCLUDED",
] as const;

// --- Prose templating --------------------------------------------------------
//
// Variety, deterministically (issue #21). The Phase 1 chronicle had exactly one
// template per event type, so a sustained run read like a log file — every
// famine, every colonisation phrased identically. Here each event type carries
// *several* phrasings and `describe` selects one. To keep the sim's "a seed
// reproduces the world" guarantee, selection is a pure function of the event's
// own structured fields (`pickVariant`) rather than a threaded RNG — so the same
// event always renders the same way, while distinct occurrences spread across
// the phrasing set.

/**
 * Deterministically choose one of `variants` for `event`.
 *
 * The index is an FNV-1a hash of a key built from the event's stable fields
 * (type, cycle, actor/location ids, and per-type `data`), reduced mod the
 * variant count. Two events that differ in any of those — e.g. the same famine
 * a dozen cycles apart, or for a different faction — land on (usually) different
 * phrasings, so repetition reads as variation rather than a stuck record. It
 * stays pure: no `Math.random`, no RNG state, identical output for equal events.
 */
function pickVariant<T>(event: WorldEvent, variants: readonly T[]): T {
  if (variants.length <= 1) return variants[0];
  const actors = event.actors.map((a) => a.id).join(",");
  const loc = event.location?.id ?? "";
  const data = "data" in event ? JSON.stringify(event.data) : "";
  const key = `${event.type}|${event.tick}|${actors}|${loc}|${data}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  }
  return variants[(h >>> 0) % variants.length];
}

/**
 * Per-resource phrasings for a crisis, keyed by stockpile so each reads
 * naturally rather than "suffered a population crisis". Each stockpile carries
 * several variants (issue #21); `f` is the (already lower-cased, article-less)
 * faction name. The first entry preserves the Phase 1 wording.
 */
const CRISIS_PROSE: Record<ResourceKind, ((f: string) => string)[]> = {
  population: [
    (f) => `Famine gripped the ${f} as its colonies starved.`,
    (f) => `Mass starvation swept the worlds of the ${f}.`,
    (f) => `The ${f} reeled as its colonies could no longer feed themselves.`,
  ],
  energy: [
    (f) => `The ${f} plunged into an energy crisis as its reactors ran dry.`,
    (f) => `Power failed across the ${f} as its reactors guttered out.`,
    (f) => `The ${f} went dark, its energy reserves all but spent.`,
  ],
  materials: [
    (f) => `The ${f} ran short of the raw materials its industry demanded.`,
    (f) => `The foundries of the ${f} fell idle for want of materials.`,
    (f) => `Shortages of raw materials choked the industry of the ${f}.`,
  ],
  influence: [
    (f) => `The authority of the ${f} crumbled into political crisis.`,
    (f) => `Political crisis shook the ${f} as its grip on power slipped.`,
    (f) => `The ${f} fractured, its institutions buckling under unrest.`,
  ],
};

/**
 * Phrasings for a *recurring* crisis (issue #20), which name the count so the
 * feed accrues a pattern — "the third famine" — rather than reporting each as if
 * it were the first. Several variants per stockpile (issue #21); `nth` is the
 * spelled-out ordinal (e.g. "third").
 */
const CRISIS_RECUR: Record<ResourceKind, ((f: string, nth: string) => string)[]> = {
  population: [
    (f, nth) => `Famine returned to the ${f} — the ${nth} to scour its colonies.`,
    (f, nth) => `Once more the colonies of the ${f} starved, its ${nth} such famine.`,
  ],
  energy: [
    (f, nth) => `The ${f}'s reactors failed again, its ${nth} energy crisis.`,
    (f, nth) => `Darkness fell over the ${f} anew — the ${nth} energy crisis to grip it.`,
  ],
  materials: [
    (f, nth) => `For the ${nth} time, the foundries of the ${f} ran short of materials.`,
    (f, nth) => `Material shortages returned to the ${f}, the ${nth} to idle its industry.`,
  ],
  influence: [
    (f, nth) => `Political crisis gripped the ${f} anew — the ${nth} to shake its authority.`,
    (f, nth) => `The ${f} convulsed in its ${nth} crisis of authority.`,
  ],
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

/** A leader's full styling for prose, e.g. "Admiral Veyra Tolan" (issue #23). */
function styled(leader: LeaderRef): string {
  return `${leader.title} ${leader.name}`;
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
      const f = event.actors[0].name;
      const lead = styled(event.data.leader);
      const where = event.location
        ? ` in the ${event.location.name} system`
        : "";
      return pickVariant(event, [
        () => `Under ${lead}, the ${f} rose to power${where}.`,
        () => `${lead} proclaimed a new power, the ${f}${where}.`,
        () => `The banners of the ${f} were first raised under ${lead}${where}.`,
      ])();
    }

    case "WORLD_COLONIZED": {
      const f = event.actors[0].name;
      const lead = styled(event.data.leader);
      const world = event.location?.name ?? "an uncharted world";
      return pickVariant(event, [
        () => `The ${f} colonized ${world}.`,
        () => `Settlers of the ${f} laid claim to ${world}.`,
        () => `${world} was brought into the fold of the ${f}.`,
        () => `At ${lead}'s command, the ${f} settled ${world}.`,
        () => `${lead} sent the ${f}'s pioneers to ${world}.`,
      ])();
    }

    case "WORLD_ABANDONED": {
      const f = event.actors[0].name;
      const world = event.location?.name ?? "a far colony";
      const lead = styled(event.data.leader);
      return pickVariant(event, [
        () => `Stretched past its means, the ${f} abandoned ${world} to the silence.`,
        () => `The ${f} withdrew from ${world}, its colonists recalled and its claim lapsed.`,
        () => `${lead} ordered ${world} evacuated; the ${f} could hold it no longer.`,
      ])();
    }

    case "CONFLICT": {
      const a = event.actors[0].name;
      const d = event.actors[1].name;
      const world = event.location?.name ?? "contested ground";
      // A clash that continues a war (clash ≥ 2) carries the campaign's age,
      // so the reader can follow one conflict across many cycles.
      const campaign = event.data.campaign;
      const lead = styled(event.data.leader);
      const tail =
        campaign && campaign.clash >= 2
          ? ` — the ${ordinal(campaign.clash)} clash of a war raging since cycle ${campaign.since}`
          : "";
      // The front moved three ways (issue #24): an `advance` gains ground without
      // taking the world, a `breakthrough` finally cracks it, a `repulse` is
      // thrown back. A clash with no `push` falls back to the captured/held read.
      const flavor =
        event.data.push ?? (event.data.captured ? "breakthrough" : "repulse");
      const byFlavor: Record<ConflictPush, (() => string)[]> = {
        breakthrough: [
          () => `The ${a} seized ${world} from the ${d}${tail}.`,
          () => `${world} fell to the ${a}, wrested from the ${d}${tail}.`,
          () => `The ${d} lost ${world} as the ${a} broke through${tail}.`,
          () => `${lead} of the ${a} stormed ${world}, taking it from the ${d}${tail}.`,
          () => `On ${lead}'s order, the ${a} wrenched ${world} from the ${d}${tail}.`,
        ],
        advance: [
          () => `The ${a} pressed deeper toward ${world}, but the ${d} held the line${tail}.`,
          () => `The ${a}'s offensive ground forward at ${world}, the ${d} yielding ground${tail}.`,
          () => `Fighting raged around ${world} as the ${a} pushed the ${d} back, the world yet unfallen${tail}.`,
          () => `${lead}'s forces gained ground at ${world}, though it stayed in ${d} hands${tail}.`,
        ],
        repulse: [
          () => `The ${d} repelled the ${a}'s assault on ${world}${tail}.`,
          () => `The ${a}'s drive on ${world} foundered against the ${d}${tail}.`,
          () => `${world} held firm as the ${d} threw back the ${a}${tail}.`,
          () => `${lead}'s assault on ${world} broke against the ${d}, sparing the ${a} nothing${tail}.`,
        ],
      };
      return pickVariant(event, byFlavor[flavor])();
    }

    case "WAR_DECLARED": {
      const a = event.actors[0].name;
      const b = event.actors[1].name;
      const lead = styled(event.data.leader);
      const where = event.location ? ` along the ${event.location.name} frontier` : "";
      return pickVariant(event, [
        () => `War broke out between the ${a} and the ${b}${where}.`,
        () => `${lead} of the ${a} loosed the dogs of war upon the ${b}${where}.`,
        () => `The ${a} opened hostilities against the ${b}${where}.`,
      ])();
    }

    case "WAR_ENDED": {
      const a = event.actors[0].name; // victor
      const b = event.actors[1].name; // vanquished
      const lead = styled(event.data.leader);
      const { since, clashes } = event.data;
      const span = clashes >= 2 ? `${clashes} clashes` : "a single clash";
      const variants =
        event.data.outcome === "conquest"
          ? [
              () => `The ${a} broke the ${b}, ending a war waged since cycle ${since}.`,
              () => `After ${span}, the ${a} ground the ${b} into defeat.`,
              () => `${lead} of the ${a} brought the war with the ${b} to a victorious close.`,
            ]
          : [
              () => `The ${a} threw back the ${b}'s offensive, and the war guttered out after ${span}.`,
              () => `The ${b}'s drive broke against the ${a}; their war, begun in cycle ${since}, ended in stalemate.`,
              () => `Spent after ${span}, the ${b} abandoned its war on the ${a}.`,
            ];
      return pickVariant(event, variants)();
    }

    case "RESOURCE_CRISIS": {
      const f = event.actors[0].name;
      const { resource, recurrence } = event.data;
      return recurrence >= 2
        ? pickVariant(event, CRISIS_RECUR[resource])(f, ordinal(recurrence))
        : pickVariant(event, CRISIS_PROSE[resource])(f);
    }

    case "FIRST_CONTACT": {
      const a = event.actors[0].name;
      const b = event.actors[1].name;
      const where = event.location
        ? ` in the ${event.location.name} reach`
        : "";
      return pickVariant(event, [
        () => `First contact between the ${a} and the ${b}${where}.`,
        () => `The ${a} and the ${b} made first contact${where}.`,
        () => `Long-range signals confirmed the ${a} and the ${b} had found one another${where}.`,
      ])();
    }

    case "FACTION_COLLAPSED": {
      const f = event.actors[0].name;
      const peak = event.data.peakWorlds;
      // A power that expanded beyond its homeworld before it fell gets a
      // fall-from-greatness framing, so its rise-and-decline arc lands in the
      // closing line (issue #20). Factions that never grew get the plain epitaph.
      const variants =
        peak >= 2
          ? [
              () => `Having once held ${peak} worlds, the ${f} collapsed, fading from the sector.`,
              () => `The ${f}, master of ${peak} worlds at its height, fell into ruin and was gone.`,
              () => `From ${peak} worlds to none, the ${f} collapsed and passed into history.`,
            ]
          : [
              () => `The ${f} collapsed, fading from the sector.`,
              () => `The ${f} guttered out, leaving no mark on the sector.`,
              () => `The last holdings of the ${f} fell, and it was no more.`,
            ];
      return pickVariant(event, variants)();
    }

    case "FACTION_SECEDED": {
      const rebel = event.actors[0].name;
      const parent = event.actors[1].name;
      const lead = styled(event.data.leader);
      const n = event.data.worlds;
      const span = n === 1 ? "an outlying world" : `${n} outlying worlds`;
      const seat = event.location ? `, seated at ${event.location.name}` : "";
      return pickVariant(event, [
        () => `Years of unrest split the ${parent}: ${span} broke away as the ${rebel}, under ${lead}${seat}.`,
        () => `The ${parent} fractured — ${lead} led ${span} into secession, proclaiming the ${rebel}${seat}.`,
        () => `Rebellion carved the ${rebel} from the ${parent}, ${span} rallying to ${lead}${seat}.`,
      ])();
    }

    case "WORLD_FORTUNE": {
      const faction = event.actors[0];
      const world = event.location?.name ?? "a frontier world";
      const holder = faction ? ` held by the ${faction.name}` : "";
      const byKind: Record<FortuneKind, (() => string)[]> = {
        discovery: [
          () => `Prospectors struck rich new deposits on ${world}${holder}.`,
          () => `A wealth of untapped resources came to light on ${world}${holder}.`,
          () => `${world}${holder} boomed as surveyors uncovered fresh lodes.`,
        ],
        depletion: [
          () => `The lodes of ${world}${holder} ran thin, dimming its yield.`,
          () => `${world}${holder} saw its once-rich seams played out.`,
          () => `Output from ${world}${holder} dwindled as its reserves gave out.`,
        ],
        disaster: [
          () => `Catastrophe swept ${world}${holder}, scattering its people.`,
          () => `Disaster struck ${world}${holder}, leaving ruin in its wake.`,
          () => `${world}${holder} was devastated, its settlements thrown into chaos.`,
        ],
      };
      return pickVariant(event, byKind[event.data.fortune])();
    }

    case "LEADERSHIP_CHANGE": {
      const f = event.actors[0].name;
      const { reason, tenure } = event.data;
      const out = styled(event.data.predecessor);
      const inc = styled(event.data.successor);
      const reign =
        tenure >= 2 ? `${tenure} cycles` : tenure === 1 ? "a single cycle" : "a brief tenure";
      const byReason: Record<LeadershipChange, (() => string)[]> = {
        succession: [
          () => `${out} of the ${f} passed after ${reign} in command; ${inc} took up the mantle.`,
          () => `After ${reign} at the helm of the ${f}, ${out} stepped down, and ${inc} succeeded.`,
          () => `The long service of ${out} ended; ${inc} now leads the ${f}.`,
        ],
        coup: [
          () => `Amid crisis, the ${f} cast down ${out}; ${inc} seized command.`,
          () => `${out} was deposed as the ${f} convulsed, and ${inc} took power.`,
          () => `A bloodless purge unseated ${out}; ${inc} now commands the ${f}.`,
        ],
        ascension: [
          () => `Borne up by victory, ${inc} supplanted ${out} atop the ${f}.`,
          () => `Flush from conquest, ${inc} eclipsed ${out} to lead the ${f}.`,
          () => `The triumphant ${inc} swept ${out} aside to command the ${f}.`,
        ],
      };
      return pickVariant(event, byReason[reason])();
    }

    case "DIPLOMACY": {
      const a = event.actors[0].name;
      const b = event.actors[1].name;
      const lead = styled(event.data.leader);
      const where = event.location ? ` along the ${event.location.name} frontier` : "";
      const byKind: Record<DiplomacyKind, (() => string)[]> = {
        pact: [
          () => `The ${a} and the ${b} signed a non-aggression pact${where}.`,
          () => `${lead} of the ${a} stayed the sword, pledging non-aggression with the ${b}.`,
          () => `A wary truce took hold as the ${a} and the ${b} swore off hostilities${where}.`,
        ],
        alliance: [
          () => `The ${a} and the ${b} forged an alliance${where}.`,
          () => `${lead} bound the ${a} to the ${b} in alliance.`,
          () => `Old ties deepened: the ${a} and the ${b} stood as allies.`,
        ],
        peace: [
          () => `The ${a} and the ${b} laid down their war and made peace${where}.`,
          () => `${lead} of the ${a} sued for peace, and the ${b} took the offered hand.`,
          () => `Exhausted by the fighting, the ${a} and the ${b} agreed a ceasefire.`,
        ],
        trade: [
          () => `The ${a} and the ${b} struck a trade accord, to the profit of both${where}.`,
          () => `Goods flowed between the ${a} and the ${b} under a new accord.`,
          () => `${lead} opened the lanes of the ${a} to the ${b}, and commerce flourished.`,
        ],
        threat: [
          () => `${lead} of the ${a} rattled the sabre at the ${b}${where}.`,
          () => `The ${a} issued an ultimatum to the ${b}, souring the peace.`,
          () => `Threats from the ${a} put the ${b} on notice${where}.`,
        ],
        betrayal: [
          () => `Breaking its pact, the ${a} turned on the ${b}${where}.`,
          () => `${lead} of the ${a} cast aside its word and struck the ${b}.`,
          () => `Treachery: the ${a} shattered its pact and fell upon the ${b}.`,
        ],
        renounce: [
          () => `${lead} of the ${a} renounced its pact with the ${b}${where}.`,
          () => `The ${a} cast off its treaty with the ${b}, and the old rancor returned.`,
          () => `Done with diplomacy, the ${a} let its pact with the ${b} lapse into hostility.`,
        ],
      };
      return pickVariant(event, byKind[event.data.kind])();
    }

    case "FACTION_DOCTRINE": {
      const f = event.actors[0].name;
      const lead = styled(event.data.leader);
      const byShift: Record<PostureShift, (() => string)[]> = {
        hegemonic: [
          () => `Commanding the sector, the ${f} cast off restraint and turned to open hegemony.`,
          () => `${lead} of the ${f}, now dominant, bent every effort toward mastery of the sector.`,
          () => `Ascendant above its rivals, the ${f} abandoned all caution for conquest.`,
        ],
        defensive: [
          () => `Bled below its height, the ${f} pulled back to a defensive footing.`,
          () => `${lead} of the ${f} set ambition aside, hunkering down to hold what remained.`,
          () => `Its reach overextended and its borders bleeding, the ${f} turned inward to recover.`,
        ],
      };
      return pickVariant(event, byShift[event.data.shift])();
    }

    case "SECTOR_CONCLUDED": {
      if (event.data.outcome === "unified") {
        const victor = event.actors[0]?.name ?? "a lone power";
        return pickVariant(event, [
          () => `The ${victor} stands unrivaled — the sector unifies under a single banner.`,
          () => `With every rival fallen, the ${victor} holds the sector alone.`,
          () => `The long contest ends: the ${victor} reigns over a unified sector.`,
        ])();
      }
      return pickVariant(event, [
        () => `Silence falls across the sector; no power remains to shape its history.`,
        () => `The last faction is gone, and the sector falls silent.`,
        () => `No power survives; the sector's history ends in darkness.`,
      ])();
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

/** Denormalize a leader into a prose-ready `LeaderRef` (issue #23). */
function leaderRef(leader: Leader): LeaderRef {
  return { name: leader.name, title: leader.title };
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
    data: { disposition: faction.disposition, leader: leaderRef(faction.leader) },
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
    data: { leader: leaderRef(faction.leader) },
  });
}

/** A faction withdraws from `world` (issue #39), returning it to the unclaimed pool. */
export function worldAbandoned(
  tick: number,
  faction: Faction,
  world: World,
): WorldAbandonedEvent {
  return withSummary<WorldAbandonedEvent>({
    type: "WORLD_ABANDONED",
    tick,
    actors: [ref(faction)],
    location: ref(world),
    data: { leader: leaderRef(faction.leader) },
  });
}

/**
 * A clash over `world`. `captured` is true when the attacker takes the world,
 * false when the defender holds. `campaign` threads it into an ongoing war
 * (issue #20); `push` records how the front moved (issue #24) — `breakthrough`
 * implies `captured`, `advance`/`repulse` do not.
 */
export function conflict(
  tick: number,
  attacker: Faction,
  defender: Faction,
  world: World,
  captured: boolean,
  campaign?: Campaign,
  push?: ConflictPush,
): ConflictEvent {
  const leader = leaderRef(attacker.leader);
  const data: ConflictEvent["data"] = { captured, leader };
  if (campaign) data.campaign = campaign;
  if (push) data.push = push;
  return withSummary<ConflictEvent>({
    type: "CONFLICT",
    tick,
    actors: [ref(attacker), ref(defender)],
    location: ref(world),
    data,
  });
}

/**
 * War is declared by `aggressor` upon `defender` (issue #24), optionally along
 * the `system` frontier it ignites on. Opens the arc that clashes continue.
 */
export function warDeclared(
  tick: number,
  aggressor: Faction,
  defender: Faction,
  system?: StarSystem,
): WarDeclaredEvent {
  return withSummary<WarDeclaredEvent>({
    type: "WAR_DECLARED",
    tick,
    actors: [ref(aggressor), ref(defender)],
    location: system ? ref(system) : undefined,
    data: { leader: leaderRef(aggressor.leader) },
  });
}

/**
 * A war ends decisively (issue #24). `victor` prevailed over `vanquished`;
 * `outcome` is `conquest` (the aggressor broke its foe) or `repelled` (the
 * defender outlasted the offensive). `since` is the war's opening cycle and
 * `clashes` the battles it took.
 */
export function warEnded(
  tick: number,
  victor: Faction,
  vanquished: Faction,
  outcome: WarOutcome,
  since: number,
  clashes: number,
): WarEndedEvent {
  return withSummary<WarEndedEvent>({
    type: "WAR_ENDED",
    tick,
    actors: [ref(victor), ref(vanquished)],
    data: { outcome, since, clashes, leader: leaderRef(victor.leader) },
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

/**
 * A rebel state secedes from its parent (issue #39). `rebel` is the new
 * faction (install its leader and worlds before calling); `worlds` (default:
 * its current holdings) is how many it carried off, and `homeSystem` its seat.
 */
export function factionSeceded(
  tick: number,
  rebel: Faction,
  parent: Faction,
  homeSystem?: StarSystem,
  worlds = rebel.ownedWorldIds.length,
): FactionSecededEvent {
  return withSummary<FactionSecededEvent>({
    type: "FACTION_SECEDED",
    tick,
    actors: [ref(rebel), ref(parent)],
    location: homeSystem ? ref(homeSystem) : undefined,
    data: {
      disposition: rebel.disposition,
      leader: leaderRef(rebel.leader),
      worlds,
    },
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
 * A faction's leadership turns over (issue #23). `faction.leader` is the new
 * incumbent (install the successor before calling); `predecessor` is the leader
 * they replaced, and `tenure` the cycles that predecessor served.
 */
export function leadershipChange(
  tick: number,
  faction: Faction,
  reason: LeadershipChange,
  predecessor: Leader,
  tenure: number,
  homeSystem?: StarSystem,
): LeadershipChangeEvent {
  return withSummary<LeadershipChangeEvent>({
    type: "LEADERSHIP_CHANGE",
    tick,
    actors: [ref(faction)],
    location: homeSystem ? ref(homeSystem) : undefined,
    data: {
      reason,
      predecessor: leaderRef(predecessor),
      successor: leaderRef(faction.leader),
      tenure,
    },
  });
}

/**
 * A political move between two powers (issue #24). `initiator` is the actor
 * driving it (the coercer of a threat, the betrayer of a betrayal); its leader
 * is named in the dispatch. `system`, when given, is the frontier they deal
 * across.
 */
export function diplomacy(
  tick: number,
  kind: DiplomacyKind,
  initiator: Faction,
  other: Faction,
  system?: StarSystem,
): DiplomacyEvent {
  return withSummary<DiplomacyEvent>({
    type: "DIPLOMACY",
    tick,
    actors: [ref(initiator), ref(other)],
    location: system ? ref(system) : undefined,
    data: { kind, leader: leaderRef(initiator.leader) },
  });
}

/**
 * A faction's strategic footing turns (issue #24). `shift` is the posture it has
 * entered — `defensive` for a battered power pulling back, `hegemonic` for an
 * ascendant one pressing for mastery; its leader is named in the dispatch.
 * `homeSystem`, when given, anchors the turn to the faction's seat.
 */
export function factionDoctrine(
  tick: number,
  faction: Faction,
  shift: PostureShift,
  homeSystem?: StarSystem,
): FactionDoctrineEvent {
  return withSummary<FactionDoctrineEvent>({
    type: "FACTION_DOCTRINE",
    tick,
    actors: [ref(faction)],
    location: homeSystem ? ref(homeSystem) : undefined,
    data: { shift, leader: leaderRef(faction.leader) },
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
