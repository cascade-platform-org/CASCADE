/**
 * run_timeline.ts — run a project's Temporal Simulation once per set of
 * Parameter values, with the app's own step operator (`lib/step-operator.ts`)
 * and the engine behind `POST /api/propagate` (`../engine_worker.py`).
 *
 * This is what Run and Compare do in the app, minus the stores: the same
 * Timeline plan, profile, Events, Parameters and Series, the same propagation
 * payload, the same imposed layer. The harness only chooses the points.
 *
 * Input (JSON file): { bundles: { key: { project, config } }, runs: [{ bundle, simulation, parameters }] }
 * Output (JSON file): per run, the Functionality of every node at the end of each period, and the warnings;
 * a run with `snapshot: true` also gets each period's full state (nodes and edges), for figures.
 *
 * Run from CASCADE-app/ (its tsconfig resolves `@/`):
 *   npx tsx ../experiments/fram/ts/run_timeline.ts <input.json> <output.json>
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { ProjectSchema } from "@/lib/schemas/network";
import { ModelConfigurationSchema } from "@/lib/schemas/config";
import { parameterValues } from "@/lib/schemas/temporal-simulation";
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { mergeUpdatesIntoSnapshot } from "@/lib/element-update";
import { planTimeline } from "@/lib/timeline-plan";
import { periodState, runTimeline } from "@/lib/step-operator";
import { PropagationResultSchema, type PropagationResult } from "@/lib/schemas/propagation";
import type { GraphSnapshot } from "@/lib/schemas/network";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PYTHON = path.resolve(HERE, "../../../CASCADE-backend/.venv/bin/python");

/** One engine process for the whole batch; requests go one at a time. */
function engine() {
  const child = spawn(PYTHON, [path.resolve(HERE, "../engine_worker.py")], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  return {
    async call(request: unknown): Promise<PropagationResult> {
      child.stdin.write(JSON.stringify(request) + "\n");
      const { value, done } = await lines.next();
      if (done) throw new Error("the engine worker exited");
      return PropagationResultSchema.parse(JSON.parse(value));
    },
    close: () => child.stdin.end(),
  };
}

interface Input {
  bundles: Record<string, { project: unknown; config: unknown }>;
  runs: { bundle: string; simulation: string; parameters: Record<string, number>; snapshot?: boolean }[];
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  const input: Input = JSON.parse(readFileSync(inputPath, "utf8"));
  const worker = engine();
  const out = [];
  for (const run of input.runs) {
    const project = ProjectSchema.parse(input.bundles[run.bundle].project);
    const config = ModelConfigurationSchema.parse(input.bundles[run.bundle].config);
    const doc = (project.temporal_simulations ?? []).find((s) => s.id === run.simulation);
    if (!doc) throw new Error(`${run.bundle}: no Temporal Simulation ${run.simulation}`);
    const plan = planTimeline(doc.timeline);
    if (plan.errors.length > 0) throw new Error(`${run.bundle}: ${plan.errors.join("; ")}`);
    const n = config.functionality_scale.length;
    const start: GraphSnapshot = { nodes: project.nodes, edges: project.edges, canvases: project.canvases };
    const record = await runTimeline({
      start,
      plan,
      profile: doc.profile,
      events: config.events ?? [],
      n,
      parameters: parameterValues(doc, run.parameters),
      series: project.series ?? [],
      propagate: async (snapshot) => {
        const request = buildPropagationPayload({
          project: { ...project, nodes: snapshot.nodes, edges: snapshot.edges },
          config,
          scope: doc.scope,
          activeCanvasId: doc.canvas ?? null,
        });
        const result = await worker.call(request);
        return {
          snapshot: mergeUpdatesIntoSnapshot(snapshot, result.updates),
          flow: { served_ratio: result.served_ratio, stored: result.stored },
        };
      },
    });
    out.push({
      bundle: run.bundle,
      parameters: run.parameters,
      warnings: record.warnings,
      periods: record.periods.map((p, k) => {
        const state = periodState(record, k + 1);
        return {
          label: p.label,
          functionality: Object.fromEntries(Object.entries(state.nodes).map(([id, node]) => [id, node.functionality])),
          ...(run.snapshot ? { state: { nodes: state.nodes, edges: state.edges } } : {}),
        };
      }),
    });
  }
  worker.close();
  writeFileSync(outputPath, JSON.stringify(out));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
