/**
 * llm-recipes.ts — Recipes: one job LLM Design copies for an LLM (ADR-0022,
 * requirements §13.3b). Pure.
 *
 * A person who does not know the platform says what they want in their own
 * words; a Recipe puts in front of it the instructions for the job and the
 * model's context, so the LLM knows the platform for them. Three Recipes reply
 * with plain changes, which the person pastes into Bulk operations; Explain
 * replies in words. The names stay in: an organisation's context (a coastal
 * hospital, a data centre) is in them, and red-teaming reasons from it.
 */

import { NODE_TYPES } from "@/lib/schemas/primitives";
import { MODEL_PRIMER } from "@/lib/temporal-simulation-text";
import { modelLists } from "@/lib/model-text";
import { bulkContext } from "@/lib/model-text-v2";
import { deriveSituation, situationEventIds } from "@/lib/situation";
import type { AnalysisResult } from "@/lib/topological-analysis";
import type { ProjectBundle } from "@/lib/file-io";

export type RecipeId = "describe" | "import" | "red-team" | "explain";

export interface Recipe {
  id: RecipeId;
  label: string;
  /** One line for the person: what the Recipe is for. */
  blurb: string;
  /** The box the person may fill; its text goes into the copy. */
  input: { label: string; placeholder: string };
  /** What comes back: plain changes for Bulk operations, or words. */
  reply: "changes" | "words";
}

export const RECIPES: readonly Recipe[] = [
  {
    id: "describe",
    label: "Model from a description",
    blurb: "Describe your organisation in your own words; the LLM asks what it needs, then builds the model.",
    input: { label: "Your description (optional: the LLM asks what it needs)", placeholder: "We run a 200-bed hospital on the coast. Power comes from the grid, with two diesel generators…" },
    reply: "changes",
  },
  {
    id: "import",
    label: "Import an organisation's data",
    blurb: "Paste an asset list, a table, an org chart or a document; the LLM turns it into Elements and edges.",
    input: { label: "The data (a table, a list, a document)", placeholder: "site, type, feeds, capacity\nPump A, pumping station, District 1, 120 m³/h\n…" },
    reply: "changes",
  },
  {
    id: "red-team",
    label: "Red-team Events",
    blurb: "An LLM with no stake in the organisation proposes hazards across sectors, and what each strikes.",
    input: { label: "Anything to focus on (optional)", placeholder: "the next 10 years; the northern sites; supply chain" },
    reply: "changes",
  },
  {
    id: "explain",
    label: "Explain the current state",
    blurb: "The applied Events, what is degraded and why, and the latest Analysis, explained in plain words.",
    input: { label: "Your question (optional)", placeholder: "Why is the Hospital down, and what would help most?" },
    reply: "words",
  },
];

export const findRecipe = (id: RecipeId): Recipe => RECIPES.find((r) => r.id === id)!;

/** What the person selected: the Elements a request is about. */
export interface Focus {
  nodeIds: readonly string[];
  edgeIds: readonly string[];
}

/** The selected Elements as stored, and their unselected neighbours by name. */
export function focusContext(bundle: ProjectBundle, focus: Focus): string {
  const { nodes, edges } = bundle.project;
  const nodeIds = focus.nodeIds.filter((id) => id in nodes);
  const picked = new Set(nodeIds);
  // An edge between two selected nodes belongs to the selection.
  const edgeIds = [...new Set([...focus.edgeIds, ...Object.values(edges).filter((e) => picked.has(e.source) && picked.has(e.target)).map((e) => e.id)])].filter((id) => id in edges);
  const neighbours = new Set<string>();
  for (const e of Object.values(edges)) {
    if (picked.has(e.source) && !picked.has(e.target)) neighbours.add(e.target);
    if (picked.has(e.target) && !picked.has(e.source)) neighbours.add(e.source);
  }
  const stored = {
    nodes: Object.fromEntries(nodeIds.map((id) => [id, nodes[id]])),
    edges: Object.fromEntries(edgeIds.map((id) => [id, edges[id]])),
  };
  return [
    `## What the person selected (${nodeIds.length} nodes, ${edgeIds.length} edges), as stored`,
    "The request is about these unless it says otherwise.",
    `\`\`\`json\n${JSON.stringify(stored, null, 1)}\n\`\`\``,
    ...(neighbours.size ? [`Connected to them (not selected):\n${[...neighbours].map((id) => `- ${id} — ${nodes[id]?.label ?? ""} — ${nodes[id]?.node_type ?? ""}`).join("\n")}`] : []),
  ].join("\n");
}

