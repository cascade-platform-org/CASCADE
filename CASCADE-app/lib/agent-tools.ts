/**
 * agent-tools.ts — what an agent can do in CASCADE (ADR-0024).
 *
 * Each tool is one typed entry: a name, a description an LLM reads, its
 * parameters as a Zod schema (sent to the agent as JSON Schema), and a `run`
 * that answers in compact text. A tool is a thin wrapper over what the app
 * already does: the plain-changes check (ADR-0022), the Expectation runner
 * (ADR-0023), the step operator, the topological metrics. It reaches the app
 * only through an `AgentHost`, so the same tools run against the live tab
 * (`lib/agent-host.ts`) and, in tests, against a bundle and a fake engine.
 *
 * The rule the tools keep: **an agent never writes the model.** `propose_change`
 * checks a change and turns it into a Proposal a person applies or rejects;
 * everything else reads the model or runs on a copy of it. Every engine call
 * goes through the host's `propagate`, so the engine boundary (CLAUDE.md §7)
 * and the Entitlements (ADR-0008) are those of the person's own session.
 */

import { z } from "zod";
import { modelLists } from "@/lib/model-text";
import { PLAIN_FORMAT, PLAIN_REFERENCE, fieldCensus, repairContext } from "@/lib/model-text-v2";
import { checkDesignText } from "@/lib/llm-design-check";
import { CALIBRATION_GUIDE, MODELLING_GUIDE, expectationsContext, stateContext } from "@/lib/llm-recipes";
import { MODEL_PRIMER, ELEMENT_PATHS, SIMULATION_REFERENCE } from "@/lib/temporal-simulation-text";
import { playScenario, resultsText, runSimulationTable, type ExpectationEnv, type ExpectationResult } from "@/lib/expectations";
import { runTableCsv } from "@/lib/temporal-metrics";
import { computeOperativityScore } from "@/lib/scorecard-utils";
import { canvasesById, filterLabel, matchElements } from "@/lib/element-filter";
import { ANALYSIS_METRICS, scoredMetricById } from "@/lib/analysis-metrics";
import { ElementFilterSchema } from "@/lib/schemas/attribute-operation";
import type { ProjectBundle } from "@/lib/schemas/bundle";
import type { Expectation } from "@/lib/schemas/expectation";
import type { GraphSnapshot } from "@/lib/schemas/network";
import type { ModelConfiguration } from "@/lib/schemas/config";
import type { Proposal } from "@/store/agent-store";

/** What a tool may ask of the app. */
export interface AgentHost {
  /** The project and its Model Configuration as they are now. */
  bundle(): ProjectBundle;
  /** Input for runs on a copy (the Reset model, the engine call), captured now. */
  env(): ExpectationEnv;
  /** Record a pending Proposal for the person; never applies it. */
  propose(text: string, notes?: string): Proposal;
  proposal(id: string): Proposal | undefined;
  /** Run Expectations by id (all when absent), showing the results in the app too. */
  runExpectations(ids?: readonly string[]): Promise<ExpectationResult[]>;
  /** Select Elements on the canvas, so the person sees what the agent means. */
  show(ids: readonly string[]): number;
}

interface AgentTool<P extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  params: P;
  run(args: z.infer<P>, host: AgentHost): Promise<string>;
}

const tool = <P extends z.ZodType>(t: AgentTool<P>): AgentTool => t as unknown as AgentTool;

const MAX_LIST = 150;

/** Elements below full Functionality, worst first, each with its causes by name. */
function degradedText(snapshot: GraphSnapshot, config: ModelConfiguration): string {
  const n = config.functionality_scale.length;
  const events = new Map(config.events.map((e) => [e.id, e.label]));
  const name = (id: string) => events.get(id) ?? (id in snapshot.nodes || id in snapshot.edges ? filterLabel(id, snapshot) : id);
  const level = (f: number) => `${f} (${config.functionality_scale[f - 1]?.label ?? "?"})`;
  const all = [...Object.values(snapshot.nodes), ...Object.values(snapshot.edges)];
  const degraded = all.filter((el) => el.functionality < n).sort((a, b) => a.functionality - b.functionality);
  const holding = all.filter((el) => el.functionality === n && (el.functionality_time ?? 0) > 0);
  const lines = degraded.slice(0, MAX_LIST).map((el) => {
    const causes = Object.entries(el.responsibility_share ?? {}).sort((a, b) => b[1] - a[1]).map(([id, s]) => `${name(id)} ${Math.round(s * 100)}%`);
    return `- ${name(el.id)} (${el.id}): ${level(el.functionality)}${el.direct_damage ? ", physically damaged" : ""}${causes.length ? `; caused by ${causes.join(", ")}` : ""}`;
  });
  return [
    `Operativity Score: ${computeOperativityScore(snapshot, n).toFixed(1)}%`,
    `Below full Functionality (${degraded.length} of ${all.length} Elements):\n${lines.join("\n") || "(none)"}${degraded.length > MAX_LIST ? `\n… ${degraded.length - MAX_LIST} more` : ""}`,
    ...(holding.length ? [`Holding on a backup (Functionality Time left):\n${holding.slice(0, MAX_LIST).map((el) => `- ${name(el.id)} (${el.id}): ${el.functionality_time} h`).join("\n")}`] : []),
  ].join("\n\n");
}

