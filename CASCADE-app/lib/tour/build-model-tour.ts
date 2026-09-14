/**
 * build-model-tour.ts — the hands-on walkthrough for authoring a model.
 *
 * The first-run tour loads a finished example and teaches how to *run* it:
 * reset, apply an Event, propagate, jump forward. This one starts on the empty
 * Canvas the wizard just made and teaches how to *build* one, because the four
 * things that stop a hand-built model working are all invisible — the network
 * looks right and the cascade simply does nothing:
 *
 *   1. nothing exists until it is in the Model Configuration: with no Category
 *      there is nothing to supply, and with no Event nothing to be exposed to;
 *   2. Node Type does not make a node supply or consume — `supply_capacity`
 *      and `demand` do;
 *   3. an edge `a → b` means *a supplies b*, so a backwards arrow propagates
 *      nothing;
 *   4. an Event with no `vulnerability_levels` does nothing when applied.
 *
 * The order of the steps is dictated by the Inspector, not by taste. Only the
 * *supplier* is tagged with a Category: that tag is what makes its Supply
 * Capacity section appear, and — once the edge is drawn — what makes the
 * consumer's Category Dependency Profile section appear by itself
 * (node-inspector.tsx, `inboundCategories`). So the consumer is never asked for
 * a Category, and Demand is only asked for after the edge exists. Likewise the
 * Event is defined before the step that asks for a vulnerability to it, since
 * the vulnerability editor lists the Events in the configuration.
 *
 * Every step that asks for an action carries a `waitFor` armed when the step
 * appears, so the tour advances only once the user has really done it. Nothing
 * here is scripted against particular labels: the user names their own
 * elements, and the predicates watch the stores for shape, not for content.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { awaitUpdate, type TourStep } from "@/lib/tour/types";

/** Nodes on the Canvas the user is building. */
function nodeCount(): number {
  return Object.keys(useCanvasStore.getState().nodes).length;
}

function edgeCount(): number {
  return Object.keys(useCanvasStore.getState().edges).length;
}

/** True once the Model Configuration defines at least one Category. */
function someCategoryDefined(): boolean {
  return useConfigStore.getState().config.categories.length > 0;
}

/** True once the Model Configuration defines at least one Event. */
function someEventDefined(): boolean {
  return useConfigStore.getState().config.events.length > 0;
}

/** True once any node supplies a non-zero amount of something. */
function someNodeSupplies(): boolean {
  return Object.values(useCanvasStore.getState().nodes).some((n) =>
    Object.values(n.supply_capacity ?? {}).some((v) => (v ?? 0) > 0),
  );
}

/** True once any node asks for a non-zero amount of something. */
function someNodeDemands(): boolean {
  return Object.values(useCanvasStore.getState().nodes).some((n) =>
    Object.values(n.category_dependency_profiles ?? {}).some((p) => (p?.demand ?? 0) > 0),
  );
}

/** True once any element can be hit by any Event. */
function someElementIsVulnerable(): boolean {
  const { nodes, edges } = useCanvasStore.getState();
  const hasEntry = (v: unknown) =>
    !!v && typeof v === "object" && Object.values(v as Record<string, number>).some((n) => n > 0);
  return (
    Object.values(nodes).some((n) => hasEntry(n.vulnerability_levels)) ||
    Object.values(edges).some((e) => hasEntry(e.vulnerability_levels))
  );
}

export const BUILD_MODEL_TOUR: TourStep[] = [
  {
    title: "Building a model",
    body:
      "Nine actions on an empty Canvas. The result is the minimal network that cascades: one " +
      "element that supplies a service, one that requires it, and an Event that disables the " +
      "first.",
  },
  {
    anchor: "config",
    side: "bottom",
    title: "Define a Category",
    body:
      "Open the Model Configuration and add a Category — water, power, transport. A Category " +
      "is the service that flows between elements. Supply and demand are declared per " +
      "Category, so nothing can be declared before one exists.",
    waitHint: "Waiting for a Category…",
    waitFor: () => () => someCategoryDefined(),
  },
  {
    anchor: "tool-add-node",
    side: "right",
    title: "Add two elements",
    body:
      "Select Add Node and place two nodes: one supplier, one consumer. Labels are free — no " +
      "step of this walkthrough depends on them.",
    waitHint: "Waiting for a second node…",
    waitFor: () => {
      const armedAt = nodeCount();
      return () => nodeCount() >= Math.max(2, armedAt + 1);
    },
  },
  {
    anchor: "inspector",
    side: "left",
    title: "Declare the supply",
    body:
      "Select the supplier, assign it the Category, then set a Supply Capacity in that " +
      "Category. Node Type determines the shape drawn and nothing else; supply is declared by " +
      "this field alone.",
    waitHint: "Waiting for a Supply Capacity…",
    waitFor: () => () => someNodeSupplies(),
  },
  {
    anchor: "tool-add-edge",
    side: "right",
    title: "Connect supplier to consumer",
    body:
      "Select Add Edge and drag from the supplier to the consumer. The direction carries the " +
      "meaning: a → b denotes that a supplies b. A reversed edge transmits nothing.",
    waitHint: "Waiting for an edge…",
    waitFor: () => {
      const armedAt = edgeCount();
      return () => edgeCount() > armedAt;
    },
  },
  {
    anchor: "inspector",
    side: "left",
    title: "Declare the demand",
    body:
      "Select the consumer and set a Demand under Category Dependency Profiles. An element is " +
      "affected by a shortfall only in a service it demands.",
    waitHint: "Waiting for a Demand…",
    waitFor: () => () => someNodeDemands(),
  },
  {
    anchor: "config",
    side: "bottom",
    title: "Define an Event",
    body:
      "Return to the Model Configuration and add an Event — a hazard or a disservice. " +
      "Vulnerability is declared per Event, so the Event is defined before the elements " +
      "exposed to it.",
    waitHint: "Waiting for an Event…",
    waitFor: () => () => someEventDefined(),
  },
  {
    anchor: "inspector",
    side: "left",
    title: "Set the vulnerability",
    body:
      "Select the supplier and set a Vulnerability level for that Event. The imposed " +
      "Functionality is N − vulnerability, so 2 on a 3-level scale drives the element to " +
      "critical. An Event with no vulnerability entry anywhere has no effect.",
    waitHint: "Waiting for a vulnerability…",
    waitFor: () => () => someElementIsVulnerable(),
  },
  {
    anchor: "events",
    side: "bottom",
    title: "Apply the Event",
    body: "Apply the Event. It damages the supplier; no consequence has been computed yet.",
    waitHint: "Waiting for an Event…",
    waitFor: awaitUpdate("event_applied"),
  },
  {
    anchor: "propagate",
    side: "bottom",
    title: "Run the Propagation",
    body:
      "Propagate. The consumer degrades in turn, having lost the service it requires. If it " +
      "does not, one of four declarations is missing: the Category, the Supply Capacity, the " +
      "Demand, or the edge direction.",
    waitHint: "Waiting for a Propagation…",
    waitFor: awaitUpdate("propagation"),
  },
  {
    title: "Model complete",
    body:
      "Larger models are the same construction repeated: more elements, more Categories, and " +
      "Rules where the graph alone is insufficient. Reset restores the network to its " +
      "Scenario Baseline.",
  },
];
