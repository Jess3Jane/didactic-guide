import "./style.css";
import { createRng } from "./sim/rng";
import { generateSector } from "./sim/world";
import { createEngine } from "./sim/engine";
import { createFeed } from "./ui/feed";

// Phase 1 wiring. This is the one place `sim/` and `ui/` meet (GDD §6): RNG →
// worldgen → engine → feed. For issue #6 it runs a fixed-seed sector on a simple
// auto-tick so the live chronicle is demonstrable end-to-end; issue #7 replaces
// this loop with play / pause / step + speed controls and a seed input.

const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  app.innerHTML = `
    <header class="masthead">
      <h1>Starfall</h1>
      <p class="tagline">Dispatches from a sector that never was.</p>
    </header>
  `;

  const seed = "starfall";
  const rng = createRng(seed);
  const sector = generateSector(rng, { seed });
  const engine = createEngine(sector, rng);

  const feed = createFeed();
  app.append(feed.element);

  // Open the chronicle on the founding roster, then stream the history.
  feed.reset(engine.foundingEvents);

  // A modest auto-tick stands in for the time controls landing in issue #7.
  const TICK_MS = 700;
  const MAX_CYCLES = 400;
  const timer = window.setInterval(() => {
    if (engine.getTick() >= MAX_CYCLES) {
      window.clearInterval(timer);
      return;
    }
    feed.push(engine.tick());
  }, TICK_MS);
}
