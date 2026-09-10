/**
 * Every shipped sample must still parse, and still undo.
 *
 * The schema change behind ADR-0017 made `before`/`after` optional and added
 * `diff`. Every git-tracked sample predates it and carries the snapshot pair, so
 * these files are the regression surface for "both formats are read, only diffs
 * are written" — including the network the guided tour runs on.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { ProjectSchema } from "@/lib/schemas/network";
import { applyGraphDiff, materialiseBefore } from "@/lib/graph-diff";

const DIR = join(__dirname, "..", "samples", "public");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json");

describe("shipped samples", () => {
  it("finds them", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it.each(FILES)("%s parses against the current schema", (file) => {
    const raw: unknown = JSON.parse(readFileSync(join(DIR, file), "utf8"));
    const project = (raw as { project?: unknown }).project ?? raw;
    const result = ProjectSchema.safeParse(project);
    expect(result.success ? null : result.error.issues.slice(0, 3)).toBeNull();
  });

  it.each(FILES)("%s still undoes through its legacy history", (file) => {
    const raw: unknown = JSON.parse(readFileSync(join(DIR, file), "utf8"));
    const project = ProjectSchema.parse((raw as { project?: unknown }).project ?? raw);
    const live = { nodes: project.nodes, edges: project.edges, canvases: project.canvases };

    for (const entry of project.update_history) {
      // Legacy entries carry snapshots, not diffs. Both paths must work: undo
      // restores `before` outright, and materialisation stops at the first one.
      expect(entry.diff ?? entry.before).toBeDefined();
      if (entry.diff) expect(() => applyGraphDiff(live, entry.diff!, "backward")).not.toThrow();
    }
    expect(() => materialiseBefore(live, project.update_history)).not.toThrow();
  });
});
