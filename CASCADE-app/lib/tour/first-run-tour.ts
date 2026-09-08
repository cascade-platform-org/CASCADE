/**
 * first-run-tour.ts — step definitions for the guided tour.
 *
 * The copy walks the core loop the User Manual documents: set up an element,
 * apply an Event, propagate, advance time. It is deliberately short — the tour
 * shows *where* things are, the manual explains *what they mean*.
 *
 * Anchors are `data-tour="…"` attributes on the real components, never CSS or
 * DOM-structure selectors. Adding a step means adding the attribute at the
 * target and an entry here; `missingTourAnchors()` reports drift in dev.
 */

export interface TourStep {
  /** Value of the target's `data-tour` attribute. Omit for a centred step. */
  anchor?: string;
  title: string;
  body: string;
  side?: "top" | "bottom" | "left" | "right";
}

/** The sample this tour is written against — 6 nodes and one Earthquake hazard. */
export const TOUR_SAMPLE_FILE = "IJDRR_example.json";

export const FIRST_RUN_TOUR: TourStep[] = [
  {
    title: "A two-minute tour",
    body:
      "You are looking at a small worked example: an electric source feeds a substation, " +
      "which drives a water pump serving a city and a hospital. We will break it and watch " +
      "the failure spread.",
  },
  {
    anchor: "canvas",
    side: "right",
    title: "The network",
    body:
      "Nodes are the elements of your system, and an arrow a → b means a supplies b. " +
      "Colour is each element's condition: green operational, red failed.",
  },
  {
    anchor: "inspector",
    side: "left",
    title: "The Inspector",
    body:
      "Click any node and everything about it appears here — what it supplies, what it " +
      "demands, how hard it depends on each service, and whether it has a backup.",
  },
  {
    anchor: "events",
    side: "bottom",
    title: "Apply an Event",
    body:
      "These are the hazards and disservices defined for the project. Click Earthquake — " +
      "it damages the electric source. Nothing has spread yet.",
  },
  {
    anchor: "propagate",
    side: "bottom",
    title: "Propagate",
    body:
      "Now run the engine. It works out how that one failure travels through the graph, " +
      "and stops when nothing else can get worse.",
  },
  {
    anchor: "temporal",
    side: "bottom",
    title: "Advance the clock",
    body:
      "Anything running on a backup holds its level and counts down. Time only moves when " +
      "you jump it from here — that is when the second wave of a cascade shows up.",
  },
  {
    anchor: "help",
    side: "bottom",
    title: "That is the loop",
    body:
      "Edit, apply, propagate, compare. Help opens the manual: what every attribute does, " +
      "how to write rules, and how to test an intervention.",
  },
];

/** Anchors named by the tour that are not currently in the DOM. Dev guard. */
export function missingTourAnchors(steps: TourStep[] = FIRST_RUN_TOUR): string[] {
  if (typeof document === "undefined") return [];
  return steps
    .map((s) => s.anchor)
    .filter((a): a is string => !!a)
    .filter((a) => !document.querySelector(`[data-tour="${a}"]`));
}
