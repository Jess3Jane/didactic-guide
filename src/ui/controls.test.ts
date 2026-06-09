// @vitest-environment jsdom
import {
  describe as group,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { createControls, randomSeed, type Controls } from "./controls";

// The controls own a `setInterval` tick loop, so the timing tests drive it with
// fake timers. Each test builds a fresh component into a clean document.

const SPEED_NORMAL_MS = 700; // the 1× tier the selector defaults to

group("createControls", () => {
  let onStep: ReturnType<typeof vi.fn>;
  let onGenerate: ReturnType<typeof vi.fn>;
  let controls: Controls;

  const playButton = () =>
    controls.element.querySelector<HTMLButtonElement>(".controls__btn--play")!;
  const buttonByText = (text: string) =>
    [...controls.element.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === text,
    )!;
  const seedInput = () =>
    controls.element.querySelector<HTMLInputElement>(".controls__seed-input")!;
  const speedSelect = () =>
    controls.element.querySelector<HTMLSelectElement>(".controls__select")!;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    // Default: the run never ends, so the loop keeps stepping.
    onStep = vi.fn(() => true);
    onGenerate = vi.fn();
    controls = createControls({ onStep, onGenerate });
    document.body.append(controls.element);
  });

  afterEach(() => {
    controls.destroy();
    vi.useRealTimers();
  });

  it("starts paused, showing Play", () => {
    expect(controls.isPlaying()).toBe(false);
    expect(playButton().textContent).toBe("Play");
  });

  it("Play starts the tick loop; each interval advances one cycle", () => {
    playButton().click();
    expect(controls.isPlaying()).toBe(true);
    expect(playButton().textContent).toBe("Pause");

    vi.advanceTimersByTime(SPEED_NORMAL_MS * 3);
    expect(onStep).toHaveBeenCalledTimes(3);
  });

  it("Pause halts the loop", () => {
    playButton().click();
    vi.advanceTimersByTime(SPEED_NORMAL_MS);
    playButton().click(); // pause

    expect(controls.isPlaying()).toBe(false);
    onStep.mockClear();
    vi.advanceTimersByTime(SPEED_NORMAL_MS * 5);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("Step advances exactly one cycle and pauses if playing", () => {
    playButton().click();
    onStep.mockClear();
    buttonByText("Step").click();

    expect(controls.isPlaying()).toBe(false);
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it("pauses itself when a step reports the run has ended", () => {
    onStep.mockReturnValue(false);
    playButton().click();
    vi.advanceTimersByTime(SPEED_NORMAL_MS);

    expect(onStep).toHaveBeenCalledTimes(1);
    expect(controls.isPlaying()).toBe(false);
  });

  it("re-times a running loop when the speed changes", () => {
    playButton().click();
    onStep.mockClear();

    speedSelect().value = "3"; // 4× → 150ms
    speedSelect().dispatchEvent(new Event("change"));

    vi.advanceTimersByTime(150 * 2);
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it("Generate passes the trimmed seed and pauses", () => {
    seedInput().value = "  nebula  ";
    playButton().click();
    buttonByText("Generate").click();

    expect(onGenerate).toHaveBeenCalledWith("nebula");
    expect(controls.isPlaying()).toBe(false);
  });

  it("Enter in the seed field generates", () => {
    seedInput().value = "orion";
    seedInput().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onGenerate).toHaveBeenCalledWith("orion");
  });

  it("Randomize fills a fresh seed and generates", () => {
    buttonByText("Randomize").click();
    expect(onGenerate).toHaveBeenCalledTimes(1);
    const used = onGenerate.mock.calls[0][0];
    expect(used).toMatch(/^[a-z]+$/);
    expect(seedInput().value).toBe(used);
  });

  it("exposes and accepts the seed via the public API", () => {
    controls.setSeed("helios");
    expect(controls.getSeed()).toBe("helios");
  });
});

group("randomSeed", () => {
  it("produces a non-empty lowercase-letter handle", () => {
    for (let i = 0; i < 20; i++) {
      expect(randomSeed()).toMatch(/^[a-z]+$/);
    }
  });
});
