/**
 * llm-eval — does an LLM, given only what LLM Design copies, write Bulk
 * operations that do what was asked? (ADR-0022.) Skipped unless LLM_EVAL is
 * set: the LLM replies come from outside the test run.
 *
 *   LLM_EVAL=gen   LLM_EVAL_DIR=<dir> npx vitest run lib/llm-eval.test.ts
 *       writes <task>.<variant>.context.md: the copied context and the request,
 *       for v1 (the original change set) and v2 (plain changes, with the field census).
 *   Give each context to a fresh LLM that sees nothing else, and save its whole
 *   reply as <task>.<variant>.reply.md in the same directory.
 *   LLM_EVAL=check LLM_EVAL_DIR=<dir> npx vitest run lib/llm-eval.test.ts
 *       writes report.md: per reply, whether the check accepted it and whether
 *       the outcome is what was asked (each task's assertions), first try. For a
 *       refused reply it also writes <task>.<variant>.repair.context.md, what
 *       "Copy the problems for the LLM" copies; a fresh LLM's answer to it, saved
 *       as <task>.<variant>.repair.reply.md, is scored in the "after repair" column.
 *
 * A reply passing the check is not enough: "halve the supply" that halves the
 * wrong field passes. So every task states the outcome it expects, and that
 * nothing else changed.
 *
 * Recipe tasks (requirements §13.3b) are scored the same way: gen writes
 * <task>.recipe.context.md, what the Recipe copies with the person's text; the
 * reply goes in <task>.recipe.reply.md and is checked as Bulk operations.
 */

