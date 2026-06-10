// Sector map view — a spatial companion to the feed (GDD §4, §7, issue #25).
//
// The chronicle tells you *what* happened; the map tells you *where*. It draws
// the sector as a node-link graph — systems positioned by their generated
// `position`, jump lanes as edges — and colours each system by the faction that
// holds it, so a viewer can watch territory shift as the history unfolds.
//
// Like the feed, this is the presentation layer, so it touches the DOM — but the
// boundary still runs one way: `ui/` reads `sim/` types and never mutates the
// sector (the engine owns that). Two halves live here, mirroring `feed.ts`:
//   1. Pure helpers (`systemControl`, `factionColors`) — DOM-free projections of
//      who holds what, unit-testable in plain Node.
//   2. `createSectorMap` — a small stateful component that builds the SVG once
//      per sector (`reset`) and recolours it in place every tick (`update`),
//      so a long run repaints without rebuilding or flickering.

import type { Sector } from "../sim/world";

// --- Pure projections --------------------------------------------------------

/** Who holds a star system, derived from world ownership within it. */
export interface SystemControl {
  /** Faction id holding the most worlds in the system, or null if unclaimed. */
  controller: string | null;
  /** True when more than one faction owns worlds here — a contested frontier. */
  contested: boolean;
}

/**
 * Determine which faction controls `systemId`.
 *
 * A system belongs to whichever faction owns the most of its worlds; a tie at
 * the top reads as `contested` (the leader by id wins the colour so the map
 * stays stable, but the ring marks it disputed). Pure: it only reads ownership
 * already recorded on the sector, so it is safe to call every tick and in tests.
 */
export function systemControl(sector: Sector, systemId: string): SystemControl {
  const system = sector.systems[systemId];
  if (!system) return { controller: null, contested: false };

  // Tally owned worlds per faction within this system.
  const counts = new Map<string, number>();
  for (const faction of Object.values(sector.factions)) {
    let held = 0;
    for (const worldId of faction.ownedWorldIds) {
      if (sector.worlds[worldId]?.systemId === systemId) held++;
    }
    if (held > 0) counts.set(faction.id, held);
  }

  if (counts.size === 0) return { controller: null, contested: false };

  // Highest world count wins; ties break by faction id for a stable colour.
  let controller: string | null = null;
  let best = -1;
  for (const [id, held] of counts) {
    if (held > best || (held === best && (controller === null || id < controller))) {
      best = held;
      controller = id;
    }
  }
  return { controller, contested: counts.size > 1 };
}

// A curated palette echoing the app's accents, then a golden-angle HSL fallback
// so any faction count stays distinguishable on the dark background.
const FACTION_PALETTE = [
  "#4fd1c5", // teal
  "#f6ad55", // amber
  "#b794f4", // violet
  "#68d391", // green
  "#f87171", // red
  "#ecc94b", // gold
  "#63b3ed", // blue
  "#fc8181", // rose
] as const;

/** Neutral fill for an unclaimed system. */
export const NEUTRAL_COLOR = "#3a4459";

/**
 * A stable colour for the faction at generation order `index`. The first few
 * draw from the curated palette; beyond it, the golden angle spreads hues so
 * even a crowded sector keeps its factions apart. Pure and deterministic.
 */
