// @vitest-environment jsdom
import { describe as group, it, expect, beforeEach } from "vitest";
import type { Faction, StarSystem, World } from "../sim/world";
import {
  factionFounded,
  factionSeceded,
  worldColonized,
  worldAbandoned,
  conflict,
  warDeclared,
  warEnded,
  diplomacy,
  resourceCrisis,
  firstContact,
  factionCollapsed,
  worldFortune,
  leadershipChange,
  factionDoctrine,
  sectorConcluded,
  EVENT_TYPES,
  type DiplomacyKind,
  type FortuneKind,
  type WorldEvent,
  type WorldEventType,
} from "../sim/events";
import type { PostureShift } from "../sim/posture";
import {
  CATEGORY_FILTER_LABEL,
  CATEGORY_ORDER,
  createFeed,
  toDispatch,
} from "./feed";

// --- Fixtures ----------------------------------------------------------------
// The feed only reads id/name/disposition off the domain objects, so minimal
// hand-built entities (mirroring events.test.ts) are enough.

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
  habitability: 0.6,
  resourceRichness: 0.7,
  hazard: 0.2,
};

const helionHome: StarSystem = {
  id: "sys-0",
  name: "Helion",
  position: { x: 0, y: 0 },
  worldIds: ["sys-0-w0"],
};

// --- Pure view-model: toDispatch ---------------------------------------------

group("toDispatch", () => {
  it("maps cycle, faction, location, and prose off the event", () => {
    const event = worldColonized(7, helion, vex);
    const d = toDispatch(event);
    expect(d.cycle).toBe(7);
    expect(d.faction).toBe("Helion Compact");
    expect(d.location).toBe("Vex-9");
    expect(d.summary).toBe(event.summary);
  });

  it("labels each event type with a kind and category", () => {
    expect(toDispatch(factionFounded(0, helion, helionHome)).category).toBe(
      "founding",
    );
    expect(toDispatch(worldColonized(1, helion, vex)).category).toBe(
      "expansion",
    );
    expect(toDispatch(conflict(2, iron, helion, vex, true)).category).toBe(
      "conflict",
    );
    expect(toDispatch(resourceCrisis(3, helion, "energy")).category).toBe(
      "crisis",
    );
    expect(toDispatch(firstContact(4, helion, iron)).category).toBe("contact");
    expect(toDispatch(factionCollapsed(5, iron)).category).toBe("collapse");
    const handover = leadershipChange(
      6,
      helion,
      "succession",
      { name: "Old Hand", title: "Prefect", trait: "stoic", since: 0 },
      6,
    );
    expect(toDispatch(handover).category).toBe("leadership");
    expect(toDispatch(handover).kind).toBe("Leadership");
    expect(toDispatch(firstContact(4, helion, iron)).kind).toBe(
      "First Contact",
    );
    const epilogue = toDispatch(sectorConcluded(40, "unified", helion));
    expect(epilogue.category).toBe("conclusion");
    expect(epilogue.kind).toBe("Epilogue");
  });

  it("colours FACTION_DOCTRINE by its shift, under the doctrine category", () => {
    const hegemony = toDispatch(factionDoctrine(7, helion, "hegemonic"));
    expect(hegemony.category).toBe("doctrine");
    expect(hegemony.kind).toBe("Hegemony");

    const retrench = toDispatch(factionDoctrine(7, iron, "defensive"));
    expect(retrench.category).toBe("doctrine");
    expect(retrench.kind).toBe("Retrenchment");
  });

  it("leaves location undefined when the event carries none", () => {
    const d = toDispatch(factionCollapsed(9, iron));
    expect(d.location).toBeUndefined();
  });

  it("files a war's whole arc under conflict — ultimatum through peace (#42)", () => {
    expect(toDispatch(diplomacy(1, "threat", iron, helion)).category).toBe(
      "conflict",
    );
    expect(toDispatch(warDeclared(2, iron, helion)).category).toBe("conflict");
    expect(toDispatch(conflict(3, iron, helion, vex, false)).category).toBe(
      "conflict",
    );
    expect(toDispatch(diplomacy(4, "betrayal", iron, helion)).category).toBe(
      "conflict",
    );
    expect(
      toDispatch(warEnded(5, helion, iron, "repelled", 2, 3)).category,
    ).toBe("conflict");

    // A negotiated peace closes the arc, so it filters with the war — but it
    // is good news, so it keeps the calm diplomacy accent rather than red.
    const peace = toDispatch(diplomacy(6, "peace", iron, helion));
    expect(peace.category).toBe("conflict");
    expect(peace.accent).toBe("diplomacy");

    // Peacetime diplomacy stays out of the war arc.
    expect(toDispatch(diplomacy(7, "trade", iron, helion)).category).toBe(
      "diplomacy",
    );
    expect(toDispatch(diplomacy(8, "pact", iron, helion)).category).toBe(
      "diplomacy",
    );
  });

  it("colours WORLD_FORTUNE by its kind — discovery is good news", () => {
    const discovery = toDispatch(worldFortune(6, helion, vex, "discovery"));
    expect(discovery.category).toBe("expansion");
    expect(discovery.kind).toBe("Discovery");

    const disaster = toDispatch(worldFortune(6, helion, vex, "disaster"));
    expect(disaster.category).toBe("crisis");
    expect(disaster.kind).toBe("Disaster");

    expect(toDispatch(worldFortune(6, helion, vex, "depletion")).category).toBe(
      "crisis",
    );
  });
});

