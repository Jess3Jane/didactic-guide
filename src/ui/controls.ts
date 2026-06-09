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

/**
 * How a run ended, surfaced as an explicit status (issue #22). `unified` —
 * one faction (the `victor`) outlasted every rival; `dark` — the sector emptied.
 */
export type EndState =
  | { kind: "unified"; victor: string }
  | { kind: "dark" };

/**
 * The result of advancing the simulation one cycle. The cycle counter and the
 * quiet-cycle hint are driven from this, so even a cycle that emits no dispatch
 * still tells the viewer that time moved (issue #22).
 */
export interface StepOutcome {
  /** The in-world cycle the engine is now on. */
  cycle: number;
  /** How many dispatches this cycle emitted; `0` marks a quiet cycle. */
  dispatches: number;
  /** Set once the run has concluded — ends the loop and shows the end state. */
  ended?: EndState;
}

/** Callbacks the host wires to the engine + feed. */
export interface ControlsCallbacks {
  /**
   * Advance the simulation one cycle and render the results, returning what
   * happened so the controls can show the cycle, quiet cycles, and the end.
   */
  onStep(): StepOutcome;
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

  // --- Status readout -------------------------------------------------------
  //
  // Always-on answer to "is it running, paused, or over — and what cycle?"
  // (issue #22). The cycle counter advances on every tick so time is visibly
  // passing even through quiet stretches; the state pill names the run state;
  // the quiet hint flashes when a deliberate Step lands on an eventless cycle.

  const statusGroup = doc.createElement("div");
  statusGroup.className = "controls__group controls__group--status";
  statusGroup.setAttribute("aria-label", "Simulation status");

  const cycleReadout = doc.createElement("span");
  cycleReadout.className = "controls__cycle";
  cycleReadout.textContent = "Cycle 0";

  const quietHint = doc.createElement("span");
  quietHint.className = "controls__quiet";
  quietHint.textContent = "quiet";
  quietHint.hidden = true;

  const stateBadge = doc.createElement("span");
  stateBadge.className = "controls__state";
  // Announce run-state changes (paused → running → ended), but not every cycle
  // tick — the counter updates too often to narrate politely.
  stateBadge.setAttribute("role", "status");
  stateBadge.setAttribute("aria-live", "polite");

  statusGroup.append(cycleReadout, quietHint, stateBadge);

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

  element.append(timeGroup, statusGroup, seedGroup);

  // --- Playback state -------------------------------------------------------

  let playing = false;
  let timer: number | null = null;
  let cycle = 0;
  // The run's end state, once it concludes. While set, the loop can't run and
  // Play/Step are disabled — a finished history is read, not advanced.
  let ended: EndState | null = null;
  let quietTimer: number | null = null;

  /** How long the "quiet cycle" hint lingers after a stepped empty cycle. */
  const QUIET_HINT_MS = 1400;

  const speedMs = (): number =>
    SPEEDS[Number(speedSelect.value)]?.ms ?? SPEEDS[DEFAULT_SPEED_INDEX].ms;

  const syncPlayButton = (): void => {
    playButton.textContent = playing ? "Pause" : "Play";
    playButton.setAttribute("aria-pressed", String(playing));
  };

  /** Reflect the run state in the cycle counter and the status pill. */
  const renderStatus = (): void => {
    cycleReadout.textContent = `Cycle ${cycle}`;
    let label: string;
    let mod: string;
    if (ended) {
      mod = "ended";
      label = ended.kind === "unified" ? "Ended · Unified" : "Ended · Dark";
      stateBadge.title =
        ended.kind === "unified"
          ? `Unified under the ${ended.victor}`
          : "The sector has gone dark";
    } else {
      mod = playing ? "running" : "paused";
      label = playing ? "Running" : "Paused";
      stateBadge.title = "";
    }
    stateBadge.textContent = label;
    stateBadge.className = `controls__state controls__state--${mod}`;
  };

  /** Enable Play/Step only while the run can still advance. */
  const syncEnabled = (): void => {
    const done = ended !== null;
    playButton.disabled = done;
    stepButton.disabled = done;
  };

  /** Restart the cycle counter's pulse so each advance reads as time passing. */
  const pulseCycle = (): void => {
    cycleReadout.classList.remove("is-tick");
    void cycleReadout.offsetWidth; // force reflow so the animation replays
    cycleReadout.classList.add("is-tick");
  };

  const clearQuietHint = (): void => {
    quietHint.hidden = true;
    if (quietTimer !== null) {
      window.clearTimeout(quietTimer);
      quietTimer = null;
    }
  };

  const flashQuietHint = (): void => {
    quietHint.hidden = false;
    if (quietTimer !== null) window.clearTimeout(quietTimer);
    quietTimer = window.setTimeout(() => {
      quietHint.hidden = true;
      quietTimer = null;
    }, QUIET_HINT_MS);
  };

  const stopTimer = (): void => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  /**
   * Advance the simulation one cycle and reflect the result. `manual` marks a
   * deliberate Step, which earns the quiet-cycle hint when nothing happened;
   * the auto-running loop relies on the pulsing counter alone so it stays calm.
   */
  const advance = (manual: boolean): void => {
    if (ended) return;
    const outcome = callbacks.onStep();
    cycle = outcome.cycle;
    clearQuietHint();
    pulseCycle();
    if (outcome.ended) {
      ended = outcome.ended;
      pause(); // a concluded history stops the loop deliberately
      syncEnabled();
    } else if (manual && outcome.dispatches === 0) {
      flashQuietHint();
    }
    renderStatus();
  };

  const startTimer = (): void => {
    stopTimer();
    timer = window.setInterval(() => advance(false), speedMs());
  };

  const play = (): void => {
    if (playing || ended) return;
    playing = true;
    syncPlayButton();
    renderStatus();
    startTimer();
  };

  function pause(): void {
    if (!playing) return;
    playing = false;
    stopTimer();
    syncPlayButton();
    renderStatus();
  }

  // --- Wiring ---------------------------------------------------------------

  playButton.addEventListener("click", () => {
    if (playing) pause();
    else play();
  });

  stepButton.addEventListener("click", () => {
    if (ended) return;
    pause(); // stepping is a deliberate single advance
    advance(true);
  });

  // Re-time a running loop the moment the speed changes.
  speedSelect.addEventListener("change", () => {
    if (playing) startTimer();
  });

  const generate = (): void => {
    pause();
    // A fresh world starts a fresh history: clear the end state and the clock
    // before the host rebuilds the engine from cycle 0.
    ended = null;
    cycle = 0;
    clearQuietHint();
    syncEnabled();
    renderStatus();
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
  syncEnabled();
  renderStatus();

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
      clearQuietHint();
    },
  };
}
