"use client";

/**
 * global-map-view.tsx — placeholder for a future multi-canvas map overview.
 *
 * Currently the global view is handled by GlobalViewCanvasWithProvider (graph layout).
 * This file exists to register the captureCanvasFn so Scorecard screenshots work
 * if this component is ever activated.
 */

import { useEffect, useRef } from "react";
import { useUiStore } from "@/store/ui-store";

export function GlobalMapView() {
  const registerCaptureCanvas = useUiStore((s) => s.registerCaptureCanvas);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerCaptureCanvas(async () => {
      const mlCanvas = containerRef.current?.querySelector("canvas");
      if (!mlCanvas) return undefined;
      return mlCanvas.toDataURL("image/png");
    });
    return () => { useUiStore.setState({ captureCanvasFn: null }); };
  }, [registerCaptureCanvas]);

  return (
    <div ref={containerRef} className="flex h-full w-full items-center justify-center text-sm text-zinc-400">
      Global map view coming soon.
    </div>
  );
}
