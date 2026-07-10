"use client";

import { useMemo, useState } from "react";
import { X, ScanSearch, Minus, ArrowUp, ArrowDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useUiStore } from "@/store/ui-store";
import { useCanvasStore, selectActiveCanvas, selectOrderedCanvases } from "@/store/canvas-store";
import { useNetworkStore } from "@/store/network-store";
import { useConfigStore } from "@/store/config-store";
import type { Node, Edge } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Attribute definitions
// ---------------------------------------------------------------------------

interface AttrDef {
  key: string;
  label: string;
  group: "standard" | "structure" | "vuln";
  /** Returns display value string if non-default, null if it IS the default. */
  extractNode: ((n: Node, N: number) => string | null) | null;
  extractEdge: ((e: Edge, N: number) => string | null) | null;
}

const STANDARD_ATTRS: AttrDef[] = [
  {
    key: "functionality",
    label: "Functionality (degraded)",
    group: "standard",
    extractNode: (n, N) => n.functionality < N ? String(n.functionality) : null,
    extractEdge: (e, N) => e.functionality < N ? String(e.functionality) : null,
  },
  {
    key: "importance",
    label: "Importance",
    group: "standard",
    extractNode: (n) => n.importance !== undefined ? String(n.importance) : null,
    extractEdge: null,
  },
  {
    key: "direct_damage",
    label: "Direct damage",
    group: "standard",
    extractNode: (n) => n.direct_damage === true ? "true" : null,
    extractEdge: (e) => e.direct_damage === true ? "true" : null,
  },
  {
    key: "expected_repair_time",
    label: "Repair time",
    group: "standard",
    extractNode: (n) => (n.expected_repair_time ?? 0) > 0 ? `${n.expected_repair_time} h` : null,
    extractEdge: (e) => (e.expected_repair_time ?? 0) > 0 ? `${e.expected_repair_time} h` : null,
  },
  {
    key: "functionality_time",
    label: "Time warning",
    group: "standard",
    extractNode: (n) => (n.functionality_time ?? 0) > 0 ? `${n.functionality_time} h` : null,
    extractEdge: (e) => (e.functionality_time ?? 0) > 0 ? `${e.functionality_time} h` : null,
  },
  {
    key: "cost_of_disservice_per_day",
    label: "Disservice cost",
    group: "standard",
    extractNode: (n) => n.cost_of_disservice_per_day !== undefined ? String(n.cost_of_disservice_per_day) : null,
    extractEdge: null,
  },
];

const STRUCTURE_ATTRS: AttrDef[] = [
  {
    key: "node_type",
    label: "Node type",
    group: "structure",
    extractNode: (n) => n.node_type ? n.node_type : null,
    extractEdge: null,
  },
  {
    key: "node_categories",
    label: "Node categories",
    group: "structure",
    extractNode: (n) => (n.node_categories?.length ?? 0) > 0 ? n.node_categories!.join(", ") : null,
    extractEdge: null,
  },
  {
    key: "rules",
    label: "Rules",
    group: "structure",
    extractNode: (n) => (n.rules?.length ?? 0) > 0 ? `${n.rules!.length} rule${n.rules!.length > 1 ? "s" : ""}` : null,
    extractEdge: (e) => (e.rules?.length ?? 0) > 0 ? `${e.rules!.length} rule${e.rules!.length > 1 ? "s" : ""}` : null,
  },
  {
    key: "properties",
    label: "Custom properties",
    group: "structure",
    extractNode: (n) => {
      const keys = Object.keys(n.properties ?? {});
      return keys.length > 0 ? keys.join(", ") : null;
    },
    extractEdge: null,
  },
];

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

interface ScanResult {
  id: string;
  label: string;
  kind: "node" | "edge";
  value: string;
}

/** Numeric-aware compare for the formatted display value: "10" sorts after
 * "2" (not before, as a plain string compare would), "6 h" sorts by 6. Falls
 * back to locale string compare once either side isn't numeric (e.g. "true",
 * a category list, a node_type name). */
