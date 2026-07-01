/**
 * Semantic data-quality checks run after Zod schema validation passes.
 *
 * Zod catches structural problems (wrong types, missing required fields).
 * This module catches graph-integrity problems that Zod cannot express:
 * broken references, orphaned elements, duplicate labels, etc.
 *
 * All checks are read-only and produce a list of ValidationIssues ranked
 * by severity (errors first). The caller decides how to surface them.
 */
import type { ProjectBundle } from "./file-io";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** Optional: the ID of the node/edge/canvas with the problem. */
  elementId?: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function validateBundle(bundle: ProjectBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { project, config } = bundle;
  const { nodes, edges, canvases } = project;

  const nodeIds = new Set(Object.keys(nodes));
  const edgeIds = new Set(Object.keys(edges));

  // IDs that appear in at least one canvas
  const canvasNodeIds = new Set<string>();
  const canvasEdgeIds = new Set<string>();
  for (const canvas of Object.values(canvases)) {
    for (const id of canvas.graph.node_ids ?? []) canvasNodeIds.add(id);
    for (const id of canvas.graph.edge_ids ?? []) canvasEdgeIds.add(id);
  }

  const knownEventIds = new Set((config.events ?? []).map((e) => e.id));
  const knownCategoryNames = new Set((config.categories ?? []).map((c) => c.name));

  // ---- Edge reference integrity ----

  for (const [edgeId, edge] of Object.entries(edges)) {
    if (!nodeIds.has(edge.source)) {
      issues.push({
        severity: "error",
        code: "EDGE_BROKEN_SOURCE",
        message: `Edge "${edgeId}" has source "${edge.source}" which does not exist in the nodes registry.`,
        elementId: edgeId,
      });
    }
    if (!nodeIds.has(edge.target)) {
      issues.push({
        severity: "error",
        code: "EDGE_BROKEN_TARGET",
        message: `Edge "${edgeId}" has target "${edge.target}" which does not exist in the nodes registry.`,
        elementId: edgeId,
      });
    }
    if (edge.source === edge.target) {
      issues.push({
        severity: "warning",
        code: "EDGE_SELF_LOOP",
        message: `Edge "${edgeId}" is a self-loop (source === target = "${edge.source}").`,
        elementId: edgeId,
      });
    }
  }

  // ---- Canvas reference integrity ----

  for (const [canvasId, canvas] of Object.entries(canvases)) {
    for (const nid of canvas.graph.node_ids ?? []) {
      if (!nodeIds.has(nid)) {
        issues.push({
          severity: "error",
          code: "CANVAS_MISSING_NODE",
          message: `Canvas "${canvas.label ?? canvasId}" references node "${nid}" which does not exist.`,
          elementId: canvasId,
        });
      }
    }
    for (const eid of canvas.graph.edge_ids ?? []) {
      if (!edgeIds.has(eid)) {
        issues.push({
          severity: "error",
          code: "CANVAS_MISSING_EDGE",
          message: `Canvas "${canvas.label ?? canvasId}" references edge "${eid}" which does not exist.`,
          elementId: canvasId,
        });
      }
    }
  }

  // ---- Orphaned elements (exist globally but not in any canvas) ----

  for (const nodeId of nodeIds) {
    if (!canvasNodeIds.has(nodeId)) {
      const label = nodes[nodeId]?.label ?? nodeId;
      issues.push({
        severity: "warning",
        code: "NODE_ORPHANED",
        message: `Node "${label}" (${nodeId}) is not in any canvas and will never render or propagate.`,
        elementId: nodeId,
      });
    }
  }

  for (const edgeId of edgeIds) {
    if (!canvasEdgeIds.has(edgeId)) {
      const src = nodes[edges[edgeId]?.source ?? ""]?.label ?? edges[edgeId]?.source ?? "?";
      const tgt = nodes[edges[edgeId]?.target ?? ""]?.label ?? edges[edgeId]?.target ?? "?";
      issues.push({
        severity: "warning",
        code: "EDGE_ORPHANED",
        message: `Edge from "${src}" → "${tgt}" (${edgeId}) is not in any canvas and will not render.`,
        elementId: edgeId,
      });
    }
  }

  // ---- Duplicate node labels ----
  // Rules reference nodes by label, so duplicates cause ambiguous rule evaluation.

  const labelCounts = new Map<string, string[]>();
  for (const [nodeId, node] of Object.entries(nodes)) {
    const label = node.label?.trim();
    if (!label) continue;
    const existing = labelCounts.get(label) ?? [];
    existing.push(nodeId);
    labelCounts.set(label, existing);
  }
  for (const [label, ids] of labelCounts) {
    if (ids.length > 1) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_NODE_LABEL",
        message: `${ids.length} nodes share the label "${label}" (${ids.join(", ")}). Rules reference nodes by label — duplicates cause ambiguity.`,
      });
    }
  }

  // ---- Empty node labels ----

  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node.label?.trim()) {
      issues.push({
        severity: "warning",
        code: "NODE_EMPTY_LABEL",
        message: `Node "${nodeId}" has no label. It will not be referenceable in rules.`,
        elementId: nodeId,
      });
    }
  }

  // ---- Unknown categories on nodes ----

  if (knownCategoryNames.size > 0) {
    for (const [nodeId, node] of Object.entries(nodes)) {
      for (const cat of node.node_categories ?? []) {
        if (!knownCategoryNames.has(cat)) {
          const label = node.label ?? nodeId;
          issues.push({
            severity: "warning",
            code: "NODE_UNKNOWN_CATEGORY",
            message: `Node "${label}" has category "${cat}" which is not defined in config.categories.`,
            elementId: nodeId,
          });
        }
      }
    }
  }

  // ---- Unknown event IDs in vulnerability_levels ----

  if (knownEventIds.size > 0) {
    for (const [nodeId, node] of Object.entries(nodes)) {
      for (const evtId of Object.keys(node.vulnerability_levels ?? {})) {
        if (!knownEventIds.has(evtId)) {
          const label = node.label ?? nodeId;
          issues.push({
            severity: "warning",
            code: "NODE_UNKNOWN_EVENT",
            message: `Node "${label}" has vulnerability_levels entry for event "${evtId}" which is not in config.events.`,
            elementId: nodeId,
          });
        }
      }
    }
    for (const [edgeId, edge] of Object.entries(edges)) {
      for (const evtId of Object.keys(edge.vulnerability_levels ?? {})) {
        if (!knownEventIds.has(evtId)) {
          issues.push({
            severity: "warning",
            code: "EDGE_UNKNOWN_EVENT",
            message: `Edge "${edgeId}" has vulnerability_levels entry for event "${evtId}" which is not in config.events.`,
            elementId: edgeId,
          });
        }
      }
    }
  }

  // Errors before warnings, stable order within each group.
  return issues.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === "error" ? -1 : 1;
  });
}
