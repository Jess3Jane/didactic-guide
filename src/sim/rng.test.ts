import { describe, it, expect } from "vitest";
import { createRng } from "./rng";

describe("createRng", () => {
  it("produces an identical sequence for the same seed", () => {
    const a = createRng("helion");
    const b = createRng("helion");
    const seqA = Array.from({ length: 32 }, () => a.next());
    const seqB = Array.from({ length: 32 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("diverges for different seeds", () => {
    const a = createRng("helion");
    const b = createRng("drift");
    const seqA = Array.from({ length: 32 }, () => a.next());
    const seqB = Array.from({ length: 32 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("is reproducible across the whole API surface for a fixed seed", () => {
    const draw = (seed: string) => {
      const r = createRng(seed);
      return {
        floats: [r.next(), r.next(), r.next()],
        ints: [r.int(1, 6), r.int(0, 100), r.int(-5, 5)],
        picks: [r.pick(["a", "b", "c"]), r.pick(["a", "b", "c"])],
        bools: [r.bool(), r.bool(0.9), r.bool(0.1)],
        shuffled: r.shuffle([1, 2, 3, 4, 5, 6, 7, 8]),
      };
    };
    expect(draw("vex-9")).toEqual(draw("vex-9"));
  });

  it("emits floats in [0, 1)", () => {
    const r = createRng("range-floats");
    for (let i = 0; i < 1000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("emits ints within the inclusive range, hitting both ends", () => {
    const r = createRng("range-ints");
    let sawMin = false;
    let sawMax = false;
    for (let i = 0; i < 2000; i++) {
      const x = r.int(1, 6);
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(6);
      if (x === 1) sawMin = true;
      if (x === 6) sawMax = true;
    }
    expect(sawMin).toBe(true);
    expect(sawMax).toBe(true);
  });

  it("handles a single-value int range", () => {
    const r = createRng("single");
    for (let i = 0; i < 10; i++) {
      expect(r.int(7, 7)).toBe(7);
    }
  });

  it("throws when int() is given min > max", () => {
    const r = createRng("bad-range");
    expect(() => r.int(5, 1)).toThrow(RangeError);
  });

  it("picks only elements that exist in the array", () => {
    const r = createRng("picks");
    const arr = ["alpha", "beta", "gamma"] as const;
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(r.pick(arr));
    }
  });

  it("throws when picking from an empty array", () => {
    const r = createRng("empty");
    expect(() => r.pick([])).toThrow(RangeError);
  });

  it("bool(p) respects probability extremes", () => {
    const r = createRng("bools");
    for (let i = 0; i < 50; i++) {
      expect(r.bool(0)).toBe(false);
      expect(r.bool(1)).toBe(true);
    }
  });

  it("bool() is roughly fair over many draws", () => {
    const r = createRng("fairness");
    let trues = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) if (r.bool()) trues++;
    const ratio = trues / n;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });

  it("shuffle returns a permutation without mutating the input", () => {
    const r = createRng("shuffle");
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const frozen = input.slice();
    const out = r.shuffle(input);
    expect(input).toEqual(frozen); // input untouched
    expect(out).not.toBe(input); // new array
    expect([...out].sort((x, y) => x - y)).toEqual(frozen); // same multiset
  });

  it("handles an empty seed string deterministically", () => {
    const a = Array.from({ length: 8 }, ((g) => () => g.next())(createRng("")));
    const b = Array.from({ length: 8 }, ((g) => () => g.next())(createRng("")));
    expect(a).toEqual(b);
  });
});
