"use client";

import { useState } from "react";
import { MousePointer2, Plus, Spline, Hand, ArrowLeftRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore, type ActiveTool } from "@/store/ui-store";
import { useNetworkStore } from "@/store/network-store";
import { useConfigStore } from "@/store/config-store";
import { useShallow } from "zustand/react/shallow";

const TOOLS: { tool: ActiveTool; icon: React.ReactNode; title: string; key: string }[] = [
  { tool: "select",            icon: <MousePointer2 size={16} />, title: "Select",              key: "V" },
  { tool: "add-node",          icon: <Plus size={16} />,          title: "Add Node",             key: "N" },
  { tool: "add-edge",          icon: <Spline size={16} />,        title: "Add Edge",             key: "E" },
  { tool: "pan",               icon: <Hand size={16} />,          title: "Pan",                  key: "H" },
  { tool: "inter-canvas-edge", icon: <ArrowLeftRight size={16} />, title: "Inter-Canvas Edge",   key: "" },
];

export function Toolbox() {
  const activeTool = useUiStore((s) => s.activeTool);
  const setActiveTool = useUiStore((s) => s.setActiveTool);
  const selectedNodeTemplate = useUiStore((s) => s.selectedNodeTemplate);
  const setSelectedNodeTemplate = useUiStore((s) => s.setSelectedNodeTemplate);
  const openInterCanvasEdgeDialog = useUiStore((s) => s.openInterCanvasEdgeDialog);
  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const nodeDefaults = useConfigStore(useShallow((s) => s.config.node_defaults ?? {}));
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);

  const templateNames = Object.keys(nodeDefaults);

  function handleClick(tool: ActiveTool) {
    if (tool === "inter-canvas-edge") {
      const firstSelected = [...selectedNodeIds][0];
      openInterCanvasEdgeDialog(firstSelected);
    } else {
      setActiveTool(tool);
    }
  }

  return (
    <div className="relative flex w-12 shrink-0 flex-col items-center gap-1 border-r border-zinc-200 bg-white py-2 dark:border-zinc-800 dark:bg-zinc-900">
      {TOOLS.map(({ tool, icon, title, key }) => {
        const isAddNode = tool === "add-node";
        return (
          <div
            key={tool}
            // Anchors for the build-a-model tour, which rings these three.
            data-tour={
              tool === "add-node"
                ? "tool-add-node"
                : tool === "add-edge"
                ? "tool-add-edge"
                : tool === "inter-canvas-edge"
                ? "tool-inter-canvas-edge"
                : undefined
            }
            className="relative"
            onMouseEnter={() => { if (isAddNode) setTemplatePopoverOpen(true); }}
            onMouseLeave={() => { if (isAddNode) setTemplatePopoverOpen(false); }}
          >
            <button
              title={key ? `${title} (${key})` : title}
              onClick={() => handleClick(tool)}
              className={cn(
                "relative flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                activeTool === tool && tool !== "inter-canvas-edge"
                  ? "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400"
                  : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300",
              )}
            >
              {icon}
              {/* Dot indicator when a non-default template is selected */}
              {isAddNode && selectedNodeTemplate && (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
              )}
            </button>

            {/* Template popover — no gap so the cursor doesn't leave the hover zone */}
            {isAddNode && templatePopoverOpen && (
              <div className="absolute left-full top-0 z-50 w-44 pl-1">
              <div className="rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                <p className="px-3 pb-1 pt-1.5 text-xs font-semibold text-zinc-400">
                  Node template
                </p>
                <p className="px-3 pb-2 text-xs text-zinc-400 italic">
                  Click canvas to place
                </p>
                <div className="border-t border-zinc-100 dark:border-zinc-800" />

                {/* Blank (default) */}
                <button
                  onClick={() => { setSelectedNodeTemplate(null); setActiveTool("add-node"); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  {selectedNodeTemplate === null && <Check size={11} className="text-blue-500" />}
                  <span className={cn("flex-1", selectedNodeTemplate === null ? "font-medium text-zinc-700 dark:text-zinc-200" : "text-zinc-500")}>
                    Blank node
                  </span>
                </button>

                {/* User templates */}
                {templateNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => { setSelectedNodeTemplate(name); setActiveTool("add-node"); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    {selectedNodeTemplate === name && <Check size={11} className="text-blue-500" />}
                    <span className={cn("flex-1 truncate", selectedNodeTemplate === name ? "font-medium text-zinc-700 dark:text-zinc-200" : "text-zinc-500")}>
                      {name}
                    </span>
                  </button>
                ))}

                {templateNames.length === 0 && (
                  <p className="px-3 py-1.5 text-xs text-zinc-400 italic">
                    No templates — add in Config → Node Defaults
                  </p>
                )}
              </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