const MODELLING_GUIDE = `## Turning an organisation into a CASCADE model
- A node is anything whose failure matters on its own: a site, a plant, a system, a team, a supplier, a service to
  people. Prefer fewer, meaningful nodes. node_type (${NODE_TYPES.join(", ")}) only sets how it is drawn:
  "Source" produces a resource (a power plant, a well, a supplier, an IT provider); "Infrastructure" carries or
  transforms it (a substation, a pump, a network, a warehouse); "Service" serves people or the organisation's
  mission (a ward, a school, a call centre); "Personnel" is people whose presence is needed (operators, a shift).
- A Category is a resource or a precondition. A quantity that flows (electricity, water, staff hours, data) is
  "SourceToDemands"; a need without a quantity (an operator on site, cooling working, a licence) is "Requisite".
  Add a Category with { "add": "category", "value": { "name": "water", "category_type": "SourceToDemands" } }.
- A node lists in "node_categories" the Categories it provides or carries; carrying one needs no dependency on it,
  and a node that only consumes lists none. What it needs goes in "category_dependency_profiles": { "<category>":
  { "dependency_level": 1..N (N = cannot work at all without it), "demand": amount, "backup": true,
  "backup_duration": hours } }; "demand" and "backup_duration" are for SourceToDemands Categories only, and
  "demand" may be left out when unknown. A producer's output is "supply_capacity": { "<category>": amount per period }.
- "functionality" defaults to N (fully operational) and an edge's id is made for you: leave both out.
- An edge runs from the provider to the node that depends on it (the direction the resource goes), on the
  Canvases of its ends; "capacity" limits what a SourceToDemands flow carries through it.
- A quantity that carries over from one period to the next is kept where a Temporal Simulation can move it:
  one the flow draws or fills (water in a tank, a fuel reserve) is a Stock, written in place of the supply number:
  "supply_capacity": { "<category>": { "rate": supply per period, "level": amount held now, "min", "max" } };
  one that is only counted (an hours balance, a backlog) is a property named for what it is now, e.g.
  "properties": { "balance_h": 10007 }, never for a date ("balance_1_jan_2023"), since the simulation changes it.
  Say in "notes" where each such quantity lives, so the simulation can be written against it.
- "importance" weighs how much a Service matters (1 = default).
- One Canvas per site or sector when the systems are clearly separate; one is fine otherwise. Give each node a
  "position" (x to the right, y downward, about 200 apart), providers above the nodes they feed.
- For example, a spring feeding a pump station that needs grid power:
  { "add": "category", "value": { "name": "water", "category_type": "SourceToDemands" }, "why": "…" }
  { "add": "node", "value": { "id": "spring", "label": "Spring", "node_type": "Source", "node_categories": ["water"],
    "supply_capacity": { "water": 100 }, "position": { "x": 0, "y": 0 } }, "why": "…" }
  { "add": "node", "value": { "id": "pump", "label": "Pump station", "node_type": "Infrastructure", "node_categories": ["water"],
    "category_dependency_profiles": { "electric": { "dependency_level": 3, "demand": 40 } }, "position": { "x": 0, "y": 200 } }, "why": "…" }
  { "connect": { "from": "spring", "to": "pump" }, "why": "…" }`;

const ASK_FIRST = `Before writing any change, check what you know. If the input leaves out what you need to build a sound
model (what the organisation does, what it depends on, which sites), ask the person up to five short questions in
plain words, with no jargon, and wait for the answers. Then reply.`;

const WHY_RULE = `Give every change a "why": the sentence or row of the input it comes from, or "Assumed: …" when you filled a
gap. Put in "notes" what you modelled, what you left out and what you assumed. The app marks everything you add as
unconfirmed until a person confirms it.`;

