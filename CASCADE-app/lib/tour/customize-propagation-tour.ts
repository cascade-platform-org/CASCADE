/**
 * customize-propagation-tour.ts — how to change what the engine computes.
 *
 * Three declarations steer a Propagation, and none of them is code: the Category
 * Type, the per-category dependency profile, and Rules. This tour changes one
 * at a time and re-runs the Propagation after each, because that is the only honest way to read them — every one is
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
      "Three declarations decide what the engine computes: the Category Type, the dependency " +
      "profile, and Rules — and Rules come in three kinds, so we write one of each. Every " +
      "change is followed by a Propagation, because none of them is visible on the canvas " +
      "until the engine runs.",
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
      "That type allocates a quantity instead of a level — Supply Capacity, the Demand and " +
      "Priority in each Category Dependency Profile, and edge Capacity all count.",
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
      "Select the City and, in the Inspector on the right, set its electric Dependency level " +
      "to 3 — full dependency. Its Demand, the supply and the graph are all unchanged; only " +
      "its tolerance moved. It was " +
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
    anchor: "rules",
    side: "top",
    title: "Rule 1 of 3 — intracategorical",
    body:
      "The Rules counter opens the Active Rules panel. Within one category the engine takes " +
      "the best supplier: one healthy feed is enough, which is why the two substations have " +
      "been holding each other up. Where that is wrong — three roads that congest as each " +
      "closes — say so. Select the Substation and write:\n\n" +
      "average_of(Electric Source, Substation 2) propagates to Substation",
    waitHint: "Waiting for a Rule…",
    waitFor: () => {
      const armedAt = ruleCount();
      return () => ruleCount() > armedAt;
    },
  },
  {
    anchor: "propagate",
    side: "bottom",
    title: "Propagate — averaging instead of best-of",
    body:
      "A Rule is evaluated by the engine, after the category heuristics and before " +
      "convergence, so it changes nothing until the next Propagation. Both substations now " +
      "follow the source down: averaging its two feeds stops the pair propping itself up.",
    waitHint: "Waiting for a Propagation…",
    waitFor: awaitUpdate("propagation"),
  },
  {
    anchor: "rules",
    side: "top",
    title: "Rule 2 of 3 — intercategorical",
    body:
      "Across categories the default is the worst of them: an element needs all its services. " +
      "Where one can cover for another, name the categories rather than the elements — that " +
      "is what makes a Rule intercategorical. The City is critical for want of electricity, " +
      "and its water is intact. Select it and write:\n\n" +
      "best_of(electric, water) propagates to City",
    waitHint: "Waiting for a second Rule…",
    waitFor: () => {
      const armedAt = ruleCount();
      return () => ruleCount() > armedAt;
    },
  },
  {
    anchor: "propagate",
    side: "bottom",
    title: "Propagate — one service covering for another",
    body:
      "The City comes back to operational: its water is fine, and best_of across its two " +
      "categories is now what decides it. Nothing else changed — the kind was inferred from " +
      "the arguments being category names rather than elements.",
    waitHint: "Waiting for a Propagation…",
    waitFor: awaitUpdate("propagation"),
  },
  {
    anchor: "rules",
    side: "top",
    title: "Rule 3 of 3 — specific",
    body:
      "The last kind states an outcome outright, for what no aggregation expresses — a " +
      "contract, a shutdown procedure, a regulation. It starts with if, and it can name any " +
      "element as its target. Write:\n\n" +
      "if Electric Source is critical then Hospital is critical",
    waitHint: "Waiting for a third Rule…",
    waitFor: () => {
      const armedAt = ruleCount();
      return () => ruleCount() > armedAt;
    },
  },
  {
    anchor: "propagate",
    side: "bottom",
    title: "Propagate — a forced outcome",
    body:
      "The Hospital goes critical even though its backup was carrying it. A specific Rule " +
      "overrides the proposal for its target, clamped to worsening: it can impose a failure " +
      "the graph would not have produced, and it never repairs anything.",
    waitHint: "Waiting for a Propagation…",
    waitFor: awaitUpdate("propagation"),
  },
  {
    title: "That is the engine, steered",
    body:
      "A Category Type, a dependency profile and three Rules — each read by propagating and " +
      "comparing. What the platform does with a Scenario once it exists is the next " +
      "walkthrough: causality, time, the Analysis Module and repair ranking.",
    nextTour: "platform",
  },
];
