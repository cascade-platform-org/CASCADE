/**
 * customize-propagation-tour.ts — how to change what the engine computes.
 *
 * Four declarations steer a Propagation, and none of them is code: the Category
 * Type, the Functionality Scale, the per-category dependency profile, and
 * Rules. This tour changes one at a time and re-runs the Propagation after
 * each, because that is the only honest way to read them — every one is
 * invisible on the canvas, and they can cancel each other out.
 *
 * It runs on `IJDRR_Extended_example.json` rather than the plain IJDRR example,
 * for one structural reason: that network has two substations fed by the same
 * source AND linked to each other. Under `Requisite` each substation is the
 * other's alternative supplier within the electric category, so `best_of`
 * redundancy lets the pair hold itself up and the source's failure does not
 * travel. Under `SourceToDemands` the flow pass asks how much is delivered, a
 * critical source delivers nothing, and the mutual link carries no quantity.
 * The plain example has no such pair, and flipping its Category Type changes
 * nothing at all.
 *
 * Measured on that sample, with the Earthquake applied (Electric Source
 * critical):
 *
 *   electric = Requisite (as shipped)   → nothing propagates
 *   electric = SourceToDemands          → City degrades, Water Pump and
 *                                         Hospital fall back on their backups
 *   …and then City electric dependency_level 2 → 3 → the City goes critical
 *
 * Note what does NOT change with the type: a failure still travels in general.
 * Every node receives a Requisite aggregation whatever its categories are (the
 * Universal Requisite pass, requirements §7.2). The type decides how a
 * shortfall is read — levels versus quantities — not whether failures travel.
 *
 * The gates read the shape of the change — a dependency level rose, a Category
 * Type changed, a Rule appeared — rather than the exact values the copy
 * suggests, so a user who picks different numbers still advances.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { awaitUpdate, type TourStep } from "@/lib/tour/types";

/** The sum of every declared Dependency level — rises when any one of them does. */
function dependencyTotal(): number {
  return Object.values(useCanvasStore.getState().nodes).reduce((total, n) => {
    for (const p of Object.values(n.category_dependency_profiles ?? {})) {
      total += p?.dependency_level ?? 0;
    }
    return total;
  }, 0);
}

/** Category name → type, as a comparable string. */
function categoryTypes(): string {
  return useConfigStore
    .getState()
    .config.categories.map((c) => `${c.name}:${c.category_type}`)
    .join(",");
}

/** Total Rules written on nodes and edges. */
function ruleCount(): number {
  const { nodes, edges } = useCanvasStore.getState();
  return (
    Object.values(nodes).reduce((n, el) => n + (el.rules?.length ?? 0), 0) +
    Object.values(edges).reduce((n, el) => n + (el.rules?.length ?? 0), 0)
  );
}

/** The sample this tour is written against — two mutually linked substations. */
export const CUSTOMIZE_TOUR_SAMPLE_FILE = "IJDRR_Extended_example.json";

