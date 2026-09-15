"use client";

/**
 * GuidedTour — runs the first-run tour over the real editor UI.
 *
 * Mounted permanently in EditorShell and inert until `ui-store.activeTour` is
 * set; `startTour()` closes any open panel first so nothing covers a target.
 *
 * Written by hand rather than with a tour library on purpose. Every library of
 * this kind (driver.js, shepherd, intro.js) dims the page and makes everything
 * outside the spotlight inert — both wrong here. The user has to *read* the
 * network while the tour talks about it, and has to *click* real controls,
 * several of which sit outside whatever the current step highlights. So this
 * draws two things and blocks nothing: a ring around the target and a card
 * beside it.
 *
 * Gating: a step with `waitFor` arms itself when it appears (capturing the
 * state it found), subscribes to the stores, and advances the moment its
 * predicate turns true — the tour follows the user's clicks. `Next` is always
 * there, so a step nobody can satisfy stays skippable.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { useNetworkStore } from "@/store/network-store";
import { useHistoryStore } from "@/store/history-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useAnalysisStore } from "@/store/analysis-store";
import { missingTourAnchors, type TourStep } from "@/lib/tour/types";
import { TOURS, type TourId } from "@/lib/tour/registry";
import { startTour } from "@/lib/tour/start-tour";

/** Any store a `waitFor` predicate might read. */
const WATCHED = [
  useNetworkStore,
  useHistoryStore,
  useUiStore,
  useCanvasStore,
  useConfigStore,
  useAnalysisStore,
];

type Side = NonNullable<TourStep["side"]>;

const CARD_WIDTH = 320;
/** Distance between the target's ring and the card. */
const GAP = 14;
/** Smallest allowed distance between the card and the viewport edge. */
const MARGIN = 10;
/** Let the click that satisfied a step finish before moving on. */
const ADVANCE_DELAY_MS = 400;

const OPPOSITE: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