// --- Component: createFeed ---------------------------------------------------

const cyclesInOrder = (feed: { element: HTMLElement }): number[] =>
  [...feed.element.querySelectorAll(".dispatch__cycle")].map((n) =>
    Number(n.textContent!.replace("Cycle ", "")),
  );

group("createFeed", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("starts empty with an accessible feed role and a placeholder", () => {
    const feed = createFeed();
    expect(feed.element.getAttribute("role")).toBe("feed");
    expect(feed.element.getAttribute("aria-label")).toBeTruthy();
    expect(feed.size()).toBe(0);
    expect(feed.element.querySelector(".feed__empty")).not.toBeNull();
  });

  it("renders a dispatch with cycle, tags, and prose", () => {
    const feed = createFeed();
    feed.push([worldColonized(3, helion, vex)]);

    const dispatch = feed.element.querySelector(".dispatch")!;
    expect(dispatch.querySelector(".dispatch__cycle")!.textContent).toBe(
      "Cycle 3",
    );
    expect(
      dispatch.querySelector(".dispatch__tag--faction")!.textContent,
    ).toBe("Helion Compact");
    expect(dispatch.querySelector(".dispatch__tag--loc")!.textContent).toBe(
      "Vex-9",
    );
    expect(dispatch.querySelector(".dispatch__summary")!.textContent).toBe(
      worldColonized(3, helion, vex).summary,
    );
    expect(dispatch.classList.contains("dispatch--expansion")).toBe(true);
  });

  it("removes the placeholder once dispatches arrive", () => {
    const feed = createFeed();
    expect(feed.element.querySelector(".feed__empty")).not.toBeNull();
    feed.push([factionFounded(0, helion, helionHome)]);
    expect(feed.element.querySelector(".feed__empty")).toBeNull();
  });

  it("shows newer ticks above older ones (reverse-chronological)", () => {
    const feed = createFeed();
    feed.push([factionFounded(0, helion, helionHome)]);
    feed.push([worldColonized(1, helion, vex)]);
    feed.push([conflict(2, iron, helion, vex, false)]);
    expect(cyclesInOrder(feed)).toEqual([2, 1, 0]);
  });

  it("orders within a batch so the last-emitted reads first", () => {
    const feed = createFeed();
    // Same tick, distinct events; emission order [a, b] should render [b, a].
    const batch: WorldEvent[] = [
      worldColonized(5, helion, vex),
      conflict(5, iron, helion, vex, true),
    ];
    feed.push(batch);
    const kinds = [...feed.element.querySelectorAll(".dispatch__kind")].map(
      (n) => n.textContent,
    );
    expect(kinds).toEqual(["Conflict", "Colonization"]);
  });

  it("caps DOM growth at maxEntries, dropping the oldest", () => {
    const feed = createFeed({ maxEntries: 5 });
    for (let t = 0; t < 50; t++) {
      feed.push([worldColonized(t, helion, vex)]);
    }
    expect(feed.size()).toBe(5);
    // The five most recent cycles survive, newest first.
    expect(cyclesInOrder(feed)).toEqual([49, 48, 47, 46, 45]);
  });

  it("reset clears existing dispatches and can reseed", () => {
    const feed = createFeed();
    feed.push([worldColonized(1, helion, vex)]);
    feed.reset([factionFounded(0, helion, helionHome)]);
    expect(feed.size()).toBe(1);
    expect(cyclesInOrder(feed)).toEqual([0]);

    feed.reset();
    expect(feed.size()).toBe(0);
    expect(feed.element.querySelector(".feed__empty")).not.toBeNull();
  });

  it("ignores an empty push", () => {
    const feed = createFeed();
    feed.push([]);
    expect(feed.size()).toBe(0);
    expect(feed.element.querySelector(".feed__empty")).not.toBeNull();
  });
});

