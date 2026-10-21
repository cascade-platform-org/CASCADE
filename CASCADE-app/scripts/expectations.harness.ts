/**
 * scripts/expectations.harness.ts — run a project's Expectations without a browser (ADR-0023).
 *
 * The same runner the Expectations window uses (`lib/expectations.ts`): what
 * this file supplies is only what the app gets from its stores, a project read
 * from disk and its Reset model, and `fetch` pointed at a local engine. It
 * prints `resultsText`, what "Copy results for the LLM" copies, so a
 * calibration on client data (Noncello, never committed) runs from a terminal.
 *
 *   # backend, from CASCADE-backend/ (DATABASE_URL blank runs auth-free)
 *   DATABASE_URL= uvicorn main:app --host 127.0.0.1 --port 8123
 *
 *   # then, from CASCADE-app/
 *   EXPECTATIONS_PROJECT=samples/public/IJDRR_example.json \
 *   EXPECTATIONS_FILE=/path/to/extra-expectations.json \   # optional: a JSON list added to the project's
 *   npm run harness:expectations
 *
 * Not part of `npm test`: it needs a live engine.
 */

import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { resultsText, runExpectations } from "@/lib/expectations";
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { mergeUpdatesIntoSnapshot } from "@/lib/element-update";
import { deriveBaseline, resetSnapshot } from "@/lib/scenario-baseline";
import { ProjectBundleSchema } from "@/lib/schemas/api";
import { ExpectationSchema } from "@/lib/schemas/expectation";
import { PropagationResultSchema } from "@/lib/schemas/propagation";
import { z } from "zod";

const PROJECT = process.env.EXPECTATIONS_PROJECT ?? "samples/public/IJDRR_example.json";
const EXTRA = process.env.EXPECTATIONS_FILE;
const API = process.env.EXPECTATIONS_API ?? "http://127.0.0.1:8123";

describe("Expectations harness", () => {
  it(`runs the Expectations of ${PROJECT}`, async () => {
    const { project, config } = ProjectBundleSchema.parse(JSON.parse(readFileSync(PROJECT, "utf8")));
    const extra = EXTRA ? z.array(ExpectationSchema).parse(JSON.parse(readFileSync(EXTRA, "utf8"))) : [];
    const expectations = [...(project.expectations ?? []), ...extra];
    const n = config.functionality_scale.length;
    const start = resetSnapshot(
      { nodes: project.nodes, edges: project.edges, canvases: project.canvases },
      deriveBaseline(project.update_history ?? [], []),
      n,
    );

    let calls = 0;
    const results = await runExpectations(expectations, {
      start,
      config,
      series: project.series ?? [],
      simulations: project.temporal_simulations ?? [],
      propagate: async (snapshot, s) => {
        const payload = buildPropagationPayload({
          project: { ...project, nodes: snapshot.nodes, edges: snapshot.edges },
          config,
          scope: s.scope,
          activeCanvasId: s.canvasId ?? project.canvases[0]?.id ?? null,
        });
        const res = await fetch(`${API}/api/propagate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
        calls++;
        const result = PropagationResultSchema.parse(await res.json());
        return { snapshot: mergeUpdatesIntoSnapshot(snapshot, result.updates), flow: { served_ratio: result.served_ratio, stored: result.stored } };
      },
    });
    process.stdout.write(`\n${resultsText(expectations, results)}\n\n${calls} engine calls\n`);
  });
});
