"use client";

/**
 * playback-paint.tsx — paints the Propagation animation's current frame
 * (ADR-0027) on a canvas, without touching the model.
 *
 * Two channels reach the nodes and edges below it:
 *   - colours, through the SnapshotColors context every node and edge already
 *     reads (the same way Level Mode and Scorecard snapshots repaint);
 *   - the rest of the frame (countdowns, flow, pulses), through `usePlayback`.
 * With no session open, both pass through: `fallback` colours (Level Mode's, or
 * null for the live canvas) and a null playback.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore, type ReactFlowState } from "@xyflow/react";
import { SnapshotColorsProvider } from "./snapshot-colors";
import { usePlaybackStore } from "@/store/playback-store";
import { useConfigStore } from "@/store/config-store";
import { useCanvasStore } from "@/store/canvas-store";
import { categoryToIcon, type LucideIcon } from "@/lib/category-icons";
import { levelColor, CATEGORY_COLORS } from "@/lib/colors";
import { fadesOn, stateAt, type Frame } from "@/lib/propagation-playback";

/** How long the flow front takes to cross one edge, at speed 1, in seconds. */
export const HOP_SECONDS = 2.8;
/** How long a logical change's pulse takes to travel its edge, at speed 1, in seconds. */
export const PULSE_SECONDS = 1.4;

export interface PlaybackView {
  frame: Frame;
  /** Changes whenever the shown frame does: what timed animations restart on. */
  frameIndex: number;
  /** Seconds per hop at the current speed: `frame.arrival` × this = when the flow gets there. */
  hopSeconds: number;
  /** Seconds a logical change's pulse takes at the current speed. */
  pulseSeconds: number;
  /** Whether any of this screen's targets is on screen in this view: if none is, nothing fades here. */
  targetsHere: boolean;
  /** Each node's countdown at this frame. */
  functionalityTime: Record<string, number>;
  /** Each node's countdown on the frame before: what a target shows until its change lands. */
  functionalityTimeBefore: Record<string, number>;
  /** What each edge carries in this frame's round. */
  flowAmount: Record<string, number>;
  /** Largest amount per Category over the run: the largest ball. */
  maxFlow: Record<string, number>;
  categoryColor: Record<string, string>;
  /** The icon the flow of each Category travels as (the one its Sources show); null = a plain ball. */
  categoryIcon: Record<string, LucideIcon | null>;
  /** The colour of each edge's layer (its Canvas), when the Canvas has one. */
  layerColor: Record<string, string>;
}

const PlaybackContext = createContext<PlaybackView | null>(null);

/** The frame being played, or null when the canvas shows the model. */
export function usePlayback(): PlaybackView | null {
  return useContext(PlaybackContext);
}

/**
 * False until `delaySeconds` have passed since `key` (the frame) last changed,
 * then true: lets a target keep its old look until its animation ends. True at
 * once for no delay.
 */
export function useArrived(delaySeconds: number, key: number): boolean {
  const [arrived, setArrived] = useState<number | null>(null);
  useEffect(() => {
    if (delaySeconds <= 0) return;
    const timer = window.setTimeout(() => setArrived(key), delaySeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [delaySeconds, key]);
  return delaySeconds <= 0 || arrived === key;
}

/** Opacity of an element the current screen does not degrade, while it shows its targets. */
export const DIMMED_OPACITY = 0.25;

/**
 * How long a target of the screen shown waits before taking its new colour, in
 * seconds: the fade comes first, the change when its animation ends — the
 * flow's balls landing on it (flow screen), or the pulse from its cause
 * arriving (logical screen). 0 for anything this screen does not change.
 */
export function changeDelay(view: PlaybackView, id: string): number {
  const { frame } = view;
  if (frame.phase === "converged" || !frame.focus.includes(id)) return 0;
  if (frame.phase === "flow") return (frame.arrival[id] ?? 0) * view.hopSeconds;
  return view.pulseSeconds;
}

/**
 * Whether `id` fades on the screen shown (lib/propagation-playback.ts
 * `fadesOn`) — only while at least one of its targets is on screen: a view
 * whose targets are on other Canvases, or panned out of sight, would
 * otherwise fade entirely.
 */
export function isDimmed(view: PlaybackView | null, id: string): boolean {
  return view !== null && view.targetsHere && fadesOn(view.frame, id);
}

/** Whether any of `ids` is a node inside the viewport (React Flow draws only those). */
function anyOnScreen(ids: readonly string[]) {
  return (s: ReactFlowState): boolean => {
    const [tx, ty, k] = s.transform;
    return ids.some((id) => {
      const node = s.nodeLookup.get(id);
      if (!node) return false;
      const { x, y } = node.internals.positionAbsolute;
      const left = x * k + tx;
      const top = y * k + ty;
      return left + (node.measured.width ?? 0) * k > 0 && top + (node.measured.height ?? 0) * k > 0 && left < s.width && top < s.height;
    });
  };
}

/** Must render inside a ReactFlowProvider: it asks React Flow what is on screen. */
export function PlaybackPaint({ fallback, children }: { fallback: Record<string, string> | null; children: ReactNode }) {
  const session = usePlaybackStore((s) => s.session);
  const frameIndex = usePlaybackStore((s) => s.frame);
  const speed = usePlaybackStore((s) => s.speed);
  const focus = session?.timeline.frames[frameIndex]?.focus;
  const selectTargetsHere = useMemo(() => anyOnScreen(focus ?? []), [focus]);
  // A boolean: re-renders only when it flips, not on every pan frame.
  const targetsHere = useStore(selectTargetsHere);
  const scale = useConfigStore((s) => s.config.functionality_scale);
  const categories = useConfigStore((s) => s.config.categories);
  const canvases = useCanvasStore((s) => s.canvases);

  const painted = useMemo(() => {
    if (!session) return null;
    const { timeline, start } = session;
    const frame = timeline.frames[frameIndex];
    if (!frame) return null;
    const state = stateAt(timeline, start, frameIndex);
    const before = frameIndex > 0 ? stateAt(timeline, start, frameIndex - 1) : start;
    const colors: Record<string, string> = {};
    for (const [id, level] of Object.entries(state.levels)) colors[id] = levelColor(scale, level);
    const categoryColor: Record<string, string> = {};
    const categoryIcon: Record<string, LucideIcon | null> = {};
    categories.forEach((c, i) => {
      categoryColor[c.name] = c.color ?? CATEGORY_COLORS[i % CATEGORY_COLORS.length];
      categoryIcon[c.name] = categoryToIcon(c.name, c.icon);
    });
    // An edge's layer is the first Canvas that lists it.
    const layerColor: Record<string, string> = {};
    for (const canvas of Object.values(canvases)) {
      if (!canvas.color) continue;
      for (const eid of canvas.graph.edge_ids) layerColor[eid] ??= canvas.color;
    }
    const view: PlaybackView = {
      frame,
      frameIndex,
      hopSeconds: HOP_SECONDS / speed,
      pulseSeconds: PULSE_SECONDS / speed,
      targetsHere,
      functionalityTime: state.functionalityTime,
      functionalityTimeBefore: before.functionalityTime,
      flowAmount: timeline.flowByRound[frame.round] ?? {},
      maxFlow: timeline.maxFlow,
      categoryColor,
      categoryIcon,
      layerColor,
    };
    return { colors, view };
  }, [session, frameIndex, speed, scale, categories, canvases, targetsHere]);

  return (
    <SnapshotColorsProvider value={painted?.colors ?? fallback}>
      <PlaybackContext.Provider value={painted?.view ?? null}>{children}</PlaybackContext.Provider>
    </SnapshotColorsProvider>
  );
}
