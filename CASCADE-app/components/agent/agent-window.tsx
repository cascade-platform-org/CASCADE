"use client";

/**
 * The Agent window (ADR-0024): where the person sees what an agent did and
 * decides what it proposed. Each Proposal shows the same before → after
 * preview as LLM Design, checked against the model as it is now, with a tick
 * per change; Apply writes the ticked ones as one undo step, Reject tells the
 * agent no (and why, if the person says). The agent only ever reads the outcome.
 */

import { useMemo, useState } from "react";
import { Bot, Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloatingWindow } from "@/components/ui/floating-window";
import { SmallButton, inputCls } from "@/components/temporal/fields";
import { PreviewList } from "@/components/model-text/preview-list";
import { BridgePanel } from "@/components/agent/bridge-panel";
import { useUiStore } from "@/store/ui-store";
import { useAgentStore, type Proposal } from "@/store/agent-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { AGENT_ANCHOR_ID } from "@/lib/ui-anchors";
import { checkDesignText } from "@/lib/llm-design-check";
import { applyProposal } from "@/lib/agent-host";
import { currentBundle } from "@/lib/project-bundle";

const USAGE = "Agent: what an agent did in this project, and the changes it proposes for you to apply";

export function AgentControl({ buttonClassName }: { buttonClassName: string }) {
  const open = useUiStore((s) => s.agentOpen);
  const toggle = useUiStore((s) => s.toggleAgent);
  const close = useUiStore((s) => s.closeAgent);
  const pending = useAgentStore((s) => s.proposals.filter((p) => p.status === "pending").length);
  const paired = useAgentStore((s) => s.bridge.status === "paired");
  return (
    <>
      <button id={AGENT_ANCHOR_ID} type="button" onClick={toggle} title={USAGE} className={buttonClassName}>
        <span className="relative">
          <Bot size={15} className={paired ? "text-success" : undefined} />
          {pending > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-accent px-1 text-[9px] font-semibold leading-3 text-white">{pending}</span>}
        </span>
        <span className="hidden text-xs sm:inline">Agent</span>
      </button>
      <FloatingWindow
        open={open}
        onClose={close}
        title="Agent"
        icon={<Bot size={15} className="shrink-0 text-blue-600 dark:text-blue-400" />}
        flyToOnClose={AGENT_ANCHOR_ID}
        storageKey="cascade.agent.window"
        defaultSize={{ w: 760, h: 620 }}
        minSize={{ w: 480, h: 360 }}
      >
        <AgentPanel />
      </FloatingWindow>
    </>
  );
}

function AgentPanel() {
  const proposals = useAgentStore((s) => s.proposals);
  const activity = useAgentStore((s) => s.activity);
  const pending = proposals.filter((p) => p.status === "pending");
  const settled = proposals.filter((p) => p.status !== "pending").slice(-10).reverse();

  return (
    <div className="flex h-full flex-col overflow-y-auto text-xs text-zinc-700 dark:text-zinc-200">
      <BridgePanel />
      <section className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Proposals waiting for you ({pending.length})</h3>
        {pending.length === 0 && <p className="text-zinc-500">Nothing to review. An agent never changes the model itself: what it wants to change waits here for you.</p>}
        {pending.map((p) => <ProposalCard key={p.id} proposal={p} />)}
        {settled.length > 0 && (
          <div className="mt-2 flex flex-col gap-0.5 text-[11px] text-zinc-500">
            {settled.map((p) => (
              <p key={p.id}>
                {p.status === "applied" ? "✓ Applied" : "✗ Rejected"} {p.id}{p.notes ? ` — ${p.notes}` : ""}
                {p.status === "applied" && p.leftOut.length > 0 ? ` (${p.leftOut.length} left out)` : ""}
                {p.reason ? ` — “${p.reason}”` : ""}
              </p>
            ))}
          </div>
        )}
      </section>
      <section className="px-3 py-2">
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">What the agent did</h3>
        {activity.length === 0 && <p className="text-zinc-500">Nothing yet this session.</p>}
        <div className="flex flex-col gap-0.5 font-mono text-[11px]">
          {[...activity].reverse().slice(0, 60).map((a, i) => (
            <p key={i} className="truncate" title={a.summary}>
              <span className="text-zinc-400">{new Date(a.at).toLocaleTimeString()}</span> <span className="text-blue-700 dark:text-blue-400">{a.tool}</span> {a.summary}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [leaveOut, setLeaveOut] = useState<ReadonlySet<number>>(new Set());
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const running = useTemporalSimulationStore((s) => s.running);
  // Re-checked whenever the model changes, so the preview is always against what Apply would write to.
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const config = useConfigStore((s) => s.config);
  const result = useMemo(
    () => checkDesignText(currentBundle(), { bulk: true, leaveOut }, proposal.text, "agent"),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the stores read inside currentBundle()
    [proposal.text, leaveOut, nodes, edges, config],
  );
  const toggle = (i: number) => setLeaveOut((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  function apply() {
    const why = applyProposal(proposal, leaveOut);
    setError(why);
    if (!why) useUiStore.getState().pushToast({ message: "Proposal applied. Ctrl+Z undoes it as one step.", variant: "success", durationMs: 3000 });
  }

  return (
    <div className="mb-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-medium">{proposal.id}</span>
        <span className="text-[11px] text-zinc-400">{new Date(proposal.createdAt).toLocaleTimeString()}</span>
        <span className="flex-1" />
        <SmallButton onClick={() => setRejecting((v) => !v)}><X size={12} /> Reject</SmallButton>
        <span data-run-locked>
          <SmallButton tone="accent" disabled={!result.checked.ok || running} onClick={apply} title="Write the ticked changes; Ctrl+Z undoes them as one step">
            <Check size={12} /> Apply
          </SmallButton>
        </span>
      </div>
      {result.checked.ok ? (
        <>
          <PreviewList
            preview={result.checked.preview}
            groups={result.groups}
            notes={result.notes}
            leaveOut={leaveOut}
            onToggle={result.groups && result.groups.filter((g) => g.index !== undefined).length > 1 ? toggle : undefined}
          />
          {result.checked.warnings.map((w, i) => <p key={i} className="mt-1 flex gap-1 text-[11px] text-amber-800 dark:text-amber-300"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{w}</p>)}
          <p className="mt-1 text-[11px] text-zinc-500">What it adds is marked unconfirmed, with the agent&apos;s reason, until you confirm it.</p>
        </>
      ) : (
        <div className="rounded bg-danger-soft p-1.5 text-[11px] text-danger dark:bg-red-900/20">
          No longer applies to the model as it is now:
          {result.checked.errors.slice(0, 10).map((e, i) => <p key={i} className="break-all">• {e}</p>)}
        </div>
      )}
      {error && <p className="mt-1 whitespace-pre-wrap text-[11px] text-danger">{error}</p>}
      {rejecting && (
        <div className={cn("mt-1.5 flex gap-1")}>
          <input className={inputCls} placeholder="Why not? (optional, the agent reads it)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <SmallButton tone="danger" onClick={() => useAgentStore.getState().settleProposal(proposal.id, { status: "rejected", reason: reason.trim() || undefined })}>Reject</SmallButton>
        </div>
      )}
    </div>
  );
}
