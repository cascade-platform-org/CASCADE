"use client";

/**
 * useFirstRun — has this browser been offered the guided tour yet?
 *
 * Deliberately localStorage and not the auth profile: the tour is about knowing
 * the interface, which is per-browser, and it must work for guests who have no
 * server-side profile at all. Every access is wrapped — private windows and
 * blocked site data throw on read, and a first run that cannot remember is
 * better than a crash.
 *
 * Read through `useSyncExternalStore` rather than an effect, so the value is a
 * subscription to something outside React instead of a setState during mount
 * (which is what the react-hooks lint rule is about), and SSR gets an explicit
 * "already offered" snapshot so the prompt never flashes during hydration.
 */

import { useSyncExternalStore } from "react";

const KEY = "cascade.tour.firstRun.offered";

const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True once the prompt has been shown and answered. Unreadable storage counts
 *  as offered, so a browser blocking site data is not nagged every mount. */
function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

function getServerSnapshot(): boolean {
  return true;
}

/** Record that the tour has been offered, from outside React. */
export function markTourOffered(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    /* nothing to persist to — the prompt reappears next session */
  }
  listeners.forEach((fn) => fn());
}

export function useFirstRun() {
  const offered = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // markTourOffered is a stable module-level function — no memoisation needed.
  return { shouldOffer: !offered, dismiss: markTourOffered };
}
