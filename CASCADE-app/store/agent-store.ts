/**
 * agent-store.ts — an agent in the modelling loop (ADR-0024): its Proposals,
 * what it has done this session, and the Agent Bridge connection with the
 * agents it announced.
 *
 * An agent never writes the model. Every change it wants becomes a **Proposal**
 * (a plain-changes text, ADR-0022), which a person applies, in part or whole,
 * or rejects in the Agent window; the agent reads the outcome back. Reads and
 * runs on copies (a scenario, the Expectations, a Temporal Simulation) need no
 * approval, and each is logged here so the person sees what the agent did.
 * Session state: nothing here is saved with the project. A Proposal is checked
 * again against the model as it is when applied, so one written before another
 * edit is refused with its reason rather than applied blind.
 */

import { create } from "zustand";
import { nanoid } from "nanoid";

type ProposalStatus = "pending" | "applied" | "rejected";

export interface Proposal {
  id: string;
  /** The plain changes, as the agent sent them (cascade.model-change/v2). */
  text: string;
  notes?: string;
  createdAt: string;
  status: ProposalStatus;
  /** Indices of the changes the person left out when applying. */
  leftOut: number[];
  /** Why the person rejected it, when they said. */
  reason?: string;
}

interface AgentActivity {
  at: string;
  tool: string;
  /** One line: what was asked and what came back. */
  summary: string;
}

/** The tab's socket to the Agent Bridge relay (ADR-0024); `open` means this tab is paired. */
type BridgeState = { status: "off" } | { status: "connecting" } | { status: "open" } | { status: "error"; message: string };

/** An agent the relay announced, waiting for the person or approved. */
export interface BridgeAgent {
  id: string;
  name: string;
  tokenName: string;
  approved: boolean;
}

const MAX_ACTIVITY = 200;

interface AgentState {
  proposals: Proposal[];
  activity: AgentActivity[];
  bridge: BridgeState;
  /** The agents the relay announced to this tab. */
  agents: BridgeAgent[];
  /** A new pending Proposal; returns it. */
  addProposal: (p: { text: string; notes?: string }) => Proposal;
  settleProposal: (id: string, outcome: { status: "applied"; leftOut: number[] } | { status: "rejected"; reason?: string }) => void;
  log: (tool: string, summary: string) => void;
  setBridge: (bridge: BridgeState) => void;
  setAgents: (update: (agents: BridgeAgent[]) => BridgeAgent[]) => void;
}

export const useAgentStore = create<AgentState>()((set) => ({
  proposals: [],
  activity: [],
  bridge: { status: "off" },
  agents: [],
  addProposal: ({ text, notes }) => {
    const proposal: Proposal = { id: `p-${nanoid(6)}`, text, ...(notes ? { notes } : {}), createdAt: new Date().toISOString(), status: "pending", leftOut: [] };
    set((s) => ({ proposals: [...s.proposals, proposal] }));
    return proposal;
  },
  settleProposal: (id, outcome) =>
    set((s) => ({
      proposals: s.proposals.map((p) =>
        p.id !== id || p.status !== "pending"
          ? p
          : outcome.status === "applied"
            ? { ...p, status: "applied", leftOut: outcome.leftOut }
            : { ...p, status: "rejected", ...(outcome.reason ? { reason: outcome.reason } : {}) },
      ),
    })),
  log: (tool, summary) =>
    set((s) => ({ activity: [...s.activity, { at: new Date().toISOString(), tool, summary }].slice(-MAX_ACTIVITY) })),
  setBridge: (bridge) => set({ bridge }),
  setAgents: (update) => set((s) => ({ agents: update(s.agents) })),
}));
