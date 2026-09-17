"use client";

/**
 * FloatingWindow — a draggable, resizable, collapsible panel that floats over
 * the canvas instead of replacing it.
 *
 * Why this exists: the app's other surfaces are modal overlays, which is right
 * for a dialog you answer and dismiss. It is wrong for a tool you consult
 * *while* reading the canvas — the Analysis heatmap paints the very canvas the
 * old full-page layout covered up. A floating window keeps both on screen.
 *
 * The whole window-management problem sits behind this one interface: the
 * caller supplies a title, some header actions and a body, and gets drag,
 * eight-way resize, collapse-to-title-bar, maximize/restore, viewport
 * clamping, Escape-to-close and geometry that survives a reload.
 *
 * Performance note: during a drag or resize the geometry is written straight to
 * the DOM and React state is left alone, committing only on pointer-up. The
 * body can therefore be arbitrarily heavy (the Model-Based section is ~600
 * lines of controls) without costing anything per pointer-move.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { X, Minus, Square, Copy, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  centredGeometry,
  clampToViewport,
  resizeGeometry,
  type Geometry,
  type ResizeDir,
} from "@/lib/window-geometry";

interface FloatingWindowProps {
  open: boolean;
  title: string;
  icon?: React.ReactNode;
  /** Sits in the title bar, left of the window controls. */
  headerActions?: React.ReactNode;
  onClose: () => void;
  /**
   * DOM id of the control that reopens this window. When given, closing flies
   * the window back into it instead of blinking out — a window that vanishes
   * leaves the user hunting for the way back, one that visibly returns
   * somewhere teaches the location once. Ignored when the element is not on
   * screen, or when the user prefers reduced motion.
   */
  flyToOnClose?: string;
  /** localStorage key for remembered geometry. Omit to never persist. */
  storageKey?: string;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  children: React.ReactNode;
}

const HEADER_H = 40;

/** Fly-back duration. Drives both the CSS transition and the close timeout. */
const FLIGHT_MS = 260;

// Eight grab zones: four edges, four corners. `dir` drives the resize maths
// below — a letter present means that edge moves.
const HANDLES: { dir: ResizeDir; cls: string }[] = [
  { dir: "n", cls: "left-3 right-3 top-0 h-1.5 cursor-ns-resize" },
  { dir: "s", cls: "left-3 right-3 bottom-0 h-1.5 cursor-ns-resize" },
  { dir: "w", cls: "top-3 bottom-3 left-0 w-1.5 cursor-ew-resize" },
  { dir: "e", cls: "top-3 bottom-3 right-0 w-1.5 cursor-ew-resize" },
  { dir: "nw", cls: "left-0 top-0 h-3.5 w-3.5 cursor-nwse-resize" },
  { dir: "ne", cls: "right-0 top-0 h-3.5 w-3.5 cursor-nesw-resize" },
  { dir: "sw", cls: "left-0 bottom-0 h-3.5 w-3.5 cursor-nesw-resize" },
  { dir: "se", cls: "right-0 bottom-0 h-3.5 w-3.5 cursor-nwse-resize" },
];

/** Bind the pure clamp to the live viewport. */
const clamp = (g: Geometry): Geometry =>
  clampToViewport(g, window.innerWidth, window.innerHeight, HEADER_H);

function readStored(key: string | undefined): Geometry | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Geometry>;
    if (![p.x, p.y, p.w, p.h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return p as Geometry;
  } catch {
    return null;
  }
}