// --- Filtering (issue #26) ---------------------------------------------------

const visibleCycles = (feed: { element: HTMLElement }): number[] =>
  [...feed.element.querySelectorAll(".dispatch:not([hidden])")].map((n) =>
    Number(n.querySelector(".dispatch__cycle")!.textContent!.replace("Cycle ", "")),
  );

const factionFilter = (feed: { element: HTMLElement }): HTMLSelectElement =>
  feed.element.querySelector(".feed__filter--faction")!;
const typeFilter = (feed: { element: HTMLElement }): HTMLSelectElement =>
  feed.element.querySelector(".feed__filter--type")!;

/** Pick a `<select>` value and fire the change the UI listens for. */
const choose = (select: HTMLSelectElement, value: string): void => {
  select.value = value;
  select.dispatchEvent(new Event("change"));
};

const optionValues = (select: HTMLSelectElement): string[] =>
  [...select.options].map((o) => o.value);

group("feed filtering", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("offers a filter bar that starts unfiltered", () => {
    const feed = createFeed();
    expect(factionFilter(feed)).not.toBeNull();
    expect(typeFilter(feed)).not.toBeNull();
    // Only the "all" option until events arrive; nothing claims to filter yet.
    expect(optionValues(factionFilter(feed))).toEqual([""]);
    expect(optionValues(typeFilter(feed))).toEqual([""]);
    expect(
      feed.element.querySelector<HTMLButtonElement>(".feed__filter-clear")!
        .hidden,
    ).toBe(true);
  });

  it("grows faction + type options to match the chronicle", () => {
    const feed = createFeed();
    feed.push([factionFounded(0, helion, helionHome)]);
    feed.push([conflict(2, iron, helion, vex, true)]);

    expect(optionValues(factionFilter(feed))).toEqual([
      "",
      "Helion Compact",
      "Iron Dominion",
    ]);
    // Categories follow the curated order, not arrival order.
    expect(optionValues(typeFilter(feed))).toEqual([
      "",
      "founding",
      "conflict",
    ]);
  });

  it("narrows the feed to one faction and restores on clear", () => {
    const feed = createFeed();
    feed.push([factionFounded(0, helion, helionHome)]);
    feed.push([worldColonized(1, helion, vex)]);
    feed.push([conflict(2, iron, helion, vex, true)]);

    choose(factionFilter(feed), "Iron Dominion");
    // Conflict lists the attacker (iron) first, so only that dispatch shows.
    expect(visibleCycles(feed)).toEqual([2]);

    choose(factionFilter(feed), "");
    expect(visibleCycles(feed)).toEqual([2, 1, 0]);
  });

  it("narrows by event type", () => {
    const feed = createFeed();
    feed.push([factionFounded(0, helion, helionHome)]);
    feed.push([worldColonized(1, helion, vex)]);
    feed.push([worldColonized(3, iron, vex)]);

    choose(typeFilter(feed), "expansion");
    expect(visibleCycles(feed)).toEqual([3, 1]);
  });

  it("combines faction and type filters", () => {
    const feed = createFeed();
    feed.push([worldColonized(1, helion, vex)]);
    feed.push([worldColonized(2, iron, vex)]);
    feed.push([conflict(3, helion, iron, vex, true)]);

    choose(factionFilter(feed), "Helion Compact");
    choose(typeFilter(feed), "expansion");
    expect(visibleCycles(feed)).toEqual([1]);
  });

  it("applies the active filter to dispatches arriving live", () => {
    const feed = createFeed();
    feed.push([worldColonized(1, helion, vex)]);
    choose(factionFilter(feed), "Helion Compact");

    // A rival's dispatch lands while the filter is set — it must stay hidden.
    feed.push([conflict(2, iron, helion, vex, true)]);
    expect(visibleCycles(feed)).toEqual([1]);
    // ...but a matching one shows immediately.
    feed.push([worldColonized(3, helion, vex)]);
    expect(visibleCycles(feed)).toEqual([3, 1]);
  });

  it("shows a distinct placeholder when a filter hides everything", () => {
    const feed = createFeed();
    feed.push([worldColonized(1, helion, vex)]);
    feed.push([conflict(2, iron, helion, vex, true)]);
    // Helion has expanded but never fought: this pair matches no dispatch.
    choose(factionFilter(feed), "Helion Compact");
    choose(typeFilter(feed), "conflict");

    expect(visibleCycles(feed)).toEqual([]);
    expect(feed.element.querySelector(".feed__empty--filtered")).not.toBeNull();
    // The "nothing yet" placeholder stays away while dispatches exist.
    const empties = feed.element.querySelectorAll(".feed__empty");
    expect(
      [...empties].every((e) => e.classList.contains("feed__empty--filtered")),
    ).toBe(true);

    choose(typeFilter(feed), "");
    expect(feed.element.querySelector(".feed__empty--filtered")).toBeNull();
  });

  it("surfaces a live count and a Clear button while filtering", () => {
    const feed = createFeed();
    feed.push([worldColonized(1, helion, vex)]);
    feed.push([conflict(2, iron, helion, vex, true)]);

    const clear = feed.element.querySelector<HTMLButtonElement>(
      ".feed__filter-clear",
    )!;
    const count = feed.element.querySelector(".feed__filter-count")!;
    expect(clear.hidden).toBe(true);
    expect((count as HTMLElement).hidden).toBe(true);

    choose(factionFilter(feed), "Helion Compact");
    expect(clear.hidden).toBe(false);
    expect(count.textContent).toBe("Showing 1 of 2");

    clear.click();
    expect(factionFilter(feed).value).toBe("");
    expect(clear.hidden).toBe(true);
    expect(visibleCycles(feed)).toEqual([2, 1]);
  });

  it("shows a war's full arc under the Conflict filter (#42)", () => {
    const feed = createFeed();
    feed.push([worldColonized(0, helion, vex)]);
    feed.push([diplomacy(1, "threat", iron, helion)]);
    feed.push([warDeclared(2, iron, helion)]);
    feed.push([conflict(3, iron, helion, vex, false)]);
    feed.push([diplomacy(4, "trade", iron, helion)]);
    feed.push([diplomacy(5, "peace", iron, helion)]);

    choose(typeFilter(feed), "conflict");
    // Ultimatum, declaration, clash, and the closing peace — nothing missing;
    // the colonization and the trade accord stay out.
    expect(visibleCycles(feed)).toEqual([5, 3, 2, 1]);

    // The peace dispatch filters as conflict but keeps its calm accent.
    const peaceNode = feed.element.querySelector<HTMLElement>(
      '.dispatch[data-category="conflict"].dispatch--diplomacy',
    );
    expect(peaceNode).not.toBeNull();
    expect(peaceNode!.querySelector(".dispatch__kind")!.textContent).toBe(
      "Peace",
    );
  });

  it("resets the filter vocabulary on a fresh sector", () => {
    const feed = createFeed();
    feed.push([factionFounded(0, helion, helionHome)]);
    choose(factionFilter(feed), "Helion Compact");

    // A new sector has new factions; the old filter must not linger.
    feed.reset([factionFounded(0, iron, helionHome)]);
    expect(factionFilter(feed).value).toBe("");
    expect(optionValues(factionFilter(feed))).toEqual(["", "Iron Dominion"]);
    expect(visibleCycles(feed)).toEqual([0]);
  });
});

