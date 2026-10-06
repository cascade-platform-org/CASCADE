"use client";

/**
 * config-modal/index.tsx — ConfigModal shell.
 *
 * Manages the draft lifecycle (openDraft / commitDraft / discardDraft),
 * renders the tab bar and routes to the five tab components.
 * The tab components own all domain-specific state; this file is a thin router.
 */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "./primitives";
import { useShallow } from "zustand/react/shallow";
import { useConfigStore } from "@/store/config-store";
import { operationProblems } from "./attribute-operations-editor";
import { useUiStore } from "@/store/ui-store";
import type { ConfigModalTab } from "@/store/ui-store";
import { TabFunctionalityScale } from "./tab-functionality-scale";
import { TabCategories } from "./tab-categories";
import { TabEvents } from "./tab-events";
import { TabGraphTypes } from "./tab-graph-types";
import { TabNodeDefaults } from "./tab-node-defaults";

const TABS: { id: ConfigModalTab; label: string }[] = [
  { id: "functionality-scale", label: "Functionality Scale" },
  { id: "categories",          label: "Categories" },
  { id: "events",              label: "Events" },
  { id: "graph-types",         label: "Graph Types" },
  { id: "node-defaults",       label: "Node Defaults" },
];

export function ConfigModal() {
  const tab = useUiStore((s) => s.configModalTab);
  const setTab = useUiStore((s) => s.setConfigModalTab);
  const closeConfigModal = useUiStore((s) => s.closeConfigModal);

  const isDirty = useConfigStore((s) => s.isDirty);
  const openDraft = useConfigStore((s) => s.openDraft);
  const addEvent = useConfigStore((s) => s.addEvent);
  const setFocusEventId = useUiStore((s) => s.setConfigModalFocusEventId);
  /** The Event `configModalNewEvent` added to this draft. */
  const newEventId = useRef<string | null>(null);
  const commitDraft = useConfigStore((s) => s.commitDraft);
  const discardDraft = useConfigStore((s) => s.discardDraft);

  useEffect(() => {
    openDraft();
    // Acted on here, after the draft exists: a child tab's effect would run
    // first and write into the draft openDraft is about to replace.
    const request = useUiStore.getState().configModalNewEvent;
    if (request) {
      newEventId.current = addEvent(request.template);
      setFocusEventId(newEventId.current);
    }
  }, [openDraft, addEvent, setFocusEventId]);

  // Tracks whether a mouse press STARTED on the backdrop itself. A bare
  // `e.target === e.currentTarget` check on the click handler is not enough:
  // a DOM `click` fires on the nearest common ancestor of the mousedown and
  // mouseup targets, so interacting with a native <select> (the category-type
  // dropdown) and releasing over an option makes the click resolve to the
  // backdrop — silently closing the modal. Requiring the press to have begun
  // on the backdrop as well means only a genuine backdrop click closes it.
  const pressStartedOnBackdrop = useRef(false);
  // Shown once a Save was refused, and recomputed as the rows are fixed.
  const [saveTried, setSaveTried] = useState(false);
  const problems = useConfigStore(useShallow((s) => operationProblems(s.draft.events)));

  function handleClose() {
    if (isDirty) {
      if (!window.confirm("Unsaved changes — discard?")) return;
    }
    discardDraft();
    closeConfigModal();
  }

  function handleSave() {
    // The configuration travels with every Propagation request and the backend
    // validates it, so a half-written Attribute Operation would fail them all.
    if (problems.length > 0) {
      setSaveTried(true);
      return;
    }
    commitDraft();
    // The new Event may have been deleted before Save; report only a saved one.
    const id = newEventId.current;
    if (id && useConfigStore.getState().config.events.some((e) => e.id === id)) {
      useUiStore.getState().configModalNewEvent?.onSaved(id);
    }
    closeConfigModal();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressStartedOnBackdrop.current) handleClose();
      }}
    >
      <div className="flex h-[80vh] w-[720px] max-w-[95vw] flex-col rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Model Configuration
          </h2>
          <div className="flex items-center gap-2">
            {isDirty && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                unsaved
              </span>
            )}
            <button
              onClick={handleClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 gap-0 border-b border-zinc-100 px-4 dark:border-zinc-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
                tab === t.id
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "functionality-scale" && <TabFunctionalityScale />}
          {tab === "categories" && <TabCategories />}
          {tab === "events" && <TabEvents />}
          {tab === "graph-types" && <TabGraphTypes />}
          {tab === "node-defaults" && <TabNodeDefaults />}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          {saveTried && problems.length > 0 && (
            <p className="mr-auto text-xs text-red-600 dark:text-red-400">
              Fix before saving — {problems.slice(0, 2).join("; ")}{problems.length > 2 ? "; …" : ""}
            </p>
          )}
          <button
            onClick={handleClose}
            className="rounded px-4 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded bg-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
