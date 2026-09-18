"use client";

import { useEffect } from "react";
import { initObservability } from "@/lib/observability";

/**
 * Mounted once in each root layout (site, site-it, product) so error and
 * performance reporting (lib/observability.ts) starts on every route, not
 * just the editor. Renders nothing — a synchronous setState-free effect, so
 * it needs no cleanup and no loading state.
 */
export function ObservabilityInit() {
  useEffect(() => {
    initObservability();
  }, []);

  return null;
}
