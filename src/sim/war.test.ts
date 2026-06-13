// Multi-cycle war tests (issue #24).
//
// Phase 1 resolved a war in a single roll — one clash, one world flips. These
// exercise the deeper model: that a war is declared, fought as a moving front
// across several cycles (advances building toward a breakthrough rather than an
// instant flip), and brought to a decisive end — conquest or a repulsed
// offensive — or laid down by negotiation, all deterministically.

import { describe, it, expect } from "vitest";
import { createRng } from "./rng";
import { generateSector } from "./world";
import { createEngine, type Engine } from "./engine";
import type { WarOutcome, WorldEvent } from "./events";

/** Build a sector + engine from a seed, mirroring how main.ts wires it. */
function engineFromSeed(seed: string): Engine {
  return createEngine(generateSector(createRng(seed), { seed }), createRng(seed));
}

/** Run an engine for N ticks and collect every event emitted. */
function run(engine: Engine, ticks: number): WorldEvent[] {
  const log: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) log.push(...engine.tick());
  return log;
}

/** Canonical, order-independent key for the pair an event concerns. */
function pairOf(e: WorldEvent): string {
  return e.actors
    .map((a) => a.id)
    .sort()
    .join("|");
}

describe("a war is a multi-cycle campaign", () => {
  it("emits declared/ended bookends and both decisive outcomes across seeds", () => {
    let declared = 0;
    const outcomes = new Set<WarOutcome>();
    for (let i = 0; i < 60; i++) {
      for (const e of run(engineFromSeed(`war-${i}`), 250)) {
        if (e.type === "WAR_DECLARED") declared++;
        else if (e.type === "WAR_ENDED") outcomes.add(e.data.outcome);
      }
    }
    // Wars are declared, and both a broken foe (conquest) and a spent offensive
    // (repelled) occur — the front swings decisively either way, not just peace.
    expect(declared).toBeGreaterThan(0);
    expect(outcomes.has("conquest")).toBe(true);
    expect(outcomes.has("repelled")).toBe(true);
  });

  it("takes a world by pressing a front, not an instant flip", () => {
    // Somewhere a contested world should fall only after the war has already
    // seen earlier clashes — a breakthrough on the second clash or later — proof
    // that momentum had to build rather than one roll deciding it.
    let sawBuiltBreakthrough = false;
    for (let i = 0; i < 60 && !sawBuiltBreakthrough; i++) {
      for (const e of run(engineFromSeed(`siege-${i}`), 250)) {
        if (
          e.type === "CONFLICT" &&
          e.data.push === "breakthrough" &&
          (e.data.campaign?.clash ?? 1) >= 2
        ) {
          sawBuiltBreakthrough = true;
          break;
        }
      }
    }
    expect(sawBuiltBreakthrough).toBe(true);
  });

  it("keeps the front's push and capture consistent", () => {
    // A clash's `push` and whether the world changed hands never disagree: only
    // a breakthrough takes ground; advances and repulses leave it in place.
    for (let i = 0; i < 20; i++) {
      for (const e of run(engineFromSeed(`front-${i}`), 200)) {
        if (e.type !== "CONFLICT" || e.data.push === undefined) continue;
        expect(e.data.captured).toBe(e.data.push === "breakthrough");
      }
    }
  });
});

describe("a war ends decisively", () => {
  it("frames a conquest as the loser broken to nothing", () => {
    // A conquest fires as the aggressor takes its foe's last world, so the
    // vanquished collapses out of the sector on the very same cycle.
    let checked = false;
    for (let i = 0; i < 80 && !checked; i++) {
      const log = run(engineFromSeed(`rout-${i}`), 250);
      for (const e of log) {
        if (e.type !== "WAR_ENDED" || e.data.outcome !== "conquest") continue;
        const loser = e.actors[1].id;
        const collapse = log.find(
          (c) =>
            c.type === "FACTION_COLLAPSED" &&
            c.tick === e.tick &&
            c.actors[0].id === loser,
        );
        expect(collapse).toBeDefined();
        // The arc is well-formed: a declaration for this pair preceded the end,
        // with at least one clash fought between.
        const key = pairOf(e);
        const declaredBefore = log.some(
          (d) => d.type === "WAR_DECLARED" && pairOf(d) === key && d.tick <= e.tick,
        );
        expect(declaredBefore).toBe(true);
        expect(e.data.clashes).toBeGreaterThanOrEqual(1);
        checked = true;
        break;
      }
    }
    expect(checked).toBe(true);
  });

  it("never reopens clashes between a pair after their war has ended", () => {
    // Once a WAR_ENDED closes the arc, a pair may fight again only under a fresh
    // declaration — the old war is settled, so any later clash belongs to a new
    // campaign opened by a WAR_DECLARED, never continuing the old count. A new
    // war can be declared the *same* cycle the old one ends (a repelled
    // aggressor's foe striking straight back), so a WAR_DECLARED for the pair —
    // not merely a later tick — is what clears the settled war; a clash seen with
    // no such re-declaration must still be a clash-1 opener.
    for (let i = 0; i < 20; i++) {
      const log = run(engineFromSeed(`settled-${i}`), 250);
      const endedAt = new Map<string, number>();
      for (const e of log) {
        const key = pairOf(e);
        if (e.type === "WAR_ENDED") {
          endedAt.set(key, e.tick);
        } else if (e.type === "WAR_DECLARED" && endedAt.has(key)) {
          // A fresh campaign legitimately opened: the settled war is closed out.
          endedAt.delete(key);
        } else if (e.type === "CONFLICT" && endedAt.has(key)) {
          if (e.tick > endedAt.get(key)!) {
            // A clash after a settled war, with no re-declaration, must be the
            // opener of a new one.
            expect(e.data.campaign?.clash).toBe(1);
            endedAt.delete(key);
          }
        }
      }
    }
  });
});

describe("determinism", () => {
  it("reproduces identical war events for the same seed", () => {
    const pick = (log: WorldEvent[]) =>
      log.filter(
        (e) =>
          e.type === "WAR_DECLARED" ||
          e.type === "WAR_ENDED" ||
          e.type === "CONFLICT",
      );
    // Settle on a seed that actually fights a war, so the comparison isn't vacuous.
    let seed = "";
    for (let i = 0; i < 20 && !seed; i++) {
      if (pick(run(engineFromSeed(`war-${i}`), 250)).length > 0) seed = `war-${i}`;
    }
    expect(seed).not.toBe("");
    const a = pick(run(engineFromSeed(seed), 250));
    const b = pick(run(engineFromSeed(seed), 250));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
