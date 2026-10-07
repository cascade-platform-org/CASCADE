"use client";

import { useMemo } from "react";
import { useConfigStore } from "@/store/config-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { levelPaint } from "@/lib/level-mode";
import { periodState } from "@/lib/step-operator";

/**
 * Level Mode's colours and legend for the period the Run View shows, or null
 * when Level Mode is off (ADR-0019 §6). The change is read against the state
 * the period started from: the previous period's end, or the run's start.
 */
export function useLevelPaint() {
  const display = useTemporalSimulationStore((s) => s.display);
  const reading = useTemporalSimulationStore((s) => s.levelReading);
  const shown = useTemporalSimulationStore((s) => s.shown);
  const record = useTemporalSimulationStore((s) => s.runRecord);
  const selected = useTemporalSimulationStore((s) => s.selectedPeriod);
  const scale = useConfigStore((s) => s.config.level_scale);
  return useMemo(() => {
    if (display !== "level" || !shown || !record) return null;
    const before = selected > 1 ? periodState(record, selected - 1) : record.start;
    return levelPaint(shown, before, scale, reading);
  }, [display, reading, shown, record, selected, scale]);
}