export const CUSTOMIZE_PROPAGATION_TOUR: TourStep[] = [
  {
    title: "Customize the Propagation",
    body:
      "Four declarations decide what the engine computes: the Category Type, the " +
      "Functionality Scale, the dependency profile, and Rules. We change them one at a time " +
      "and re-run the Propagation after each. Read the network before and after every " +
      "change — none of these is visible on the canvas.",
  },
  {
    anchor: "reset",
    side: "bottom",
    title: "Start from a known state",
    body:
      "Reset returns the network to its Scenario Baseline. Each change below is then measured " +
      "against the same undamaged starting point, with nothing else moving.",
    waitHint: "Waiting for a Reset…",
    waitFor: awaitUpdate("scenario_reset"),
  },
  {
    anchor: "events",
    side: "bottom",
    title: "Break the source",
    body:
      "Apply the Earthquake. It drives the Electric Source to critical — the single supplier " +
      "of electricity for the two substations, which are also linked to each other.",
    waitHint: "Waiting for an Event…",
    waitFor: awaitUpdate("event_applied"),
  },
  {
    anchor: "propagate",
    side: "bottom",
    title: "Propagate — and read nothing",
    body:
      "The source is critical and nothing downstream moves. Electricity is declared Requisite " +
      "here, which aggregates Functionality levels and takes the best supplier within a " +
      "category. Each substation counts as the other's alternative, so the pair holds itself " +
      "up and the failure stops at them.",
    waitHint: "Waiting for a Propagation…",
    waitFor: awaitUpdate("propagation"),
  },
  {
    anchor: "config",
    side: "bottom",
    title: "Change the Category Type",
    body:
      "Model Configuration → Categories: switch electric from Requisite to SourceToDemands. " +
      "That type allocates a quantity instead of a level — Supply Capacity, Demand, edge " +
      "Capacity and Priority all count.",
    waitHint: "Waiting for a Category Type change…",
    waitFor: () => {
      const armedAt = categoryTypes();
      return () => categoryTypes() !== armedAt;
    },
  },
  {
    anchor: "propagate",
    side: "bottom",
    title: "Propagate — the cascade appears",
    body:
      "Same graph, same damage, different reading: the City degrades, and the Water Pump and " +
      "Hospital fall back on their backups. A critical source delivers nothing, and the link " +
      "between the substations carries no quantity, so the redundancy that Requisite saw was " +
      "never there.",
    waitHint: "Waiting for a Propagation…",
    waitFor: awaitUpdate("propagation"),
  },
  {
    anchor: "inspector",
    side: "left",
    title: "Raise the Dependency level",
    body:
      "Select the City and set its electric Dependency level to 3 — full dependency. Its " +
      "Demand, the supply and the graph are all unchanged; only its tolerance moved. It was " +
      "2, which is what softened the shortfall into a warning.",
    waitHint: "Waiting for a higher Dependency level…",
    waitFor: () => {
      const armedAt = dependencyTotal();
      return () => dependencyTotal() > armedAt;
    },
  },
  {
    anchor: "propagate",
    side: "bottom",
    title: "Propagate — the City goes critical",
    body:
      "One number, one level worse. Neither the Demand nor the Dependency level can be read " +
      "on its own, and neither is visible on the canvas: only the Propagation after the " +
      "change tells you what it did.",
    waitHint: "Waiting for a Propagation…",
    waitFor: awaitUpdate("propagation"),
  },
  {
    anchor: "config",
    side: "bottom",
    title: "The Functionality Scale sets the resolution",
    body:
      "The Functionality Scale tab defines N and the label of each level. Every result is " +
      "expressed on it, and vulnerability levels and dependency levels are read against it. A " +
      "3-level scale cannot express a degradation a 5-level scale distinguishes, so N is a " +
      "modelling decision.",
  },
  {
    anchor: "rules",
    side: "top",
    title: "Rules override the aggregation",
    body:
      "The Rules counter opens the Active Rules panel. Where the defaults are wrong — three " +
      "roads that congest rather than one being enough, a service that covers for another — a " +
      "Rule states the exception: intracategorical, intercategorical, or a specific if/then. " +
      "Write one against the selected element.",
    waitHint: "Waiting for a Rule…",
    waitFor: () => {
      const armedAt = ruleCount();
      return () => ruleCount() > armedAt;
    },
  },
  {
    anchor: "propagate",
    side: "bottom",
    title: "Propagate — Rules run in the engine",
    body:
      "A Rule is evaluated by the engine, after the category heuristics and before " +
      "convergence, so it changes nothing until the next Propagation.",
    waitHint: "Waiting for a Propagation…",
    waitFor: awaitUpdate("propagation"),
  },
  {
    anchor: "scorecard",
    side: "bottom",
    title: "Keep the comparison",
    body:
      "Every step here was a before and an after. Saving each to the Scorecard makes the " +
      "comparison durable: an entry stores the Scenario, its Operativity Score and a " +
      "snapshot, which is what turns a sequence of edits into a result worth reporting.",
  },
];
