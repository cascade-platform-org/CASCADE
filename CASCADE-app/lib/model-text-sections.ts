/**
 * model-text-sections.ts — the LLM Design as a tree of sections (ADR-0022).
 * Pure.
 *
 * Everything a project saves, arranged the way a person thinks of it: Project
 * (info, Canvases, Nodes and Edges by Canvas, Scorecard, Temporal
 * Simulations) and Configuration (Events, Categories, Functionality scale,
 * the rest). Any level can be opened: a group shows everything under it, so
 * one edit there is a bulk edit, and a leaf shows one item. The person edits
 * the section's JSON as it is; `sectionPatch` turns the edited JSON into the
 * JSON Patch operations the check (`checkChange`) and the preview already
 * understand, so a section edit and a hand-written change set go through the
 * same gate.
 *
 * Nodes and Edges are id-keyed registries: their sections compare key by key,
 * so a changed record is one `replace`, a new one an `add`, a deleted one a
 * `remove`. Deleting an Element there also takes what refers to it (its edges,
 * its place on every Canvas), which the preview lists; elsewhere a section is
 * replaced whole and the preview reports only what differs.
 */

import { deepEqual } from "@/lib/graph-diff";
import { encodePointerKey as enc, isPlain as isRecord, readPointer, type PatchOp } from "@/lib/model-text";
import type { ProjectBundle } from "@/lib/file-io";

export interface Section {
  /** Unique in the tree. */
  key: string;
  label: string;
  /** How many items it holds, for the tree. */
  count?: number;
  /** Where its value lives (JSON Pointer into `{ project, config }`). */
  pointer: string;
  /**
   * `keys`: an object compared key by key; `ids` limits it to some keys of a
   * registry (a Canvas's Nodes). `value`: replaced whole.
   */
  mode: "keys" | "value";
  ids?: string[];
  /** For an Element registry: deleting a key also removes what refers to it. */
  registry?: "nodes" | "edges";
  /** For a registry's Canvas group: the Canvas (by index) an added Element is placed on. */
  canvasIndex?: number;
  children?: Section[];
}

/** The section that holds the hand-written change set, not a part of the bundle. */
export const BULK_KEY = "bulk";

const leaf = (pointer: string, label: string): Section => ({ key: pointer, label, pointer, mode: "value" });

/** Each item of a list, labelled by what a person recognises it by. */
function items(pointer: string, list: readonly unknown[], name: (x: Record<string, unknown>, i: number) => string): Section[] {
  return list.map((x, i) => leaf(`${pointer}/${i}`, name((x ?? {}) as Record<string, unknown>, i)));
}

const str = (v: unknown, fallback: string) => (typeof v === "string" && v ? v : fallback);

/** A registry (Nodes or Edges) grouped by the Canvases its Elements are on. */
function registrySection(bundle: ProjectBundle, registry: "nodes" | "edges", label: string): Section {
  const records = bundle.project[registry] as Record<string, { id: string; label?: string; source?: string; target?: string }>;
  const pointer = `/project/${registry}`;
  const name = (id: string) => {
    const r = records[id];
    if (registry === "edges" && r) return `${str(bundle.project.nodes[r.source ?? ""]?.label, r.source ?? "?")} → ${str(bundle.project.nodes[r.target ?? ""]?.label, r.target ?? "?")}`;
    return str(r?.label, id);
  };
  const group = (key: string, groupLabel: string, ids: string[], canvasIndex?: number): Section => ({
    key, label: groupLabel, count: ids.length, pointer, mode: "keys", ids, registry, canvasIndex,
    children: ids.map((id) => ({ ...leaf(`${pointer}/${enc(id)}`, name(id)), key: `${key}/${id}` })),
  });
  const placed = new Set<string>();
  const byCanvas = bundle.project.canvases.map((c, i) => {
    const ids = (registry === "nodes" ? c.graph.node_ids : c.graph.edge_ids).filter((id) => id in records);
    ids.forEach((id) => placed.add(id));
    return group(`${pointer}@${c.id}`, `On ${str(c.label, c.id)}`, ids, i);
  });
  const loose = Object.keys(records).filter((id) => !placed.has(id));
  return {
    key: pointer, label, count: Object.keys(records).length, pointer, mode: "keys", registry,
    children: [...byCanvas, ...(loose.length ? [group(`${pointer}@none`, "Not on a Canvas", loose)] : [])],
  };
}

