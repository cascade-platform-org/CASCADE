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
 */

import { describe, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { deepEqual } from "./graph-diff";
import { checkChange, modelTextContext, parseChangeText, type CheckedChange } from "./model-text";
import { bulkContext, checkBulkText, repairContext } from "./model-text-v2";
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

function checkReply(variant: Variant, bundle: ProjectBundle, text: string): CheckedChange {
  if (variant === "v2") return checkBulkText(bundle, text).checked;
  const parsed = parseChangeText(text);
  return parsed.ok ? checkChange(bundle, parsed.change) : parsed;
}

describe.skipIf(!MODE)("llm eval", () => {
  it("writes the contexts", () => {
    if (MODE !== "gen") return;
    for (const t of TASKS) for (const v of VARIANTS) {
      const b = load(t.file);
      const context = v === "v2" ? bulkContext(b) : modelTextContext(b);
      writeFileSync(`${DIR}/${t.id}.${v}.context.md`, `${context}\n\n## Request\n${t.request}\n`);
    }
  });

  it("checks the replies", () => {
    if (MODE !== "check") return;
    const rows: string[] = ["| task | v1 | v1 after repair | v2 | v2 after repair |", "| --- | --- | --- | --- | --- |"];
    const details: string[] = [];
    const score: Record<Variant, number> = { v1: 0, v2: 0 };
    const repaired: Record<Variant, number> = { v1: 0, v2: 0 };
    /** One reply scored: right, wrong (with why) or refused (with the errors). */
    const grade = (t: Task, v: Variant, label: string, text: string) => {
      const b = load(t.file);
      // A repaired reply may come back in either form; the plain form says so in its format.
      const r = label.includes("repair") ? checkBulkText(b, text).checked : checkReply(v, b, text);
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
        const first = grade(t, v, v, text);
        if (first.cell === "**right**") { score[v]++; return [first.cell, ""]; }
        if (first.errors) writeFileSync(`${DIR}/${t.id}.${v}.repair.context.md`, `${repairContext(load(t.file), text, first.errors)}\n\n## The original request\n${t.request}\n`);
        const repairPath = `${DIR}/${t.id}.${v}.repair.reply.md`;
        if (!existsSync(repairPath)) return [first.cell, first.errors ? "no reply" : ""];
        const second = grade(t, v, `${v} after repair`, readFileSync(repairPath, "utf8"));
        if (second.cell === "**right**") repaired[v]++;
        return [first.cell, second.cell];
      });
      rows.push(`| ${t.id} | ${cells.join(" | ")} |`);
    }
    rows.push(`| right | ${score.v1}/${TASKS.length} | ${score.v1 + repaired.v1}/${TASKS.length} | ${score.v2}/${TASKS.length} | ${score.v2 + repaired.v2}/${TASKS.length} |`);
    writeFileSync(`${DIR}/report.md`, [...rows, "", ...details].join("\n"));
  });
});
