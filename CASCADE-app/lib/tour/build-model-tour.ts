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
 * *supplier* is tagged with a Category and set to Node Type Source: either one
 * makes its Supply Capacity section appear (node-inspector.tsx renders it for a
 * Source or for any node with a Category), and the step asks for both so the
 * node also *looks* like the supplier it is, and — once the edge is drawn — what makes the
 * consumer's Category Dependency Profile section appear by itself
 * (node-inspector.tsx, `inboundCategories`). So the consumer is never asked for
 * a Category, and Demand is only asked for after the edge exists. Likewise the
 * Event is defined before the step that asks for a vulnerability to it, since
 * the vulnerability editor lists the Events in the configuration.
 *
 * The second half is the multi-canvas one: a second Canvas, a second Category
 * with its own supplier on it, an inter-canvas edge from that supplier to the
 * consumer built in the first half, and the All tab, where the two Canvases are
 * finally one network. It is built rather than described because the two things
 * that surprise people about Canvases — an ordinary edge cannot leave one, and
 * a Category arrives at a node over an edge without the node being tagged with
 * it — are only visible by doing it.
 *
 * Every step that asks for an action carries a `waitFor` armed when the step
 * appears, so the tour advances only once the user has really done it. Nothing
 * here is scripted against particular labels: the user names their own
 * elements, and the predicates watch the stores for shape, not for content.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
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

/** Canvases in the project. */
function canvasCount(): number {
  return useCanvasStore.getState().canvasOrder.length;
}

/** Categories defined in the Model Configuration. */
function categoryCount(): number {
  return useConfigStore.getState().config.categories.length;
}

/** Nodes that supply a non-zero amount of anything. */
function supplierCount(): number {
  return Object.values(useCanvasStore.getState().nodes).filter((n) =>
    Object.values(n.supply_capacity ?? {}).some((v) => (v ?? 0) > 0),
  ).length;
}

/**
 * Edges whose two endpoints sit on different Canvases.
 *
 * A node can belong to more than one Canvas (Canvas Membership copies it), so
 * an edge is inter-canvas only when the two Canvas *sets* are disjoint — an
 * edge between two nodes that both appear on Canvas A is local there, whatever
 * else they appear on.
 */
function interCanvasEdgeCount(): number {
  const { canvases, edges } = useCanvasStore.getState();
  const canvasesOf = new Map<string, Set<string>>();
  for (const canvas of Object.values(canvases)) {
    for (const nodeId of canvas.graph.node_ids) {
      if (!canvasesOf.has(nodeId)) canvasesOf.set(nodeId, new Set());
      canvasesOf.get(nodeId)!.add(canvas.id);
    }
  }
  return Object.values(edges).filter((e) => {
    const a = canvasesOf.get(e.source);
    const b = canvasesOf.get(e.target);
    if (!a || !b) return false;
    return ![...a].some((id) => b.has(id));
  }).length;
}

/**
 * How vulnerable the whole network is to everything, as one number.
 *
 * A count of "is anything vulnerable" would be satisfied on arrival: the Event
 * editor in the Model Configuration carries its own vulnerability levels
 * editor, so the previous step — "Define an Event" — is a place the user may
 * already have set them. The gate watches this total for an *increase* instead,
 * which a fresh entry always produces and which raising an existing level
 * produces too.
 */
function vulnerabilityTotal(): number {
  const { nodes, edges } = useCanvasStore.getState();
  const sum = (v: unknown) =>
    !v || typeof v !== "object"
      ? 0
      : Object.values(v as Record<string, number>).reduce((t, n) => t + (n > 0 ? n : 0), 0);
  return [
    ...Object.values(nodes).map((n) => sum(n.vulnerability_levels)),
    ...Object.values(edges).map((e) => sum(e.vulnerability_levels)),
  ].reduce((t, n) => t + n, 0);
}