const SHOWN_CONFIG = new Set(["events", "categories", "functionality_scale"]);
const SHOWN_PROJECT = new Set(["meta", "canvases", "nodes", "edges", "scorecard", "temporal_simulations", "update_history", "version"]);

export function sectionTree(bundle: ProjectBundle): Section[] {
  const { project, config } = bundle;
  const sims = project.temporal_simulations ?? [];
  const projectChildren: Section[] = [
    leaf("/project/meta", "Project info"),
    ...Object.keys(project).filter((k) => !SHOWN_PROJECT.has(k)).map((k) => leaf(`/project/${enc(k)}`, k)),
    { ...leaf("/project/canvases", "Canvases"), count: project.canvases.length, children: items("/project/canvases", project.canvases, (c, i) => str(c.label, str(c.id, `#${i}`))) },
    registrySection(bundle, "nodes", "Nodes"),
    registrySection(bundle, "edges", "Edges"),
    { ...leaf("/project/scorecard", "Scorecard"), count: project.scorecard.length, children: items("/project/scorecard", project.scorecard, (e, i) => str(e.label, `#${i}`)) },
    { ...leaf("/project/temporal_simulations", "Temporal Simulations"), count: sims.length, children: items("/project/temporal_simulations", sims, (s, i) => str((s.timeline as { name?: string } | undefined)?.name, `#${i}`)) },
  ];
  const configChildren: Section[] = [
    { ...leaf("/config/events", "Events"), count: config.events.length, children: items("/config/events", config.events, (e, i) => str(e.label, str(e.id, `#${i}`))) },
    { ...leaf("/config/categories", "Categories"), count: config.categories.length, children: items("/config/categories", config.categories, (c, i) => str(c.name, `#${i}`)) },
    leaf("/config/functionality_scale", "Functionality scale"),
    ...Object.keys(config).filter((k) => !SHOWN_CONFIG.has(k)).map((k) => leaf(`/config/${enc(k)}`, k)),
  ];
  return [
    { key: "/project", label: "Project", pointer: "/project", mode: "keys", children: projectChildren },
    { ...leaf("/config", "Configuration"), children: configChildren },
    { key: BULK_KEY, label: "Bulk operations", pointer: "", mode: "value" },
  ];
}

/** Every section, depth first. */
export const flattenSections = (tree: readonly Section[]): Section[] => tree.flatMap((s) => [s, ...flattenSections(s.children ?? [])]);

export const findSection = (tree: readonly Section[], key: string): Section | undefined => flattenSections(tree).find((s) => s.key === key);

/** The keys of the groups above `key`, outermost first, or null when it is not in the tree. */
export function sectionAncestors(tree: readonly Section[], key: string, path: string[] = []): string[] | null {
  for (const s of tree) {
    if (s.key === key) return path;
    const below = sectionAncestors(s.children ?? [], key, [...path, s.key]);
    if (below) return below;
  }
  return null;
}

/** What a section shows: its value, a registry limited to its ids, the project without its history. */
export function sectionValue(bundle: ProjectBundle, section: Section): unknown {
  if (section.pointer === "/project") {
    const { update_history: _history, ...rest } = bundle.project;
    return rest;
  }
  const value = readPointer(bundle, section.pointer);
  if (section.ids && value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(section.ids.filter((id) => id in record).map((id) => [id, record[id]]));
  }
  return value;
}

/**
 * The patch that turns `section`'s current value into `edited`, or why the
 * edited JSON cannot stand there (a list where an object belongs). The check
 * decides everything else.
 */
