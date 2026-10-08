/**
 * model-text — the Model text's check (ADR-0022). Every stage is exercised by
 * hand-picked cases (syntax, meaning, hostile input), and fast-check throws
 * random change sets at the whole pipeline: each one must either be refused
 * with a reason or produce a bundle that passes the schemas, and the bundle it
 * started from must never change.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_CONFIG } from "@/store/config-store";
import { ModelConfigurationSchema } from "./schemas/config";
import { ProjectSchema, type Project } from "./schemas/network";
import { MAX_DEPTH, MAX_TEXT_CHARS, MODEL_TEXT_FORMAT, checkChange, modelTextContext, parseChangeText, parsePointer, readPointer, type ChangeSet } from "./model-text";
import type { ProjectBundle } from "./file-io";

const N = DEFAULT_CONFIG.functionality_scale.length;

function bundle(): ProjectBundle {
  const project: Project = {
    version: "2.0",
    meta: { name: "p" },
    nodes: {
      s: { id: "s", label: "Source", functionality: N, node_type: "Source", supply_capacity: { water: 10 } },
      c: { id: "c", label: "City", functionality: N, node_type: "Service" },
    },
    edges: { e: { id: "e", source: "s", target: "c", functionality: N } },
    canvases: [{ id: "c1", label: "Main", graph: { graph_type: "generic", node_ids: ["s", "c"], edge_ids: ["e"] } }],
    update_history: [],
    scorecard: [],
  };
  return { project, config: structuredClone(DEFAULT_CONFIG) };
}

const change = (over: Partial<ChangeSet>): ChangeSet => ({ format: MODEL_TEXT_FORMAT, patch: [], elements: [], ...over });
const text = (over: object) => JSON.stringify({ format: MODEL_TEXT_FORMAT, ...over });

const errorsOf = (r: ReturnType<typeof checkChange>) => (r.ok ? [] : r.errors).join("\n");

describe("parsing the text", () => {
  it("takes bare JSON or the json block of an LLM reply", () => {
    expect(parseChangeText(text({ patch: [] })).ok).toBe(true);
    expect(parseChangeText(`Sure, here it is:\n\`\`\`json\n${text({ elements: [] })}\n\`\`\`\nAnything else?`).ok).toBe(true);
  });

  it("refuses broken JSON, a wrong format, an unknown key, and add without a value", () => {
    expect(parseChangeText("{ format: ").ok).toBe(false);
    expect(parseChangeText(JSON.stringify({ format: "other", patch: [] }))).toMatchObject({ ok: false });
    expect(parseChangeText(text({ patches: [] }))).toMatchObject({ ok: false, errors: [expect.stringMatching(/patches/)] });
    expect(parseChangeText(text({ patch: [{ op: "add", path: "/config/events/-" }] }))).toMatchObject({ ok: false, errors: [expect.stringMatching(/need a `value`/)] });
    expect(parseChangeText(text({ patch: [{ op: "move", from: "/a", path: "/b" }] })).ok).toBe(false);
  });

  it("refuses a text over the size limit and a value nested past the depth limit", () => {
    expect(parseChangeText(" ".repeat(MAX_TEXT_CHARS + 1))).toMatchObject({ ok: false, errors: [expect.stringMatching(/limit/)] });
    const deep = "[".repeat(MAX_DEPTH + 5) + "]".repeat(MAX_DEPTH + 5);
    expect(parseChangeText(`{"format":"${MODEL_TEXT_FORMAT}","patch":[{"op":"add","path":"/config/x","value":${deep}}]}`)).toMatchObject({ ok: false, errors: [expect.stringMatching(/deeper/)] });
  });

  it("refuses __proto__, constructor and prototype as a key anywhere, and never touches a prototype", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const hostile = `{"format":"${MODEL_TEXT_FORMAT}","patch":[{"op":"add","path":"/config/x","value":{"a":{"${key}":{"polluted":1}}}}]}`;
      expect(parseChangeText(hostile)).toMatchObject({ ok: false, errors: [expect.stringMatching(/not allowed/)] });
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("paths", () => {
  it("decode ~1 and ~0 and start at the project or the configuration", () => {
    expect(parsePointer("/project/nodes/a~1b~0c")).toEqual({ segments: ["project", "nodes", "a/b~c"] });
    expect(parsePointer("project/nodes")).toMatchObject({ error: expect.stringMatching(/start with "\/"/) });
    expect(parsePointer("/other")).toMatchObject({ error: expect.stringMatching(/\/project or \/config/) });
  });

  it("keep update_history and the whole project out of reach, and refuse unsafe segments", () => {
    expect(parsePointer("/project/update_history/0")).toMatchObject({ error: expect.stringMatching(/read-only/) });
    expect(parsePointer("/project")).toMatchObject({ error: expect.stringMatching(/not the whole project/) });
    expect(parsePointer("/config/__proto__/x")).toMatchObject({ error: expect.stringMatching(/not allowed/) });
  });

  it("read any part for Copy section", () => {
    const b = bundle();
    expect(readPointer(b, "/project/nodes/s/label")).toBe("Source");
    expect(readPointer(b, "/project/canvases/0/id")).toBe("c1");
    expect(readPointer(b, "/project/nodes/zz")).toBeUndefined();
    expect(readPointer(b, "/config/constructor")).toBeUndefined();
  });
});

describe("checking a change against the model", () => {
  it("adds an Event, renames a node and scales a supply, and previews each change", () => {
    const b = bundle();
    const r = checkChange(b, change({
      patch: [
        { op: "add", path: "/config/events/-", value: { id: "flood", label: "Flood", type: "hazard", frequency_per_10y: 1 } },
        { op: "replace", path: "/project/nodes/c/label", value: "Town" },
      ],
      elements: [{ where: { kind: "node", node_type: "Source" }, path: ["supply_capacity", "water"], op: "mul", value: 0.5 }],
    }));
    expect(errorsOf(r)).toBe("");
    if (!r.ok) return;
    expect(r.after.project.nodes.c.label).toBe("Town");
    expect(r.after.project.nodes.s.supply_capacity).toEqual({ water: 5 });
    expect(r.after.config.events.map((e) => e.id)).toContain("flood");
    const where = r.preview.lines.map((l) => `${l.kind} ${l.where}`);
    expect(where).toContain('change Node "Town" (c) › label');
    expect(where).toContain('change Node "Source" (s) › supply_capacity › water');
    expect(where).toContain('add config › events "flood"');
    expect(r.preview.counts).toEqual({ add: 1, remove: 0, change: 2 });
    expect(b.project.nodes.c.label).toBe("City");
  });

  it("removes an Element only with what refers to it: a dangling edge or Canvas member is refused", () => {
    const b = bundle();
    expect(errorsOf(checkChange(b, change({ patch: [{ op: "remove", path: "/project/nodes/s" }] })))).toMatch(/source "s"/);
    expect(errorsOf(checkChange(b, change({ patch: [{ op: "remove", path: "/project/edges/e" }] })))).toMatch(/references edge "e"/);
    const whole = checkChange(b, change({ patch: [
      { op: "remove", path: "/project/edges/e" },
      { op: "remove", path: "/project/canvases/0/graph/edge_ids/0" },
    ] }));
    expect(whole.ok).toBe(true);
    if (whole.ok) expect(whole.preview.lines.map((l) => `${l.kind} ${l.where}`)).toContain("remove Edge e");
  });

  it("refuses a path that is not there, a schema break, a key that disagrees with its id, a duplicate Event id", () => {
    const b = bundle();
    expect(errorsOf(checkChange(b, change({ patch: [{ op: "replace", path: "/project/nodes/zz/label", value: "x" }] })))).toMatch(/does not exist/);
    expect(errorsOf(checkChange(b, change({ patch: [{ op: "replace", path: "/project/nodes/c/functionality", value: "high" }] })))).toMatch(/project\.nodes\.c\.functionality/);
    expect(errorsOf(checkChange(b, change({ patch: [{ op: "add", path: "/project/nodes/x", value: { id: "y", functionality: 1 } }] })))).toMatch(/key and the id must match/);
    const quake = { id: "q", label: "Q", type: "hazard", frequency_per_10y: 0 };
    expect(errorsOf(checkChange(b, change({ patch: [{ op: "add", path: "/config/events/-", value: quake }, { op: "add", path: "/config/events/-", value: quake }] })))).toMatch(/"q" is used twice/);
    expect(errorsOf(checkChange(b, change({ patch: [{ op: "remove", path: "/config/events/99" }] })))).toMatch(/no index 99/);
  });

  it("refuses an operation that matches nothing or leaves the scale, and clamps nothing", () => {
    const b = bundle();
    expect(errorsOf(checkChange(b, change({ elements: [{ element: "ghost", path: ["functionality"], op: "set", value: 1 }] })))).toMatch(/no Element "ghost"/);
    expect(errorsOf(checkChange(b, change({ elements: [{ element: "c", path: ["functionality"], op: "set", value: N + 1 }] })))).toMatch(/above the top Functionality level/);
    expect(errorsOf(checkChange(b, change({ elements: [{ where: { kind: "node", label_contains: "nothing like it" }, path: ["importance"], op: "set", value: 1 }] })))).toMatch(/matches no Element/);
  });

  it("can change any saved part, the configuration included", () => {
    const b = bundle();
    const r = checkChange(b, change({ patch: [{ op: "replace", path: "/project/meta/name", value: "Renamed" }, { op: "replace", path: "/config/meta/name", value: "Cfg" }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.preview.lines.map((l) => l.where)).toEqual(["project › meta › name", "config › meta › name"]);
  });
});

describe("the LLM context", () => {
  it("names the Elements and Events, and stays compact on a large model", () => {
    const b = bundle();
    for (let i = 0; i < 500; i++) b.project.nodes[`n${i}`] = { id: `n${i}`, label: `N${i}`, functionality: N };
    const context = modelTextContext(b);
    expect(context).toMatch(/- s — Source — Source/);
    expect(context).toMatch(/… 202 more/);
    expect(context).toContain(MODEL_TEXT_FORMAT);
  });
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

const segment = fc.oneof(
  fc.constantFrom("project", "config", "nodes", "edges", "canvases", "events", "meta", "name", "label", "functionality", "s", "c", "e", "0", "1", "-", "graph", "node_ids", "update_history", "__proto__", "constructor"),
  fc.string({ maxLength: 6 }),
);
const pointer = fc.array(segment, { minLength: 1, maxLength: 5 }).map((s) => `/${s.join("/")}`);
const jsonValue = fc.jsonValue({ maxDepth: 3 });
const patchOp = fc.record({ op: fc.constantFrom("add", "replace", "remove") as fc.Arbitrary<"add" | "replace" | "remove">, path: pointer, value: jsonValue });
const elementOp = fc.record({
  element: fc.constantFrom("s", "c", "e", "ghost"),
  path: fc.array(fc.constantFrom("functionality", "importance", "label", "supply_capacity", "water", "properties", "k"), { minLength: 1, maxLength: 3 }),
  op: fc.constantFrom("set", "add", "mul") as fc.Arbitrary<"set" | "add" | "mul">,
  value: fc.oneof(fc.integer({ min: -3, max: 8 }), fc.double({ noNaN: true, noDefaultInfinity: true }), fc.string({ maxLength: 4 })),
});

describe("any change set", () => {
  it("is refused with reasons, or yields a bundle the schemas accept; the model it started from never changes", () => {
    const builtIns = Object.getOwnPropertyNames(Object.prototype);
    fc.assert(
      fc.property(fc.array(patchOp, { maxLength: 4 }), fc.array(elementOp, { maxLength: 3 }), (patch, elements) => {
        const b = bundle();
        const frozen = structuredClone(b);
        const parsed = parseChangeText(JSON.stringify({ format: MODEL_TEXT_FORMAT, patch, elements }));
        if (!parsed.ok) {
          expect(parsed.errors.length).toBeGreaterThan(0);
          return;
        }
        const r = checkChange(b, parsed.change);
        if (r.ok) {
          expect(ProjectSchema.safeParse(r.after.project).success).toBe(true);
          expect(ModelConfigurationSchema.safeParse(r.after.config).success).toBe(true);
          expect(r.after.project.update_history).toEqual(frozen.project.update_history);
        } else {
          expect(r.errors.length).toBeGreaterThan(0);
        }
        expect(b).toEqual(frozen);
        expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(builtIns);
      }),
      { numRuns: 400 },
    );
  });

  it("previews nothing for a change that changes nothing", () => {
    fc.assert(
      fc.property(fc.constantFrom("/project/nodes/s/label", "/config/meta/name", "/project/meta/name"), (path) => {
        const b = bundle();
        const r = checkChange(b, change({ patch: [{ op: "replace", path, value: readPointer(b, path) }] }));
        expect(r.ok && r.preview.lines).toEqual([]);
      }),
    );
  });
});
