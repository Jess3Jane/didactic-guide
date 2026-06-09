# Starfall — Phase 1 Review Worksheet

A rubric for judging the Phase 1 "walking skeleton" before committing to Phase 2.
It has three parts: **(1) a scorecard** to fill in, **(2) a hands-on test
protocol**, and **(3) observed findings** from a real playthrough so you can
calibrate against a reference read and reach your own verdict.

The scorecard below is **pre-filled with a strawman set of scores** (from a single
run on seed `kekamif` plus a full code read) — argue with them, don't trust them.
Reset the `Score` column to blank and judge fresh if you'd rather not be anchored.

## How to score

Each dimension gets **1–5**:

- **1** — absent or broken
- **2** — present but frustrating
- **3** — works, unremarkable
- **4** — good, would happily show someone
- **5** — delightful, exceeds the brief

The three **bolded** dimensions (A, B, C) are the core pillars from the GDD —
weight them double when totalling.

## 1. Scorecard

| # | Dimension | Probe questions | Score (1–5) | Strawman |
|---|-----------|-----------------|:-----------:|:--------:|
| A | **Emergence** (core pillar) | Do stories feel like systems *colliding*, not random rolls? Can you point to a causal chain (overexpansion → crisis → invasion → collapse)? Do different seeds tell genuinely different stories? | | 3 |
| B | **Readable history** (core pillar) | Does each dispatch read as clean prose? Could a stranger follow the sector's story top to bottom without explanation? Any robotic/repetitive phrasing? | | 4 |
| C | **Deterministic & shareable** (core pillar) | Same seed → identical history every time? Is a seed easy to copy/share? (Note: no URL-sharing yet — Phase 3.) | | 4 |
| D | Pacing & longevity | Does a history *sustain*? How many events before it goes quiet? Does "press play and watch" stay rewarding for more than ~30s? | | 2 |
| E | First-run experience | Page loads non-empty? Obvious what to do? Could you enjoy it without reading docs? | | 4 |
| F | Controls & feedback | Play/pause/step/speed/seed all behave as expected? Does the UI tell you what state the sim is in (running? ended? what cycle?)? | | 2 |
| G | Variety of event types | How many of the 6 types do you actually see in a run? Any that never fire? Any that dominate? | | 3 |
| H | Visual design & polish | Does it look like "dispatches from an alternate future"? Color accents legible? Typography/spacing pleasant? Mobile-readable? | | 4 |
| I | Stability & performance | Console clean? Long runs stay responsive? Any frozen/stuck states? | | 4 |
| J | Vision alignment | Does it deliver the GDD §1 promise — "seed a sector, press play, watch an emergent history unfold"? | | 3 |

**Strawman total: 33 / 50** (unweighted) · **44 / 65** (pillars A,B,C ×2)

## 2. Hands-on test protocol (~5 min)

1. **Cold open** — Load the page. Don't touch anything. Is it inviting? (A, E)
2. **Watch one run** — Press Play at 1×, read along for ~30s. Note when new
   dispatches *stop* appearing. (B, D, G)
3. **Determinism check** — Note the first 3 events + seed. Hit Generate again
   with the same seed. Identical? (C)
4. **Seed variety** — Randomize 4–5 times, short runs each. Do you get wars and
   collapses, or do most worlds just fizzle? (A, G, I)
5. **Controls sweep** — Try Step, switch speeds mid-play, press Enter in the seed
   box, Randomize. Anything surprising? (F)
6. **The "is it still alive?" test** — Let one run play for 60s untouched. Can you
   tell whether the sim is still running, finished, or stuck? (F, I) ← *this is
   where the sharpest issue surfaced.*
7. **Mobile** — Resize narrow / open on a phone. Still readable? (H)

## 3. Observed findings (the strawman's reasoning)

From one playthrough (seed `kekamif`) plus a read of the simulation core.

### Strong

- Clean, atmospheric UI; color-coded categories (crisis amber, expansion green,
  contact teal) read at a glance.
- Prose is genuinely good and varied per event — e.g. *"Famine gripped the Verdant
  Imperium as its colonies starved,"* *"First contact between the Helion Coalition
  and the Crimson Dominion in the Kepler reach."*
- Real causal coupling exists in the engine (expansion strains resources → crisis
  → consolidation → weakness invites conquest → collapse). 74 tests pass, console
  clean, determinism is properly engineered (seeded sfc32; `sim/` is pure, DOM-free).
- One run surfaced 5 of 6 event types (founding, crisis, colonization, first
  contact, conflict).

### The biggest issue — drives the low D and F scores

- The run produced **22 events over ~17 cycles, then went permanently silent.**
  Stepping **40 more times produced zero new dispatches.** Factions reach a quiet
  equilibrium where everyone just *consolidates* (which emits no events), but
  `worldIsLive()` stays true, so the loop keeps "playing" forever with **no cycle
  counter and no 'the sector has gone quiet' signal.** From the player's seat it
  looks frozen/broken.
- For a toy whose whole pitch is "watch a galaxy's worth of history unfold," a
  history that's ~20 dispatches long and then stalls invisibly is the single thing
  most worth addressing in Phase 2.
- Knock-on: there's no visible sense of *time passing* (no cycle/clock display),
  so even during active stretches you can't gauge pace or progress.

### Out of scope — roadmapped, not penalized

- No sector map, no feed filtering (Phase 2).
- No URL seed-sharing, no named leaders/characters (Phase 3).

## 4. Suggested Phase 2 priorities (implied by the above)

These fall out of the findings, ranked by how much they'd move the core
experience — offered as input to the Phase 2 issue backlog, not a commitment.

1. **Keep histories alive.** Make equilibrium productive: ambient events
   (trade, diplomacy, internal politics, world events) so a settled sector still
   generates news, and/or detect true stasis and surface it.
2. **Surface simulation state.** A visible cycle counter and an explicit
   "the sector has gone quiet / fallen dark" state so the page never looks frozen.
3. **Richer faction goals & diplomacy** (already on the Phase 2 roadmap) — more
   collision points means more emergence, which is the headline pillar.
4. **Sector map view** and **feed filtering** (Phase 2 roadmap).
