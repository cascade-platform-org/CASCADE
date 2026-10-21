/**
 * agent-host.ts — the agent tools' view of the open tab (ADR-0024).
 *
 * `lib/agent-tools.ts` reaches the app only through an `AgentHost`; this is the
 * one that reads the live stores. Runs capture their input once, as a Temporal
 * Simulation run does, and every engine call is the tab's own (its session,
 * its Entitlement). Writes stop at a Proposal: `applyProposal`, called by the
 * person's click in the Agent window, is the only path from an agent's text to
 * the model, through the same check and apply as LLM Design.
 */

import { useAgentStore, type Proposal } from "@/store/agent-store";
import { useNetworkStore } from "@/store/network-store";
import { useUiStore } from "@/store/ui-store";
import { useExpectationRunStore } from "@/store/expectation-run-store";
import { currentBundle } from "@/lib/project-bundle";
import { captureExpectationEnv, runProjectExpectations } from "@/lib/expectations-run";
import { checkDesignText } from "@/lib/llm-design-check";
import { applyModelBundle } from "@/lib/model-text-apply";
import { callTool, type AgentHost, type ToolOutcome } from "@/lib/agent-tools";

const liveHost: AgentHost = {
  bundle: () => currentBundle(),
  env: () => captureExpectationEnv(),
  propose: (text, notes) => {
    const p = useAgentStore.getState().addProposal({ text, notes });
    useUiStore.getState().openAgent();
    return p;
  },
  proposal: (id) => useAgentStore.getState().proposals.find((p) => p.id === id),
  runExpectations: async (ids) => {
    // The window's own run, so its results show there; one run at a time.
    if (useExpectationRunStore.getState().progress) throw new Error("Expectations are already running in the app; try again when they finish.");
    return runProjectExpectations(ids);
  },
  show: (ids) => {
    const { nodes, edges } = currentBundle().project;
    const nodeIds = ids.filter((id) => id in nodes);
    const edgeIds = ids.filter((id) => id in edges);
    useNetworkStore.getState().selectAll(nodeIds, edgeIds);
    if (nodeIds[0]) useUiStore.getState().requestFocusNode(nodeIds[0]);
    return nodeIds.length + edgeIds.length;
  },
};

/** One tool call from the agent, logged for the person to see. */
export async function runAgentTool(name: string, args: unknown): Promise<ToolOutcome> {
  const outcome = await callTool(name, args, liveHost);
  const first = (outcome.ok ? outcome.text : `refused: ${outcome.error}`).split("\n")[0].slice(0, 160);
  useAgentStore.getState().log(name, first);
  return outcome;
}

/**
 * The person applies a Proposal, leaving out the changes they unticked. It is
 * checked again against the model as it is now; returns why not, or null.
 */
export function applyProposal(p: Proposal, leaveOut: ReadonlySet<number>): string | null {
  const r = checkDesignText(currentBundle(), { bulk: true, leaveOut }, p.text, "agent");
  if (!r.checked.ok) return r.checked.errors.join("\n");
  if (!applyModelBundle(r.checked.after, "Agent proposal")) return "A Temporal Simulation run is shown: End run first.";
  useAgentStore.getState().settleProposal(p.id, { status: "applied", leftOut: [...leaveOut].sort((a, b) => a - b) });
  return null;
}