// --- Filter-category exhaustiveness (issue #42) --------------------------------
//
// The Conflict filter missed events because a diplomacy kind sat in the wrong
// category — a gap nothing enforced. These samples are keyed by the sim's own
// unions (`WorldEventType`, `DiplomacyKind`, …), so adding a new event type or
// kind without deciding its filter category fails to *compile* here, and the
// test then checks each maps to exactly one category the dropdown offers.

const DIPLOMACY_SAMPLES: Record<DiplomacyKind, WorldEvent> = {
  pact: diplomacy(0, "pact", helion, iron),
  alliance: diplomacy(0, "alliance", helion, iron),
  peace: diplomacy(0, "peace", helion, iron),
  trade: diplomacy(0, "trade", helion, iron),
  threat: diplomacy(0, "threat", helion, iron),
  betrayal: diplomacy(0, "betrayal", helion, iron),
  renounce: diplomacy(0, "renounce", helion, iron),
};

const FORTUNE_SAMPLES: Record<FortuneKind, WorldEvent> = {
  discovery: worldFortune(0, helion, vex, "discovery"),
  depletion: worldFortune(0, helion, vex, "depletion"),
  disaster: worldFortune(0, helion, vex, "disaster"),
};

const DOCTRINE_SAMPLES: Record<PostureShift, WorldEvent> = {
  defensive: factionDoctrine(0, helion, "defensive"),
  hegemonic: factionDoctrine(0, helion, "hegemonic"),
};

