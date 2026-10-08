/**
 * end-run-cue.ts — point at End run when something a shown run blocks is used.
 *
 * While a Temporal Simulation run is shown the model, the definition and the
 * list of Simulations are read-only, so their controls are disabled. A disabled
 * control gets no click, so the person would see nothing happen. Instead, using
 * one (any control inside an element marked `data-run-locked`) or a refusal in
 * the stores (`modelLocked`, the Simulation store's writers) raises
 * `endRunCue`, and every End run button pulses for a moment, scrolled into view.
 */

import { useEffect, useRef, useState } from "react";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";

const CUE_MS = 1600;

/** Whether End run is being pointed at; scrolls `ref` into view on each cue. */
export function useEndRunCue<T extends HTMLElement>(): { cued: boolean; ref: React.RefObject<T | null> } {
  const cue = useTemporalSimulationStore((s) => s.endRunCue);
  const [cued, setCued] = useState(false);
  const ref = useRef<T>(null);
  const first = useRef(cue);
  useEffect(() => {
    if (cue === first.current) return;
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setCued(true);
    const t = setTimeout(() => setCued(false), CUE_MS);
    return () => clearTimeout(t);
  }, [cue]);
  return { cued, ref };
}

/** Pulse ring around a cued End run button. */
export const CUE_CLASS = "animate-pulse rounded ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-zinc-900";

/**
 * Listens, while a run is shown, for a press on a disabled control inside
 * `[data-run-locked]` and cues End run. Pointer events still reach a disabled
 * control (only click and the mouse up/down events are suppressed).
 */
export function useRunLockedPresses(): void {
  const running = useTemporalSimulationStore((s) => s.running);
  useEffect(() => {
    if (!running) return;
    const onPress = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("[data-run-locked]") && target.closest(":disabled")) useTemporalSimulationStore.getState().cueEndRun();
    };
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, [running]);
}
