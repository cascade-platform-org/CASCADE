"use client";

/**
 * PlaybackBar — the Propagation animation's controls (ADR-0027), over the
 * canvas while a playback session is open: play/pause, step, speed, a slider
 * with one tick per engine round, and Done.
 *
 * It also owns the session's two clocks: advancing frames while playing, and
 * ending the session when the model changes under it (the playback paints the
 * state the Propagation started from, so an edit would be painted over). Moving
 * a node is not a change of the model's state and keeps it open.
 */

import { useEffect } from "react";
import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { usePlaybackStore, PLAYBACK_SPEEDS } from "@/store/playback-store";
import { useCanvasStore } from "@/store/canvas-store";
import type { Frame } from "@/lib/propagation-playback";
import { HOP_SECONDS, PULSE_SECONDS } from "./playback-paint";
import { cn } from "@/lib/utils";

/**
 * How long a frame shows at speed 1, in ms. A flow screen lasts as long as its
 * front takes to cross (one hop-time per edge from the Sources, plus the last
 * edge), then lingers; a logical step lasts its pulse, then lingers on the change.
 */
function frameMs(frame: Frame): number {
  if (frame.phase === "converged") return 0;
  if (frame.phase === "flow") return (frame.hops + 1) * HOP_SECONDS * 1000 + 1200;
  return (PULSE_SECONDS + 0.9) * 1000;
}

/** True when `next` differs from `prev` only in where Elements are drawn. */
function onlyMoved(prev: Record<string, object>, next: Record<string, object>): boolean {
  if (Object.keys(prev).length !== Object.keys(next).length) return false;
  const strip = (el: object) => {
    const { position: _p, geo: _g, ...rest } = el as { position?: unknown; geo?: unknown };
    return JSON.stringify(rest);
  };
  for (const [id, el] of Object.entries(next)) {
    const before = prev[id];
    if (before === el) continue;
    if (!before || strip(before) !== strip(el)) return false;
  }
  return true;
}

export function PlaybackBar() {
  const session = usePlaybackStore((s) => s.session);
  const frame = usePlaybackStore((s) => s.frame);
  const playing = usePlaybackStore((s) => s.playing);
  const speed = usePlaybackStore((s) => s.speed);
  const { seek, step, setPlaying, setSpeed, end } = usePlaybackStore.getState();

  // Advance while playing.
  useEffect(() => {
    if (!session || !playing) return;
    const f = session.timeline.frames[frame];
    if (!f) return;
    const timer = window.setTimeout(step, frameMs(f) / speed);
    return () => window.clearTimeout(timer);
  }, [session, playing, frame, speed, step]);

  // End when the model changes (other than a node being moved).
  useEffect(() => {
    if (!session) return;
    return useCanvasStore.subscribe((next, prev) => {
      if (next.edges !== prev.edges && !onlyMoved(prev.edges, next.edges)) end();
      else if (next.nodes !== prev.nodes && !onlyMoved(prev.nodes, next.nodes)) end();
    });
  }, [session, end]);

  if (!session) return null;
  const { frames, roundStarts } = session.timeline;
  const last = frames.length - 1;
  const current = frames[frame];
  const rounds = roundStarts.length;
  const phase = current?.phase === "converged"
    ? "Converged"
    : `Round ${(current?.round ?? 0) + 1} / ${rounds} · ${current?.phase === "flow" ? "Flow" : "Logical"}`;
  const btn = "rounded p-1 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div
      role="region"
      aria-label="Propagation playback"
      className="absolute bottom-3 left-1/2 z-20 flex w-[min(560px,calc(100%-2rem))] -translate-x-1/2 flex-col gap-1 rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
    >
      <div className="flex items-center gap-1 text-xs">
        <button type="button" className={btn} title="Previous step" disabled={frame <= 0} onClick={() => seek(frame - 1)}>
          <SkipBack size={14} />
        </button>
        <button type="button" className={btn} title={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button type="button" className={btn} title="Next step" disabled={frame >= last} onClick={() => seek(frame + 1)}>
          <SkipForward size={14} />
        </button>
        <span className="ml-1 font-medium tabular-nums text-zinc-700 dark:text-zinc-200">{phase}</span>
        <span className="flex-1" />
        <button
          type="button"
          className="rounded px-1.5 py-0.5 tabular-nums text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          title="Playback speed"
          onClick={() => setSpeed(PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(speed) + 1) % PLAYBACK_SPEEDS.length])}
        >
          {speed}×
        </button>
        <button type="button" className={cn(btn, "flex items-center gap-1 px-1.5")} title="Close the playback: the canvas shows the result" onClick={end}>
          <X size={13} /> Done
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={last}
        value={frame}
        onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }}
        aria-label="Playback position"
        className="w-full accent-blue-600"
      />
      {/* One tick per engine round, where its frames start. */}
      <div className="relative h-3 text-[10px] text-zinc-400">
        {roundStarts.map((start, r) => (
          <button
            key={r}
            type="button"
            className="absolute -translate-x-1/2 hover:text-zinc-700 dark:hover:text-zinc-200"
            style={{ left: `${last > 0 ? (start / last) * 100 : 0}%` }}
            onClick={() => { setPlaying(false); seek(start); }}
            title={`Round ${r + 1}`}
          >
            {r + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
