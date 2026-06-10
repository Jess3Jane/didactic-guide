# Starfall — Phase 2 Review Worksheet

A rubric for judging Phase 2 ("turn a set of events into a living history that
sustains") before scoping Phase 3. Same shape as the Phase 1 worksheet:
**(1) a scorecard** to fill in, **(2) a hands-on test protocol**, and **(3)
observed findings** from real playthroughs so you can calibrate and reach your
own verdict.

The scorecard was pre-filled with **strawman scores** from two full runs (seeds
`tinotol` to cycle 400+ and `fecenuw` to cycle 400) plus the test suite. The
**owner's actual verdict** (Jess3Jane, from a run on seed `cuxojos`) has since
been folded in via PR #37 review — where they diverge, the owner's read governs.

Test against the deployed site (GitHub Pages) or `npm run dev` locally.

## How to score

Each dimension gets **1–5**:

- **1** — absent or broken
- **2** — present but frustrating
- **3** — works, unremarkable
- **4** — good, would happily show someone
- **5** — delightful, exceeds the brief

Dimensions A–J are identical to Phase 1 so scores are comparable. K–N are new
this phase. The three **bolded** dimensions (A, B, C) are the core pillars —
weight them double when totalling A–J.

## 1. Scorecard

| # | Dimension | Score | Owner's note | Strawman | Phase 1 (owner) |
|---|-----------|:-----:|--------------|:--------:|:---------------:|
| A | **Emergence** (core pillar) | **3** | second-act test: "0 map changes, one peaceful leadership change. so almost all economic" | 3 | 2 |
| B | **Readable history** (core pillar) | **3** | "but improved" / "prose is much more interesting" | 4 | 3 |
| C | **Deterministic & shareable** (core pillar) | **4** | reproduces | 4 | 4 |
| D | Pacing & longevity | **3** | sustains, but the long tail is economic static | 3 | 1 |
| E | First-run experience | **4** | cold open "looks reasonable" | 4 | 3 |
| F | Controls & feedback | **3** | controls sweep "works" | 4 | 2 |
| G | Variety of event types | **3** | — | 4 | 3 |
| H | Visual design & polish | **4** | map "fairly clear to read but lacks some contrast"; "reasonable at phone width" | 4 | 4 |
| I | Stability & performance | **4** | "console clean, still performant, feed caps" | 4 | 4 |
| J | Vision alignment | **4** | — | 3 | 2 |

**Owner total: 35 / 50** (unweighted) · **45 / 65** (pillars A,B,C ×2)
&nbsp;&nbsp;·&nbsp;&nbsp; *(Phase 1 owner verdict was 28 / 50 · 37 / 65 — up 7 points; strawman
claimed 37 / 50 · 48 / 65, so the owner is again a touch harsher, mainly on
prose, controls, and variety.)*

### New-in-Phase-2 features (scored separately, unweighted)

The owner annotated these in prose rather than scoring them; notes below.

| # | Feature | Owner's note | Strawman |
|---|---------|--------------|:--------:|
| K | Sector map | "a good addition, fairly clear to read but lacks some contrast"; **"two planets (3?) overlap on the map"** | 4 |
| L | Feed filtering | "Mostly functional, **conflict sometimes misses things**" | 4 |
| M | Named leaders & characters | "set dressing, as far as i can tell. causes are reasonable at least, **though sometimes lack basis**" | 3 |
| N | Wars, diplomacy & faction postures | opening-act arcs cohere: "Mostly!"; map-over-time "Works"; but see the second-act finding | 3 |

### The verdict in one breath

The owner's run (seed `cuxojos`) **confirmed the strawman's central finding
independently**: at cycle 200+, the 20 most recent dispatches contained
*"0 map changes, one peaceful leadership change — so almost all economic."*
Determinism holds ("yes"), seeds diverge ("differently"), the sim stays
performant with a capped feed and a clean console. Phase 2's mandate — sustain
the simulation and connect events into arcs — landed (28→35, every Phase 1
failing score improved), but prose, variety, and emergence all cap at 3 for
the same reason: the history has no second act. The owner also surfaced three
defects the strawman missed or underweighted: **the Conflict filter sometimes
misses events**, **planets overlap on the map** (plus thin contrast), and
**leadership changes sometimes lack visible basis**.

### The strawman verdict in one breath (kept for the record)

Phase 1 died of silence; Phase 2 lives forever but **stops happening.** The
sub-30s fizzle is genuinely dead — runs sustain past cycle 400 with a clean
console — and when the systems collide they now produce real, connected
stories (an ultimatum that becomes a named multi-clash war that ends in a
brokered peace, a collapse, a hegemony). But in both observed runs **every
structural event was confined to roughly cycles 0–25.** After the opening
act, 375+ cycles passed without a single war, colonization, crisis, collapse,
or posture change — just an endless loop of discovery/depletion/disaster
static and the same two factions re-signing the same trade accord ~27 times.
The history now has a great first act and no second one. That is the bar
Phase 3 has to clear.

## 2. Hands-on test protocol (~10 min)

1. **Cold open** — Load the page. Map, founding dispatches, named leaders all
   there before you touch anything? Inviting? (E, K, M)
2. **Watch the opening act** — Play at 1× for ~60s (through cycle ~30). Do
   events *reference each other* ("the third clash of a war raging since
   cycle 7")? Does a war or collapse feel like one story? (A, B, N)
3. **The second-act test** ← *this is where the sharpest issue lives.* Crank
   to 4× and let it run to cycle 200+. Then read the 20 most recent
   dispatches and count how many would change a map or a power structure
   (war, conquest, collapse, colonization, crisis) versus economic noise
   (discovery/depletion/disaster/trade). Strawman observed: **0 of 20, on
   both seeds.** (A, D, J)
4. **Determinism check** — Note the seed and first 3 events. Generate again,
   same seed. Identical? Try once more after stepping vs playing. (C)
5. **Seed variety** — Randomize 4–5 times, watch each opening (~cycle 25). Do
   the openings *end differently* — peace, conquest, collapse, hegemony — or
   converge on the same shape? (A, G)
6. **Filters** — Pick a faction, then an event type (e.g. Conflict). Does the
   feed narrow correctly, show a "Showing X of Y" count, and clear cleanly?
   Do filters hold up while the sim keeps running? (L)
7. **The map over time** — Watch the map across a war: do worlds change
   color when they change hands? Do fallen factions get marked? Toggle
   hide/show. (K)
8. **Follow a dynasty** — Filter one faction + Leadership. Does the
   succession line cohere (names, titles, tenure lengths, causes)? Do leaders
   ever *do* anything outside succession notices, or are they set dressing?
   (M, B)
9. **Controls sweep** — Step on a quiet cycle (still get feedback?), switch
   speeds mid-play, Generate mid-run, Enter in the seed box. Is the
   running/paused/cycle state always legible? (F)
10. **Mobile** — Resize to phone width. Map and feed both still usable? (H)
11. **Endurance** — Leave it at 4× for 5 minutes. Console clean? Scroll still
    smooth with hundreds of dispatches? Does the feed cap or grow forever? (I)

## 3. Observed findings (the strawman's reasoning)

From two playthroughs (seed `tinotol`, ~420 cycles; seed `fecenuw`, ~400
cycles), a determinism double-run, mobile check, and the test suite (172
tests, 14 files, all green).

### Strong

- **The fizzle is dead.** Both runs were still emitting events past cycle
  400, with the cycle counter and RUNNING/PAUSED pill making sim state
  legible at a glance — Phase 1's sharpest failures (D=1, F=2), directly
  fixed.
- **Real arcs exist now.** Seed `tinotol`, cycles 4–10: ultimatum → war
  declared → three clashes with continuity callbacks (*"the Verdant Concord
  pressed deeper toward Cygnus I, but the Astral Accord held the line — the
  third clash of a war raging since cycle 7"*) → negotiated peace. Seed
  `fecenuw`: a war ends in victory, the loser **collapses** (*"master of 2
  worlds at its height, fell into ruin and was gone"*), the winner declares
  **hegemony**. This is the emergent storytelling the GDD asked for.
- **Prose is much closer to dispatches than log lines.** Multiple phrasings
  per type, leaders woven in (*"At Architect Orla Rastan's command, the
  Verdant Concord settled Sirius III"*), tenure-aware successions (*"After
  115 cycles at the helm…"*).
- **Map and filters both land.** Faction-colored systems, ownership legend,
  fallen factions struck through in the legend (a lovely touch), "Showing X
  of Y" filter feedback with a clear button. Mobile layout holds up.
- **Engineering is sound.** Determinism verified exactly (two generations of
  the same seed produced identical histories), console clean after 400+
  cycles, 172 tests pass.

### The biggest issue — drives the capped A, D, J scores

- **All structural history happens in the opening ~25 cycles.** On both
  seeds, every war, ultimatum, peace, collapse, hegemony, crisis,
  retrenchment, and colonization occurred before cycle 25. From cycle 25 to
  400+, the feed was **100% discovery / depletion / disaster / trade /
  leadership-succession churn** — nothing that moved a border or toppled a
  power. The map froze ~cycle 10 and never changed again.
- The economy noise actively pads it: the same pair of factions "struck a
  trade accord" at least 27 times in one run with no memory of the previous
  ones, and discovery/depletion ping-pong endlessly on the same handful of
  worlds.
- Net effect: Phase 1's dead silence has been replaced by **live static**.
  The "is it still alive?" question is answered, but the question it raises
  is "is anything ever going to *happen* again?" — and the answer, after
  minutes of watching, is no. Shifting postures (#36) apparently never tip a
  faction back into expansion or war once the opening settles.

### Smaller findings

- **Leader surname collisions at founding**: seed `tinotol` opened with
  Architect Anselm **Marrow** (Astral Accord) and Prefect Sarn **Marrow**
  (Iron Coalition) — unrelated factions, same surname, reads as a bug even
  if it's chance.
- Leaders are succession-only set dressing outside war: they appear in
  datelines and succession notices but rarely drive events.
- Trade events repeat verbatim between the same pair with no escalation
  ("renewed", "deepened", "lapsed") — the single most repetitive line in
  long runs.
- Crises (famine) appeared only in the opening act, never again — the
  economy seems to settle into permanent comfortable equilibrium.

## 4. Phase 3 priorities (from the owner's verdict)

Phase 3's mandate, in one line: **give the history a second act.** Ordered by
how directly they answer the capped scores (A=3, B=3, D=3, G=3, F=3) and the
owner's defect reports. These seed the Phase 3 issue backlog.

### Tier 1 — give history a second act (A, D, J, G)

1. **Late-game destabilizers.** Once the sector settles, *something* must
   re-light it: postures that actually tip back to expansion/aggression,
   resource scarcity that forces conflict, succession disputes, rebellions,
   new factions rising from collapsed ones. A 400-cycle run should contain
   several distinct eras — and the map should keep changing hands outside
   the opening (conquest, secession, recolonization of fallen worlds).
2. **Tame the economic static (B, G).** Aggregate or rate-limit
   discovery/depletion/disaster noise; give trade memory (renewals,
   escalation to pacts, breakdowns) so repeated relations *go somewhere*
   instead of the same accord being re-signed ~27 times.

### Tier 2 — deepen what works, fix what the review caught

3. **Leaders with agency (M, A).** "Set dressing, as far as i can tell" —
   give leaders ambitions, rivalries, coups; make successions have visible
   basis ("causes… sometimes lack basis"); fix founding surname collisions.
4. **Conflict filter misses events (L, bug).** Audit the event-type →
   filter-category mapping so every war/diplomacy dispatch lands in a
   category the filter actually catches.
5. **Map polish (K, H).** De-overlap co-located systems, raise contrast on
   ownership colors and lanes.

### Tier 3 — roadmapped (GDD §7 Phase 3)

6. **URL seed-sharing** — a seed in the URL makes "share a history" real.
7. **World/faction detail views** — click a map node or faction name for a
   dossier built from the same history.