function compareScanValues(a: string, b: string): number {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  const aNumeric = !Number.isNaN(na) && /^-?\d/.test(a);
  const bNumeric = !Number.isNaN(nb) && /^-?\d/.test(b);
  if (aNumeric && bNumeric) return na - nb;
  return a.localeCompare(b);
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function AttributeScanPanel() {
  const close = useUiStore((s) => s.closeAttributeScanPanel);
  const requestFocusNode = useUiStore((s) => s.requestFocusNode);
  const selectNode = useNetworkStore((s) => s.selectNode);
  const setInspectorOpen = useUiStore((s) => s.setInspectorOpen);

  const config = useConfigStore(useShallow((s) => s.config));
  const N = Math.max(...config.functionality_scale.map((l) => l.level));
  const events = config.events ?? [];
  const categories = config.categories ?? [];

  const globalViewActive = useUiStore((s) => s.globalViewActive);
  const globalViewLayout = useUiStore((s) => s.globalViewLayout);
  const isMergedView = globalViewActive && globalViewLayout === "merged";

  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const allCanvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);

  const [selectedAttr, setSelectedAttr] = useState("functionality");
  const [customAttr, setCustomAttr] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Build full attribute list including per-event vulnerabilities
  // Identity keys: memos depend on the *set* of ids/names, not array identity.
  const eventIdsKey = events.map((e) => e.id).join(",");
  const categoryNamesKey = categories.map((c) => c.name).join(",");

  const vulnAttrs: AttrDef[] = useMemo(() =>
    events.map((ev) => ({
      key: `vuln:${ev.id}`,
      label: ev.label ?? ev.id,
      group: "vuln" as const,
      extractNode: (n: Node) => {
        const v = n.vulnerability_levels?.[ev.id] ?? 0;
        return v > 0 ? String(v) : null;
      },
      extractEdge: (e: Edge) => {
        const v = e.vulnerability_levels?.[ev.id] ?? 0;
        return v > 0 ? String(v) : null;
      },
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventIdsKey],
  );

  // Per-category dependency profile entries
  const profileAttrs: AttrDef[] = useMemo(() =>
    categories.map((cat) => ({
      key: `profile:${cat.name}`,
      label: cat.name,
      group: "vuln" as const,
      extractNode: (n: Node) => {
        const p = n.category_dependency_profiles?.[cat.name];
        if (!p) return null;
        const parts: string[] = [`dep:${p.dependency_level}`];
        if (p.backup_duration !== undefined) parts.push(`backup:${p.backup_duration}h`);
        if (p.demand !== undefined) parts.push(`demand:${p.demand}`);
        if (p.priority !== undefined) parts.push(`priority:${p.priority}`);
        if (p.capacity !== undefined) parts.push(`cap:${p.capacity}`);
        return parts.join(", ");
      },
      extractEdge: null,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categoryNamesKey],
  );

  const allAttrs = useMemo(
    () => [...STANDARD_ATTRS, ...STRUCTURE_ATTRS, ...vulnAttrs, ...profileAttrs],
    [vulnAttrs, profileAttrs],
  );

  // Canvas elements — include all canvases when in merged ("all") view
  const { canvasNodes, canvasEdges, scanLabel } = useMemo(() => {
    if (isMergedView) {
      const seenNodes = new Set<string>();
      const seenEdges = new Set<string>();
      const nodes: Node[] = [];
      const edges: Edge[] = [];
      for (const c of allCanvases) {
        for (const id of c.graph.node_ids) {
          if (!seenNodes.has(id) && allNodes[id]) { seenNodes.add(id); nodes.push(allNodes[id]!); }
        }
        for (const id of c.graph.edge_ids) {
          if (!seenEdges.has(id) && allEdges[id]) { seenEdges.add(id); edges.push(allEdges[id]!); }
        }
      }
      return { canvasNodes: nodes, canvasEdges: edges, scanLabel: "all canvases" };
    }
    if (!activeCanvas) return { canvasNodes: [], canvasEdges: [], scanLabel: null };
    return {
      canvasNodes: activeCanvas.graph.node_ids.flatMap((id) => allNodes[id] ? [allNodes[id]!] : []),
      canvasEdges: activeCanvas.graph.edge_ids.flatMap((id) => allEdges[id] ? [allEdges[id]!] : []),
      scanLabel: activeCanvas.label ?? "canvas",
    };
  }, [isMergedView, activeCanvas, allCanvases, allNodes, allEdges]);

  // Scan results
  const results = useMemo((): ScanResult[] => {
    const isCustom = selectedAttr === "custom";
    const attr = isCustom ? null : allAttrs.find((a) => a.key === selectedAttr) ?? null;
    const customKey = customAttr.trim();

    const out: ScanResult[] = [];

    for (const node of canvasNodes) {
      let value: string | null = null;
      if (attr) {
        value = attr.extractNode ? attr.extractNode(node, N) : null;
      } else if (customKey) {
        const raw = (node as Record<string, unknown>)[customKey]
          ?? (node.properties as Record<string, unknown> | undefined)?.[customKey];
        value = raw !== undefined && raw !== null ? String(raw) : null;
      }
      if (value !== null) {
        out.push({ id: node.id, label: node.label ?? node.id, kind: "node", value });
      }
    }

    for (const edge of canvasEdges) {
      let value: string | null = null;
      if (attr) {
        value = attr.extractEdge ? attr.extractEdge(edge, N) : null;
      } else if (customKey) {
        const raw = (edge as Record<string, unknown>)[customKey];
        value = raw !== undefined && raw !== null ? String(raw) : null;
      }
      if (value !== null) {
        const src = allNodes[edge.source]?.label ?? edge.source;
        const tgt = allNodes[edge.target]?.label ?? edge.target;
        out.push({ id: edge.id, label: `${src} → ${tgt}`, kind: "edge", value });
      }
    }

    out.sort((a, b) => (sortDir === "asc" ? 1 : -1) * compareScanValues(a.value, b.value));
    return out;
  }, [selectedAttr, customAttr, allAttrs, canvasNodes, canvasEdges, N, allNodes, sortDir]);

  function handleSelect(result: ScanResult) {
    if (result.kind === "node") {
      selectNode(result.id);
      setInspectorOpen(true);
      requestFocusNode(result.id);
    }
  }

  const attrLabel = selectedAttr === "custom"
    ? (customAttr.trim() || "custom")
    : allAttrs.find((a) => a.key === selectedAttr)?.label ?? selectedAttr;

  // Minimised: a compact pill (same idiom as SituationWindow) — click to expand.
  // No backdrop even when expanded: this panel is meant to stay open *while*
  // looking at the canvas (clicking a result focuses/highlights the node
  // behind it), not as a blocking dialog like Config/Scorecard/Intervention.
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        title="Attribute Scan"
        className="pointer-events-auto fixed left-16 top-16 z-40 flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/95 py-1 pl-1 pr-2.5 shadow-lg backdrop-blur-sm hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/95 dark:hover:bg-zinc-900"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
          <ScanSearch size={13} />
        </span>
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Attribute Scan</span>
        {results.length > 0 && (
          <span className="rounded-full bg-zinc-100 px-1.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {results.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="pointer-events-none fixed left-16 top-16 z-40 flex max-h-[75dvh] w-full max-w-lg">
      <div className="pointer-events-auto flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <ScanSearch size={18} className="text-blue-600" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Attribute Scan</h2>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setMinimized(true)}
              title="Minimise"
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            >
              <Minus size={16} />
            </button>
            <button
              onClick={close}
              title="Close"
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="shrink-0 border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Attribute
          </label>
          <select
            value={selectedAttr}
            onChange={(e) => setSelectedAttr(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            <optgroup label="Standard">
              {STANDARD_ATTRS.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </optgroup>
            <optgroup label="Structure">
              {STRUCTURE_ATTRS.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </optgroup>
            {vulnAttrs.length > 0 && (
              <optgroup label="Vulnerabilities">
                {vulnAttrs.map((a) => (
                  <option key={a.key} value={a.key}>{a.label}</option>
                ))}
              </optgroup>
            )}
            {profileAttrs.length > 0 && (
              <optgroup label="Category dependency profiles">
                {profileAttrs.map((a) => (
                  <option key={a.key} value={a.key}>{a.label}</option>
                ))}
              </optgroup>
            )}
            <option value="custom">Custom…</option>
          </select>

          {selectedAttr === "custom" && (
            <input
              value={customAttr}
              onChange={(e) => setCustomAttr(e.target.value)}
              placeholder="attribute name (e.g. is_communicating_with_electric_operator)"
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            />
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {/* Count bar */}
          <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-6 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400">
            <span className="min-w-0 truncate">
              {results.length === 0
                ? `No elements with non-default "${attrLabel}"`
                : `${results.length} element${results.length > 1 ? "s" : ""} with non-default "${attrLabel}"`
              }
              {scanLabel && (
                <span className="ml-1 text-zinc-400 dark:text-zinc-500">— {scanLabel}</span>
              )}
            </span>
            {results.length > 1 && (
              <button
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                title={`Sort by value, ${sortDir === "asc" ? "ascending" : "descending"}`}
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              >
                Value {sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
              </button>
            )}
          </div>

          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-zinc-400">
              <ScanSearch size={28} className="opacity-40" />
              <p className="text-sm">All elements use the default value</p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => handleSelect(r)}
                    disabled={r.kind === "edge"}
                    className="flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-zinc-50 disabled:cursor-default dark:hover:bg-zinc-800/50"
                  >
                    {/* Kind badge */}
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      r.kind === "node"
                        ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}>
                      {r.kind}
                    </span>
                    {/* Label */}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {r.label}
                    </span>
                    {/* Value */}
                    <span className="shrink-0 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {r.value}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
