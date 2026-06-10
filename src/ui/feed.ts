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
//      responsive. It also owns the feed's *filters* (issue #26): a long,
//      sustained history stays navigable when the viewer can narrow it to one
//      faction and/or one kind of event. Filtering is a pure view concern over
//      the same stream — dispatches are never dropped, only shown or hidden —
//      so it lives here rather than in the engine.

import type {
  DiplomacyKind,
  FortuneKind,
  WorldEvent,
  WorldEventType,
} from "../sim/events";
import type { PostureShift } from "../sim/posture";

// --- View model --------------------------------------------------------------

/**
 * A broad category per event type, used both for styling (a colour accent on
 * the dispatch) and as the "event type" axis of the feed filter (issue #26).
 * Kept separate from `WorldEventType` so the palette — and the filter — can
 * stay coarse and legible even as the event vocabulary grows.
 *
 * Each event maps to exactly one filter category (enforced by test, issue
 * #42); when an event should *read* differently from how it *filters* — a
 * negotiated peace files under Conflict but shouldn't glow red — the meta
 * entry carries a separate visual `accent`.
 */
export type DispatchCategory =
  | "founding"
  | "expansion"
  | "conflict"
  | "crisis"
  | "contact"
  | "collapse"
  | "leadership"
  | "doctrine"
  | "diplomacy"
  | "conclusion";

/** The render-ready shape of a single dispatch. Pure data — no DOM. */
export interface Dispatch {
  /** In-world cycle the event occurred on. */
  cycle: number;
  /** Human label for the event type, e.g. "First Contact". */
  kind: string;
  /** Coarse category driving the event-type filter (issue #26). */
  category: DispatchCategory;
  /** Colour accent for styling; usually `category`, but may differ (#42). */
  accent: DispatchCategory;
  /** Primary faction tag (first actor), if any. */
  faction?: string;
  /** Location tag (world or system), if the event carries one. */
  location: string | undefined;
  /** The prose dispatch, taken straight from the event's `summary`. */
  summary: string;
}

/**
 * Label, filter category, and (when it differs) visual accent for one event
 * type or sub-kind. `accent` defaults to `category` in `toDispatch`.
 */
interface DispatchMeta {
  kind: string;
  category: DispatchCategory;
  accent?: DispatchCategory;
}

/** Per-type label + category. One entry per `WorldEventType`. */
const TYPE_META: Record<WorldEventType, DispatchMeta> = {
  FACTION_FOUNDED: { kind: "Founding", category: "founding" },
  WORLD_COLONIZED: { kind: "Colonization", category: "expansion" },
  WAR_DECLARED: { kind: "War Declared", category: "conflict" },
  CONFLICT: { kind: "Conflict", category: "conflict" },
  WAR_ENDED: { kind: "War's End", category: "conflict" },
  RESOURCE_CRISIS: { kind: "Crisis", category: "crisis" },
  FIRST_CONTACT: { kind: "First Contact", category: "contact" },
  FACTION_COLLAPSED: { kind: "Collapse", category: "collapse" },
  // Placeholder; WORLD_FORTUNE's label + colour vary by its fortune kind and
  // are resolved per-event in `toDispatch`, not from this static table.
  WORLD_FORTUNE: { kind: "Fortune", category: "crisis" },
  LEADERSHIP_CHANGE: { kind: "Leadership", category: "leadership" },
  // Placeholder; DIPLOMACY's label + colour vary by its kind and are resolved
  // per-event in `toDispatch`, not from this static table.
  DIPLOMACY: { kind: "Diplomacy", category: "diplomacy" },
  // Placeholder; FACTION_DOCTRINE's label varies by its shift (defensive vs.
  // hegemonic) and is resolved per-event in `toDispatch`, not from this table.
  FACTION_DOCTRINE: { kind: "Doctrine", category: "doctrine" },
  SECTOR_CONCLUDED: { kind: "Epilogue", category: "conclusion" },
};

