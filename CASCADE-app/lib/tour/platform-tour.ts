/**
 * platform-tour.ts — "Analyse and decide": what the platform does with a
 * Scenario once the engine has produced one.
 *
 * The companion to the customize tour, which covers the declarations that steer
 * the engine. This one starts where a Propagation ends: read the causality,
 * advance time, keep comparisons in the Scorecard, rank elements in the
 * Analysis Module, rank repairs, and get data in and out.
 *
 * It runs on the worked example in its shipped, already-propagated state,
 * because most of these steps point at a result — a responsibility share, an
 * Analysis score, a repair ranking — which an unpropagated project cannot show.
 *
 * Most steps therefore only ask to be read. A `waitFor` appears where opening
 * the panel is the point, and `Next` is never removed: a guest has neither
 * `can_propagate` nor engine evaluations and must be able to walk past the
 * steps that need them.
 */

import { useAnalysisStore } from "@/store/analysis-store";
import { useUiStore } from "@/store/ui-store";
import type { TourStep } from "@/lib/tour/types";

export const PLATFORM_TOUR: TourStep[] = [
  {
    title: "Analyse and decide",
    body:
      "A Propagation produces a Scenario. This walks what the platform does with one: read " +
      "the causality, move the clock, keep the comparisons, rank the elements, and rank the " +
      "repairs.",
  },
  {
    anchor: "global-view",
    side: "bottom",
    title: "Scope: one Canvas or all of them",
    body:
      "Canvases partition a project by system or by layer. Propagate and Analyse each carry " +
      "their own scope selector: local computes on the active Canvas alone, global on every " +
      "Canvas at once, following inter-canvas edges. The All tab shows them together, " +
      "read-only.",
  },
  {
    anchor: "inspector",
    side: "left",
    title: "Causality is recorded, not inferred",
    body:
      "Every degraded element carries a responsibility share: which upstream element or Event " +
      "produced its level, and in what proportion. The Inspector states it in words. The " +
      "repair ranking is computed from these shares rather than from the topology.",
  },
  {
    anchor: "temporal",
    cardAnchor: "canvas",
    side: "bottom",
    title: "Time is explicit",
    body:
      "Backups and repair estimates are counted in hours, and hours pass only through a " +
      "Temporal Jump. Auto-advance repeats jump-and-propagate until the network stops " +
      "changing, which is how a deferred second wave and a recovery both appear.",
  },
  {
    anchor: "scorecard",
    side: "bottom",
    title: "The Scorecard keeps the comparisons",
    body:
      "Each entry stores a Scenario: its Events, its Operativity Score, derived metrics and a " +
      "snapshot of the network as it stood. Entries are what make two interventions " +
      "comparable, and they export to CSV and JSON.",
    waitHint: "Waiting for the Scorecard…",
    waitFor: () => () => useUiStore.getState().scorecardPanelOpen,
  },
  {
    anchor: "analyse",
    side: "bottom",
    title: "Analysis: structure versus consequence",
    body:
      "Topological metrics run in the browser and describe the graph — degree, betweenness, " +
      "k-core, articulation points, percolation. Model-based metrics re-propagate the Scenario " +
      "without each element and measure the Operativity Score lost, so they describe " +
      "consequence rather than shape. Scores paint the canvas as an Analysis Heatmap.",
    waitHint: "Waiting for the Analysis window…",
    waitFor: () => () => useAnalysisStore.getState().analysisPageOpen,
  },
  {
    anchor: "analyse",
    side: "bottom",
    title: "Re-weight without recomputing",
    body:
      "The Operativity weighting — constant, importance, or cost of disservice — belongs to " +
      "the reading, not to the run. Changing it re-scores a completed Analysis in place and " +
      "repaints the heatmap, spending no engine evaluation. Ask which elements are neuralgic " +
      "by cost, then by population served, from the same run.",
  },
  {
    anchor: "repair",
    side: "bottom",
    title: "Repair ranks by what it unblocks",
    body:
      "The Repair panel ranks physically damaged elements by Recovery Value — the weighted " +
      "loss that terminates on them along the responsibility chains — and by value per repair " +
      "hour. Elements holding on a backup are listed separately with the hours they have left.",
  },
  {
    anchor: "file",
    side: "bottom",
    title: "Data in and out",
    body:
      "The File panel holds local saves, cloud saves and the importer: an EPANET .inp file " +
      "becomes a Canvas, and a Canvas marked EPANET is solved hydraulically instead of by the " +
      "engine. Local saves stay in this browser; cloud saves need an account.",
  },
  {
    title: "That is the surface",
    body:
      "The Scorecard, the Analysis Module and the Repair panel all read one Propagation. The " +
      "manual documents each field, and the Rules Manual the rule grammar in full.",
  },
];
