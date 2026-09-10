/**
 * Tests for the Shapley export document.
 *
 * This document is the seam between the app's estimator and the paper harness
 * `CASCADE-backend/scripts/paper_shapley_vs_centrality.py`. The Python side
 * parses these exact field names; nothing in the TypeScript build can catch a
 * rename. So the first test is deliberately a literal-key assertion — it is the
 * only place the cross-language contract is written down twice on purpose.
 */

import { describe, it, expect } from "vitest";

import {
  SHAPLEY_EXPORT_FORMAT,
  SHAPLEY_EXPORT_VERSION,
  buildShapleyExport,
  shapleyExportFilename,
} from "@/lib/analysis-export";
import type { ShapleyResult } from "@/lib/model-based-analysis";
import type { GraphSnapshot } from "@/lib/schemas/network";

const snapshot: GraphSnapshot = {
  nodes: {
    pump: { id: "pump", label: "Pump station", functionality: 3 },
    tank: { id: "tank", label: "Tank", functionality: 3 },
    bare: { id: "bare", functionality: 3 } as GraphSnapshot["nodes"][string],
  },
  edges: {
    main: { id: "main", source: "pump", target: "tank", functionality: 3 },
  },
  canvases: [],
};

const result: ShapleyResult = {
  values: { pump: 0.1, tank: 0.4, bare: 0.2, main: 0.3 },
  worstCoalitions: {
    1: { ids: ["tank"], loss: 0.4 },
    2: { ids: ["tank", "main"], loss: 0.65 },
  },
  samplesUsed: 180,
  evaluations: 421,
  seed: 4242,
};

const input = {
  result,
  snapshot,
  networkName: "Palmanova Complete",
  samplesRequested: 200,
  kMax: 3,
  nodesOnly: false,
  scope: "global",
  oiWeightAttr: "constant",
  now: () => new Date("2026-09-09T12:00:00.000Z"),
};

describe("the cross-language contract", () => {
  it("carries exactly the keys the Python harness reads", () => {
    const doc = buildShapleyExport(input);

    expect(doc.format).toBe(SHAPLEY_EXPORT_FORMAT);
    expect(doc.version).toBe(SHAPLEY_EXPORT_VERSION);
    // The harness refuses a document whose φ̂ are not fractions, because the
    // retired Python estimator produced 0–100 values and mixing the two would
    // silently rescale a paper figure.
    expect(doc.operativity_scale).toBe("fraction");

    expect(Object.keys(doc.params).sort()).toEqual([
      "evaluations",
      "k_max",
      "nodes_only",
      "oi_weight_attr",
      "samples_requested",
      "samples_used",
      "scope",
      "seed",
    ]);
    expect(Object.keys(doc.shapley[0]).sort()).toEqual(["id", "kind", "label", "value"]);
    expect(Object.keys(doc.network).sort()).toEqual(["n_edges", "n_nodes", "name"]);
  });

  it("reports the run's real parameters, not the ones that were asked for", () => {
    // A run cut short by the time budget or by Cancel uses fewer samples than
    // requested. Recording only the request would overstate the estimate's
    // precision in the paper's methods section.
    const doc = buildShapleyExport(input);
    expect(doc.params.samples_requested).toBe(200);
    expect(doc.params.samples_used).toBe(180);
    expect(doc.params.seed).toBe(4242); // the seed the estimator chose, replayable
    expect(doc.params.evaluations).toBe(421);
  });
});

describe("Element identity", () => {
  it("sorts by φ̂ descending so position is rank", () => {
    const doc = buildShapleyExport(input);
    expect(doc.shapley.map((e) => e.id)).toEqual(["tank", "main", "bare", "pump"]);
  });

  it("labels edges by their endpoints and falls back to the id", () => {
    const doc = buildShapleyExport(input);
    const byId = Object.fromEntries(doc.shapley.map((e) => [e.id, e]));

    expect(byId.main.kind).toBe("edge");
    expect(byId.main.label).toBe("Pump station→Tank");
    expect(byId.pump.kind).toBe("node");
    expect(byId.bare.label).toBe("bare"); // unlabelled Element still joins on id
  });

  it("keeps coalition sizes addressable after JSON round-trips", () => {
    // JSON object keys are strings. A consumer indexing with a number would
    // miss, so the document commits to string keys and the test round-trips to
    // prove the shape survives serialisation.
    const doc = JSON.parse(JSON.stringify(buildShapleyExport(input)));
    expect(Object.keys(doc.worst_coalitions).sort()).toEqual(["1", "2"]);
    expect(doc.worst_coalitions["2"].labels).toEqual(["Tank", "Pump station→Tank"]);
    expect(doc.worst_coalitions["2"].loss).toBeCloseTo(0.65, 12);
  });
});

describe("filename", () => {
  it("is deterministic and carries the seed, so a re-export overwrites its own run", () => {
    const doc = buildShapleyExport(input);
    expect(shapleyExportFilename(doc)).toBe("shapley-Palmanova_Complete-seed4242.json");
    expect(shapleyExportFilename({ ...doc, network: { ...doc.network, name: "///" } }))
      .toBe("shapley-_-seed4242.json");
  });
});
