"use client";

import { useRef, useState } from "react";
import { Settings, Save, Plus, ChevronDown, Layers, X, BookMarked, Wrench, HelpCircle } from "lucide-react";
import { UserButton } from "@/components/auth/user-button";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { useCanvasStore, selectOrderedCanvases } from "@/store/canvas-store";
import { useNetworkStore } from "@/store/network-store";
import { useConfigStore } from "@/store/config-store";
import { HELP_ANCHOR_ID, SCORECARD_ANCHOR_ID } from "@/lib/ui-anchors";
import { useUiStore } from "@/store/ui-store";
import { nanoid } from "nanoid";
import type { Canvas } from "@/lib/schemas/network";
import { CANVAS_PALETTE } from "@/lib/colors";
import { brandColor } from "@/lib/brand";

// ---------------------------------------------------------------------------
// Canvas colors for + Canvas popover
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------

export function Topbar() {
  const hasUnsavedChanges = useUiStore((s) => s.hasUnsavedChanges);

  return (
    <header className="flex h-11 shrink-0 items-center border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Logo. Plain <img> rather than next/image: the static export
          (output: "export") ships no image optimizer, and keeping the mark a
          separate document lets its own prefers-color-scheme rule re-colour it
          for dark mode — the same signal Tailwind's `dark:` variant uses here.
          26px because the mark's edge-trim mask muddies below ~20px. */}
      <div className="mr-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={26} height={26} className="shrink-0" />
        <span>CASCADE</span>
      </div>

      <div className="mx-2 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

      {/* Project name */}
      <ProjectNameEditor />

      <div className="mx-2 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

      {/* Canvas tabs */}
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        <GlobalViewTab />
        <CanvasTabs />
        <AddCanvasButton />
      </div>

      {/* Right actions */}
      <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
        {/* "Help" + HelpCircle, distinct from the Active Rules panel's
            BookOpen "Manual" button, which opens the rule-grammar window. */}
        <TopbarIconButton
          label="Help"
          dataTour="help"
          id={HELP_ANCHOR_ID}
          onClick={() => useUiStore.getState().toggleUserManualPanel()}
        >
          <HelpCircle size={15} />
        </TopbarIconButton>

        <TopbarIconButton
          label="Config"
          dataTour="config"
          onClick={() => useUiStore.getState().openConfigModal()}
        >
          <Settings size={15} />
        </TopbarIconButton>

        <TopbarIconButton
          label="Scorecard"
          dataTour="scorecard"
          id={SCORECARD_ANCHOR_ID}
          onClick={() => useUiStore.getState().toggleScorecardPanel()}
        >
          <BookMarked size={15} />
        </TopbarIconButton>

        <TopbarIconButton
          label="Repair"
          dataTour="repair"
          onClick={() => useUiStore.getState().toggleInterventionPanel()}
        >
          <Wrench size={15} />
        </TopbarIconButton>

        <TopbarIconButton
          label="File"
          dataTour="file"
          onClick={() => useUiStore.getState().toggleFileIoPanel()}
        >
          <div className="relative">
            <Save size={15} />
            {hasUnsavedChanges && (
              <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-amber-400" />
            )}
          </div>
        </TopbarIconButton>

        <UserButton />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Project name inline editor
// ---------------------------------------------------------------------------

function ProjectNameEditor() {
  const projectName = useCanvasStore((s) => s.projectMeta.name);
  const setProjectMeta = useCanvasStore((s) => s.setProjectMeta);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(projectName);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    setProjectMeta({ name: trimmed || "Untitled Project" });
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-40 rounded border border-blue-500 bg-transparent px-1.5 py-0.5 text-sm font-medium text-zinc-900 focus:outline-none dark:text-zinc-100"
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      title="Click to rename"
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {projectName}
      <span className="text-xs text-zinc-400">✎</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Global view tab ("All")
// ---------------------------------------------------------------------------

function GlobalViewTab() {
  const globalViewActive = useUiStore((s) => s.globalViewActive);
  const setGlobalViewActive = useUiStore((s) => s.setGlobalViewActive);
  const globalViewLayout = useUiStore((s) => s.globalViewLayout);
  const setGlobalViewLayout = useUiStore((s) => s.setGlobalViewLayout);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  function activate() {
    setGlobalViewActive(true);
    useUiStore.getState().setActiveTool("select");
    useNetworkStore.getState().clearSelection();
    useUiStore.getState().setInspectorOpen(true);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  function closeMenu() {
    setContextMenu(null);
  }

  return (
    <div className="relative">
      <button
        data-tour="global-view"
        onClick={activate}
        onContextMenu={handleContextMenu}
        title="Global view — all canvases together (right-click for options)"
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm select-none transition-colors",
          globalViewActive
            ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50",
        )}
      >
        <Layers size={13} />
        <span>All</span>
      </button>

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} />
          <div
            className="fixed z-50 min-w-[200px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              View mode
            </p>
            <MenuItem
              onClick={() => { setGlobalViewLayout("merged"); closeMenu(); }}
              className={globalViewLayout === "merged" ? "font-semibold text-blue-600 dark:text-blue-400" : ""}
            >
              Merged (default)
            </MenuItem>
            <MenuItem
              onClick={() => { setGlobalViewLayout("grouped"); closeMenu(); }}
              className={globalViewLayout === "grouped" ? "font-semibold text-blue-600 dark:text-blue-400" : ""}
            >
              Grouped (read-only)
            </MenuItem>

          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas tabs
// ---------------------------------------------------------------------------

function CanvasTabs() {
  const canvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const activeCanvasId = useCanvasStore((s) => s.activeCanvasId);
  const setActiveCanvas = useCanvasStore((s) => s.setActiveCanvas);
  const reorderCanvases = useCanvasStore((s) => s.reorderCanvases);
  const canvasOrder = useCanvasStore((s) => s.canvasOrder);
  const setGlobalViewActive = useUiStore((s) => s.setGlobalViewActive);
  const globalViewActive = useUiStore((s) => s.globalViewActive);

  const dragSrc = useRef<string | null>(null);

  function onDragStart(id: string) {
    dragSrc.current = id;
  }

  function onDrop(targetId: string) {
    const src = dragSrc.current;
    if (!src || src === targetId) return;
    const next = [...canvasOrder];
    const from = next.indexOf(src);
    const to = next.indexOf(targetId);
    next.splice(from, 1);
    next.splice(to, 0, src);
    reorderCanvases(next);
    dragSrc.current = null;
  }

  return (
    <>
      {canvases.map((canvas) => (
        <CanvasTab
          key={canvas.id}
          canvas={canvas}
          active={!globalViewActive && canvas.id === activeCanvasId}
          onActivate={() => {
            setGlobalViewActive(false);
            setActiveCanvas(canvas.id);
            // Clear element selection and open inspector to show canvas details
            useNetworkStore.getState().clearSelection();
            useUiStore.getState().setInspectorOpen(true);
          }}
          onDragStart={() => onDragStart(canvas.id)}
          onDrop={() => onDrop(canvas.id)}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Single canvas tab
// ---------------------------------------------------------------------------

interface CanvasTabProps {
  canvas: Canvas;
  active: boolean;
  onActivate: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}

function CanvasTab({ canvas, active, onActivate, onDragStart, onDrop }: CanvasTabProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const updateCanvasMeta = useCanvasStore((s) => s.updateCanvasMeta);
  const removeCanvas = useCanvasStore((s) => s.removeCanvas);
  const canvasOrder = useCanvasStore((s) => s.canvasOrder);
  const graphTypes = useConfigStore((s) => s.config.graph_types);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(canvas.label ?? canvas.id);
  const inputRef = useRef<HTMLInputElement>(null);

  function commitRename() {
    setRenaming(false);
    if (renameVal.trim()) {
      updateCanvasMeta(canvas.id, { label: renameVal.trim() });
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  function closeMenu() {
    setContextMenu(null);
  }

  const canDelete = canvasOrder.length > 1;

  return (
    <div className="relative">
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={onActivate}
        onContextMenu={handleContextMenu}
        className={cn(
          "flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-sm select-none transition-colors",
          active
            ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50",
        )}
      >
        {/* Color dot */}
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: canvas.color ?? brandColor("neutral", 400) }}
        />

        {/* Label */}
        {renaming ? (
          <input
            ref={inputRef}
            autoFocus
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-24 bg-transparent focus:outline-none"
          />
        ) : (
          <span className="max-w-[120px] truncate">{canvas.label ?? canvas.id}</span>
        )}

      </div>

      {/* Context menu */}
      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canDelete={canDelete}
          graphTypes={graphTypes.map((g) => g.name)}
          currentGraphType={canvas.graph.graph_type}
          onRename={() => {
            closeMenu();
            setRenaming(true);
            setRenameVal(canvas.label ?? canvas.id);
            setTimeout(() => inputRef.current?.select(), 0);
          }}
          onChangeColor={(color) => {
            closeMenu();
            updateCanvasMeta(canvas.id, { color });
          }}
          onChangeGraphType={(gt) => {
            closeMenu();
            useCanvasStore.getState().setGraphType(gt, canvas.id);
          }}
          onDelete={() => {
            closeMenu();
            if (canDelete) removeCanvas(canvas.id);
          }}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas context menu
// ---------------------------------------------------------------------------

/**
 * Canvas tab colours. `CANVAS_PALETTE` is eight evenly-spaced hues at one fixed
 * lightness and chroma, generated in lib/colors.ts — so the swatches stay
 * distinguishable from each other without any of them being off-palette, and a
 * hue change in globals.css moves them with everything else. Positions, not
 * colour names: "Yellow" stops being true the moment the palette shifts.
 */
const CONTEXT_COLORS = CANVAS_PALETTE.map((value, i) => ({
  label: `Colour ${i + 1}`,
  value,
}));

interface CanvasContextMenuProps {
  x: number;
  y: number;
  canDelete: boolean;
  graphTypes: string[];
  currentGraphType: string;
  onRename: () => void;
  onChangeColor: (color: string) => void;
  onChangeGraphType: (gt: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

function CanvasContextMenu({
  x, y, canDelete, graphTypes, currentGraphType,
  onRename, onChangeColor, onChangeGraphType, onDelete, onClose,
}: CanvasContextMenuProps) {
  const [colorOpen, setColorOpen] = useState(false);
  const [gtOpen, setGtOpen] = useState(false);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div
        className="fixed z-50 min-w-[160px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
        style={{ top: y, left: x }}
      >
        <MenuItem onClick={onRename}>Rename</MenuItem>

        {/* Change color submenu */}
        <div className="relative">
          <MenuItem onClick={() => { setColorOpen((v) => !v); setGtOpen(false); }}>
            <span>Change color</span>
            <ChevronDown size={12} className={cn("ml-auto transition-transform", colorOpen && "rotate-180")} />
          </MenuItem>
          {colorOpen && (
            <div className="border-t border-zinc-100 px-2 py-2 dark:border-zinc-700">
              <div className="grid grid-cols-4 gap-1.5">
                {CONTEXT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    title={c.label}
                    onClick={() => onChangeColor(c.value)}
                    className="h-5 w-5 rounded-full border-2 border-transparent hover:border-zinc-400"
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Change graph type submenu */}
        {graphTypes.length > 0 && (
          <div className="relative">
            <MenuItem onClick={() => { setGtOpen((v) => !v); setColorOpen(false); }}>
              <span>Change graph type</span>
              <ChevronDown size={12} className={cn("ml-auto transition-transform", gtOpen && "rotate-180")} />
            </MenuItem>
            {gtOpen && (
              <div className="border-t border-zinc-100 dark:border-zinc-700">
                {graphTypes.map((gt) => (
                  <MenuItem
                    key={gt}
                    onClick={() => onChangeGraphType(gt)}
                    className={gt === currentGraphType ? "font-medium text-blue-600" : ""}
                  >
                    {gt}
                  </MenuItem>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />

        <MenuItem
          onClick={onDelete}
          disabled={!canDelete}
          className={cn(!canDelete && "cursor-not-allowed opacity-40", "text-red-600 dark:text-red-400")}
        >
          Delete canvas
        </MenuItem>
      </div>
    </>
  );
}

function MenuItem({
  onClick,
  disabled,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// + Canvas popover
// ---------------------------------------------------------------------------

function AddCanvasButton() {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(brandColor("accent", 500));
  const [graphType, setGraphType] = useState("");
  const [georeferenced, setGeoreferenced] = useState(false);
  const addCanvas = useCanvasStore((s) => s.addCanvas);
  const setActiveCanvas = useCanvasStore((s) => s.setActiveCanvas);
  const graphTypes = useConfigStore((s) => s.config.graph_types);
  const labelRef = useRef<HTMLInputElement>(null);

  function reset() {
    setLabel("");
    setColor(brandColor("accent", 500));
    setGraphType("");
    setGeoreferenced(false);
  }

  function handleOpen() {
    reset();
    setOpen(true);
    setTimeout(() => labelRef.current?.focus(), 50);
  }

  function handleClose() {
    setOpen(false);
    reset();
  }

  function handleAdd() {
    if (!label.trim()) return;
    const canvas: Canvas = {
      id: `canvas-${nanoid(8)}`,
      label: label.trim(),
      color,
      georeferenced,
      graph: {
        graph_type: graphType || graphTypes[0]?.name || "default",
        node_ids: [],
        edge_ids: [],
      },
    };
    addCanvas(canvas);
    setActiveCanvas(canvas.id);
    // Open inspector to show the new canvas details
    useNetworkStore.getState().clearSelection();
    useUiStore.getState().setInspectorOpen(true);
    handleClose();
  }

  return (
    <>
      <button
        onClick={handleOpen}
        title="Add canvas"
        data-tour="add-canvas"
        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
      >
        <Plus size={14} />
        <span>Canvas</span>
      </button>

      {/* Full-screen modal — same pattern as ConfigModal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div className="my-auto w-[400px] max-w-full rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">New Canvas</h2>
              <button
                onClick={handleClose}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-5 px-6 py-5">
              {/* Name */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Name
                </label>
                <input
                  ref={labelRef}
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
                    if (e.key === "Escape") handleClose();
                  }}
                  placeholder="e.g. Water Distribution"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>

              {/* Color */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Color
                </label>
                <div className="flex flex-wrap gap-2">
                  {CANVAS_PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={cn(
                        "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                        color === c
                          ? "scale-110 border-zinc-900 dark:border-white"
                          : "border-transparent",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Graph type */}
              {graphTypes.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Graph type
                  </label>
                  <select
                    value={graphType || graphTypes[0]?.name}
                    onChange={(e) => setGraphType(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    {graphTypes.map((gt) => (
                      <option key={gt.name} value={gt.name}>{gt.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Georeferenced toggle */}
              <label className="flex cursor-pointer items-center gap-3">
                <div
                  role="checkbox"
                  aria-checked={georeferenced}
                  onClick={() => setGeoreferenced((v) => !v)}
                  className={cn(
                    "relative h-5 w-9 rounded-full transition-colors",
                    georeferenced ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-600",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                      georeferenced ? "translate-x-4" : "translate-x-0.5",
                    )}
                  />
                </div>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">Georeferenced</span>
              </label>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
              <button
                onClick={handleClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!label.trim()}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors",
                  label.trim()
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700",
                )}
              >
                Create Canvas
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Generic icon button
// ---------------------------------------------------------------------------

function TopbarIconButton({
  label,
  onClick,
  children,
  dataTour,
  id,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  /** Stable anchor id for the guided tour (see lib/tour/first-run-tour.ts). */
  dataTour?: string;
  /** DOM id a floating window flies back into on close (lib/ui-anchors.ts). */
  id?: string;
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      title={label}
      data-tour={dataTour}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
    >
      {children}
      <span className="hidden text-xs sm:inline">{label}</span>
    </button>
  );
}
