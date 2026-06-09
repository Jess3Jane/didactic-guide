// @vitest-environment jsdom
import {
  describe as group,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  createControls,
  randomSeed,
  type Controls,
  type StepOutcome,
} from "./controls";

// The controls own a `setInterval` tick loop, so the timing tests drive it with
// fake timers. Each test builds a fresh component into a clean document.

const SPEED_NORMAL_MS = 700; // the 1× tier the selector defaults to

group("createControls", () => {
  let onStep: ReturnType<typeof vi.fn>;
  let onGenerate: ReturnType<typeof vi.fn>;
  let controls: Controls;
  let cycle: number;

  const playButton = () =>
    controls.element.querySelector<HTMLButtonElement>(".controls__btn--play")!;
  const stepButton = () => buttonByText("Step");
  const buttonByText = (text: string) =>
    [...controls.element.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === text,
    )!;
  const seedInput = () =>
    controls.element.querySelector<HTMLInputElement>(".controls__seed-input")!;
  const speedSelect = () =>
    controls.element.querySelector<HTMLSelectElement>(".controls__select")!;
  const cycleReadout = () =>
    controls.element.querySelector<HTMLElement>(".controls__cycle")!;
  const stateBadge = () =>
    controls.element.querySelector<HTMLElement>(".controls__state")!;
  const quietHint = () =>
    controls.element.querySelector<HTMLElement>(".controls__quiet")!;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    cycle = 0;
    // Default: an ongoing run that advances the clock and carries news each cycle.
    onStep = vi.fn((): StepOutcome => ({ cycle: ++cycle, dispatches: 1 }));
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
    onStep.mockReturnValue({ cycle: 1, dispatches: 0, ended: { kind: "dark" } });
    playButton().click();
    vi.advanceTimersByTime(SPEED_NORMAL_MS);

    expect(onStep).toHaveBeenCalledTimes(1);
    expect(controls.isPlaying()).toBe(false);
  });

  it("shows the cycle counter advancing as the loop runs", () => {
    expect(cycleReadout().textContent).toBe("Cycle 0");
    playButton().click();
    vi.advanceTimersByTime(SPEED_NORMAL_MS * 3);
    expect(cycleReadout().textContent).toBe("Cycle 3");
  });

  it("reflects run state in the status badge: paused → running → paused", () => {
    expect(stateBadge().textContent).toBe("Paused");
    expect(stateBadge().classList.contains("controls__state--paused")).toBe(true);

    playButton().click();
    expect(stateBadge().textContent).toBe("Running");
    expect(stateBadge().classList.contains("controls__state--running")).toBe(
      true,
    );

    playButton().click(); // pause
    expect(stateBadge().textContent).toBe("Paused");
  });

  it("surfaces an ended run and disables Play/Step", () => {
    onStep.mockReturnValue({
      cycle: 12,
      dispatches: 1,
      ended: { kind: "unified", victor: "Helion Compact" },
    });
    stepButton().click();

    expect(stateBadge().textContent).toBe("Ended · Unified");
    expect(stateBadge().classList.contains("controls__state--ended")).toBe(true);
    expect(stateBadge().title).toContain("Helion Compact");
    expect(cycleReadout().textContent).toBe("Cycle 12");
    expect(playButton().disabled).toBe(true);
    expect(stepButton().disabled).toBe(true);

    // Further presses are inert once the history has concluded.
    onStep.mockClear();
    stepButton().click();
    playButton().click();
    expect(onStep).not.toHaveBeenCalled();
  });

  it("flashes a quiet-cycle hint when a deliberate Step emits nothing", () => {
    onStep.mockReturnValue({ cycle: 1, dispatches: 0 });
    expect(quietHint().hidden).toBe(true);

    stepButton().click();
    expect(quietHint().hidden).toBe(false);

    // The hint clears itself after its window elapses.
    vi.advanceTimersByTime(2000);
    expect(quietHint().hidden).toBe(true);
  });

  it("does not flash the quiet hint during auto-play", () => {
    onStep.mockReturnValue({ cycle: 1, dispatches: 0 });
    playButton().click();
    vi.advanceTimersByTime(SPEED_NORMAL_MS);
    expect(quietHint().hidden).toBe(true);
  });

  it("Generate resets the cycle counter and re-enables a concluded run", () => {
    onStep.mockReturnValue({ cycle: 5, dispatches: 1, ended: { kind: "dark" } });
    stepButton().click();
    expect(playButton().disabled).toBe(true);
    expect(stateBadge().textContent).toBe("Ended · Dark");

    buttonByText("Generate").click();
    expect(cycleReadout().textContent).toBe("Cycle 0");
    expect(stateBadge().textContent).toBe("Paused");
    expect(playButton().disabled).toBe(false);
    expect(stepButton().disabled).toBe(false);
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
