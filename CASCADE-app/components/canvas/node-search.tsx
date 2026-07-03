"use client";

/**
 * NodeSearch — search bar that finds nodes in the active canvas and flies to them.
 *
 * Renders inside a React Flow <Panel> at top-center.
 * Must be used as a direct child of <ReactFlow> (needs ReactFlowProvider context).
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Panel, useReactFlow } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { useCanvasStore, selectActiveCanvas } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import type { Node } from "@/lib/schemas/network";
import { levelColor } from "@/lib/colors";

// ---------------------------------------------------------------------------
// Result row
// ---------------------------------------------------------------------------

interface ResultRowProps {
  node: Node;
  highlighted: boolean;
  onSelect: (id: string) => void;
}

function ResultRow({ node, highlighted, onSelect }: ResultRowProps) {
  const scaleLevels = useConfigStore(useShallow((s) => s.config.functionality_scale));
  const nodeColor = levelColor(scaleLevels, node.functionality);

  return (
    <button
      onMouseDown={(e) => {
        // Prevent the input from losing focus before we record the click
        e.preventDefault();
        onSelect(node.id);
      }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
        highlighted
          ? "bg-blue-50 dark:bg-blue-900/30"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-700/50",
      )}
    >
      {/* Functionality colour dot */}
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: nodeColor }}
      />
      {/* Label */}
      <span className="flex-1 truncate font-medium text-zinc-800 dark:text-zinc-200">
        {node.label ?? node.id}
      </span>
      {/* Node type badge */}
      {node.node_type && (
        <span className="shrink-0 text-[10px] text-zinc-400">{node.node_type}</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// NodeSearch
// ---------------------------------------------------------------------------

interface NodeSearchProps {
  /** Override the node list. When omitted, falls back to the active canvas. */
  nodes?: Node[];
}

export function NodeSearch({ nodes: nodesProp }: NodeSearchProps = {}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { fitView } = useReactFlow();

  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const allNodes = useCanvasStore((s) => s.nodes);

  const canvasNodes = useMemo(() => {
    if (nodesProp) return nodesProp;
    if (!activeCanvas) return [];
    return activeCanvas.graph.node_ids
      .map((id) => allNodes[id])
      .filter((n): n is Node => Boolean(n));
  }, [nodesProp, activeCanvas, allNodes]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return canvasNodes
      .filter((n) => (n.label ?? n.id).toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, canvasNodes]);

  // Reset highlight when results change
  useEffect(() => { setHighlightedIdx(0); }, [results]);

  const handleSelect = useCallback(
    (nodeId: string) => {
      fitView({ nodes: [{ id: nodeId }], duration: 400, padding: 0.5, maxZoom: 1.5 });
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    },
    [fitView],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(results[highlightedIdx]?.id ?? "");
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showDropdown = open && query.trim().length > 0;

  return (
    <Panel position="top-center">
      <div className="relative w-64">
        {/* Search input */}
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/90 px-2.5 py-1.5 shadow-sm backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/90">
          <Search size={13} className="shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Small delay so ResultRow's onMouseDown fires first
              setTimeout(() => setOpen(false), 120);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search nodes…"
            className="flex-1 bg-transparent text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none dark:text-zinc-200"
          />
          {query && (
            <button
              onMouseDown={(e) => { e.preventDefault(); setQuery(""); setOpen(false); }}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <X size={11} />
            </button>
          )}
        </div>

        {/* Dropdown results */}
        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white py-0.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
          >
            {results.length > 0 ? (
              results.map((node, i) => (
                <ResultRow
                  key={node.id}
                  node={node}
                  highlighted={i === highlightedIdx}
                  onSelect={handleSelect}
                />
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-zinc-400">No nodes found</div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
