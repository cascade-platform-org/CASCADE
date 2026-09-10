/**
 * first-run-tour.ts — step definitions for the guided tour.
 *
 * The copy walks the core loop the User Manual documents: read the network,
 * inspect an element's attributes, reset the scenario, apply an Event,
 * propagate, advance time.
 *
 * Steps that ask for an action carry a `waitFor` that is *armed when the step
 * appears*: it captures the state it found and returns a predicate that only
 * turns true on a genuinely new action. That matters because the sample ships
 * with the Earthquake already applied — an absolute check like "the latest
 * history entry is an event" would be satisfied on arrival and the step would
 * skip itself. `Next` stays available as an escape hatch so nobody is trapped
 * by a step they cannot satisfy (a guest without `can_propagate`).
 *
 * Anchors are `data-tour="…"` attributes on the real components, never CSS or
 * DOM-structure selectors. `resolve` is the exception, for when a `data-tour`
 * anchor is too coarse to aim at — see the "Open an element" step.
 */

import { useNetworkStore } from "@/store/network-store";
import { useHistoryStore } from "@/store/history-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

export interface TourStep {
  /** Value of the target's `data-tour` attribute. Omit for a centred step. */
  anchor?: string;
  /**
   * Finer spotlight than `anchor` can express, resolved when the tour starts.
   * Falls back to `anchor` when it returns null.
   */
  resolve?: () => HTMLElement | null;
  title: string;
  body: string;
  side?: "top" | "bottom" | "left" | "right";
  /**
   * `data-tour` anchor to position the card against, when sitting next to the
   * ringed target would cover what the step asks the user to use — a control
   * that opens a panel over its own surroundings. The ring stays on the target.
   */
  cardAnchor?: string;
  /**
   * Called when the step appears; returns a predicate re-checked on every store
   * change. The step advances by itself once the predicate turns true.
   */
  waitFor?: () => () => boolean;
  /** Shown under the body while waiting, in place of a plain "click Next". */
  waitHint?: string;
}

/** The sample this tour is written against — 6 nodes and one Earthquake hazard. */
export const TOUR_SAMPLE_FILE = "IJDRR_example.json";

/** `updateHistory` is latest-first, so entry 0 is the most recent action. */
function latestUpdate(): { id: string; update_type: string } | undefined {
  return useHistoryStore.getState().updateHistory[0];
}

/**
 * Waits for a *new* history entry of the given kind. Comparing entry ids rather
 * than just the type is what stops a pre-loaded scenario from satisfying the
 * step before the user has done anything.
 */
function awaitUpdate(type: string): () => () => boolean {
  return () => {
    const armedAt = latestUpdate()?.id;
    return () => {
      const latest = latestUpdate();
      return !!latest && latest.id !== armedAt && latest.update_type === type;
    };
  };
}

/** The element drawn for a node carrying this label, if it is on screen. */
function nodeElementByLabel(label: string): HTMLElement | null {
  const node = Object.values(useCanvasStore.getState().nodes).find(
    (n) => n.label?.toLowerCase() === label.toLowerCase(),
  );
  if (!node) return null;
  return document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${CSS.escape(node.id)}"]`,
  );
}

export const FIRST_RUN_TOUR: TourStep[] = [
  {
    title: "A one-minute tour",
    body:
      "You are looking at a small worked example after an earthquake: an electric source " +
      "feeds a substation, which drives a water pump serving a city and a hospital. We " +
      "will rewind it and produce this damage ourselves.",
  },
  {
    anchor: "canvas",
    side: "right",
    title: "The network",
    body:
      "Nodes are the elements of your system, and an arrow a → b means a supplies b. " +
      "Colour is each element's condition: green operational, orange degraded, red " +
      "failed. Only the source was hit directly — everything else here is consequence.",
  },
  {
    anchor: "canvas",
    // The canvas fills the workspace, so ringing it would say nothing about
    // where to click. Ring the node itself.
    resolve: () => nodeElementByLabel("Substation"),
    side: "left",
    title: "Open an element",
    body: "Click the Substation node to see how an element is configured.",
    waitHint: "Waiting for you to select a node…",
    waitFor: () => {
      const armedAt = [...useNetworkStore.getState().selectedNodeIds].join(",");
      return () => {
        const now = [...useNetworkStore.getState().selectedNodeIds];
        return now.length > 0 && now.join(",") !== armedAt;
      };
    },
  },
  {
    anchor: "inspector",
    side: "left",
    title: "What it provides and needs",
    body:
      "Categories are the services this element deals in. Supply Capacity makes it a " +
      "source of one; Demand makes it a consumer. Node Type only changes the shape drawn " +
      "— these two fields decide what it actually does.",
  },
  {
    anchor: "inspector",
    side: "left",
    title: "How hard it depends",
    body:
      "For each category it consumes there is a Dependency level: N means an upstream " +
      "failure hits in full, 1 means that service can never bring it down, and values " +
      "between soften the blow. A backup goes further — the element holds its level and " +
      "starts a countdown instead of dropping.",
  },
  {
    anchor: "reset",
    side: "bottom",
    title: "Rewind it",
    body:
      "The damage on screen is a saved result — an earthquake someone already ran. Click " +
      "Reset to put the network back to how it was before it, then cause the damage " +
      "yourself and watch it spread, rather than reading the outcome.",
    waitHint: "Waiting for a Reset…",
    waitFor: awaitUpdate("scenario_reset"),
  },
  {
    anchor: "events",
    side: "bottom",
    title: "Apply an Event",
    body:
      "These are the hazards and disservices defined for the project. Click Earthquake — " +
      "it damages the electric source. Nothing has spread yet.",
    waitHint: "Waiting for you to apply an Event…",
    waitFor: awaitUpdate("event_applied"),
  },
  {
    anchor: "propagate",
    side: "bottom",
    title: "Propagate",
    body:
      "Now run the engine. It works out how that one failure travels through the graph " +
      "and stops when nothing else can get worse.",
    waitHint: "Waiting for a Propagation…",
    waitFor: awaitUpdate("propagation"),
  },
  {
    anchor: "canvas",
    side: "right",
    title: "Read the cascade",
    body:
      "Select anything that changed colour: the Inspector names which upstream element " +
      "or Event caused it. An amber ring means the element is holding on a backup rather " +
      "than having survived.",
  },
  {
    anchor: "temporal",
    // Time opens a panel directly under its button, exactly where the card
    // would otherwise sit — so the card goes to the canvas instead.
    cardAnchor: "canvas",
    side: "bottom",
    title: "Advance the clock",
    body:
      "Backups count down, and time only moves when you jump it from here. That is when " +
      "the second wave of a cascade shows up.",
    waitHint: "Waiting for a Temporal Jump…",
    waitFor: () => {
      const armedAt = useUiStore.getState().temporalJumpElapsedHours;
      return () => useUiStore.getState().temporalJumpElapsedHours > armedAt;
    },
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
  return [...new Set(steps.map((s) => s.anchor).filter((a): a is string => !!a))].filter(
    (a) => !document.querySelector(`[data-tour="${a}"]`),
  );
}
