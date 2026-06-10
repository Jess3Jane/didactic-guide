// Faction posture model for Starfall (issue #24).
//
// Phase 1 — and Phase 2 up to here — drove every faction off a single fixed
// `disposition`: an expansionist always reached for new worlds, an isolationist
// always kept to itself, whatever the state of the galaxy around them. That made
// a power's behaviour static: it never read the room. This module adds the
// missing layer — a `Posture` derived each cycle from a faction's *circumstance*,
// so goals shift as fortunes do. A battered expansionist, bled below its height,
// turns `defensive` and pulls back to hold what remains; a power that has come to
// command the sector turns `hegemonic` and presses for mastery whatever its
// temperament. Everyone else stays `steady`, acting on disposition as before.
//
// Like `relations.ts`, this is the pure core: no DOM, no RNG, no engine state.
// It owns only the vocabulary, the thresholds, and the deterministic derivation
// that reads them. The engine holds the stateful posture-per-faction map and the
// transition detection that turns a shift into a dispatch.

/**
 * A faction's current strategic footing, derived from circumstance rather than
 * declared once at founding. `steady` is the default — the faction acts on its
 * disposition. `defensive` is retrenchment: a power in crisis, or one bled well
 * below its territorial height, pulls back to recover instead of overreaching.
 * `hegemonic` is ascendancy: a power that commands the sector casts off restraint
 * and presses for conquest, however cautious its temperament once was.
 */
export type Posture = "defensive" | "steady" | "hegemonic";

/**
 * The two *notable* postures — the ones worth a dispatch when a faction first
 * enters them. A return to `steady` is the quiet, unremarkable baseline and is
 * not reported, so the feed carries the dramatic turns (a power overextending and
 * pulling back, or rising to dominance) without narrating every settling-down.
 */
export type PostureShift = "defensive" | "hegemonic";

/**
 * Tuning for the posture model. Kept here with the type they shape; the engine
 * supplies the live counts each cycle. The shares are deliberately demanding so
 * a posture is an earned, legible turn — sector dominance or a real reversal —
 * rather than something a faction flickers in and out of every other cycle.
 */
export const POSTURE = {
  /**
   * A faction is hegemonic once it is the single largest power *and* holds at
   * least this share of all worlds currently held across the sector — true
   * dominance, not a narrow lead.
   */
  hegemonyShare: 0.5,
  /**
   * ...and holds at least this many worlds outright, so a two-world edge in a
   * sparse early sector doesn't read as galactic mastery.
   */
  hegemonyFloor: 4,
  /**
   * A faction is defensive once it has fallen below this fraction of its
   * territorial peak — it overreached or was driven back, and now retrenches.
   */
  batteredShare: 0.6,
  /**
   * ...having once held more than this many worlds, so losing a single early
   * colony off a peak of one or two isn't mistaken for a great power's fall.
   */
  batteredPeakFloor: 2,
} as const;

/** The circumstance the engine reads a faction's posture from each cycle. */
export interface PostureContext {
  /** Whether the faction is stretched thin / in crisis (engine's `isStrained`). */
  strained: boolean;
  /** Worlds the faction holds right now. */
  ownedWorlds: number;
  /** The most worlds it has ever held — its high-water mark. */
  peakWorlds: number;
  /** Total worlds held by every living faction (the sector's claimed territory). */
  sectorWorlds: number;
  /** Whether it is the single largest power by world count (strictly, no ties). */
  isLargest: boolean;
  /** How many factions still hold territory — dominance is meaningless alone. */
  livingFactions: number;
}

/**
 * Derive a faction's posture from its circumstance.
 *
 * Crisis comes first: a strained power retrenches whatever its size, because the
 * fire at home outweighs any ambition abroad. Failing that, a faction that truly
 * commands the sector (largest, and past the dominance share/floor, with rivals
 * still standing) turns hegemonic. Otherwise a power bled well below its height
 * turns defensive. Anyone else is steady and acts on disposition as before.
 */
export function postureFor(ctx: PostureContext): Posture {
  if (ctx.strained) return "defensive";

  if (
    ctx.livingFactions > 1 &&
    ctx.isLargest &&
    ctx.ownedWorlds >= POSTURE.hegemonyFloor &&
    ctx.ownedWorlds >= ctx.sectorWorlds * POSTURE.hegemonyShare
  ) {
    return "hegemonic";
  }

  if (
    ctx.peakWorlds > POSTURE.batteredPeakFloor &&
    ctx.ownedWorlds < ctx.peakWorlds * POSTURE.batteredShare
  ) {
    return "defensive";
  }

  return "steady";
}

/** Whether a posture is a notable one worth announcing on entry (see above). */
export function isPostureShift(posture: Posture): posture is PostureShift {
  return posture === "defensive" || posture === "hegemonic";
}
