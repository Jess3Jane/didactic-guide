// News feed UI — renders the engine's chronicle (GDD §4, issue #6).
//
// The feed is the primary view: a reverse-chronological stream of dispatches,
// each turning one `WorldEvent` into a readable line of in-world news. This is
// the presentation layer, so unlike `src/sim/` it touches the DOM — but the
// boundary still runs one way: `ui/` reads `sim/` types, never the reverse.
//
// Two halves live here, mirroring the split that keeps `sim/` testable:
//   1. `toDispatch` — a pure event → view-model mapping (cycle label, tags,
//      category, prose). No DOM, so it unit-tests in plain Node.
//   2. `createFeed` — a small stateful component that renders dispatches into
//      the DOM, newest first, capping how many it keeps so a long run stays
//      responsive.

import type { FortuneKind, WorldEvent, WorldEventType } from "../sim/events";

// --- View model --------------------------------------------------------------

/**
 * A broad category per event type, used only for styling (a colour accent on
 * the dispatch). Kept separate from `WorldEventType` so the palette can stay
 * coarse even as the event vocabulary grows.
 */
export type DispatchCategory =
  | "founding"
  | "expansion"
  | "conflict"
  | "crisis"
  | "contact"
  | "collapse";

/** The render-ready shape of a single dispatch. Pure data — no DOM. */
export interface Dispatch {
  /** In-world cycle the event occurred on. */
  cycle: number;
  /** Human label for the event type, e.g. "First Contact". */
  kind: string;
  /** Coarse category driving the colour accent. */
  category: DispatchCategory;
  /** Primary faction tag (first actor), if any. */
  faction?: string;
  /** Location tag (world or system), if the event carries one. */
  location: string | undefined;
  /** The prose dispatch, taken straight from the event's `summary`. */
  summary: string;
}

/** Per-type label + category. One entry per `WorldEventType`. */
const TYPE_META: Record<
  WorldEventType,
  { kind: string; category: DispatchCategory }
> = {
  FACTION_FOUNDED: { kind: "Founding", category: "founding" },
  WORLD_COLONIZED: { kind: "Colonization", category: "expansion" },
  CONFLICT: { kind: "Conflict", category: "conflict" },
  RESOURCE_CRISIS: { kind: "Crisis", category: "crisis" },
  FIRST_CONTACT: { kind: "First Contact", category: "contact" },
  FACTION_COLLAPSED: { kind: "Collapse", category: "collapse" },
  // Placeholder; WORLD_FORTUNE's label + colour vary by its fortune kind and
  // are resolved per-event in `toDispatch`, not from this static table.
  WORLD_FORTUNE: { kind: "Fortune", category: "crisis" },
};

/** Per-fortune label + category, so a discovery reads as good news, not crisis. */
const FORTUNE_META: Record<
  FortuneKind,
  { kind: string; category: DispatchCategory }
> = {
  discovery: { kind: "Discovery", category: "expansion" },
  depletion: { kind: "Depletion", category: "crisis" },
  disaster: { kind: "Disaster", category: "crisis" },
};

/**
 * Project a `WorldEvent` onto its render-ready `Dispatch`.
 *
 * Pure and DOM-free: it only reads fields the event already carries (including
 * the prose `summary` stamped at construction), so it is safe to unit-test in
 * Node and cheap to call per event.
 */
export function toDispatch(event: WorldEvent): Dispatch {
  const meta =
    event.type === "WORLD_FORTUNE"
      ? FORTUNE_META[event.data.fortune]
      : TYPE_META[event.type];
  return {
    cycle: event.tick,
    kind: meta.kind,
    category: meta.category,
    faction: event.actors[0]?.name,
    location: event.location?.name,
    summary: event.summary,
  };
}

// --- Component ---------------------------------------------------------------

export interface FeedOptions {
  /**
   * Maximum dispatches kept in the DOM at once. Older ones are trimmed off the
   * bottom so the feed never grows without bound over a long simulation.
   */
  maxEntries?: number;
}

/**
 * A live news feed bound to a root element.
 *
 * `push` prepends a batch of newly-emitted events (newest on top); `reset`
 * clears the feed for a fresh sector. The caller owns the wiring to the engine
 * (that lives in `main.ts`, issue #7) — the feed only knows how to render.
 */
