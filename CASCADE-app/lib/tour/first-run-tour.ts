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
      "source was damaged directly; every other state is a consequence.\n\n" +
      "Moving around: scroll to zoom, drag with the middle mouse button or the Hand tool (H) " +
      "to pan, and press F — or the ⤢ button at bottom left — to fit the whole network on " +
      "screen again.",
  },
  {
    anchor: "canvas",
    // The canvas fills the workspace, so ringing it would say nothing about
    // where to click. Ring the node itself.
    resolve: () => nodeElementByLabel("Substation"),
    side: "left",
    title: "Open an element",
    body:
      "Select the Substation. Everything it declares opens in the Inspector — the panel down " +
      "the right-hand side.",
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
    title: "Supply Capacity",
    body:
      "This is the Inspector, on the right. A Category is a service the element deals in — " +
      "often a resource that is consumed, such as water or electricity. Supply Capacity is " +
      "how much of a Category this element can " +
      "supply. What it requires is not a field of its own: it is the Demand held in its " +
      "Category Dependency Profile for that Category, shown further down. Node Type " +
      "determines the shape drawn and nothing else.",
  },
  {
    anchor: "inspector",
    side: "left",
    title: "Category Dependency Profile",
    body:
      "One entry per Category reaching this element. Dependency level: N transmits an upstream " +
      "failure in full, 1 makes that service unable to degrade the element, intermediate values " +
      "attenuate it. Demand is the quantity the element requests in that Category. A backup " +
      "instead defers the drop — the element holds its level and a countdown starts.",
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
    anchor: "legend",
    side: "left",
    title: "Read the cascade",
    body:
      "The Legend is the key to what is now on screen: the Functionality colours, the Node " +
      "Type shapes, and the amber ring — an element still held up by a backup, with hours " +
      "left on its Functionality Time. Select any element that changed colour and the " +
      "Inspector on the right names the upstream element or Event responsible.",
  },
  {
    anchor: "temporal",
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
      "to write Rules, and how to evaluate an intervention.\n\n" +
      "Next: build a network of your own, from an empty canvas.",
    nextTour: "build-model",
  },
];