export function factionColor(index: number): string {
  if (index >= 0 && index < FACTION_PALETTE.length) return FACTION_PALETTE[index];
  const hue = (Math.abs(index) * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 60%, 62%)`;
}

/**
 * Assign each faction a colour by its order in the sector, keyed by id. Founding
 * order is stable across a run (`fac-0`, `fac-1`, …), so a faction keeps its
 * colour for the whole history even as others fall.
 */
export function factionColors(sector: Sector): Record<string, string> {
  const out: Record<string, string> = {};
  Object.keys(sector.factions).forEach((id, i) => {
    out[id] = factionColor(i);
  });
  return out;
}

// --- Component ---------------------------------------------------------------

/** A live sector map bound to a root element. */
export interface SectorMap {
  /** The root element to mount in the page. */
  readonly element: HTMLElement;
  /** Bind a freshly generated sector and (re)build the map skeleton. */
  reset(sector: Sector): void;
  /** Repaint ownership from the bound sector — call after each tick. */
  update(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Systems are laid out in a 0–1000 field (see world.ts MAP_SIZE); pad the
// viewBox so node rings and labels near the edge aren't clipped.
const FIELD = 1000;
const PAD = 70;

/** Node radius grows a touch with how many worlds a system holds. */
function nodeRadius(worldCount: number): number {
  return 14 + Math.min(worldCount, 3) * 2;
}

/**
 * Create the sector map inside a fresh `<section>`.
 *
 * The section is returned on `element` for the caller to mount; nothing is
 * appended to the document automatically. The host rebuilds the engine's sector
 * on every "Generate" and ticks it forward, calling `reset` then `update` (see
 * `main.ts`) — the map never touches the sim, only reads it.
 */
export function createSectorMap(): SectorMap {
  const doc = document;

  const element = doc.createElement("section");
  element.className = "map";
  element.setAttribute("aria-label", "Sector map");

  // Header: a title and a collapse toggle so the map can fold away on small
  // screens without scrolling past it to reach the chronicle.
  const header = doc.createElement("header");
  header.className = "map__header";

  const title = doc.createElement("h2");
  title.className = "map__title";
  title.textContent = "Sector Map";

  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "controls__btn map__toggle";
  toggle.textContent = "Hide map";
  toggle.setAttribute("aria-expanded", "true");

  header.append(title, toggle);

  // Body: the SVG graph and a faction legend, hidden together when collapsed.
  const body = doc.createElement("div");
  body.className = "map__body";

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "map__svg");
  svg.setAttribute("viewBox", `${-PAD} ${-PAD} ${FIELD + PAD * 2} ${FIELD + PAD * 2}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");

  const legend = doc.createElement("ul");
  legend.className = "map__legend";

  body.append(svg, legend);
  element.append(header, body);

  // Live state, rebound on every reset.
  let sector: Sector | null = null;
  let colors: Record<string, string> = {};
  // Per-system circle, kept so update() can recolour without rebuilding.
  const nodeEls = new Map<string, SVGCircleElement>();

  toggle.addEventListener("click", () => {
    const collapsed = element.classList.toggle("map--collapsed");
    toggle.textContent = collapsed ? "Show map" : "Hide map";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    body.hidden = collapsed;
  });

  /** Build the fixed skeleton — positions and lanes don't change within a run. */
  const reset = (next: Sector): void => {
    sector = next;
    colors = factionColors(next);
    nodeEls.clear();

    const newLanes = doc.createElementNS(SVG_NS, "g");
    newLanes.setAttribute("class", "map__lanes");
    const newNodes = doc.createElementNS(SVG_NS, "g");
    newNodes.setAttribute("class", "map__nodes");

    for (const [a, b] of next.lanes) {
      const sa = next.systems[a];
      const sb = next.systems[b];
      if (!sa || !sb) continue;
      const line = doc.createElementNS(SVG_NS, "line");
      line.setAttribute("class", "map__lane");
      line.setAttribute("x1", String(sa.position.x));
      line.setAttribute("y1", String(sa.position.y));
      line.setAttribute("x2", String(sb.position.x));
      line.setAttribute("y2", String(sb.position.y));
      newLanes.append(line);
    }

    for (const system of Object.values(next.systems)) {
      const node = doc.createElementNS(SVG_NS, "g");
      node.setAttribute("class", "map__node");
      node.setAttribute(
        "transform",
        `translate(${system.position.x} ${system.position.y})`,
      );

      const circle = doc.createElementNS(SVG_NS, "circle");
      circle.setAttribute("class", "map__system");
      circle.setAttribute("r", String(nodeRadius(system.worldIds.length)));

      const tip = doc.createElementNS(SVG_NS, "title");
      circle.append(tip);

      const label = doc.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "map__label");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("y", String(nodeRadius(system.worldIds.length) + 22));
      label.textContent = system.name;

      node.append(circle, label);
      newNodes.append(node);
      nodeEls.set(system.id, circle);
    }

    svg.replaceChildren(newLanes, newNodes);

    update();
  };

  /** Repaint ownership: recolour systems and rebuild the legend from live state. */
  const update = (): void => {
    if (!sector) return;

    // Reassign colours each repaint: a secession (issue #39) can found a new
    // faction mid-run, and it needs a swatch the moment it appears. Founding
    // factions keep their colours — assignment follows insertion order, and
    // newcomers only ever append.
    colors = factionColors(sector);

    // Recolour each system and refresh its tooltip + contested ring.
    for (const system of Object.values(sector.systems)) {
      const circle = nodeEls.get(system.id);
      if (!circle) continue;
      const control = systemControl(sector, system.id);
      const fill = control.controller
        ? colors[control.controller] ?? NEUTRAL_COLOR
        : NEUTRAL_COLOR;
      circle.setAttribute("fill", fill);
      circle.classList.toggle("map__system--contested", control.contested);
      circle.classList.toggle("map__system--neutral", control.controller === null);

      const holder = control.controller
        ? sector.factions[control.controller]?.name ?? "Unclaimed"
        : "Unclaimed";
      const tip = circle.querySelector("title");
      if (tip) {
        const note = control.contested ? " (contested)" : "";
        tip.textContent = `${system.name} — ${holder}${note}`;
      }
    }

    // Rebuild the legend: every founding faction, with its live world count, so
    // a fallen power reads as 0 worlds rather than vanishing from the key.
    legend.replaceChildren();
    for (const faction of Object.values(sector.factions)) {
      const held = faction.ownedWorldIds.length;
      const item = doc.createElement("li");
      item.className = "map__legend-item";
      if (held === 0) item.classList.add("map__legend-item--fallen");

      const swatch = doc.createElement("span");
      swatch.className = "map__swatch";
      swatch.style.background = colors[faction.id] ?? NEUTRAL_COLOR;

      const name = doc.createElement("span");
      name.className = "map__legend-name";
      name.textContent = faction.name;

      const count = doc.createElement("span");
      count.className = "map__legend-count";
      count.textContent = held === 0 ? "fallen" : `${held} ${held === 1 ? "world" : "worlds"}`;

      item.append(swatch, name, count);
      legend.append(item);
    }
  };

  return { element, reset, update };
}
