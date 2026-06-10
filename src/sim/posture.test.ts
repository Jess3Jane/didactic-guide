import { describe, it, expect } from "vitest";
import { postureFor, isPostureShift, POSTURE, type PostureContext } from "./posture";

/** A neutral, steady-by-default context; spread over it to vary one axis. */
const base: PostureContext = {
  strained: false,
  ownedWorlds: 3,
  peakWorlds: 3,
  sectorWorlds: 10,
  isLargest: false,
  livingFactions: 4,
};

describe("postureFor", () => {
  it("is steady for a healthy, mid-pack power", () => {
    expect(postureFor(base)).toBe("steady");
  });

  it("turns defensive in crisis, whatever the size", () => {
    // Strain wins outright — even a sector-commanding power retrenches when the
    // fire is at home.
    const dominant: PostureContext = {
      ...base,
      strained: true,
      ownedWorlds: 8,
      sectorWorlds: 10,
      isLargest: true,
    };
    expect(postureFor(dominant)).toBe("defensive");
  });

  it("turns hegemonic once a power commands the sector", () => {
    const ctx: PostureContext = {
      ...base,
      ownedWorlds: 6,
      sectorWorlds: 10, // 60% of held territory, and the largest
      isLargest: true,
    };
    expect(postureFor(ctx)).toBe("hegemonic");
  });

  it("does not call a narrow or sparse lead hegemonic", () => {
    // Largest, but below the dominance share.
    expect(
      postureFor({ ...base, ownedWorlds: 4, sectorWorlds: 10, isLargest: true }),
    ).toBe("steady");
    // A clear share, but too few worlds to read as galactic mastery.
    expect(
      postureFor({
        ...base,
        ownedWorlds: POSTURE.hegemonyFloor - 1,
        sectorWorlds: POSTURE.hegemonyFloor - 1,
        isLargest: true,
      }),
    ).toBe("steady");
  });

  it("never reads as hegemonic when alone — there is no one left to dominate", () => {
    expect(
      postureFor({
        ...base,
        ownedWorlds: 8,
        sectorWorlds: 8,
        isLargest: true,
        livingFactions: 1,
      }),
    ).toBe("steady");
  });

  it("turns defensive when bled well below its territorial peak", () => {
    const ctx: PostureContext = {
      ...base,
      ownedWorlds: 4,
      peakWorlds: 10, // 40% of its height — overextended and driven back
      sectorWorlds: 20,
    };
    expect(postureFor(ctx)).toBe("defensive");
  });

  it("does not read a minor dip off a small peak as a great fall", () => {
    // Lost one world off a peak of two — not the collapse of a great power.
    expect(
      postureFor({ ...base, ownedWorlds: 1, peakWorlds: 2, sectorWorlds: 8 }),
    ).toBe("steady");
  });

  it("prefers hegemonic over defensive when still dominant despite a dip", () => {
    // Bled from a peak of 12 down to 7, but still commands the sector.
    const ctx: PostureContext = {
      ...base,
      ownedWorlds: 7,
      peakWorlds: 12,
      sectorWorlds: 12,
      isLargest: true,
    };
    expect(postureFor(ctx)).toBe("hegemonic");
  });
});

describe("isPostureShift", () => {
  it("flags the notable postures and not the steady baseline", () => {
    expect(isPostureShift("defensive")).toBe(true);
    expect(isPostureShift("hegemonic")).toBe(true);
    expect(isPostureShift("steady")).toBe(false);
  });
});