export function sectionPatch(bundle: ProjectBundle, section: Section, edited: unknown): { patch: PatchOp[] } | { error: string } {
  const current = sectionValue(bundle, section);
  if (deepEqual(current, edited)) return { patch: [] };
  if (section.mode === "value") {
    const events = eventsAfter(bundle, section.pointer, edited);
    const gone = events ? bundle.config.events.map((e) => e.id).filter((id) => !events.has(id)) : [];
    return { patch: [{ op: "replace", path: section.pointer, value: edited }, ...eventFollowUps(bundle, gone)] };
  }
  if (!isRecord(edited) || !isRecord(current)) return { error: `${section.label} is an object: { "key": value, … }` };

  const patch: PatchOp[] = [];
  for (const [key, value] of Object.entries(edited)) {
    if (!(key in current)) patch.push({ op: "add", path: `${section.pointer}/${enc(key)}`, value });
    else if (!deepEqual(current[key], value)) patch.push({ op: "replace", path: `${section.pointer}/${enc(key)}`, value });
  }
  const removed = Object.keys(current).filter((key) => !(key in edited));
  if (section.pointer === "/project" && removed.length > 0) return { error: `The project's ${removed.join(", ")} cannot be removed; empty it instead` };
  for (const key of removed) patch.push({ op: "remove", path: `${section.pointer}/${enc(key)}` });
  if (section.registry) {
    const added = Object.keys(edited).filter((key) => !(key in current));
    patch.push(...registryFollowUps(bundle, section.registry, removed, added, edited, section.canvasIndex));
  }
  return { patch };
}

/** The Event ids a section edit leaves, when the section holds Events; null otherwise. */
function eventsAfter(bundle: ProjectBundle, pointer: string, edited: unknown): Set<string> | null {
  const ids = (list: unknown) => new Set((Array.isArray(list) ? list : []).map((e) => (isRecord(e) ? e.id : undefined)).filter((id): id is string => typeof id === "string"));
  if (pointer === "/config") return isRecord(edited) ? ids(edited.events) : null;
  if (pointer === "/config/events") return ids(edited);
  const one = /^\/config\/events\/(\d+)$/.exec(pointer);
  if (!one) return null;
  const list: unknown[] = [...bundle.config.events];
  list[Number(one[1])] = edited;
  return ids(list);
}

/** What follows from removing Events: their vulnerability levels on every Element go too. */
export function eventFollowUps(bundle: ProjectBundle, removed: readonly string[]): PatchOp[] {
  const ops: PatchOp[] = [];
  for (const reg of ["nodes", "edges"] as const) {
    for (const [id, el] of Object.entries(bundle.project[reg])) {
      for (const event of removed) {
        if (el.vulnerability_levels && Object.hasOwn(el.vulnerability_levels, event)) {
          ops.push({ op: "remove", path: `/project/${reg}/${enc(id)}/vulnerability_levels/${enc(event)}` });
        }
      }
    }
  }
  return ops;
}

/**
 * What follows from a registry edit: a removed node's edges go too, removed
 * Elements leave every Canvas, and an Element added in a Canvas's group is
 * placed on that Canvas.
 */
export function registryFollowUps(
  bundle: ProjectBundle,
  registry: "nodes" | "edges",
  removed: string[],
  added: string[],
  edited: Record<string, unknown>,
  canvasIndex: number | undefined,
): PatchOp[] {
  const { project } = bundle;
  const gone = new Set(removed);
  const goneEdges = new Set(registry === "edges" ? removed : []);
  if (registry === "nodes") {
    for (const e of Object.values(project.edges)) if (gone.has(e.source) || gone.has(e.target)) goneEdges.add(e.id);
  }
  const ops: PatchOp[] = [];
  // From the Nodes section a removed node's edges go here; in the Edges section the person removed them.
  if (registry === "nodes") for (const id of goneEdges) if (!(id in edited)) ops.push({ op: "remove", path: `/project/edges/${enc(id)}` });
  project.canvases.forEach((c, i) => {
    const placed = i === canvasIndex ? added : [];
    const nodeIds = [...c.graph.node_ids.filter((id) => !(registry === "nodes" && gone.has(id))), ...(registry === "nodes" ? placed : [])];
    const edgeIds = [...c.graph.edge_ids.filter((id) => !goneEdges.has(id)), ...(registry === "edges" ? placed : [])];
    if (!deepEqual(nodeIds, c.graph.node_ids)) ops.push({ op: "replace", path: `/project/canvases/${i}/graph/node_ids`, value: nodeIds });
    if (!deepEqual(edgeIds, c.graph.edge_ids)) ops.push({ op: "replace", path: `/project/canvases/${i}/graph/edge_ids`, value: edgeIds });
  });
  return ops;
}
