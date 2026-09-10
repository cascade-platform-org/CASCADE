/**
 * scripts/shapley-export.harness.ts — produce a Shapley Export without a browser.
 *
 * WHY THIS IS NOT A THIRD IMPLEMENTATION. Every number here comes from the
 * modules the app itself runs: `estimateShapley`, `computeOperativityScore`,
 * `buildPropagationPayload`, `mergeUpdatesIntoSnapshot`, `buildShapleyExport`.
 * What this file supplies is only the part the Analysis page gets from React and
 * Zustand — a Project loaded from disk instead of from a store, and `fetch`
 * pointed at a locally-running backend instead of at the deployed one. Delete it
 * and the paper is reproduced by clicking through the UI; nothing about the
 * estimate changes.
 *
 * It exists so a paper run is scriptable and repeatable: same seed, same
 * parameters, recorded in the output, no manual clicking to re-do after a
 * model edit.
 *
 * Run it (see package.json → harness:shapley):
 *
 *   # backend, from CASCADE-backend/ — DATABASE_URL blank runs auth-free
 *   DATABASE_URL= uvicorn main:app --host 127.0.0.1 --port 8123
 *
 *   # then, from CASCADE-app/
 *   SHAPLEY_NETWORK=samples/public/Palmanova_Complete.json \
 *   SHAPLEY_OUT=/tmp/shapley.json \
 *   npm run harness:shapley
 *
 * It is driven by vitest (vitest.harness.config.mts) purely because vitest is
 * already the project's TypeScript runner and resolves the `@` alias. It is NOT
 * part of `npm test`: it needs a live engine, so it must never gate a commit.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";

import { buildShapleyExport } from "@/lib/analysis-export";
import { mergeUpdatesIntoSnapshot } from "@/lib/element-update";
import { estimateShapley, type ElementRef } from "@/lib/model-based-analysis";
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { computeOperativityScore } from "@/lib/scorecard-utils";
import type { ModelConfiguration } from "@/lib/schemas/config";
import type { GraphSnapshot, Project } from "@/lib/schemas/network";

const NETWORK = process.env.SHAPLEY_NETWORK ?? "samples/public/Palmanova_Complete.json";
const OUT = process.env.SHAPLEY_OUT ?? "/tmp/shapley-export.json";
const API = process.env.SHAPLEY_API ?? "http://127.0.0.1:8123";
const SAMPLES = Number(process.env.SHAPLEY_SAMPLES ?? 800);
const KMAX = Number(process.env.SHAPLEY_KMAX ?? 3);
const SEED = Number(process.env.SHAPLEY_SEED ?? 0);
// §4.4 compares node Shapley against node centrality, so the coalition game is
// over nodes. Letting edges fail too is a DIFFERENT game and would move every
// node's φ̂; the Python harness warns when an export was produced that way.
const NODES_ONLY = process.env.SHAPLEY_NODES_ONLY !== "false";
const WEIGHT_ATTR = process.env.SHAPLEY_WEIGHT ?? "constant";

describe("Shapley export harness", () => {
  it(
    `runs ${SAMPLES} samples over ${NETWORK}`,
    { timeout: 60 * 60 * 1000 },
    async () => {
      const bundle = JSON.parse(readFileSync(NETWORK, "utf8")) as {
        project: Project;
        config: ModelConfiguration;
      };
      const { project, config } = bundle;
      const n = config.functionality_scale.length;

      const baseline: GraphSnapshot = {
        nodes: project.nodes,
        edges: project.edges,
        canvases: project.canvases,
      };

      let calls = 0;
      async function propagate(snapshot: GraphSnapshot): Promise<GraphSnapshot> {
        const payload = buildPropagationPayload({
          project: { ...project, nodes: snapshot.nodes, edges: snapshot.edges },
          config,
          scope: "global",
          activeCanvasId: null,
        });
        const res = await fetch(`${API}/api/propagate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
        calls++;
        if (calls % 50 === 0) process.stdout.write(`  ${calls} engine calls\n`);
        const result = await res.json();
        return mergeUpdatesIntoSnapshot(snapshot, result.updates);
      }

      const elements: ElementRef[] = [
        ...Object.keys(project.nodes).map((id) => ({ id, kind: "node" as const })),
        ...(NODES_ONLY
          ? []
          : Object.keys(project.edges).map((id) => ({ id, kind: "edge" as const }))),
      ];

      // The same adapter shape the Analysis page passes (makeCoalitionEvaluator).
      const evaluate = async (failed: ReadonlySet<string>): Promise<number> => {
        const nodes = { ...baseline.nodes };
        const edges = { ...baseline.edges };
        for (const id of failed) {
          if (id in nodes) nodes[id] = { ...nodes[id], functionality: 1 };
          else if (id in edges) edges[id] = { ...edges[id], functionality: 1 };
        }
        const after = await propagate({ ...baseline, nodes, edges });
        return computeOperativityScore(after, n, WEIGHT_ATTR) / 100;
      };

      const startedAt = Date.now();
      const result = await estimateShapley(elements, evaluate, {
        samples: SAMPLES,
        kMax: KMAX,
        seed: SEED,
      });

      const doc = buildShapleyExport({
        result,
        snapshot: baseline,
        networkName: project.meta?.name ?? NETWORK,
        samplesRequested: SAMPLES,
        kMax: KMAX,
        nodesOnly: NODES_ONLY,
        scope: "global",
        oiWeightAttr: WEIGHT_ATTR,
      });

      writeFileSync(OUT, JSON.stringify(doc, null, 2));
      process.stdout.write(
        `\n${elements.length} elements, ${result.samplesUsed} samples, ` +
          `${result.evaluations} engine calls, seed ${result.seed}, ` +
          `${((Date.now() - startedAt) / 1000).toFixed(1)}s\nwrote ${OUT}\n`,
      );
    },
  );
});