export function FloatingWindow({
  open,
  title,
  icon,
  headerActions,
  onClose,
  flyToOnClose,
  storageKey,
  defaultSize,
  minSize = { w: 420, h: 260 },
  children,
}: FloatingWindowProps) {
  // defaultSize/minSize arrive as object literals, so their identity changes on
  // every parent render. Depend on the numbers instead — otherwise the seeding
  // effect and the pointer handler would be rebuilt continuously.
  const { w: defaultW, h: defaultH } = defaultSize;
  const { w: minW, h: minH } = minSize;

  const shellRef = useRef<HTMLDivElement>(null);
  // The live geometry. Kept in a ref as well as state so a pointer session can
  // read and write it without waiting for a render.
  const [geom, setGeom] = useState<Geometry | null>(null);
  const geomRef = useRef<Geometry | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);
  /** Non-null while the window is flying back into its anchor. */
  const [flight, setFlight] = useState<CSSProperties | null>(null);

  const commit = useCallback(
    (g: Geometry) => {
      geomRef.current = g;
      setGeom(g);
      if (!storageKey) return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(g));
      } catch {
        /* private mode / blocked storage — geometry just won't be remembered */
      }
    },
    [storageKey],
  );

  // Seed geometry on first open: remembered position, else centred.
  useEffect(() => {
    if (!open || geomRef.current) return;
    const stored = readStored(storageKey);
    commit(clamp(stored ?? centredGeometry({ w: defaultW, h: defaultH }, window.innerWidth, window.innerHeight)));
  }, [open, storageKey, defaultW, defaultH, commit]);

  // A shrinking viewport must not strand the window off-screen.
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (geomRef.current) commit(clamp(geomRef.current));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, commit]);

  /**
   * Close, flying the window back into `flyToOnClose` when that control is on
   * screen. The animation is presentation only: `onClose` runs either way, and
   * immediately when there is nothing to fly to.
   */
  const requestClose = useCallback(() => {
    if (flight) return; // already on its way out
    const el = shellRef.current;
    const anchorEl = flyToOnClose ? document.getElementById(flyToOnClose) : null;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!el || !anchorEl || reducedMotion) {
      onClose();
      return;
    }

    const c = el.getBoundingClientRect();
    const a = anchorEl.getBoundingClientRect();
    setFlight({
      transform:
        `translate(${a.left + a.width / 2 - (c.left + c.width / 2)}px, ` +
        `${a.top + a.height / 2 - (c.top + c.height / 2)}px) ` +
        `scale(${Math.max(0.04, a.width / c.width)})`,
      opacity: 0,
    });
    window.setTimeout(() => {
      onClose();
      // Land the flight. Without this the transform survives the close — which
      // is invisible for a window the parent unmounts (Active Rules, the
      // Scorecard) but not for one that stays mounted and is driven by the
      // `open` prop (Temporal Jump): there the NEXT open would render the
      // window scaled into its own button at zero opacity, present in the DOM
      // and invisible on screen, and `requestClose` would refuse to run again
      // because a flight was still "in progress".
      setFlight(null);
    }, FLIGHT_MS);
  }, [flight, flyToOnClose, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A window can host editors — a rule textarea, a label field — whose own
      // Escape cancels the edit or dismisses a suggestion popup. Closing the
      // whole window out from under that would discard work the user was
      // trying to abandon one step of.
      const el = e.target as HTMLElement | null;
      if (el?.closest("input,textarea,select,[contenteditable='true']")) return;
      requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  /**
   * One pointer session, shared by dragging and resizing. `dir` is null for a
   * move. Geometry goes straight to the element's style while the pointer is
   * down, so the body never re-renders mid-gesture; state catches up on
   * pointer-up.
   */
  const beginPointerSession = useCallback(
    (e: React.PointerEvent, dir: ResizeDir | null) => {
      if (maximized || e.button !== 0) return;
      const start = geomRef.current;
      const el = shellRef.current;
      if (!start || !el) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);

      const px = e.clientX;
      const py = e.clientY;
      let next = start;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - px;
        const dy = ev.clientY - py;
        next =
          dir === null
            ? clamp({ ...start, x: start.x + dx, y: start.y + dy })
            : resizeGeometry(start, dir, dx, dy, { w: minW, h: minH });
        el.style.left = `${next.x}px`;
        el.style.top = `${next.y}px`;
        el.style.width = `${next.w}px`;
        if (!collapsed) el.style.height = `${next.h}px`;
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        commit(next);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [maximized, minW, minH, collapsed, commit],
  );

  if (!open || !geom) return null;

  const frame = maximized
    ? { left: 8, top: 8, width: window.innerWidth - 16, height: window.innerHeight - 16 }
    : { left: geom.x, top: geom.y, width: geom.w, height: collapsed ? HEADER_H : geom.h };

  return (
    <div
      ref={shellRef}
      role="dialog"
      aria-label={title}
      style={{ ...frame, ...flight, transitionDuration: `${FLIGHT_MS}ms` }}
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900",
        "origin-center transition-[transform,opacity] ease-in",
        flight && "pointer-events-none",
      )}
    >
      {/* Title bar — the drag handle. Double-click toggles maximize, the same
          gesture every desktop window manager uses. */}
      <div
        onPointerDown={(e) => {
          // Let buttons and the scope control in headerActions work normally.
          if ((e.target as HTMLElement).closest("button,select,input")) return;
          beginPointerSession(e, null);
        }}
        onDoubleClick={() => setMaximized((v) => !v)}
        style={{ height: HEADER_H }}
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-800/60",
          maximized ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        )}
      >
        {icon}
        <span className="select-none text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</span>

        <div className="ml-auto flex items-center gap-1.5">
          {headerActions}

          <div className="mx-0.5 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

          {/* Window controls follow the desktop convention: a rule to minimize,
              a single square to maximize, two stacked squares to restore down,
              a cross to close. Collapsed, the minimize button becomes a chevron
              pointing the way the body will come back. */}
          <WindowButton
            label={collapsed ? "Expand" : "Collapse to title bar"}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <ChevronDown size={14} /> : <Minus size={14} />}
          </WindowButton>

          <WindowButton
            label={maximized ? "Restore down" : "Maximize"}
            onClick={() => {
              setMaximized((v) => !v);
              setCollapsed(false);
            }}
          >
            {maximized ? <Copy size={12} /> : <Square size={12} />}
          </WindowButton>

          <WindowButton label="Close" onClick={requestClose} danger>
            <X size={14} />
          </WindowButton>
        </div>
      </div>

      {!collapsed && <div className="flex min-h-0 flex-1">{children}</div>}

      {!collapsed &&
        !maximized &&
        HANDLES.map((h) => (
          <div
            key={h.dir}
            onPointerDown={(e) => beginPointerSession(e, h.dir)}
            className={cn("absolute z-10", h.cls)}
          />
        ))}
    </div>
  );
}

function WindowButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors",
        danger
          ? "hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
          : "hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200",
      )}
    >
      {children}
    </button>
  );
}