export interface Feed {
  /** The root element to mount in the page. */
  readonly element: HTMLElement;
  /** Prepend a batch of events in emission order; the last shows on top. */
  push(events: readonly WorldEvent[]): void;
  /** Replace the feed's contents, optionally seeding it with `events`. */
  reset(events?: readonly WorldEvent[]): void;
  /** How many dispatches are currently in the DOM. */
  size(): number;
}

const DEFAULT_MAX_ENTRIES = 300;

/** Build the DOM node for a single dispatch. */
function renderDispatch(doc: Document, d: Dispatch): HTMLElement {
  const article = doc.createElement("article");
  article.className = `dispatch dispatch--${d.category}`;
  article.setAttribute("role", "article");
  article.setAttribute(
    "aria-label",
    `Cycle ${d.cycle}, ${d.kind}: ${d.summary}`,
  );

  const meta = doc.createElement("header");
  meta.className = "dispatch__meta";

  const cycle = doc.createElement("span");
  cycle.className = "dispatch__cycle";
  cycle.textContent = `Cycle ${d.cycle}`;
  meta.append(cycle);

  const kind = doc.createElement("span");
  kind.className = "dispatch__kind";
  kind.textContent = d.kind;
  meta.append(kind);

  if (d.faction) {
    const faction = doc.createElement("span");
    faction.className = "dispatch__tag dispatch__tag--faction";
    faction.textContent = d.faction;
    meta.append(faction);
  }

  if (d.location) {
    const loc = doc.createElement("span");
    loc.className = "dispatch__tag dispatch__tag--loc";
    loc.textContent = d.location;
    meta.append(loc);
  }

  const summary = doc.createElement("p");
  summary.className = "dispatch__summary";
  summary.textContent = d.summary;

  article.append(meta, summary);
  return article;
}

/**
 * Create a news feed inside a fresh `<section role="feed">`.
 *
 * The section is returned on `element` for the caller to mount; nothing is
 * appended to the document automatically.
 */
export function createFeed(options: FeedOptions = {}): Feed {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const doc = document;

  const element = doc.createElement("section");
  element.className = "feed";
  element.setAttribute("role", "feed");
  element.setAttribute("aria-label", "World chronicle");
  element.setAttribute("aria-busy", "false");

  // Shown only while the feed is empty; removed as soon as events arrive.
  const empty = doc.createElement("p");
  empty.className = "feed__empty";
  empty.textContent = "No dispatches yet — generate a sector and press play.";
  element.append(empty);

  const hasDispatches = (): boolean =>
    element.querySelector(".dispatch") !== null;

  const syncEmpty = (): void => {
    const present = hasDispatches();
    empty.hidden = present;
    if (present && empty.parentElement) empty.remove();
    else if (!present && !empty.parentElement) element.append(empty);
  };

  /** Drop oldest dispatches (bottom of the feed) past the cap. */
  const trim = (): void => {
    while (element.querySelectorAll(".dispatch").length > maxEntries) {
      element.lastElementChild?.remove();
    }
  };

  const push = (events: readonly WorldEvent[]): void => {
    if (events.length === 0) return;

    // Build the batch newest-first into a fragment, then splice it above the
    // current top in one DOM write. Reversing here means that within a single
    // tick the last-emitted event reads first, matching reverse-chronological
    // order at finer-than-tick granularity.
    const fragment = doc.createDocumentFragment();
    for (let i = events.length - 1; i >= 0; i--) {
      fragment.append(renderDispatch(doc, toDispatch(events[i])));
    }

    const firstDispatch = element.querySelector(".dispatch");
    if (firstDispatch) element.insertBefore(fragment, firstDispatch);
    else element.append(fragment);

    trim();
    syncEmpty();
  };

  const reset = (events: readonly WorldEvent[] = []): void => {
    for (const node of [...element.querySelectorAll(".dispatch")]) {
      node.remove();
    }
    syncEmpty();
    push(events);
  };

  const size = (): number => element.querySelectorAll(".dispatch").length;

  return { element, push, reset, size };
}
