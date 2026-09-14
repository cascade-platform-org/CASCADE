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
 *
 * The step shape and the shared gate helpers live in `lib/tour/types.ts`.
 */

import { useNetworkStore } from "@/store/network-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";
import { awaitUpdate, type TourStep } from "@/lib/tour/types";

/** The sample this tour is written against — 6 nodes and one Earthquake hazard. */
export const TOUR_SAMPLE_FILE = "IJDRR_example.json";

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
    title: "A worked example",
    body:
      "A small interdependent system after an earthquake: an electric source feeds a " +
      "substation, the substation drives a water pump, and the pump serves a city and a " +
      "hospital. The scenario is restored and reproduced step by step.",
  },
  {
    anchor: "canvas",
    side: "right",
    title: "The network",
    body:
      "Nodes are the elements of the system; an edge a → b denotes that a supplies b. Colour " +
      "encodes Functionality: green operational, orange degraded, red critical. Only the " +
      "source was damaged directly; every other state is a consequence.",
  },
  {
    anchor: "canvas",
    // The canvas fills the workspace, so ringing it would say nothing about
    // where to click. Ring the node itself.
    resolve: () => nodeElementByLabel("Substation"),
    side: "left",
    title: "Open an element",
    body: "Select the Substation to inspect how an element is configured.",
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
    title: "Supply and demand",
    body:
      "Categories are the services this element deals in. Supply Capacity declares it a " +
      "supplier of one; Demand declares it a consumer. Node Type determines the shape drawn " +
      "and nothing else.",
  },
  {
    anchor: "inspector",
    side: "left",
    title: "Dependency and backup",
    body:
      "Each consumed category carries a Dependency level: N transmits an upstream failure in " +
      "full, 1 makes that service unable to degrade the element, intermediate values attenuate " +
      "it. A backup instead defers the drop — the element holds its level and a countdown starts.",
  },
  {
    anchor: "reset",
    side: "bottom",
    title: "Restore the baseline",
    body:
      "The damage on screen is a stored result of an earlier run. Reset restores the network " +
      "to its Scenario Baseline, so the cascade can be reproduced rather than read.",
    waitHint: "Waiting for a Reset…",
    waitFor: awaitUpdate("scenario_reset"),
  },
  {
    anchor: "events",
    side: "bottom",
    title: "Apply an Event",
    body:
      "These are the hazards and disservices defined for the project. Apply Earthquake: it " +
      "damages the electric source. No consequence has been computed yet.",
    waitHint: "Waiting for you to apply an Event…",
    waitFor: awaitUpdate("event_applied"),
  },
  {
    anchor: "propagate",
    side: "bottom",
    title: "Propagate",
    body:
      "Run the engine. It propagates that failure through the graph and terminates when no " +
      "element can degrade further.",
    waitHint: "Waiting for a Propagation…",
    waitFor: awaitUpdate("propagation"),
  },
  {
    anchor: "canvas",
    side: "right",
    title: "Read the cascade",
    body:
      "Select any element that changed colour: the Inspector names the upstream element or " +
      "Event responsible. An amber ring marks an element held up by a backup rather than one " +
      "that was unaffected.",
  },
  {
    anchor: "temporal",
    // Time opens a panel directly under its button, exactly where the card
    // would otherwise sit — so the card goes to the canvas instead.
    cardAnchor: "canvas",
    side: "bottom",
    title: "Advance the clock",
    body:
      "Backups consume their duration only when time advances, and time advances only from " +
      "here. A Temporal Jump produces the second wave of the cascade.",
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
      "Edit, apply, propagate, compare. Help opens the manual: what each attribute does, how " +
      "to write Rules, and how to evaluate an intervention.",
  },
];