/**
 * Per-doctrine-shift label, so a hegemonic turn and a defensive retrenchment read
 * apart at a glance. Both share the `doctrine` accent. The category is fixed; the
 * label is resolved per-event in `toDispatch`.
 */
const DOCTRINE_META: Record<PostureShift, { kind: string }> = {
  hegemonic: { kind: "Hegemony" },
  defensive: { kind: "Retrenchment" },
};

/** Per-fortune label + category, so a discovery reads as good news, not crisis. */
const FORTUNE_META: Record<FortuneKind, DispatchMeta> = {
  discovery: { kind: "Discovery", category: "expansion" },
  depletion: { kind: "Depletion", category: "crisis" },
  disaster: { kind: "Disaster", category: "crisis" },
};

/**
 * Per-diplomacy-kind label + category. The war-adjacent kinds file under
 * `conflict` so the Conflict filter shows a war's whole arc — the ultimatum
 * that presages it, the betrayal that opens it, the peace that closes it
 * (issue #42); wars also end as `WAR_ENDED`, already conflict. A `threat` or
 * `betrayal` is a hostile turn and wears the `conflict` red, but a `peace` is
 * good news ending a war, so it keeps the calm `diplomacy` accent while still
 * filtering with the war it concludes. The genuinely peacetime beats — pact,
 * alliance, trade — stay under `diplomacy`.
 */
const DIPLOMACY_META: Record<DiplomacyKind, DispatchMeta> = {
  pact: { kind: "Pact", category: "diplomacy" },
  alliance: { kind: "Alliance", category: "diplomacy" },
  peace: { kind: "Peace", category: "conflict", accent: "diplomacy" },
  trade: { kind: "Trade", category: "diplomacy" },
  threat: { kind: "Ultimatum", category: "conflict" },
  betrayal: { kind: "Betrayal", category: "conflict" },
};

/**
 * The categories the event-type filter offers, in a stable, curated order, with
 * a viewer-facing label for each. The dropdown only ever lists a category once
 * it has actually appeared this run (see `createFeed`), so an empty sector shows
 * no spurious filters — but when it does list them, this fixes their order.
 */
export const CATEGORY_ORDER: readonly DispatchCategory[] = [
  "founding",
  "expansion",
  "conflict",
  "crisis",
  "contact",
  "collapse",
  "leadership",
  "doctrine",
  "diplomacy",
  "conclusion",
];

export const CATEGORY_FILTER_LABEL: Record<DispatchCategory, string> = {
  founding: "Foundings",
  expansion: "Expansion",
  conflict: "Conflict",
  crisis: "Crises",
  contact: "First Contact",
  collapse: "Collapse",
  leadership: "Leadership",
  doctrine: "Doctrine",
  diplomacy: "Diplomacy",
  conclusion: "Epilogue",
};

/**
 * Project a `WorldEvent` onto its render-ready `Dispatch`.
 *
 * Pure and DOM-free: it only reads fields the event already carries (including
 * the prose `summary` stamped at construction), so it is safe to unit-test in
 * Node and cheap to call per event.
 */
