"use client";

/**
 * TourPrompt — the one-time "new here?" offer, shown bottom-left over the canvas.
 *
 * Taking the tour loads the worked example the tour is written against
 * (IJDRR_example.json), because the steps name its nodes and its Earthquake
 * hazard. That replaces whatever is loaded, so the prompt says so and only
 * appears on a first run, never over work in progress.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { startTour } from "@/lib/tour/start-tour";

export function TourPrompt({ onDismiss }: { onDismiss: () => void }) {
  const [loading, setLoading] = useState(false);

  async function takeTour() {
    setLoading(true);
    await startTour("first-run");
    setLoading(false);
  }

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-30 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-1.5 top-1.5 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700"
      >
        <X size={13} />
      </button>

      <p className="pr-5 text-sm font-medium text-zinc-800 dark:text-zinc-100">
        New here?
      </p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        A one-minute tour breaks a small example network and follows the failure
        through it. It loads that example, replacing what is open.
      </p>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={takeTour}
          disabled={loading}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Take the tour"}
        </button>
        <button
          onClick={onDismiss}
          className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