const SAMPLES_BY_TYPE: Record<WorldEventType, readonly WorldEvent[]> = {
  FACTION_FOUNDED: [factionFounded(0, helion, helionHome)],
  FACTION_SECEDED: [factionSeceded(0, iron, helion, helionHome)],
  WORLD_COLONIZED: [worldColonized(0, helion, vex)],
  WORLD_ABANDONED: [worldAbandoned(0, helion, vex)],
  WAR_DECLARED: [warDeclared(0, iron, helion)],
  CONFLICT: [conflict(0, iron, helion, vex, true)],
  WAR_ENDED: [warEnded(0, helion, iron, "repelled", 0, 1)],
  RESOURCE_CRISIS: [resourceCrisis(0, helion, "energy")],
  FIRST_CONTACT: [firstContact(0, helion, iron)],
  FACTION_COLLAPSED: [factionCollapsed(0, iron)],
  WORLD_FORTUNE: Object.values(FORTUNE_SAMPLES),
  LEADERSHIP_CHANGE: [
    leadershipChange(
      0,
      helion,
      "succession",
      { name: "Old Hand", title: "Prefect", trait: "stoic", since: 0 },
      6,
    ),
  ],
  DIPLOMACY: Object.values(DIPLOMACY_SAMPLES),
  FACTION_DOCTRINE: Object.values(DOCTRINE_SAMPLES),
  SECTOR_CONCLUDED: [
    sectorConcluded(0, "unified", helion),
    sectorConcluded(0, "dark"),
  ],
};

group("filter category exhaustiveness (#42)", () => {
  it("maps every event type and kind to exactly one offered category", () => {
    for (const type of EVENT_TYPES) {
      const samples = SAMPLES_BY_TYPE[type];
      expect(samples.length).toBeGreaterThan(0);
      for (const event of samples) {
        const d = toDispatch(event);
        // Exactly one category, and one the filter dropdown actually offers.
        expect(CATEGORY_ORDER.filter((c) => c === d.category)).toHaveLength(1);
        expect(CATEGORY_FILTER_LABEL[d.category]).toBeTruthy();
        // The accent must be a styled category too, or the dispatch loses
        // its colour silently.
        expect(CATEGORY_ORDER).toContain(d.accent);
      }
    }
  });

  it("labels every category the filter can offer", () => {
    expect([...CATEGORY_ORDER].sort()).toEqual(
      Object.keys(CATEGORY_FILTER_LABEL).sort(),
    );
  });
});
