"use client";

/**
 * AnonymousBanner — shown at the top of the workspace when the user is not
 * signed in. Clearly communicates what is and is not available without an
 * account so users are not surprised when they hit a gated feature.
 *
 * Anonymous (local-only) mode capabilities:
 *   ✓  Full graph editing — nodes, edges, canvases, inter-canvas edges
 *   ✓  Hazard and disservice application
 *   ✓  Topological analysis (centrality, clustering, influence)
 *   ✓  Temporal simulation
 *   ✓  Scorecard generation
 *   ✓  Local file save (download) and load (upload)
 *   ✗  Propagation — POST /api/propagate requires analyst role or above
 *   ✗  Server sync — requires can_sync permission
 *
 * The banner is dismissible for the current session (stored in component
 * state). It reappears on next page load.
 *
 * TODO: wire onSignIn to the AuthModal component.
 */

import { useState } from "react";

interface AnonymousBannerProps {
  onSignIn: () => void;
}

export function AnonymousBanner({ onSignIn }: AnonymousBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-900/50 dark:bg-amber-950/30">
      <span className="shrink-0 text-amber-500" aria-hidden>⚠</span>

      <p className="flex-1 text-sm text-amber-800 dark:text-amber-200">
        <span className="font-medium">Anonymous mode —</span>{" "}
        editing, analysis, and local file save are fully available.{" "}
        <span className="font-medium">Propagation and server sync require sign-in.</span>
      </p>

      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onSignIn}
          className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
        >
          Sign in
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="text-amber-400 hover:text-amber-700 dark:hover:text-amber-200"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
