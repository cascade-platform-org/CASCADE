/**
 * playback-store.ts — the Propagation animation (ADR-0027).
 *
 * `animate` is the on/off switch by Propagate, a preference of this browser
 * (localStorage), never part of a project. With it on, Propagate asks the
 * engine for its round record and opens a playback `session`; the canvas then
 * paints the frame the playback bar is on instead of the model's colours. The
 * model already holds the Propagation's result throughout: the session is a
 * view, so it never writes the model, and any change to the model ends it.
 */

import { create } from "zustand";
import type { PlaybackStart, Timeline } from "@/lib/propagation-playback";

const STORAGE_KEY = "cascade.animatePropagation";

function loadAnimate(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveAnimate(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* private mode or blocked storage: the switch still works for this session */
  }
}

export interface PlaybackSession {
  timeline: Timeline;
  start: PlaybackStart;
}

/** Playback speeds offered on the bar; 1 = the default pace. */
export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

interface PlaybackStore {
  animate: boolean;
  setAnimate: (on: boolean) => void;

  session: PlaybackSession | null;
  frame: number;
  playing: boolean;
  speed: PlaybackSpeed;
  /** Open a session at its first frame, playing. */
  begin: (session: PlaybackSession) => void;
  seek: (frame: number) => void;
  /** Advance one frame; stops playing at the last. */
  step: () => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  /** Close the session: the canvas shows the model again. */
  end: () => void;
}

export const usePlaybackStore = create<PlaybackStore>()((set, get) => ({
  animate: loadAnimate(),
  setAnimate(on) {
    saveAnimate(on);
    set({ animate: on });
  },

  session: null,
  frame: 0,
  playing: false,
  speed: 1,
  begin(session) {
    set({ session, frame: 0, playing: true });
  },
  seek(frame) {
    const last = (get().session?.timeline.frames.length ?? 1) - 1;
    set({ frame: Math.max(0, Math.min(last, frame)) });
  },
  step() {
    const { frame, session } = get();
    const last = (session?.timeline.frames.length ?? 1) - 1;
    if (frame >= last) set({ playing: false });
    else set({ frame: frame + 1, playing: frame + 1 < last && get().playing });
  },
  setPlaying(playing) {
    const { frame, session } = get();
    const last = (session?.timeline.frames.length ?? 1) - 1;
    // Play from the end replays from the start.
    set(playing && frame >= last ? { playing, frame: 0 } : { playing });
  },
  setSpeed(speed) {
    set({ speed });
  },
  end() {
    set({ session: null, frame: 0, playing: false });
  },
}));
