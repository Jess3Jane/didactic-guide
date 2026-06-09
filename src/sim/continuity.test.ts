// Narrative-continuity tests (issue #20).
//
// These exercise the engine's running memory end-to-end: that repeated clashes
// thread into one campaign, recurring crises are counted, and a fallen faction
// remembers the height it fell from — and that all of it stays deterministic.

import { describe, it, expect } from "vitest";
import { createRng } from "./rng";
import { generateSector } from "./world";
import { createEngine, type Engine } from "./engine";
import type { WorldEvent } from "./events";

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

describe("multi-cycle war campaigns", () => {
  it("threads repeated clashes into a single, aging campaign", () => {
    // Somewhere across these seeds a rivalry should flare repeatedly enough to
    // accrue a third clash — proof that a war reads as one arc, not isolated hits.
    let found: WorldEvent | null = null;
    for (let i = 0; i < 40 && !found; i++) {
      for (const e of run(engineFromSeed(`campaign-${i}`), 250)) {
        if (e.type === "CONFLICT" && e.data.campaign && e.data.campaign.clash >= 3) {
          found = e;
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    if (found && found.type === "CONFLICT" && found.data.campaign) {
      // The campaign began strictly before this clash, and the prose says so.
      expect(found.data.campaign.since).toBeLessThan(found.tick);
      expect(found.summary).toContain("clash of a war raging since cycle");
    }
  });

  it("numbers clashes consecutively within a war, resetting only on a lull", () => {
    // For any pair, each clash's index is either 1 (a fresh war) or one more than
    // the previous clash for that pair — never a skip or a repeat.
    const log = run(engineFromSeed("long-feud"), 300);
    const lastByPair = new Map<string, number>();
    let sawContinuation = false;
    for (const e of log) {
      if (e.type !== "CONFLICT" || !e.data.campaign) continue;
      const key = e.actors.map((a) => a.id).sort().join("|");
      const clash = e.data.campaign.clash;
      const prev = lastByPair.get(key) ?? 0;
      expect(clash === 1 || clash === prev + 1).toBe(true);
      if (clash === prev + 1) sawContinuation = true;
      lastByPair.set(key, clash);
    }
    expect(sawContinuation).toBe(true);
  });
});

describe("recurring crises", () => {
  it("counts a faction's repeated crises across a run", () => {
    let maxRecurrence = 0;
    for (let i = 0; i < 30 && maxRecurrence < 2; i++) {
      for (const e of run(engineFromSeed(`drought-${i}`), 250)) {
        if (e.type === "RESOURCE_CRISIS") {
          maxRecurrence = Math.max(maxRecurrence, e.data.recurrence);
        }
      }
    }
    // At least one sector suffered the same crisis twice, numbered as such.
    expect(maxRecurrence).toBeGreaterThanOrEqual(2);
  });

  it("increments recurrence monotonically per faction and resource", () => {
    const log = run(engineFromSeed("famine-saga"), 300);
    const counts = new Map<string, number>();
    for (const e of log) {
      if (e.type !== "RESOURCE_CRISIS") continue;
      const key = `${e.actors[0].id}:${e.data.resource}`;
      const expected = (counts.get(key) ?? 0) + 1;
      expect(e.data.recurrence).toBe(expected);
      counts.set(key, expected);
    }
  });
});

describe("rise-and-fall", () => {
  it("remembers a collapsed faction's peak territory", () => {
    let sawGrownFall = false;
    for (let i = 0; i < 40 && !sawGrownFall; i++) {
      for (const e of run(engineFromSeed(`dynasty-${i}`), 300)) {
        if (e.type === "FACTION_COLLAPSED" && e.data.peakWorlds >= 2) {
          // A faction that fell held more worlds at its height than at its end (0).
          expect(e.data.peakWorlds).toBeGreaterThan(0);
          sawGrownFall = true;
          break;
        }
      }
    }
    expect(sawGrownFall).toBe(true);
  });
});

describe("determinism", () => {
  it("reproduces identical continuity context for the same seed", () => {
    const a = run(engineFromSeed("mirror"), 250);
    const b = run(engineFromSeed("mirror"), 250);
    expect(a).toEqual(b);
  });
});