const REFERENCE_TOPICS = {
  modelling: () => MODELLING_GUIDE,
  changes: (b: ProjectBundle) => [PLAIN_REFERENCE, fieldCensus(b)].join("\n\n"),
  expectations: () => CALIBRATION_GUIDE,
  propagation: () => MODEL_PRIMER,
  simulation: () => [SIMULATION_REFERENCE, ELEMENT_PATHS].join("\n\n"),
} as const;
type Topic = keyof typeof REFERENCE_TOPICS;

const TOPICS = Object.keys(REFERENCE_TOPICS) as [Topic, ...Topic[]];

export const AGENT_TOOLS: readonly AgentTool[] = [
  tool({
    name: "describe_model",
    description:
      "The open project: its Canvases, Nodes, Edges, Events, Categories, Functionality scale, Temporal Simulations, Expectations and pending Proposals, by id and name. Start here.",
    params: z.object({}).strict(),
    async run(_args, host) {
      const b = host.bundle();
      return [`# ${b.project.meta.name}`, modelLists(b), expectationsContext(b)].join("\n\n");
    },
  }),
  tool({
    name: "get_reference",
    description:
      "How to do something in CASCADE. Topics: modelling (turning an organisation into Elements, Categories and edges), changes (the format propose_change takes, with this model's field census), expectations (how to write and meet them), propagation (what the engine computes), simulation (Temporal Simulations: Timeline, profile, Metrics).",
    params: z.object({ topic: z.enum(TOPICS) }).strict(),
    async run({ topic }, host) {
      return REFERENCE_TOPICS[topic](host.bundle());
    },
  }),
  tool({
    name: "get_elements",
    description: "Elements as stored (every field), by id or by an Element Filter. Use before changing them.",
    params: z
      .object({ ids: z.array(z.string()).optional(), where: ElementFilterSchema.optional(), limit: z.number().int().min(1).max(100).default(30) })
      .strict(),
    async run({ ids, where, limit }, host) {
      const { project } = host.bundle();
      const model = { nodes: project.nodes, edges: project.edges, canvases: canvasesById(project.canvases) };
      const chosen = ids ?? (where ? matchElements(where, model) : Object.keys(project.nodes));
      const missing = chosen.filter((id) => !(id in project.nodes) && !(id in project.edges));
      const found = chosen.filter((id) => !missing.includes(id)).slice(0, limit);
      const stored = Object.fromEntries(found.map((id) => [id, project.nodes[id] ?? project.edges[id]]));
      return [
        `${found.length} of ${chosen.length - missing.length} Elements${missing.length ? `; not found: ${missing.join(", ")}` : ""}`,
        JSON.stringify(stored, null, 1),
      ].join("\n");
    },
  }),
  tool({
    name: "propose_change",
    description: `Propose changes to the model in the plain-changes format (get_reference "changes"): nodes, edges, Events, Categories, Canvases, Temporal Simulations, Series and Expectations, added, updated or deleted by id, or a field changed on many Elements. The change is checked now; if it passes it becomes a Proposal the person reviews, applies (all or some of its changes) or rejects. Nothing is written until they do. Give every change a "why".`,
    params: z.object({ changes: z.array(z.unknown()).min(1), notes: z.string().optional() }).strict(),
    async run({ changes, notes }, host) {
      const bundle = host.bundle();
      const text = JSON.stringify({ format: PLAIN_FORMAT, ...(notes ? { notes } : {}), changes }, null, 1);
      const r = checkDesignText(bundle, { bulk: true }, text, "agent");
      if (!r.checked.ok) return `REFUSED: nothing was proposed.\n\n${repairContext(bundle, text, r.checked.errors)}`;
      const p = host.propose(text, notes);
      const lines = r.checked.preview.lines.length;
      const titles = (r.groups ?? []).map((g) => `- ${g.title}${g.skipped.length ? ` (skipped ${g.skipped.length})` : ""}`);
      const warnings = r.checked.warnings.length ? `\nWarnings:\n${r.checked.warnings.map((w) => `- ${w}`).join("\n")}` : "";
      return `Proposal ${p.id} is waiting for the person (${lines} field change${lines === 1 ? "" : "s"}):\n${titles.join("\n")}${warnings}\n\nAsk them to review it in the Agent window; get_proposal tells you what they decided.`;
    },
  }),
  tool({
    name: "get_proposal",
    description: "Whether the person applied, partly applied or rejected a Proposal, and why.",
    params: z.object({ id: z.string() }).strict(),
    async run({ id }, host) {
      const p = host.proposal(id);
      if (!p) return `No Proposal ${id}.`;
      if (p.status === "pending") return `Proposal ${id} is still waiting for the person.`;
      if (p.status === "rejected") return `Proposal ${id} was rejected${p.reason ? `: ${p.reason}` : ""}.`;
      return `Proposal ${id} was applied${p.leftOut.length ? `, leaving out changes ${p.leftOut.join(", ")} (0-based)` : " in full"}.`;
    },
  }),
  tool({
    name: "run_scenario",
    description:
      "Apply Events to a copy of the model (Reset first), Propagate, and optionally let hours pass and Propagate again. Returns the Operativity Score and every degraded Element with what caused it. The model is not changed. Each Propagation is one Engine Evaluation.",
    params: z
      .object({
        events: z.array(z.string()),
        advance_hours: z.number().int().min(0).default(0),
        scope: z.enum(["global", "local"]).default("global"),
        canvas: z.string().optional(),
      })
      .strict(),
    async run(args, host) {
      const env = host.env();
      const played = await playScenario(args, env);
      if ("error" in played) return `Cannot run: ${played.error}`;
      return [...played.lines, degradedText(played.snapshot, env.config), `(${played.engineCalls} engine call${played.engineCalls === 1 ? "" : "s"})`].join("\n\n");
    },
  }),
  tool({
    name: "run_expectations",
    description:
      "Run the project's Expectations (all, or by id) on a copy of the model. Returns pass/fail per Expectation with each Element's actual value and its cause. The results also appear in the person's Expectations window.",
    params: z.object({ ids: z.array(z.string()).optional() }).strict(),
    async run({ ids }, host) {
      const list = host.bundle().project.expectations ?? [];
      if (list.length === 0) return "The project has no Expectations yet: propose some with propose_change ({ \"add\": \"expectation\" }).";
      const results = await host.runExpectations(ids);
      return resultsText(list as Expectation[], results);
    },
  }),
  tool({
    name: "run_simulation",
    description:
      "Run one of the project's Temporal Simulations on a copy of the model, optionally overriding some of its Parameters, and return its Run table as CSV (one row per period). One Engine Evaluation per propagating Phase.",
    params: z.object({ simulation: z.string(), parameters: z.record(z.string(), z.number()).optional() }).strict(),
    async run({ simulation, parameters }, host) {
      const run = await runSimulationTable(simulation, host.env(), parameters ?? {});
      if ("error" in run) return `Cannot run: ${run.error}`;
      return [
        `${run.name}: ${run.table.rows.length} periods, ${run.engineCalls} engine calls`,
        ...(run.warnings.length ? [`Warnings:\n${run.warnings.slice(0, 30).map((w) => `- ${w}`).join("\n")}`] : []),
        runTableCsv(run.table),
      ].join("\n\n");
    },
  }),
  tool({
    name: "analyse",
    description: `Score every Element with a topological metric (instant, no engine call): ${ANALYSIS_METRICS.filter((m) => m.kind === "scored" && !m.needsSourceId).map((m) => m.id).join(", ")}. Returns the top Elements.`,
    params: z.object({ metric: z.string(), top: z.number().int().min(1).max(100).default(15) }).strict(),
    async run({ metric, top }, host) {
      const m = scoredMetricById(metric);
      if (!m || m.needsSourceId) return `No metric ${metric}.`;
      const { project, config } = host.bundle();
      const result = m.run({ graph: { nodes: project.nodes, edges: project.edges, canvases: project.canvases }, n: config.functionality_scale.length });
      const name = (id: string) => filterLabel(id, project);
      return [`${m.label}: ${m.description}`, ...result.ranked.slice(0, top).map((s) => `${s.rank}. ${name(s.id)} (${s.id}): ${s.score.toFixed(3)}`)].join("\n");
    },
  }),
  tool({
    name: "explain_state",
    description: "The model's current state on the person's canvas: the Events applied, the degraded Elements and their causes. Use it when the person asks about what they see.",
    params: z.object({}).strict(),
    async run(_args, host) {
      return stateContext(host.bundle(), null);
    },
  }),
  tool({
    name: "show",
    description: "Select Elements on the person's canvas, so they see what you are talking about.",
    params: z.object({ ids: z.array(z.string()).min(1) }).strict(),
    async run({ ids }, host) {
      const shown = host.show(ids);
      return `Selected ${shown} of ${ids.length} on the canvas.`;
    },
  }),
];

const BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

/** The tools as an MCP `tools/list` names them: name, description, JSON Schema of the arguments. */
export function toolList(): { name: string; description: string; inputSchema: unknown }[] {
  return AGENT_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.params, { io: "input" }) }));
}

export type ToolOutcome = { ok: true; text: string } | { ok: false; error: string };

/** Validate the arguments and run the tool; a refusal or a throw is an outcome, never an exception. */
export async function callTool(name: string, args: unknown, host: AgentHost): Promise<ToolOutcome> {
  const t = BY_NAME.get(name);
  if (!t) return { ok: false, error: `No tool ${name}. Tools: ${AGENT_TOOLS.map((x) => x.name).join(", ")}` };
  const parsed = t.params.safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}` };
  try {
    return { ok: true, text: await t.run(parsed.data, host) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