export function toDispatch(event: WorldEvent): Dispatch {
  const meta: DispatchMeta =
    event.type === "WORLD_FORTUNE"
      ? FORTUNE_META[event.data.fortune]
      : event.type === "DIPLOMACY"
        ? DIPLOMACY_META[event.data.kind]
        : event.type === "FACTION_DOCTRINE"
          ? { kind: DOCTRINE_META[event.data.shift].kind, category: "doctrine" }
          : TYPE_META[event.type];
  return {
    cycle: event.tick,
    kind: meta.kind,
    category: meta.category,
    accent: meta.accent ?? meta.category,
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
  /** How many dispatches are currently in the DOM (regardless of filters). */
  size(): number;
}

const DEFAULT_MAX_ENTRIES = 300;

/**
 * Build the DOM node for a single dispatch.
 *
 * The faction and category are also stamped onto `data-` attributes so the
 * filter can show/hide an existing dispatch without re-deriving its tags.
 */
function renderDispatch(doc: Document, d: Dispatch): HTMLElement {
  const article = doc.createElement("article");
  // The class drives the colour accent, the data attribute the filter; they
  // usually agree, but e.g. a Peace files under Conflict yet reads calm (#42).
  article.className = `dispatch dispatch--${d.accent}`;
  article.setAttribute("role", "article");
  article.setAttribute(
    "aria-label",
    `Cycle ${d.cycle}, ${d.kind}: ${d.summary}`,
  );
  article.dataset.category = d.category;
  if (d.faction) article.dataset.faction = d.faction;

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

  // --- Filter bar (issue #26) -----------------------------------------------
  //
  // Two axes — faction and event type — each a `<select>` that starts on "all"
  // and only grows options the run has actually produced, so the controls match
  // the chronicle in front of you. A Clear button and a live "showing N of M"
  // count make the active filter obvious and reversible.

  const filters = doc.createElement("div");
  filters.className = "feed__filters";
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "Filter the chronicle");

  const factionSelect = doc.createElement("select");
  factionSelect.className = "feed__filter feed__filter--faction";
  factionSelect.setAttribute("aria-label", "Filter by faction");

  const typeSelect = doc.createElement("select");
  typeSelect.className = "feed__filter feed__filter--type";
  typeSelect.setAttribute("aria-label", "Filter by event type");

  const count = doc.createElement("span");
  count.className = "feed__filter-count";
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");
  count.hidden = true;

  const clearButton = doc.createElement("button");
  clearButton.type = "button";
  clearButton.className = "feed__filter-clear";
  clearButton.textContent = "Clear filters";
  clearButton.hidden = true;

  filters.append(factionSelect, typeSelect, count, clearButton);
  element.append(filters);

  // Shown only while the feed is empty; removed as soon as events arrive.
  const empty = doc.createElement("p");
  empty.className = "feed__empty";
  empty.textContent = "No dispatches yet — generate a sector and press play.";
  element.append(empty);

  // Shown when the feed holds dispatches but the active filter hides them all —
  // a distinct, reassuring "nothing here *under this filter*" rather than the
  // cold "nothing has happened yet" of the empty state above.
  const filteredEmpty = doc.createElement("p");
  filteredEmpty.className = "feed__empty feed__empty--filtered";
  filteredEmpty.textContent = "No dispatches match the current filter.";

  // The filter vocabulary seen so far this run. Factions are listed
  // alphabetically; categories follow `CATEGORY_ORDER`.
  const knownFactions = new Set<string>();
  const knownCategories = new Set<DispatchCategory>();

  const allDispatches = (): NodeListOf<Element> =>
    element.querySelectorAll(".dispatch");
  const visibleCount = (): number =>
    element.querySelectorAll(".dispatch:not([hidden])").length;

  const isFiltering = (): boolean =>
    factionSelect.value !== "" || typeSelect.value !== "";

  /** Does a dispatch with this faction/category pass the active filter? */
  const matches = (
    faction: string | undefined,
    category: string,
  ): boolean => {
    if (factionSelect.value && faction !== factionSelect.value) return false;
    if (typeSelect.value && category !== typeSelect.value) return false;
    return true;
  };

  /** Rebuild a `<select>`'s options, preserving the current selection. */
  const fillSelect = (
    select: HTMLSelectElement,
    allLabel: string,
    values: readonly string[],
    labelOf: (value: string) => string,
  ): void => {
    const current = select.value;
    select.textContent = "";
    const all = doc.createElement("option");
    all.value = "";
    all.textContent = allLabel;
    select.append(all);
    for (const value of values) {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = labelOf(value);
      select.append(option);
    }
    // Selection survives because options only ever accrete, never disappear.
    select.value = current;
  };

  const rebuildFilters = (): void => {
    const factions = [...knownFactions].sort((a, b) => a.localeCompare(b));
    fillSelect(factionSelect, "All factions", factions, (f) => f);
    const categories = CATEGORY_ORDER.filter((c) => knownCategories.has(c));
    fillSelect(typeSelect, "All events", categories, (c) =>
      CATEGORY_FILTER_LABEL[c as DispatchCategory],
    );
  };

  /** Reflect filter state: active styling, the Clear button, and the count. */
  const syncFilterUI = (): void => {
    const filtering = isFiltering();
    filters.classList.toggle("feed__filters--active", filtering);
    clearButton.hidden = !filtering;
    if (filtering) {
      count.textContent = `Showing ${visibleCount()} of ${allDispatches().length}`;
      count.hidden = false;
    } else {
      count.textContent = "";
      count.hidden = true;
    }
  };

  /** Show the right placeholder: none, empty, or "filtered to nothing". */
  const syncEmpty = (): void => {
    const total = allDispatches().length;
    const showEmpty = total === 0;
    if (showEmpty && !empty.parentElement) element.append(empty);
    else if (!showEmpty && empty.parentElement) empty.remove();

    const showFiltered = total > 0 && visibleCount() === 0;
    if (showFiltered && !filteredEmpty.parentElement) {
      element.append(filteredEmpty);
    } else if (!showFiltered && filteredEmpty.parentElement) {
      filteredEmpty.remove();
    }
  };

  /** Apply the active filter to every dispatch already in the DOM. */
  const applyFilters = (): void => {
    for (const node of allDispatches()) {
      const el = node as HTMLElement;
      el.hidden = !matches(el.dataset.faction || undefined, el.dataset.category ?? "");
    }
    syncEmpty();
    syncFilterUI();
  };

  /** Drop oldest dispatches (bottom of the feed) past the cap. */
  const trim = (): void => {
    let dispatches = allDispatches();
    while (dispatches.length > maxEntries) {
      dispatches[dispatches.length - 1].remove();
      dispatches = allDispatches();
    }
  };

  const push = (events: readonly WorldEvent[]): void => {
    if (events.length === 0) return;

    // Project once; the dispatches drive both the filter vocabulary and the DOM.
    const dispatches = events.map(toDispatch);

    // Grow the filter dropdowns to cover any faction/category new this batch, so
    // the controls always offer exactly what the chronicle contains.
    let vocabularyGrew = false;
    for (const d of dispatches) {
      if (d.faction && !knownFactions.has(d.faction)) {
        knownFactions.add(d.faction);
        vocabularyGrew = true;
      }
      if (!knownCategories.has(d.category)) {
        knownCategories.add(d.category);
        vocabularyGrew = true;
      }
    }
    if (vocabularyGrew) rebuildFilters();

    // Build the batch newest-first into a fragment, then splice it above the
    // current top in one DOM write. Reversing here means that within a single
    // tick the last-emitted event reads first, matching reverse-chronological
    // order at finer-than-tick granularity. New dispatches honour the active
    // filter at birth, so a live run never flashes a hidden one into view.
    const fragment = doc.createDocumentFragment();
    for (let i = dispatches.length - 1; i >= 0; i--) {
      const d = dispatches[i];
      const node = renderDispatch(doc, d);
      node.hidden = !matches(d.faction, d.category);
      fragment.append(node);
    }

    const firstDispatch = element.querySelector(".dispatch");
    if (firstDispatch) element.insertBefore(fragment, firstDispatch);
    else element.append(fragment);

    trim();
    syncEmpty();
    syncFilterUI();
  };

  const reset = (events: readonly WorldEvent[] = []): void => {
    for (const node of [...allDispatches()]) {
      node.remove();
    }
    // A fresh sector starts a fresh vocabulary: drop the old factions/categories
    // and return to the unfiltered view before reseeding.
    knownFactions.clear();
    knownCategories.clear();
    factionSelect.value = "";
    typeSelect.value = "";
    rebuildFilters();
    syncEmpty();
    syncFilterUI();
    push(events);
  };

  const size = (): number => allDispatches().length;

  factionSelect.addEventListener("change", applyFilters);
  typeSelect.addEventListener("change", applyFilters);
  clearButton.addEventListener("click", () => {
    factionSelect.value = "";
    typeSelect.value = "";
    applyFilters();
  });

  rebuildFilters();
  syncFilterUI();

  return { element, push, reset, size };
}
