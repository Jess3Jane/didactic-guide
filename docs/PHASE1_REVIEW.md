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

Scores below are the **owner's actual verdict** (Jess3Jane), with the strawman
kept alongside for contrast. Where they diverge, the owner's read governs.

| # | Dimension | Score | Owner's note | Strawman |
|---|-----------|:-----:|--------------|:--------:|
| A | **Emergence** (core pillar) | **2** | "largely feels like events separate from one another, especially with every run ending largely the same" | 3 |
| B | **Readable history** (core pillar) | **3** | "clean and readable but plastic, less like news more like a log file" | 4 |
| C | **Deterministic & shareable** (core pillar) | **4** | reproduces "always" | 4 |
| D | Pacing & longevity | **1** | "it always ends in under 30 seconds" | 2 |
| E | First-run experience | **3** | "it's fine!" / cold open "feels clear and readable and interesting" | 4 |
| F | Controls & feedback | **2** | sim state "impossible to tell"; with no dispatch, "step does nothing" | 2 |
| G | Variety of event types | **3** | — | 3 |
| H | Visual design & polish | **4** | mobile "totally fine" | 4 |
| I | Stability & performance | **4** | "clean console, long runs don't exist" | 4 |
| J | Vision alignment | **2** | "less like a history more like a set of events" | 3 |

**Owner total: 28 / 50** (unweighted) · **37 / 65** (pillars A,B,C ×2)
&nbsp;&nbsp;·&nbsp;&nbsp; *(strawman was 33 / 50 · 44 / 65 — i.e. the owner is meaningfully harsher.)*

### The verdict in one breath

It's pretty, stable, and deterministic — but **every sector fizzles identically in
under 30 seconds, the events never connect into a story, and the prose reads like
a log file rather than the news.** Three pillars (Emergence, Pacing, Vision) all
fail for the same root reason: there is no sustaining, legible *history* — just a
short, samey burst of disconnected events. That is the bar Phase 2 has to clear.

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

## 4. Phase 2 priorities (from the owner's verdict)

Phase 2's mandate, in one line: **turn "a set of events" into a living history
that sustains.** Priorities are ordered by how directly they answer the failing
scores (D=1, A=2, J=2, F=2). These seed the Phase 2 issue backlog.

### Tier 1 — make it a history that lasts (the failing pillars)

1. **Sustain the simulation — kill the sub-30s fizzle (D=1).** Rebalance the
   economy and add ongoing pressures so a sector keeps *changing* for minutes, not
   seconds, and never settles into a dead, silent equilibrium while still "playing."
2. **Narrative continuity — weave events into arcs (A=2, J=2).** Give events
   memory and causal callbacks so the feed reads as one connected story (a named
   war that spans cycles, "the third famine in a decade," a faction's rise-and-fall
   thread) instead of disconnected log lines.
3. **Richer prose — dispatches, not a log file (B=3).** Multiple phrasings per
   event, in-world framing (datelines, sources, headlines), and tone, so the same
   event type never reads the same way twice.
4. **Surface simulation state (F=2).** A visible cycle counter and an explicit
   running / paused / *ended (sector gone dark)* status, and Step feedback even on
   an empty cycle — so "is it still alive?" is never "impossible to tell."

### Tier 2 — more collisions, more story (raise emergence)

5. **Named leaders & characters** (promoted from Phase 3). People are the cheapest
   route to both narrative cohesion and a "news" voice.
6. **Richer faction goals, diplomacy & war** (GDD Phase 2). Alliances, rivalries,
   betrayals, multi-front wars — more systems colliding means more emergence.

### Tier 3 — roadmapped depth (GDD Phase 2)

7. **Sector map view** — spatial context for the chronicle.
8. **Feed filtering** — by faction and event type.
