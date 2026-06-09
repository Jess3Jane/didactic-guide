import "./style.css";
import { createRng } from "./sim/rng";
import { generateSector } from "./sim/world";
import { createEngine, type Engine } from "./sim/engine";
import { createFeed } from "./ui/feed";
import { createControls, randomSeed } from "./ui/controls";

// Phase 1 wiring (issue #7). This is the one place `sim/` and `ui/` meet
// (GDD §6): RNG → worldgen → engine → feed, driven by the time + seed controls.
// Open the page, press play, and watch a sector's history scroll by; enter a
// seed and the same history reproduces every time.

const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  app.innerHTML = `
    <header class="masthead">
      <h1>Starfall</h1>
      <p class="tagline">Dispatches from a sector that never was.</p>
    </header>
  `;

  const feed = createFeed();

  // The live engine for the current seed. Rebuilt from scratch on every
  // "Generate" so a seed always starts the same world from cycle 0.
  let engine: Engine | null = null;

  /** Build a fresh sector from `seed`, reset the chronicle to its founding. */
  const generate = (seed: string): void => {
    const rng = createRng(seed);
    const sector = generateSector(rng, { seed });
    engine = createEngine(sector, rng);
    feed.reset(engine.foundingEvents);
  };

  const controls = createControls({
    onStep: () => {
      if (!engine) return { cycle: 0, dispatches: 0 };
      const events = engine.tick();
      feed.push(events);
      // Report the cycle and event count so the controls can show time passing
      // (and flag quiet cycles); surface a concluded run as an explicit end so
      // the loop stops deliberately rather than ticking on in silence.
      const status = engine.getStatus();
      return {
        cycle: engine.getTick(),
        dispatches: events.length,
        ended:
          status.kind === "unified"
            ? { kind: "unified", victor: status.victor.name }
            : status.kind === "dark"
              ? { kind: "dark" }
              : undefined,
      };
    },
    onGenerate: generate,
  });

  // Controls above the chronicle they drive.
  app.append(controls.element, feed.element);

  // Open on a fresh random sector so the page never loads empty.
  const initialSeed = randomSeed();
  controls.setSeed(initialSeed);
  generate(initialSeed);
}
