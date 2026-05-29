"use client";

import { MousePointer2, Plus, Spline, Hand, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore, type ActiveTool } from "@/store/ui-store";
import { useNetworkStore } from "@/store/network-store";

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
  const openInterCanvasEdgeDialog = useUiStore((s) => s.openInterCanvasEdgeDialog);
  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);

  function handleClick(tool: ActiveTool) {
    if (tool === "inter-canvas-edge") {
      const firstSelected = [...selectedNodeIds][0];
      openInterCanvasEdgeDialog(firstSelected);
    } else {
      setActiveTool(tool);
    }
  }

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-zinc-200 bg-white py-2 dark:border-zinc-800 dark:bg-zinc-900">
      {TOOLS.map(({ tool, icon, title, key }) => (
        <button
          key={tool}
          title={key ? `${title} (${key})` : title}
          onClick={() => handleClick(tool)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
            activeTool === tool && tool !== "inter-canvas-edge"
              ? "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400"
              : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300",
          )}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