import { describe, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { deepEqual } from "./graph-diff";
import { modelTextContext } from "./model-text";
import { bulkContext, repairContext } from "./model-text-v2";
import { recipeContext, type RecipeId } from "./llm-recipes";
import { checkDesignText } from "./llm-design-check";
import { DEFAULT_CONFIG } from "@/store/config-store";
import type { ProjectBundle } from "./file-io";

const MODE = process.env.LLM_EVAL;
const DIR = process.env.LLM_EVAL_DIR ?? ".";
const load = (file: string) => JSON.parse(readFileSync(`samples/public/${file}`, "utf8")) as ProjectBundle;

type Variant = "v1" | "v2";
const VARIANTS: Variant[] = ["v1", "v2"];

/** What changed between two bundles: node and edge ids, and whether the configuration did. */
function changed(before: ProjectBundle, after: ProjectBundle) {
  const ids = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((id) => !deepEqual(a[id], b[id])).sort();
  return {
    nodes: ids(before.project.nodes, after.project.nodes),
    edges: ids(before.project.edges, after.project.edges),
    config: !deepEqual(before.config, after.config),
  };
}

interface Task {
  id: string;
  file: string;
  request: string;
  /** What must hold after the change; each failure in words. */
  expect: (before: ProjectBundle, after: ProjectBundle) => string[];
}

const fail = (ok: boolean, message: string) => (ok ? [] : [message]);
const nodesOfType = (b: ProjectBundle, type: string) => Object.values(b.project.nodes).filter((n) => n.node_type === type);
const approx = (a: unknown, b: number) => typeof a === "number" && Math.abs(a - b) <= Math.abs(b) * 1e-6;

const TASKS: Task[] = [
  {
    id: "b1-halve-supply",
    file: "Net1_temporal.json",
    request: "Halve the supply of every Source node, and give every Service node importance 2.",
    expect: (b, a) => {
      const sources = nodesOfType(b, "Source");
      const services = nodesOfType(b, "Service");
      const out = sources.flatMap((s) => {
        const was = s.supply_capacity?.water;
        const now = a.project.nodes[s.id]?.supply_capacity?.water;
        return typeof was === "number"
          ? fail(approx(now, was / 2), `${s.id}: supply ${String(now)}, expected ${was / 2}`)
          : fail(typeof now === "object" && approx(now.rate, was!.rate / 2) && now.level === was!.level, `${s.id}: the Stock's rate should halve and its level stay`);
      });
      out.push(...services.flatMap((s) => fail(a.project.nodes[s.id]?.importance === 2, `${s.id}: importance ${String(a.project.nodes[s.id]?.importance)}`)));
      const c = changed(b, a);
      out.push(...fail(c.nodes.every((id) => [...sources, ...services].some((n) => n.id === id)) && c.edges.length === 0 && !c.config, `changed more than asked: ${JSON.stringify(c)}`));
      return out;
    },
  },
  {
    id: "b2-raise-demand",
    file: "Net1_temporal.json",
    request: "Raise the water demand of every Service node by 10%.",
    expect: (b, a) => [
      ...nodesOfType(b, "Service").flatMap((s) => {
        const was = s.category_dependency_profiles?.water?.demand;
        const now = a.project.nodes[s.id]?.category_dependency_profiles?.water?.demand;
        return was === undefined ? [] : fail(approx(now, was * 1.1), `${s.id}: demand ${String(now)}, expected ${was * 1.1}`);
      }),
      ...fail(changed(b, a).nodes.length === nodesOfType(b, "Service").length && !changed(b, a).config, `changed more than asked: ${JSON.stringify(changed(b, a))}`),
    ],
  },
  {
    id: "b3-delete-services",
    file: "IJDRR_example.json",
    request: "Delete every Service node from the model.",
    expect: (b, a) => {
      const services = nodesOfType(b, "Service").map((s) => s.id);
      const kept = Object.keys(b.project.nodes).filter((id) => !services.includes(id));
      return [
        ...fail(nodesOfType(a, "Service").length === 0, "Service nodes remain"),
        ...fail(kept.every((id) => deepEqual(a.project.nodes[id], b.project.nodes[id])), "another node changed"),
        ...fail(Object.values(b.project.edges).filter((e) => !services.includes(e.source) && !services.includes(e.target)).every((e) => deepEqual(a.project.edges[e.id], e)), "an edge between other nodes changed"),
      ];
    },
  },
  {
    id: "b4-flood",
    file: "IJDRR_example.json",
    request: "Add a 'Flood' hazard Event that happens about once every 20 years, which costs the Water Pump and the Substation one Functionality level each (and nothing else).",
    expect: (b, a) => {
      const flood = a.config.events.find((e) => !b.config.events.some((x) => x.id === e.id));
      if (!flood) return ["no new Event"];
      const hit = Object.values(a.project.nodes).filter((n) => n.vulnerability_levels?.[flood.id] !== undefined);
      return [
        ...fail(flood.type === "hazard" && approx(flood.frequency_per_10y, 0.5), `the Event: ${JSON.stringify(flood)}`),
        ...fail(deepEqual(hit.map((n) => n.label).sort(), ["Substation", "Water Pump"]) && hit.every((n) => n.vulnerability_levels?.[flood.id] === 1), `hit: ${hit.map((n) => `${n.label}=${n.vulnerability_levels?.[flood.id]}`).join(", ")}`),
      ];
    },
  },
  {
    id: "b5-generator",
    file: "IJDRR_example.json",
    request: "Add a backup diesel generator: a Source node supplying 4 units of electricity, fully functional, connected by an edge to the Substation.",
    expect: (b, a) => {
      const added = Object.values(a.project.nodes).filter((n) => !(n.id in b.project.nodes));
      const sub = Object.values(a.project.nodes).find((n) => n.label === "Substation")!;
      const gen = added[0];
      if (added.length !== 1) return [`${added.length} nodes added`];
      return [
        ...fail(gen.node_type === "Source" && gen.supply_capacity?.electric === 4 && gen.functionality === a.config.functionality_scale.length, `the generator: ${JSON.stringify(gen)}`),
        ...fail(Object.values(a.project.edges).some((e) => e.source === gen.id && e.target === sub.id), "no edge from the generator to the Substation"),
        ...fail(a.project.canvases.some((c) => c.graph.node_ids.includes(gen.id)), "the generator is on no Canvas"),
      ];
    },
  },
  {
    id: "b6-rewire",
    file: "IJDRR_example.json",
    request: "Remove the connection from the Substation to the Hospital, and rename the City to 'Old Town'.",
    expect: (b, a) => {
      const byLabel = (label: string) => Object.values(b.project.nodes).find((n) => n.label === label)!.id;
      const [sub, hosp, city] = [byLabel("Substation"), byLabel("Hospital"), byLabel("City")];
      return [
        ...fail(!Object.values(a.project.edges).some((e) => e.source === sub && e.target === hosp), "the edge is still there"),
        ...fail(a.project.nodes[city]?.label === "Old Town", `City is "${a.project.nodes[city]?.label}"`),
        ...fail(Object.keys(a.project.nodes).length === Object.keys(b.project.nodes).length, "a node was added or removed"),
        ...fail(Object.keys(b.project.edges).length - Object.keys(a.project.edges).length === 1, "not exactly one edge removed"),
      ];
    },
  },
];

/** A new project: one empty Canvas, the default configuration. */
const emptyBundle = (): ProjectBundle => ({
  project: {
    version: "2.0",
    meta: { name: "new" },
    nodes: {},
    edges: {},
    canvases: [{ id: "main", label: "Main", graph: { graph_type: "generic", node_ids: [], edge_ids: [] } }],
    update_history: [],
    scorecard: [],
  },
  config: structuredClone(DEFAULT_CONFIG),
});

interface RecipeTask {
  id: string;
  recipe: RecipeId;
  bundle: () => ProjectBundle;
  input: string;
  expect: (before: ProjectBundle, after: ProjectBundle, groups: { why?: string }[]) => string[];
}

const added = <T,>(before: Record<string, T>, after: Record<string, T>) => Object.keys(after).filter((id) => !(id in before)).map((id) => after[id]);
const labelled = (b: ProjectBundle, needle: RegExp) => Object.values(b.project.nodes).find((n) => needle.test(n.label ?? ""));
const feeds = (b: ProjectBundle, from: RegExp, to: RegExp) => {
  const [f, t] = [labelled(b, from), labelled(b, to)];
  return !!f && !!t && Object.values(b.project.edges).some((e) => e.source === f.id && e.target === t.id);
};

const RECIPE_TASKS: RecipeTask[] = [
  {
    id: "r1-describe",
    recipe: "describe",
    bundle: emptyBundle,
    input:
      "We are a small hill town. Our water comes from one spring, pumped by an electric pump station up to a reservoir that feeds the town. " +
      "Power comes from a single substation fed by the regional grid. The town has a health clinic that needs power and water, and a school that needs water. " +
      "The clinic has a diesel generator that lasts 12 hours. Two technicians run the pump station; without them it stops within a day. (No more questions: go ahead.)",
    expect: (b, a, groups) => {
      const nodes = added(b.project.nodes, a.project.nodes);
      return [
        ...fail(nodes.length >= 6 && nodes.length <= 14, `${nodes.length} nodes added`),
        ...fail(a.config.categories.length >= 2, `${a.config.categories.length} Categories`),
        ...fail(feeds(a, /substation/i, /pump station/i), "no edge Substation → pump station"),
        ...fail(feeds(a, /reservoir/i, /clinic/i) || feeds(a, /reservoir/i, /town|distribution/i), "the reservoir feeds neither the clinic nor the town"),
        ...fail(Object.values(a.project.nodes).some((n) => /clinic/i.test(n.label ?? "") && Object.values(n.category_dependency_profiles ?? {}).some((p) => p.backup && p.backup_duration === 12)), "the clinic's 12-hour backup is missing"),
        ...fail(nodes.every((n) => a.project.canvases.some((c) => c.graph.node_ids.includes(n.id))), "a node is on no Canvas"),
        ...fail(groups.filter((g) => !g.why).length === 0, `${groups.filter((g) => !g.why).length} changes without a why`),
      ];
    },
  },
  {
    id: "r2-import",
    recipe: "import",
    bundle: emptyBundle,
    input: [
      "asset,kind,depends on,output",
      "Grid feeder,power supplier,,50 kW",
      "Server room,IT,Grid feeder; Cooling unit,",
      "Cooling unit,facility,Grid feeder,",
      "Call centre,customer service,Server room; Grid feeder,",
      "Payroll office,back office,Server room,",
    ].join("\n"),
    expect: (b, a, groups) => {
      const nodes = added(b.project.nodes, a.project.nodes);
      return [
        ...fail(nodes.length === 5, `${nodes.length} nodes added, expected one per row (5)`),
        ...fail(feeds(a, /grid/i, /server/i) && feeds(a, /cooling/i, /server/i) && feeds(a, /server/i, /call/i) && feeds(a, /grid/i, /call/i) && feeds(a, /server/i, /payroll/i) && feeds(a, /grid/i, /cooling/i), "a 'depends on' edge is missing or reversed"),
        ...fail(Object.keys(a.project.edges).length - Object.keys(b.project.edges).length === 6, `${Object.keys(a.project.edges).length} edges, expected 6`),
        ...fail(Object.values(labelled(a, /grid/i)?.supply_capacity ?? {}).some((v) => v === 50), "the feeder's 50 kW supply is missing"),
        // The data gives no other quantity: none invented.
        ...fail(nodes.filter((n) => !/grid/i.test(n.label ?? "")).every((n) => !n.supply_capacity), "a supply was invented"),
        ...fail(groups.filter((g) => !g.why).length === 0, `${groups.filter((g) => !g.why).length} changes without a why`),
      ];
    },
  },
  {
    id: "r3-red-team",
    recipe: "red-team",
    bundle: () => load("IJDRR_example.json"),
    input: "",
    expect: (b, a) => {
      const events = a.config.events.filter((e) => !b.config.events.some((x) => x.id === e.id));
      const hits = (id: string) => Object.values(a.project.nodes).filter((n) => n.vulnerability_levels?.[id] !== undefined).length + Object.values(a.project.edges).filter((e) => e.vulnerability_levels?.[id] !== undefined).length;
      return [
        ...fail(events.length >= 8 && events.length <= 12, `${events.length} Events added`),
        ...fail(events.every((e) => e.frequency_per_10y > 0), "an Event has no frequency"),
        ...fail(events.every((e) => hits(e.id) > 0), `Events striking nothing: ${events.filter((e) => hits(e.id) === 0).map((e) => e.label).join(", ")}`),
        ...fail(!events.some((e) => /earthquake/i.test(e.label)), "repeats the existing Earthquake"),
        ...fail(events.some((e) => e.type === "disservice") && events.some((e) => e.type === "hazard"), "only one Event type"),
        ...fail(events.every((e) => e.provenance?.rationale), "an Event without its why"),
      ];
    },
  },
];


describe.skipIf(!MODE)("llm eval", () => {
  it("writes the contexts", () => {
    if (MODE !== "gen") return;
    for (const t of TASKS) for (const v of VARIANTS) {
      const b = load(t.file);
      const context = v === "v2" ? bulkContext(b) : modelTextContext(b);
      writeFileSync(`${DIR}/${t.id}.${v}.context.md`, `${context}\n\n## Request\n${t.request}\n`);
    }
    for (const t of RECIPE_TASKS) writeFileSync(`${DIR}/${t.id}.recipe.context.md`, recipeContext(t.recipe, t.bundle(), { input: t.input }));
  });

  it("checks the replies", () => {
    if (MODE !== "check") return;
    const rows: string[] = ["| task | v1 | v1 after repair | v2 | v2 after repair |", "| --- | --- | --- | --- | --- |"];
    const details: string[] = [];
    const score: Record<Variant, number> = { v1: 0, v2: 0 };
    const repaired: Record<Variant, number> = { v1: 0, v2: 0 };
    /** One reply scored: right, wrong (with why) or refused (with the errors). */
    const grade = (t: Task, label: string, text: string) => {
      const b = load(t.file);
      // The window's own gate; it reads either format by its "format" field.
      const r = checkDesignText(b, { bulk: true }, text).checked;
      if (!r.ok) { details.push(`### ${t.id} ${label}: refused\n${r.errors.slice(0, 8).map((e) => `- ${e}`).join("\n")}`); return { cell: "refused", errors: r.errors }; }
      const failures = t.expect(b, r.after);
      if (failures.length > 0) { details.push(`### ${t.id} ${label}: wrong outcome\n${failures.map((e) => `- ${e}`).join("\n")}`); return { cell: "wrong" }; }
      return { cell: "**right**" };
    };
    for (const t of TASKS) {
      const cells = VARIANTS.flatMap((v) => {
        const path = `${DIR}/${t.id}.${v}.reply.md`;
        if (!existsSync(path)) return ["no reply", ""];
        const text = readFileSync(path, "utf8");
        const first = grade(t, v, text);
        if (first.cell === "**right**") { score[v]++; return [first.cell, ""]; }
        if (first.errors) writeFileSync(`${DIR}/${t.id}.${v}.repair.context.md`, `${repairContext(load(t.file), text, first.errors)}\n\n## The original request\n${t.request}\n`);
        const repairPath = `${DIR}/${t.id}.${v}.repair.reply.md`;
        if (!existsSync(repairPath)) return [first.cell, first.errors ? "no reply" : ""];
        const second = grade(t, `${v} after repair`, readFileSync(repairPath, "utf8"));
        if (second.cell === "**right**") repaired[v]++;
        return [first.cell, second.cell];
      });
      rows.push(`| ${t.id} | ${cells.join(" | ")} |`);
    }
    rows.push(`| right | ${score.v1}/${TASKS.length} | ${score.v1 + repaired.v1}/${TASKS.length} | ${score.v2}/${TASKS.length} | ${score.v2 + repaired.v2}/${TASKS.length} |`);
    rows.push("", "| recipe task | first try |", "| --- | --- |");
    for (const t of RECIPE_TASKS) {
      const path = `${DIR}/${t.id}.recipe.reply.md`;
      if (!existsSync(path)) { rows.push(`| ${t.id} | no reply |`); continue; }
      const b = t.bundle();
      const r = checkDesignText(b, { bulk: true }, readFileSync(path, "utf8"));
      if (!r.checked.ok) {
        details.push(`### ${t.id}: refused\n${r.checked.errors.slice(0, 8).map((e) => `- ${e}`).join("\n")}`);
        writeFileSync(`${DIR}/${t.id}.recipe.repair.context.md`, repairContext(b, readFileSync(path, "utf8"), r.checked.errors));
        rows.push(`| ${t.id} | refused |`);
        continue;
      }
      const failures = t.expect(b, r.checked.after, r.groups ?? []);
      if (failures.length) details.push(`### ${t.id}: wrong outcome\n${failures.map((e) => `- ${e}`).join("\n")}`);
      rows.push(`| ${t.id} | ${failures.length ? "wrong" : "**right**"} |`);
    }
    writeFileSync(`${DIR}/report.md`, [...rows, "", ...details].join("\n"));
  });
});
