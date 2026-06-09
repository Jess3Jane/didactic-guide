// Time & seed controls — drive the simulation from the page (issue #7).
//
// This is the other half of the UI from the feed: where `feed.ts` renders the
// chronicle, `controls.ts` decides *when* the engine ticks and *which* world it
// runs. It owns the play/pause/step loop and the seed input, but it knows
// nothing about the engine or the feed — it only fires callbacks. The actual
// RNG → worldgen → engine → feed wiring lives in `main.ts` (GDD §6), the one
// place `sim/` and `ui/` meet.
//
// Like the feed, this is the presentation layer, so it touches the DOM. The
// loop itself is intentionally thin: a `setInterval` whose period comes from the
// speed selector, calling back into the host once per cycle.

/** Callbacks the host wires to the engine + feed. */
export interface ControlsCallbacks {
  /**
   * Advance the simulation one cycle and render the results. Returns `false`
   * when the run has nothing left to simulate, so the loop can pause itself.
   */
  onStep(): boolean;
  /** Build a fresh sector from `seed` and reset the chronicle. */
  onGenerate(seed: string): void;
}

/** A live controls bar bound to a root element. */
export interface Controls {
  /** The root element to mount in the page. */
  readonly element: HTMLElement;
  /** The current seed text. */
  getSeed(): string;
  /** Set the seed input's value. */
  setSeed(seed: string): void;
  /** Whether the tick loop is currently running. */
  isPlaying(): boolean;
  /** Stop any running loop — for teardown. */
  destroy(): void;
}

/** A playback speed: how long the loop waits between cycles. */
interface Speed {
  label: string;
  ms: number;
}

// Gentle by default so a human can read the chronicle as it scrolls; faster
// tiers let an impatient viewer fast-forward through quiet stretches.
const SPEEDS: readonly Speed[] = [
  { label: "0.5×", ms: 1400 },
  { label: "1×", ms: 700 },
  { label: "2×", ms: 350 },
  { label: "4×", ms: 150 },
];
const DEFAULT_SPEED_INDEX = 1;

/**
 * A pronounceable random seed — alternating consonants and vowels read better
 * as a shareable handle than raw base36, and "randomize" should feel playful.
 *
 * UI-only randomness: this is the one spot a fresh seed is conjured, so reaching
 * for `Math.random()` here is fine. Determinism lives downstream of the seed —
 * once chosen, the same string always reproduces the same history.
 */
export function randomSeed(): string {
  const consonants = "bcdfghjklmnpqrstvwxz";
  const vowels = "aeiou";
  let out = "";
  for (let i = 0; i < 7; i++) {
    const set = i % 2 === 0 ? consonants : vowels;
    out += set[Math.floor(Math.random() * set.length)];
  }
  return out;
}

/**
 * Create the time + seed controls.
 *
 * The bar is returned on `element` for the caller to mount; nothing is appended
 * to the document automatically. The host owns the engine and feed and reacts
 * through `callbacks`.
 */
export function createControls(callbacks: ControlsCallbacks): Controls {
  const doc = document;

  const element = doc.createElement("section");
  element.className = "controls";
  element.setAttribute("aria-label", "Simulation controls");

  // --- Time controls --------------------------------------------------------

  const timeGroup = doc.createElement("div");
  timeGroup.className = "controls__group controls__group--time";

  const playButton = doc.createElement("button");
  playButton.type = "button";
  playButton.className = "controls__btn controls__btn--play";

  const stepButton = doc.createElement("button");
  stepButton.type = "button";
  stepButton.className = "controls__btn";
  stepButton.textContent = "Step";

  const speedSelect = doc.createElement("select");
  speedSelect.className = "controls__select";
  speedSelect.setAttribute("aria-label", "Playback speed");
  SPEEDS.forEach((speed, i) => {
    const option = doc.createElement("option");
    option.value = String(i);
    option.textContent = speed.label;
    speedSelect.append(option);
  });
  speedSelect.value = String(DEFAULT_SPEED_INDEX);

  timeGroup.append(playButton, stepButton, speedSelect);

  // --- Seed controls --------------------------------------------------------

  const seedGroup = doc.createElement("div");
  seedGroup.className = "controls__group controls__group--seed";

  const seedLabel = doc.createElement("label");
  seedLabel.className = "controls__seed-label";
  seedLabel.textContent = "Seed";

  const seedInput = doc.createElement("input");
  seedInput.type = "text";
  seedInput.className = "controls__seed-input";
  seedInput.setAttribute("aria-label", "World seed");
  seedInput.spellcheck = false;
  seedInput.autocomplete = "off";
  seedLabel.append(seedInput);

  const randomizeButton = doc.createElement("button");
  randomizeButton.type = "button";
  randomizeButton.className = "controls__btn";
  randomizeButton.textContent = "Randomize";

  const generateButton = doc.createElement("button");
  generateButton.type = "button";
  generateButton.className = "controls__btn controls__btn--primary";
  generateButton.textContent = "Generate";

  seedGroup.append(seedLabel, randomizeButton, generateButton);

  element.append(timeGroup, seedGroup);

  // --- Playback state -------------------------------------------------------

  let playing = false;
  let timer: number | null = null;

  const speedMs = (): number =>
    SPEEDS[Number(speedSelect.value)]?.ms ?? SPEEDS[DEFAULT_SPEED_INDEX].ms;

  const syncPlayButton = (): void => {
    playButton.textContent = playing ? "Pause" : "Play";
    playButton.setAttribute("aria-pressed", String(playing));
  };

  const stopTimer = (): void => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  /** Run one cycle; pause the loop if the run has ended. */
  const step = (): void => {
    const more = callbacks.onStep();
    if (!more) pause();
  };

  const startTimer = (): void => {
    stopTimer();
    timer = window.setInterval(step, speedMs());
  };

  const play = (): void => {
    if (playing) return;
    playing = true;
    syncPlayButton();
    startTimer();
  };

  function pause(): void {
    if (!playing) return;
    playing = false;
    stopTimer();
    syncPlayButton();
  }

  // --- Wiring ---------------------------------------------------------------

  playButton.addEventListener("click", () => {
    if (playing) pause();
    else play();
  });

  stepButton.addEventListener("click", () => {
    pause(); // stepping is a deliberate single advance
    callbacks.onStep();
  });

  // Re-time a running loop the moment the speed changes.
  speedSelect.addEventListener("change", () => {
    if (playing) startTimer();
  });

  const generate = (): void => {
    pause();
    callbacks.onGenerate(seedInput.value.trim());
  };

  generateButton.addEventListener("click", generate);

  // Enter in the seed field generates, matching the obvious expectation.
  seedInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      generate();
    }
  });

  randomizeButton.addEventListener("click", () => {
    seedInput.value = randomSeed();
    generate();
  });

  syncPlayButton();

  return {
    element,
    getSeed: () => seedInput.value.trim(),
    setSeed: (seed: string) => {
      seedInput.value = seed;
    },
    isPlaying: () => playing,
    destroy: () => {
      pause();
      stopTimer();
    },
  };
}
