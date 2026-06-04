"use client";

/**
 * ActionBar — sits below the Topbar.
 *
 * Left zone:  [▶ Propagate] [↺ Reset] [Local/Global toggle]
 * Divider
 * Event zone: [⚡ Ev1] ... [⚡ Ev5] [More ▼] [+]
 */

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Play, RotateCcw, Plus, ChevronDown, Zap, Waves, Undo2, Redo2 } from "lucide-react";
import { nanoid } from "nanoid";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";
import {
  useConfigStore,
  selectActionBarEvents,
  selectOverflowEvents,
  selectN,
} from "@/store/config-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { useNetworkHistory } from "@/hooks/useNetworkHistory";
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { PropagationResultSchema } from "@/lib/schemas/api";
import type { EventDefinition } from "@/lib/schemas/config";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function ActionBar() {
  const scope = useUiStore((s) => s.propagationScope);
  const isPropagating = useUiStore((s) => s.isPropagating);
  const serverReachable = useUiStore((s) => s.serverReachable);
  const setPropagationScope = useUiStore((s) => s.setPropagationScope);
  const setIsPropagating = useUiStore((s) => s.setIsPropagating);
  const openConfigModal = useUiStore((s) => s.openConfigModal);
  const pushToast = useUiStore((s) => s.pushToast);

  const actionBarEvents = useConfigStore(useShallow(selectActionBarEvents));
  const overflowEvents = useConfigStore(useShallow(selectOverflowEvents));
  const n = useConfigStore(selectN);

  const { undo, redo, canUndo, canRedo } = useNetworkHistory();

  const [moreOpen, setMoreOpen] = useState(false);

  async function handlePropagate() {
    if (!serverReachable || isPropagating) return;

    const canvasState = useCanvasStore.getState();
    const config = useConfigStore.getState().config;
    const activeCanvasId = canvasState.activeCanvasId;

    let payload;
    try {
      payload = buildPropagationPayload({
        project: canvasState.toProject(),
        config,
        scope,
        activeCanvasId,
      });
    } catch (err) {
      pushToast({ message: `Cannot propagate: ${err instanceof Error ? err.message : String(err)}`, variant: "error", durationMs: 4000 });
      return;
    }

    setIsPropagating(true);
    const before = canvasState.toGraphSnapshot();

    try {
      const response = await fetch(`${API_BASE}/api/propagate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        throw new Error(`Server returned ${response.status}: ${detail}`);
      }

      const raw = await response.json();
      const result = PropagationResultSchema.parse(raw);

      canvasState.applyPropagationResult(result);

      const after = useCanvasStore.getState().toGraphSnapshot();
      useHistoryStore.getState().pushUpdateEntry({
        id: nanoid(),
        timestamp: new Date().toISOString(),
        update_type: "propagation",
        label: `Propagation (${scope})`,
        scope,
        canvas_id: activeCanvasId ?? undefined,
        before,
        after,
      });

      const count = result.updates.length;
      const warnings = result.warnings ?? [];

      if (warnings.length > 0) {
        pushToast({
          message: `Propagation complete — ${count} element${count !== 1 ? "s" : ""} updated. ⚠ ${warnings[0]}`,
          variant: "warning",
          durationMs: 5000,
        });
      } else {
        pushToast({
          message: count > 0
            ? `Propagation complete — ${count} element${count !== 1 ? "s" : ""} updated`
            : "Propagation complete — no changes",
          variant: "success",
          durationMs: 3500,
        });
      }
    } catch (err) {
      pushToast({
        message: `Propagation failed — ${err instanceof Error ? err.message : "unexpected error"}`,
        variant: "error",
        durationMs: 5000,
      });
    } finally {
      setIsPropagating(false);
    }
  }

  function handleReset() {
    const state = useCanvasStore.getState();
    const activeCanvasId = state.activeCanvasId;
    if (!activeCanvasId) return;

    // Scope-aware: local resets only the active canvas; global resets the whole registry.
    const before = state.toGraphSnapshot();

    if (scope === "local") {
      const canvas = state.canvases[activeCanvasId];
      if (!canvas) return;
      canvas.graph.node_ids.forEach((id) => {
        state.updateNode(id, { functionality: n, direct_damage: false, functionality_time: 0 });
      });
      canvas.graph.edge_ids.forEach((id) => {
        state.updateEdge(id, { functionality: n, direct_damage: false, functionality_time: 0 });
      });
    } else {
      Object.values(state.nodes).forEach((node) => {
        state.updateNode(node.id, { functionality: n, direct_damage: false, functionality_time: 0 });
      });
      Object.values(state.edges).forEach((edge) => {
        state.updateEdge(edge.id, { functionality: n, direct_damage: false, functionality_time: 0 });
      });
    }

    useHistoryStore.getState().pushUpdateEntry({
      id: nanoid(),
      timestamp: new Date().toISOString(),
      update_type: "manual_functionality_update",
      label: scope === "local" ? "Reset canvas to Functionality N" : "Reset all to Functionality N",
      scope,
      canvas_id: activeCanvasId,
      before,
      after: state.toGraphSnapshot(),
    });
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Split Propagate button — left half triggers run, right half selects scope */}
      <PropagateSplitButton
        scope={scope}
        onPropagate={handlePropagate}
        onScopeChange={setPropagationScope}
        disabled={!serverReachable || isPropagating}
        loading={isPropagating}
        serverReachable={serverReachable}
      />

      {/* Reset */}
      <ActionButton
        onClick={handleReset}
        title={scope === "local" ? "Reset active canvas elements to Functionality N" : "Reset all elements to Functionality N"}
        className="text-zinc-600 dark:text-zinc-400"
      >
        <RotateCcw size={13} />
        <span>Reset</span>
      </ActionButton>

      {/* Undo */}
      <ActionButton
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        className="text-zinc-600 dark:text-zinc-400"
      >
        <Undo2 size={13} />
      </ActionButton>

      {/* Redo */}
      <ActionButton
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        className="text-zinc-600 dark:text-zinc-400"
      >
        <Redo2 size={13} />
      </ActionButton>

      {/* Divider */}
      <div className="mx-1.5 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

      {/* Event buttons */}
      {actionBarEvents.map((ev) => (
        <EventButton key={ev.id} event={ev} />
      ))}

      {/* More ▼ */}
      {overflowEvents.length > 0 && (
        <div className="relative">
          <ActionButton
            onClick={() => setMoreOpen((v) => !v)}
            className="text-zinc-500"
          >
            <span>More</span>
            <ChevronDown size={12} className={cn("transition-transform", moreOpen && "rotate-180")} />
          </ActionButton>

          {moreOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                {overflowEvents.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => setMoreOpen(false)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    <EventIcon type={ev.type} size={13} />
                    {ev.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* + shortcut → Config Events tab */}
      <button
        onClick={() => openConfigModal("events")}
        title="Add event (opens Config)"
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Split Propagate button: [▶ Propagate] [Local/Global ▾]
// ---------------------------------------------------------------------------

function PropagateSplitButton({
  scope,
  onPropagate,
  onScopeChange,
  disabled,
  loading,
  serverReachable,
}: {
  scope: "local" | "global";
  onPropagate: () => void;
  onScopeChange: (v: "local" | "global") => void;
  disabled: boolean;
  loading: boolean;
  serverReachable: boolean;
}) {
  const [scopeOpen, setScopeOpen] = useState(false);

  const title = !serverReachable
    ? "Server unreachable — your data is safe locally"
    : `Run ${scope} propagation (Ctrl+Enter)`;

  return (
    <div className="flex items-center rounded-md border border-green-300 dark:border-green-800">
      {/* Run button */}
      <button
        onClick={disabled ? undefined : onPropagate}
        disabled={disabled}
        title={title}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-l-md px-2.5 text-xs font-medium transition-colors",
          "text-green-700 dark:text-green-400",
          disabled
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-green-50 dark:hover:bg-green-900/20",
        )}
      >
        <Play size={12} className={cn(loading && "animate-pulse")} />
        <span>{loading ? "Running…" : "Propagate"}</span>
      </button>

      {/* Divider */}
      <div className="h-5 w-px bg-green-200 dark:bg-green-800" />

      {/* Scope selector */}
      <div className="relative">
        <button
          onClick={() => setScopeOpen((v) => !v)}
          title="Switch propagation scope"
          className="flex h-7 items-center gap-1 rounded-r-md px-2 text-xs font-medium text-green-700 transition-colors hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
        >
          <span className="capitalize">{scope}</span>
          <ChevronDown size={11} className={cn("transition-transform", scopeOpen && "rotate-180")} />
        </button>

        {scopeOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setScopeOpen(false)} />
            <div className="absolute left-0 top-full z-50 mt-1 min-w-[96px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              {(["local", "global"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => { onScopeChange(v); setScopeOpen(false); }}
                  className={cn(
                    "flex w-full items-center px-3 py-1.5 text-xs capitalize transition-colors",
                    v === scope
                      ? "font-semibold text-green-700 dark:text-green-400"
                      : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700",
                  )}
                >
                  {v}
                  {v === scope && <span className="ml-auto text-green-500">✓</span>}
                </button>
              ))}
              <div className="border-t border-zinc-100 px-3 py-1.5 dark:border-zinc-700">
                <p className="text-[10px] leading-tight text-zinc-400">
                  {scope === "local"
                    ? "Active canvas only — inter-canvas edges excluded from engine payload"
                    : "Full multi-canvas — all canvases sent to engine"}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event button
// ---------------------------------------------------------------------------

function EventButton({ event }: { event: EventDefinition }) {
  const pushToast = useUiStore((s) => s.pushToast);

  function applyEvent() {
    const storeState = useCanvasStore.getState();
    const configState = useConfigStore.getState();
    const N = configState.getFunctionalityN();
    const activeCanvasId = storeState.activeCanvasId;
    if (!activeCanvasId) return;

    const before = storeState.toGraphSnapshot();

    // Apply vulnerability formula to every element that has an entry for this event.
    // imposed = N - vulnerability_level  (clamped to 1), only if it worsens.
    let affected = 0;

    Object.values(storeState.nodes).forEach((node) => {
      const vulnLevel = node.vulnerability_levels?.[event.id];
      if (vulnLevel === undefined) return;
      const imposed = Math.max(1, N - vulnLevel);
      if (imposed < node.functionality) {
        const patch: Partial<typeof node> = { functionality: imposed };
        if (event.type === "hazard") {
          patch.direct_damage = true;
          const eff = event.direct_damage_effects?.[node.id];
          if (eff) patch.expected_repair_time = eff.expected_repair_time;
        }
        // Apply attribute_mutations
        if (event.attribute_mutations) {
          Object.entries(event.attribute_mutations).forEach(([key, val]) => {
            const [elemId, field] = key.split(".");
            if (elemId === node.id && field) (patch as Record<string, unknown>)[field] = val;
          });
        }
        storeState.updateNode(node.id, patch);
        affected++;
      }
    });

    Object.values(storeState.edges).forEach((edge) => {
      const vulnLevel = edge.vulnerability_levels?.[event.id];
      if (vulnLevel === undefined) return;
      const imposed = Math.max(1, N - vulnLevel);
      if (imposed < edge.functionality) {
        const patch: Partial<typeof edge> = { functionality: imposed };
        if (event.type === "hazard") {
          patch.direct_damage = true;
          const eff = event.direct_damage_effects?.[edge.id];
          if (eff) patch.expected_repair_time = eff.expected_repair_time;
        }
        storeState.updateEdge(edge.id, patch);
        affected++;
      }
    });

    // Events always apply to the full registry regardless of the scope toggle
    // (CONTEXT.md: "Event application always writes to the global registry").
    useHistoryStore.getState().pushUpdateEntry({
      id: nanoid(),
      timestamp: new Date().toISOString(),
      update_type: "event_applied",
      label: `Apply: ${event.label}`,
      scope: "global",
      canvas_id: activeCanvasId,
      event_id: event.id,
      before,
      after: storeState.toGraphSnapshot(),
    });

    pushToast({
      message: affected > 0
        ? `${event.label} applied — ${affected} element${affected > 1 ? "s" : ""} affected`
        : `${event.label} applied — Elements with vulnerability to this event were not found or already affected`,
      variant: affected > 0 ? (event.type === "hazard" ? "error" : "warning") : "info",
      durationMs: 3500,
    });
  }

  return (
    <ActionButton
      onClick={applyEvent}
      title={`Apply: ${event.label} (Escape to clear)`}
      className={cn(
        "gap-1",
        event.type === "hazard"
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          : "text-orange-500 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20",
      )}
    >
      <EventIcon type={event.type} size={13} />
      <span className="max-w-[80px] truncate">{event.label}</span>
    </ActionButton>
  );
}

function EventIcon({ type, size }: { type: "hazard" | "disservice" | "temporal_jump"; size: number }) {
  return type === "hazard"
    ? <Zap size={size} />
    : <Waves size={size} />;
}

// ---------------------------------------------------------------------------
// Generic action button
// ---------------------------------------------------------------------------

function ActionButton({
  onClick,
  disabled,
  title,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
        "hover:bg-zinc-100 dark:hover:bg-zinc-800",
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}