export const BUILD_MODEL_TOUR: TourStep[] = [
  {
    title: "Building a model",
    body:
      "Fifteen actions on an empty Canvas. First the minimal network that cascades — one " +
      "element that supplies a service, one that requires it, and an Event that disables the " +
      "first. Then a second Canvas carrying a second service the same consumer depends on, " +
      "joined across the two by an inter-canvas edge.",
  },
  {
    anchor: "config",
    side: "bottom",
    title: "Define a Category",
    body:
      "Open the Model Configuration and add a Category — water, power, transport. A Category " +
      "is the service that flows between elements.",
    waitHint: "Waiting for a Category…",
    waitFor: () => () => someCategoryDefined(),
  },
  {
    anchor: "tool-add-node",
    side: "right",
    title: "Add two elements",
    body:
      "Select Add Node and place two nodes.\n\n" +
      "If you lose them off-screen: scroll to zoom, pan with the middle mouse button or the " +
      "Hand tool (H), and press F to fit everything back on screen.",
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
      "Turn one of them into a supplier. Select it and, in the Inspector — the panel on the " +
      "right — set its Node Type to Source, assign it the Category, then set a Supply " +
      "Capacity in that Category: the quantity it can supply.",
    waitHint: "Waiting for a Supply Capacity…",
    waitFor: () => () => someNodeSupplies(),
  },
  {
    anchor: "tool-add-edge",
    side: "right",
    title: "Connect supplier to consumer",
    body:
      "Select Add Edge and drag from the supplier to the consumer. The direction carries the " +
      "meaning: a → b denotes that a supplies b.",
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
      "Select the consumer and, in the Inspector on the right, set a Demand under Category " +
      "Dependency Profiles — the section appears by itself for every Category reaching the " +
      "element. Demand is not a field of its " +
      "own: it belongs to the profile of one Category. An element is affected by a shortfall " +
      "only in a service it demands.",
    waitHint: "Waiting for a Demand…",
    waitFor: () => () => someNodeDemands(),
  },
  {
    anchor: "config",
    side: "bottom",
    title: "Define an Event",
    body:
      "Return to the Model Configuration and add an Event — a hazard or a disservice. Once it " +
      "exists, each element can be given a vulnerability to it, which is how badly that " +
      "element is hit when the Event is applied.",
    waitHint: "Waiting for an Event…",
    waitFor: () => () => someEventDefined(),
  },
  {
    anchor: "inspector",
    side: "left",
    title: "Set the vulnerability",
    body:
      "Select the supplier and set a Vulnerability level for that Event in the Inspector — or " +
      "raise the one you already set while defining the Event, which the Inspector lists here " +
      "as well.",
    waitHint: "Waiting for a vulnerability…",
    waitFor: () => {
      const armedAt = vulnerabilityTotal();
      return () => vulnerabilityTotal() > armedAt;
    },
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
    anchor: "add-canvas",
    side: "bottom",
    title: "Split it across Canvases",
    body:
      "Add a second Canvas. Canvases are layers of one project — a system, a utility, an " +
      "administrative area — and an edge may cross between them, which is how a water network " +
      "depends on a power network. The rest of this walkthrough builds that second system and " +
      "hangs the consumer off it.",
    waitHint: "Waiting for a second Canvas…",
    waitFor: () => {
      const armedAt = canvasCount();
      return () => canvasCount() > armedAt;
    },
  },
  {
    anchor: "config",
    side: "bottom",
    title: "A second service",
    body:
      "Add a second Category in the Model Configuration — if the first was power, make this " +
      "one water. The consumer will end up requiring both, which is what an interdependent " +
      "system is: two services, each with its own supplier, failing for unrelated reasons.",
    waitHint: "Waiting for a second Category…",
    waitFor: () => {
      const armedAt = categoryCount();
      return () => categoryCount() > armedAt;
    },
  },
  {
    anchor: "tool-add-node",
    side: "right",
    title: "Build the second system",
    body:
      "On the new Canvas, place a node and make it a supplier of the new Category: Node Type " +
      "Source, the new Category assigned, a Supply Capacity in it. The canvas tabs switch " +
      "between Canvases; place it on the new one, not the first.",
    waitHint: "Waiting for a second supplier…",
    waitFor: () => {
      const armedAt = supplierCount();
      return () => supplierCount() > armedAt;
    },
  },
  {
    anchor: "tool-inter-canvas-edge",
    side: "right",
    title: "Connect across Canvases",
    body:
      "Select the new supplier, then click the Inter-Canvas Edge tool and pick the first " +
      "Canvas and the consumer on it. An ordinary edge can only join two elements on the same " +
      "Canvas; this is how a dependency crosses between them.\n\n" +
      "The consumer's Category Dependency Profiles now carry a block for the new Category too, " +
      "tagged via parent — it arrived over the edge, without the consumer being tagged with " +
      "the Category at all.",
    waitHint: "Waiting for an inter-canvas edge…",
    waitFor: () => {
      const armedAt = interCanvasEdgeCount();
      return () => interCanvasEdgeCount() > armedAt;
    },
  },
  {
    anchor: "global-view",
    side: "bottom",
    title: "See it whole",
    body:
      "Open the All tab. It draws every Canvas at once with the edges between them, which is " +
      "the only view where this model is one network rather than two halves. It is read-only: " +
      "editing happens on a Canvas.",
    waitHint: "Waiting for the All tab…",
    waitFor: () => () => useUiStore.getState().globalViewActive,
  },
  {
    anchor: "propagate",
    side: "bottom",
    title: "Local or global, decided before the run",
    body:
      "Propagate again, with the scope selector on global: local computes on the Canvas you " +
      "are looking at and ignores edges leaving it, global computes on every Canvas at once " +
      "and follows them. Break the second supplier and only a global run reaches the consumer.",
    waitHint: "Waiting for a Propagation…",
    waitFor: awaitUpdate("propagation"),
  },
  {
    title: "Model complete",
    body:
      "Larger models are the same construction repeated: more elements, more Categories, more " +
      "Canvases joined by inter-canvas edges, and Rules where the graph alone is " +
      "insufficient. Reset restores the network to its Scenario Baseline.\n\n" +
      "Next: steer how that network propagates — Category Types, dependency profiles and " +
      "Rules, each read by re-propagating.",
    nextTour: "customize",
  },
];