function targetOf(step: TourStep): HTMLElement | null {
  return (
    step.resolve?.() ??
    (step.anchor
      ? document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`)
      : null)
  );
}

/**
 * Put the card on the requested side of the target, falling back to any side
 * where it fits whole, then clamping into the viewport. A step whose target is
 * gone (a closed panel, a renamed anchor) gets a centred card rather than
 * being dropped, so the narrative survives.
 */
function place(
  target: DOMRect | null,
  side: Side,
  w: number,
  h: number,
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (v: number, max: number) => Math.max(MARGIN, Math.min(v, max - MARGIN));

  // Centred — but clamped like every other branch. A card taller than the
  // viewport (a long step on a laptop, or browser zoom above 100 %) would
  // otherwise take a negative top and lose its title off the top of the screen,
  // with nothing to scroll.
  if (!target) {
    return { left: clamp((vw - w) / 2, vw - w), top: clamp((vh - h) / 2, vh - h) };
  }

  const fits: Record<Side, boolean> = {
    top: target.top - GAP - h >= MARGIN,
    bottom: target.bottom + GAP + h <= vh - MARGIN,
    left: target.left - GAP - w >= MARGIN,
    right: target.right + GAP + w <= vw - MARGIN,
  };
  const order: Side[] = [side, OPPOSITE[side], "bottom", "top", "right", "left"];
  const chosen = order.find((s) => fits[s]);

  // Nothing fits beside it — the target is most of the viewport (the canvas).
  // Sit in its bottom-left corner instead: inside a target that big is out of
  // the way, where clamping to an edge would cover the Inspector.
  if (!chosen) {
    return {
      left: clamp(target.left + GAP, vw - w),
      top: clamp(target.bottom - h - GAP, vh - h),
    };
  }

  if (chosen === "top" || chosen === "bottom") {
    const top = chosen === "top" ? target.top - GAP - h : target.bottom + GAP;
    // Aligned to the target's left edge, which reads better than centring on a
    // wide target like the action bar.
    return { left: clamp(target.left, vw - w), top: clamp(top, vh - h) };
  }
  const left = chosen === "left" ? target.left - GAP - w : target.right + GAP;
  return { left: clamp(left, vw - w), top: clamp(target.top, vh - h) };
}

/**
 * Mounted always, renders only while a tour is active. The runner is keyed on
 * the tour id so each run remounts at step 0 — no effect resetting state.
 */
export function GuidedTour() {
  const activeTour = useUiStore((s) => s.activeTour);
  if (!activeTour || !(activeTour in TOURS)) return null;
  return <TourRunner key={activeTour} tourId={activeTour} />;
}

function TourRunner({ tourId }: { tourId: string }) {
  const { steps } = TOURS[tourId as TourId];
  const endTour = useUiStore((s) => s.endTour);

  const [index, setIndex] = useState(0);
  /** What the ring is drawn around. */
  const [rect, setRect] = useState<DOMRect | null>(null);
  /** What the card is positioned against — the ringed target unless the step
   *  names a `cardAnchor` because the target opens a panel under itself. */
  const [cardRect, setCardRect] = useState<DOMRect | null>(null);
  const [size, setSize] = useState({ w: CARD_WIDTH, h: 180 });
  const cardRef = useRef<HTMLDivElement>(null);

  const step: TourStep | undefined = steps[index];
  const isLast = index === steps.length - 1;

  const close = useCallback(() => endTour(), [endTour]);
  const next = useCallback(() => {
    setIndex((i) => (i >= steps.length - 1 ? i : i + 1));
  }, [steps.length]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const missing = missingTourAnchors(steps);
    if (missing.length) {
      console.warn(
        `[tour] no element carries data-tour for: ${missing.join(", ")}. ` +
          "Those steps will render centred.",
      );
    }
  }, [steps]);

  // Follow the target. A frame loop rather than scroll/resize listeners because
  // the most-highlighted target is a node on a canvas the user can pan and zoom
  // at any moment, which fires neither event.
  useEffect(() => {
    if (!step) return;
    let frame = 0;
    let last = "";
    const describe = (r: DOMRect | null) =>
      r ? `${r.x},${r.y},${r.width},${r.height}` : "";
    const tick = () => {
      const r = targetOf(step)?.getBoundingClientRect() ?? null;
      const c = step.cardAnchor
        ? document
            .querySelector<HTMLElement>(`[data-tour="${step.cardAnchor}"]`)
            ?.getBoundingClientRect() ?? r
        : r;
      const key = `${describe(r)}|${describe(c)}`;
      if (key !== last) {
        last = key;
        setRect(r);
        setCardRect(c);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [step]);

  // Gate: arm on entry, then advance when the user does the thing.
  useEffect(() => {
    if (!step?.waitFor) return;
    const satisfied = step.waitFor();
    let timer = 0;
    const check = () => {
      if (timer || !satisfied()) return;
      timer = window.setTimeout(next, ADVANCE_DELAY_MS);
    };
    const offs = WATCHED.map((store) => store.subscribe(check));
    return () => {
      offs.forEach((off) => off());
      if (timer) window.clearTimeout(timer);
    };
  }, [step, next]);

  // Measure the card so `place()` works with its real height.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize((prev) =>
      Math.abs(prev.h - r.height) < 1 && Math.abs(prev.w - r.width) < 1
        ? prev
        : { w: r.width, h: r.height },
    );
  }, [step, cardRect]);

  if (!step || typeof document === "undefined") return null;

  const { left, top } = place(cardRect, step.side ?? "bottom", size.w, size.h);

  return createPortal(
    <>
      {/* The ring. Nothing is dimmed: the point of most steps is to look at
          what is behind them — so the ring itself has to carry the whole
          signal. It is opaque and pulses (`.tour-ring`, app/globals.css). */}
      {rect && (
        <div
          aria-hidden
          className="tour-ring pointer-events-none fixed z-[9998] rounded-lg ring-4 ring-blue-500 transition-[top,left,width,height] duration-150"
          style={{
            left: rect.left - 4,
            top: rect.top - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
        />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-label={step.title}
        className="fixed z-[9999] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-800"
        // maxHeight, not a fixed one: on a short viewport a long step scrolls
        // inside the card instead of running off the bottom with its buttons.
        style={{ left, top, width: CARD_WIDTH, maxHeight: `calc(100vh - ${MARGIN * 2}px)` }}
      >
        <button
          onClick={close}
          aria-label="End tour"
          className="absolute right-1.5 top-1.5 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700"
        >
          <X size={13} />
        </button>

        <p className="pr-5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {step.title}
        </p>
        {/* pre-line: a step may set a rule or a formula on its own line, and a
            collapsed newline would run it into the prose. */}
        <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
          {step.body}
        </p>
        {step.waitHint && (
          <p className="mt-2 text-xs italic text-blue-600 dark:text-blue-400">
            {step.waitHint}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">
            {index + 1} of {steps.length}
          </span>
          <div className="flex items-center gap-1.5">
            {index > 0 && (
              <button
                onClick={() => setIndex((i) => i - 1)}
                className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                Back
              </button>
            )}
            {/* A tour that ends where another begins says so, rather than
                leaving the user to find the next one in the Help window. */}
            {isLast && step.nextTour && step.nextTour in TOURS && (
              <button
                onClick={() => {
                  close();
                  void startTour(step.nextTour as TourId);
                }}
                className="rounded-md border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/30"
              >
                {TOURS[step.nextTour as TourId].label} →
              </button>
            )}
            <button
              onClick={isLast ? close : next}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
