/**
 * registry.ts — every tour, declared once.
 *
 * A tour used to be spread over five files: its steps, its entry in the
 * runner's map, its launcher, its line in the User Manual, and its button on
 * the New Project screen. Adding one meant editing all five and keeping four
 * copies of its name in step. Here a tour is one entry, and the runner, the
 * launchers and both menus read it.
 *
 * `start` says what the tour needs on screen before it can begin:
 *   - `{ sample }` loads that worked example, replacing the open project;
 *   - `{ empty: true }` starts a fresh blank project instead.
 * Either way the open project is discarded, which is why every entry also
 * carries the `discards` line its menus show before starting.
 */

import { FIRST_RUN_TOUR, TOUR_SAMPLE_FILE } from "@/lib/tour/first-run-tour";
import { BUILD_MODEL_TOUR } from "@/lib/tour/build-model-tour";
import {
  CUSTOMIZE_PROPAGATION_TOUR,
  CUSTOMIZE_TOUR_SAMPLE_FILE,
} from "@/lib/tour/customize-propagation-tour";
import { PLATFORM_TOUR } from "@/lib/tour/platform-tour";
import type { TourStep } from "@/lib/tour/types";

export interface TourDefinition {
  /** Menu label. */
  label: string;
  /** One line under the label — what this tour teaches. */
  blurb: string;
  steps: TourStep[];
  /** What to put on screen first. */
  start: { sample: string } | { empty: true };
  /** Shown by entry points reachable over real work, before starting. */
  discards: string;
}

const OPENS_SAMPLE = "Open the tour's example network? The project you have open is discarded.";

export const TOURS = {
  "first-run": {
    label: "Guided tour",
    blurb: "the core loop, on a worked example.",
    steps: FIRST_RUN_TOUR,
    start: { sample: TOUR_SAMPLE_FILE },
    discards: OPENS_SAMPLE,
  },
  "build-model": {
    label: "Build a model",
    blurb: "build one that cascades, on a new empty canvas.",
    steps: BUILD_MODEL_TOUR,
    start: { empty: true },
    discards: "Start the walkthrough on a new empty canvas? The project you have open is discarded.",
  },
  customize: {
    label: "Customize the Propagation",
    blurb: "change one declaration at a time, and re-propagate to read what it did.",
    steps: CUSTOMIZE_PROPAGATION_TOUR,
    // The *extended* example, not the one the other tours use: its two mutually
    // linked substations are what makes the Category Type switch visible at all
    // (see customize-propagation-tour.ts).
    start: { sample: CUSTOMIZE_TOUR_SAMPLE_FILE },
    discards: OPENS_SAMPLE,
  },
  platform: {
    label: "Analyse and decide",
    blurb: "causality, time, the Scorecard, the Analysis Module and repair ranking.",
    steps: PLATFORM_TOUR,
    start: { sample: TOUR_SAMPLE_FILE },
    discards: OPENS_SAMPLE,
  },
} as const satisfies Record<string, TourDefinition>;

export type TourId = keyof typeof TOURS;

/** Menu order — the order a newcomer should meet them in. */
export const TOUR_IDS = Object.keys(TOURS) as TourId[];