function taskFor(recipe: RecipeId, bundle: ProjectBundle): string {
  const n = bundle.config.functionality_scale.length;
  switch (recipe) {
    case "describe":
      return [
        "# Task: model an organisation from a description",
        "You are helping a person who does not know CASCADE build a model of their organisation, to find out how a failure in one part spreads to the rest. The model below may be empty or partial: add to it, and keep what is there.",
        ASK_FIRST,
        MODELLING_GUIDE,
        WHY_RULE,
      ].join("\n\n");
    case "import":
      return [
        "# Task: turn an organisation's data into a CASCADE model",
        "The person pasted data about their organisation (a table, a list, an org chart, a document). Turn it into Categories, nodes and edges. The model below may be empty or partial: add to it, and keep what is there; a thing already in it is updated, never added twice.",
        "Use only what the data gives. A value it does not give is left out and said so in that change's \"why\", never invented. Say in \"notes\" which columns or parts you used and which you did not.",
        ASK_FIRST,
        MODELLING_GUIDE,
        WHY_RULE,
      ].join("\n\n");
    case "red-team":
      return [
        "# Task: red-team this organisation's Events",
        "You are an independent risk analyst. You have no stake in this organisation and no reason to play down a threat. From the names, types and structure below, infer what the organisation is, where it probably is and what it depends on. Then propose 8 to 12 Events it should be prepared for and does not cover yet (its Events are listed at the end).",
        "Cover several of: natural (weather, flood, heat, earthquake, wildfire), technological (equipment failure, a utility outage), cyber, supply chain, social and organisational (a strike, key staff absent, an epidemic), and compound or cascading combinations. Prefer plausible, specific Events to generic ones.",
        `For each Event:
- { "add": "event", "value": { "id": "<new id>", "label": "<short name>", "type": "hazard" (physical damage) or "disservice" (degradation without damage), "frequency_per_10y": how many times in 10 years you expect it }, "why": "the mechanism, and the evidence or comparable cases your frequency rests on" }
- then, for each Element it strikes directly (a node or an edge), { "set": "vulnerability", "event": "<its id>", "to": levels lost (1..${n - 1}), "id": "<element id>", "why": "how it strikes this Element" }. Only direct hits: the engine spreads the consequences along edges.
List the Events by how much they would matter. The app marks every Event you add as unconfirmed, and its frequency as an estimate, until a person confirms it.`,
      ].join("\n\n");
    case "explain":
      return "";
  }
}

/** The current state, for an LLM to explain: applied Events, degraded Elements and why, the latest Analysis. */
export function stateContext(bundle: ProjectBundle, analysis: AnalysisResult | null): string {
  const { project, config } = bundle;
  const n = config.functionality_scale.length;
  const name = (id: string) => project.nodes[id]?.label ?? config.events.find((e) => e.id === id)?.label ?? id;
  const situation = deriveSituation(project.update_history ?? []);
  const applied = situation ? situationEventIds(situation).map((id) => `- ${name(id)} (${id})`) : [];
  const degraded = [...Object.values(project.nodes), ...Object.values(project.edges)]
    .filter((el) => el.functionality < n)
    .sort((a, b) => a.functionality - b.functionality)
    .slice(0, 200)
    .map((el) => {
      const label = "label" in el && el.label ? el.label : "source" in el ? `${name(el.source)} → ${name(el.target)}` : el.id;
      const causes = Object.entries(el.responsibility_share ?? {}).sort((a, b) => b[1] - a[1]).map(([id, share]) => `${name(id)} ${Math.round(share * 100)}%`);
      return `- ${label} (${el.id}): Functionality ${el.functionality}/${n}${causes.length ? `; caused by ${causes.join(", ")}` : ""}`;
    });
  return [
    `## Events applied now\n${applied.join("\n") || "(none: the state comes from manual edits or a fresh model)"}`,
    `## Elements below full Functionality (${n} = fully operational; "caused by" is the engine's responsibility share)\n${degraded.join("\n") || "(none: everything is fully operational)"}`,
    ...(analysis
      ? [`## Latest Analysis: ${analysis.metric} (min ${analysis.min}, max ${analysis.max}, average ${analysis.avg.toFixed(3)})\n${analysis.ranked.slice(0, 15).map((s) => `${s.rank}. ${name(s.id)} (${s.kind}): ${s.score.toFixed(3)}`).join("\n")}`]
      : []),
  ].join("\n\n");
}

/** What a Recipe copies: its instructions, what the person typed, and the model's context. */
export function recipeContext(recipe: RecipeId, bundle: ProjectBundle, opts: { input?: string; focus?: string; analysis?: AnalysisResult | null } = {}): string {
  const input = opts.input?.trim();
  const said = `## What the person wrote\n${input ? input : "(nothing yet: ask them what you need)"}`;
  if (recipe === "explain") {
    return [
      "# Task: explain the current state of a CASCADE model",
      "Explain to the person, in plain words and without jargon, what is happening in their model: which Events are applied, which Elements are degraded and why (follow the chain of causes), what matters most, and the three changes that would make the organisation most resilient. Reply in words; do not write JSON unless they ask for it.",
      ...(input ? [`## Their question\n${input}`] : []),
      stateContext(bundle, opts.analysis ?? null),
      ...(opts.focus ? [opts.focus] : []),
      MODEL_PRIMER,
      "# The model",
      modelLists(bundle),
    ].join("\n\n");
  }
  return [taskFor(recipe, bundle), said, "# How to reply", bulkContext(bundle, opts.focus)].join("\n\n");
}
