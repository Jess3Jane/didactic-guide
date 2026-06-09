// Inter-faction relations model for Starfall (issue #24).
//
// Phase 1 factions acted on a single fixed disposition and met only as
// strangers or enemies — there was no standing *relationship* between powers,
// so the chronicle never grew alliances, rivalries, or the betrayals that make
// a history feel political. This module is the pure core of that relationship
// layer: every acquainted pair of factions carries a numeric `standing` (how
// they feel about one another) and, optionally, a negotiated `pact` (a binding
// they have struck). From those two facts a single discrete `Stance` is
// derived, which the engine uses to gate who may fight whom and the feed uses
// to colour the politics.
//
// Like the rest of `src/sim/`, this is pure and headless — no DOM, no RNG. The
// engine owns the stateful evolution of standings (and routes every random
// draw through the injected `Rng`); here we keep only the vocabulary, the
// thresholds, and the deterministic functions that read them.

/**
 * A negotiated, sticky binding between two powers, set by diplomacy and broken
 * only by betrayal. A `nonaggression` pact stays the sword; an `alliance` is a
 * warmer bond two powers grow into. Absence of a pact means relations are
 * governed by raw `standing` alone.
 */
export type PactKind = "nonaggression" | "alliance";

/**
 * The discrete relationship between two acquainted powers, derived from their
 * standing and any pact. `allied` and `atPeace` are negotiated states that bar
 * war; `rivalry` is open hostility short of a pact; `neutral` is the wary
 * default of powers that have met but committed to nothing.
 */
export type Stance = "allied" | "atPeace" | "neutral" | "rivalry";

/**
 * Tuning for the relations model. Standing runs on a symmetric scale and the
 * bands below partition it; the engine layers its own per-cycle drift and
 * diplomacy odds on top (see `engine.ts`). Kept here so the thresholds that
 * define a "rivalry" or an "alliance-worthy" standing live with the type they
 * describe.
 */
export const RELATION = {
  /** Standing floor and ceiling — clamped so a feud or friendship can't run away. */
  min: -100,
  max: 100,
  /** At or below this standing, an un-pacted pair is openly rival. */
  rivalryAt: -30,
  /** Standing at which a pair is warm enough to sign a non-aggression pact. */
  pactAt: 15,
  /** Standing at which a pair is warm enough to forge (or upgrade to) an alliance. */
  allianceAt: 45,
} as const;

/**
 * Derive the discrete stance for a pair from its standing and any pact.
 *
 * A pact wins outright — two powers who have signed are `allied` or `atPeace`
 * whatever their mood — because the binding, not the sentiment, is what gates
 * war. Without a pact the standing band decides: deep enough into the red is a
 * `rivalry`, anything else is wary `neutral`.
 */
export function stanceFor(standing: number, pact?: PactKind): Stance {
  if (pact === "alliance") return "allied";
  if (pact === "nonaggression") return "atPeace";
  if (standing <= RELATION.rivalryAt) return "rivalry";
  return "neutral";
}

/** Clamp a standing to the model's range, rounded to an integer to stay tidy. */
export function clampStanding(value: number): number {
  return Math.max(RELATION.min, Math.min(RELATION.max, Math.round(value)));
}

/** Whether a pact (of either kind) bars these two powers from open war. */
export function pactBarsWar(pact?: PactKind): boolean {
  return pact === "nonaggression" || pact === "alliance";
}
