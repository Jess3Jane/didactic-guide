// Seeded pseudo-random number generator for Starfall.
//
// Determinism is a core pillar: a seed string must fully reproduce a world
// (see GDD §3 "Deterministic & shareable" and §6). This module is pure and
// headless — no DOM, and `Math.random()` must never appear in `src/sim/`.
//
// Implementation: a cyrb53-style string hash seeds a `sfc32` generator.
// sfc32 (Small Fast Counter, 32-bit) is fast, has a long period, and passes
// PractRand — plenty for procedural worldgen.

/** A stateful, explicit random source. Pass it into worldgen/engine. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. Throws if min > max. */
  int(min: number, max: number): number;
  /** Uniformly pick an element. Throws on an empty array. */
  pick<T>(arr: readonly T[]): T;
  /** True with probability `p` (default 0.5). */
  bool(p?: number): boolean;
  /** Returns a new shuffled array (Fisher–Yates); does not mutate the input. */
  shuffle<T>(arr: readonly T[]): T[];
}

/**
 * Hash a string to four 32-bit seed words. Based on cyrb53 / xmur3 mixing:
 * cheap, well-avalanched, and deterministic across platforms.
 */
function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 0x9e3779b9 ^ seed.length;
  let h2 = 0x85ebca6b ^ seed.length;
  let h3 = 0xc2b2ae35 ^ seed.length;
  let h4 = 0x27d4eb2f ^ seed.length;

  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x85ebca77);
    h2 = Math.imul(h2 ^ ch, 0xc2b2ae3d);
    h3 = Math.imul(h3 ^ ch, 0x27d4eb2f);
    h4 = Math.imul(h4 ^ ch, 0x165667b1);
    // Cross-mix so adjacent words diverge.
    h1 = (h1 << 13) | (h1 >>> 19);
    h2 = (h2 << 17) | (h2 >>> 15);
    h3 = (h3 << 7) | (h3 >>> 25);
    h4 = (h4 << 11) | (h4 >>> 21);
  }

  // Final avalanche so even an empty string yields well-spread words.
  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x45d9f3b);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 0x45d9f3b);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 0x45d9f3b);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 0x45d9f3b);

  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * Create a deterministic RNG from a seed string.
 *
 * The same seed always yields the same sequence; different seeds diverge.
 */
export function createRng(seed: string): Rng {
  let [a, b, c, d] = hashSeed(seed);

  // sfc32 core: returns a float in [0, 1).
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  // Discard a few outputs so low-entropy seeds (e.g. "") warm up.
  for (let i = 0; i < 16; i++) next();

  const int = (min: number, max: number): number => {
    if (min > max) {
      throw new RangeError(`int(min, max): min (${min}) > max (${max})`);
    }
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return lo + Math.floor(next() * (hi - lo + 1));
  };

  const pick = <T>(arr: readonly T[]): T => {
    if (arr.length === 0) {
      throw new RangeError("pick(): cannot pick from an empty array");
    }
    return arr[int(0, arr.length - 1)];
  };

  const bool = (p = 0.5): boolean => next() < p;

  const shuffle = <T>(arr: readonly T[]): T[] => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  return { next, int, pick, bool, shuffle };
}
