import type { ModelConfiguration } from "@/lib/schemas/config";
import type { Project } from "@/lib/schemas/network";

/**
 * merge-import.ts — helper for merging an imported network into the current
 * project as an extra canvas (requirements §13.5), rather than replacing it.
 *
 * canvasStore.mergeImportedProject() remaps any node/edge id that collides
 * with the current project's own ids (two independently-authored networks
 * can easily reuse short generic ids like "J1" or "R1"). A generated scenario
 * Event's `attribute_mutations` keys are "<elementId>.<field>" strings — if
 * the elementId part named a node that got remapped, the mutation would
 * silently target nothing (or the wrong element) once merged in. This
 * rewrites those keys through the id maps returned by mergeImportedProject,
 * BEFORE the config is merged in via configStore.mergeConfig().
 *
 * Node ids and edge ids are independent namespaces (an EPANET junction and
 * pipe can legitimately share the same raw id), so the two maps are kept
 * separate rather than merged into one Record — a single merged map would
 * let a node id and an edge id sharing the same original string silently
 * clobber each other's remap. `sourceProject` (the imported bundle's own
 * project, PRE-remap) disambiguates which namespace a given elementId came
 * from before picking which map to consult.
 *
 * Vulnerability-based Hazards (vulnerability_levels living ON the node
 * object, e.g. the .inp importer's "Blackout" event) need no such rewrite —
 * the whole node object moves with its id, vulnerability_levels travels
 * with it unchanged.
 */
export function remapConfigEventIds(
  config: ModelConfiguration,
  sourceProject: Project,
  nodeIdMap: Record<string, string>,
  edgeIdMap: Record<string, string>,
): ModelConfiguration {
  if (Object.keys(nodeIdMap).length === 0 && Object.keys(edgeIdMap).length === 0) return config;

  return {
    ...config,
    events: config.events.map((event) => {
      const mutations = event.attribute_mutations;
      if (!mutations || Object.keys(mutations).length === 0) return event;

      const remapped: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(mutations)) {
        // Split on the LAST "." — field names (functionality_time,
        // category_dependency_profiles, ...) are fixed identifiers that never
        // contain a dot, but an imported element id can (a raw .inp label is a
        // free-form string, e.g. "T.1"); splitting on the first dot would
        // truncate such an id and silently mismatch every lookup downstream.
        const dotIdx = key.lastIndexOf(".");
        if (dotIdx === -1) {
          remapped[key] = value;
          continue;
        }
        const elementId = key.slice(0, dotIdx);
        const field = key.slice(dotIdx + 1);
        // Disambiguate by which namespace the id belonged to IN THE SOURCE
        // project — never fall through from one map to the other, since
        // node/edge ids can collide with each other and a wrong fallback
        // would silently remap through the wrong table.
        const newId = elementId in sourceProject.nodes
          ? (nodeIdMap[elementId] ?? elementId)
          : elementId in sourceProject.edges
            ? (edgeIdMap[elementId] ?? elementId)
            : elementId;
        remapped[`${newId}.${field}`] = value;
      }
      return { ...event, attribute_mutations: remapped };
    }),
  };
}
