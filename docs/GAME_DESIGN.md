# Starfall — Game Design Document

> A sci-fi world generator. Seed a star sector, press play, and watch an
> emergent history unfold as a living news feed from an alternate future.

## 1. Vision

**Starfall** is a generative toy in the spirit of Dwarf Fortress *Legends mode*.
There is no win condition and no direct control. You define a seed, the
simulation grows a galaxy's worth of history, and you read it back as a stream
of dispatches — *"The Helion Compact has annexed the mining colony of Vex-9,"*
*"First contact reported in the Aldebaran reach,"* *"The Drift Famine enters its
fourth cycle."*

The fun is **emergence**: simple rules about factions, worlds, and resources
interacting until surprising stories fall out the other side.

### Pillars
1. **Emergent, not scripted.** Stories come from systems colliding, never from
   hand-authored plotlines.
2. **Readable history.** Everything that happens is legible as a human-readable
   event in a chronicle.
3. **Deterministic & shareable.** A seed fully reproduces a world. Share a seed,
   share a history.
4. **Runs anywhere.** Pure static web app, no backend, deployed on GitHub Pages.

## 2. The World

A **Sector** contains:
- **Star systems** — nodes in a graph, connected by jump lanes.
- **Worlds** — planets/moons within systems, each with traits (habitability,
  resources, hazards).
- **Factions** — the agents of history. They hold territory, accumulate
  resources, and pursue goals (expand, defend, research, trade, war).
- **Resources** — a small set (e.g. population, energy, materials, influence)
  that gate what factions can do.

## 3. The Simulation

The world advances in discrete **ticks** (each tick = an in-world span, e.g. a
"cycle"). On each tick the engine:
1. Updates faction state (resource production/consumption, growth/decline).
2. Lets each faction take an action toward its goals (colonize, attack, trade,
   research, etc.) subject to resource costs and rules.
3. Resolves interactions between factions (conflicts, diplomacy).
4. Emits **events** describing anything noteworthy that happened.

Events are the output of record. Every state change worth reading about produces
a structured event `{ tick, type, actors, location, summary }` which the UI
renders into prose.

## 4. The Player Experience

- A **news feed / chronicle** is the primary view: a reverse-chronological
  stream of generated dispatches.
- **Time controls**: play / pause / step, and a speed selector.
- A **seed control**: enter or randomize a seed to generate a fresh sector.
- (Later) a **map view** of the sector graph, and filtering the feed by faction
  or event type.

## 5. Tech Stack

- **TypeScript + Vite** — static SPA, no framework required for Phase 1.
- **Seeded PRNG** for full determinism from a seed string.
- **DOM/CSS** rendering for the feed (canvas/SVG map can come later).
- **GitHub Actions → GitHub Pages** for deployment.
- Simulation core is **pure and headless** (no DOM dependency) so it can be
  unit-tested and later run in a worker.

## 6. Architecture (target)

```
src/
  sim/        # headless, deterministic simulation core
    rng.ts        # seeded PRNG
    world.ts      # world/sector data model + worldgen
    engine.ts     # tick loop, faction actions, event emission
    events.ts     # event types + prose templating
  ui/         # presentation layer
    feed.ts       # news feed rendering
    controls.ts   # play/pause/seed controls
  main.ts     # wires sim + ui together
```

The boundary is firm: `sim/` never imports from `ui/`.

## 7. Roadmap

- **Phase 1 — Walking skeleton (this milestone).** Scaffold + deploy, seeded
  RNG, minimal worldgen, a tick engine that emits events, and a news feed UI
  with basic time controls. Goal: open the page, press play, watch a (simple)
  history scroll by — live on GitHub Pages.
- **Phase 2 — Depth.** Richer faction goals/AI, diplomacy & war resolution,
  more resource/world interplay, a sector map view, feed filtering.
- **Phase 3 — Flavor & polish.** Procedural names & prose variety, notable
  characters/leaders, persistence and seed sharing via URL, visual polish.

## 8. Non-Goals (for now)

- No multiplayer, no backend, no accounts.
- No real-time 3D; presentation stays lightweight.
- No direct player control over factions — observation only.
