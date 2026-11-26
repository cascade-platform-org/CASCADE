/**
 * propagation-playback.ts — the Propagation animation's timeline (ADR-0027).
 *
 * The engine returns, with `trace`, what each round did: the flow it solved at
 * the round's start and the changes its node pass committed, in order. This
 * module lays those out as frames to play, and computes nothing the engine did
 * not report — it only orders and groups:
 *
 *   per round
 *     flow          ONE screen: edges take their sources' levels, then the
 *                   round's flow leaves the Sources; `arrival` says after how
 *                   many hop-times it reaches each node, so the canvas starts
 *                   each edge's balls, and changes each consumer the flow left
 *                   short, as the balls land — timing within the screen, not
 *                   extra screens;
 *     logical       the other changes (logical, rule, backup), in the engine's
 *                   commit order, each pulsing along the edges from the
 *                   elements responsible for it.
 *   converged       the result as the canvas holds it, with the final flow. The
 *                   engine's last round re-solves the same flow and changes no
 *                   node (that is how it knows it converged), so it is shown
 *                   here rather than as a round of its own.
 *
 * A frame is cheap: it says how many changes are applied so far and what to
 * highlight. `stateAt` replays the changes up to a frame on top of the state
 * the Propagation was sent.
 */

import type { PropagationRound, RoundChange } from "@/lib/schemas/propagation";

export interface PlaybackEdge { id: string; source: string; target: string }

/** The Functionality and countdown of every Element as sent to the Propagation. */
export interface PlaybackStart {
  levels: Record<string, number>;
  functionalityTime: Record<string, number>;
}

export interface Frame {
  /** 0-based engine round. */
  round: number;
  phase: "flow" | "logical" | "converged";
  /** How many changes (in `Timeline.changes` order) are applied once this frame shows. */
  applied: number;
  /** Edges carrying flow, with their Category. */
  flowEdges: Record<string, string>;
  /** Flow screen: hop-times after the screen starts at which the flow reaches each node. Empty = no delay. */
  arrival: Record<string, number>;
  /** Hop-times the front takes to cross: how long a flow screen plays. */
  hops: number;
  /** Edges a change in this frame arrives along. */
  pulse: string[];
  /** Elements that changed in this frame. */
  focus: string[];
}

export interface Timeline {
  frames: Frame[];
  /** Every change, in the order the frames apply them. */
  changes: RoundChange[];
  /** Index of the first frame of each round. */
  roundStarts: number[];
  /** Largest amount any edge carries, per Category, over the whole run: the scale of edge widths. */
  maxFlow: Record<string, number>;
  /** Each edge's amount in the round it is drawn, by round then edge. */
  flowByRound: Record<string, number>[];
}

/** At most this many frames for one round's logical phase; a larger phase groups changes. */
const MAX_LOGICAL_FRAMES = 40;

/**
 * Hops from the Sources of one Category's flow, over every edge (the flow may
 * be short and leave a consumer unreached, but its distance still says when the
 * front gets there). Sources: nodes that send flow and receive none.
 */
function hopsFrom(flow: Record<string, number>, edges: PlaybackEdge[]): Map<string, number> {
  const byId = new Map(edges.map((e) => [e.id, e]));
  const senders = new Set<string>();
  const receivers = new Set<string>();
  for (const eid of Object.keys(flow)) {
    const e = byId.get(eid);
    if (!e) continue;
    senders.add(e.source);
    receivers.add(e.target);
  }
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const hop = new Map<string, number>();
  const queue = [...senders].filter((n) => !receivers.has(n));
  for (const n of queue) hop.set(n, 0);
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    const h = hop.get(n) ?? 0;
    for (const t of out.get(n) ?? []) {
      if (!hop.has(t)) { hop.set(t, h + 1); queue.push(t); }
    }
  }
  return hop;
}

/** The edges a change arrives along: from each responsible node into it, or the responsible edge itself. */
function pulseEdges(change: RoundChange, edges: PlaybackEdge[], incoming: Map<string, PlaybackEdge[]>): string[] {
  const causes = Object.keys(change.responsibility_share ?? {});
  if (causes.length === 0) return [];
  const edgeIds = new Set(edges.map((e) => e.id));
  const along = causes.filter((c) => edgeIds.has(c));
  for (const e of incoming.get(change.id) ?? []) if (causes.includes(e.source)) along.push(e.id);
  return along;
}

export function buildTimeline(rounds: PropagationRound[], edges: PlaybackEdge[]): Timeline {
  const frames: Frame[] = [];
  const changes: RoundChange[] = [];
  const roundStarts: number[] = [];
  const maxFlow: Record<string, number> = {};
  const flowByRound: Record<string, number>[] = [];
  const incoming = new Map<string, PlaybackEdge[]>();
  for (const e of edges) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
  const byId = new Map(edges.map((e) => [e.id, e]));

  rounds.forEach((rnd, round) => {
    const amounts: Record<string, number> = {};
    const flowEdges: Record<string, string> = {};
    for (const [category, perEdge] of Object.entries(rnd.flows)) {
      for (const [eid, amount] of Object.entries(perEdge)) {
        amounts[eid] = amount;
        flowEdges[eid] = category;
        maxFlow[category] = Math.max(maxFlow[category] ?? 0, amount);
      }
    }
    flowByRound.push(amounts);

    const edgeChanges = rnd.changes.filter((c) => c.cause === "edge");
    const flowChanges = rnd.changes.filter((c) => c.cause === "flow");
    const rest = rnd.changes.filter((c) => c.cause !== "edge" && c.cause !== "flow");

    // The converged round lowers no node (only edges catching up, or a backup
    // countdown starting): it is the Converged screen, with its flow standing.
    const last = round === rounds.length - 1;
    if (last && flowChanges.length === 0 && rest.every((c) => c.cause === "backup")) {
      changes.push(...edgeChanges, ...rest);
      frames.push({
        round, phase: "converged", applied: changes.length, flowEdges, arrival: {}, hops: 0,
        pulse: [], focus: rest.map((c) => c.id),
      });
      return;
    }
    roundStarts.push(frames.length);

    // Flow: one screen. Hops from the Sources time the front within it.
    const hopMaps = Object.values(rnd.flows).map((flow) => hopsFrom(flow, edges));
    const hopOf = (nid: string): number => {
      const reached = hopMaps.map((h) => h.get(nid)).filter((h): h is number => h !== undefined);
      return reached.length > 0 ? Math.min(...reached) : Infinity;
    };
    const destinations = [
      ...Object.keys(flowEdges).flatMap((eid) => { const e = byId.get(eid); return e ? [e.source, e.target] : []; }),
      ...Object.keys(rnd.served_ratio),
      ...flowChanges.map((c) => c.id),
    ];
    const reachable = destinations.map(hopOf).filter(Number.isFinite);
    const hops = reachable.length > 0 ? Math.max(...reachable) : 0;
    const arrival: Record<string, number> = {};
    // A node no hop reaches (cut off entirely) changes when the front has gone as far as it can.
    for (const nid of destinations) arrival[nid] = Math.min(hopOf(nid), hops);
    if (Object.keys(flowEdges).length > 0 || edgeChanges.length > 0 || flowChanges.length > 0) {
      changes.push(...edgeChanges, ...flowChanges);
      frames.push({
        round, phase: "flow", applied: changes.length, flowEdges, arrival, hops,
        pulse: [], focus: flowChanges.map((c) => c.id),
      });
    }

    // Logical, in commit order, grouped when long.
    const per = Math.max(1, Math.ceil(rest.length / MAX_LOGICAL_FRAMES));
    for (let i = 0; i < rest.length; i += per) {
      const group = rest.slice(i, i + per);
      changes.push(...group);
      frames.push({
        round, phase: "logical", applied: changes.length,
        flowEdges: {}, arrival: {}, hops: 0,
        pulse: group.flatMap((c) => pulseEdges(c, edges, incoming)),
        focus: group.map((c) => c.id),
      });
    }

    // The engine stopped at its round cap rather than converging: end on the last flow.
    if (last) {
      frames.push({ round, phase: "converged", applied: changes.length, flowEdges, arrival: {}, hops: 0, pulse: [], focus: [] });
    }
  });

  if (frames.length === 0) {
    frames.push({ round: 0, phase: "converged", applied: 0, flowEdges: {}, arrival: {}, hops: 0, pulse: [], focus: [] });
  }
  return { frames, changes, roundStarts, maxFlow, flowByRound };
}

/**
 * Whether the run has a cascade to play: some node lowered by the flow, logical
 * aggregation or a Rule. Edges taking their sources' levels follow damage that
 * was already there (an Event's), and a backup countdown lowers nothing yet, so
 * neither alone is worth a playback.
 */
export function hasDegradation(rounds: PropagationRound[]): boolean {
  return rounds.some((r) => r.changes.some((c) => c.cause === "flow" || c.cause === "logical" || c.cause === "rule"));
}

/**
 * Whether `id` fades on `frame`: a screen that degrades something keeps its
 * targets (`focus`) at full strength and fades every other node and edge, so
 * what is about to change stands out before it does. The flow's balls and the
 * pulses are drawn on top and never fade. Converged fades nothing.
 */
export function fadesOn(frame: Frame, id: string): boolean {
  if (frame.phase === "converged" || frame.focus.length === 0) return false;
  return !frame.focus.includes(id);
}

/** The pause after a screen's last change, before the next screen, in seconds at speed 1. */
const LINGER_SECONDS = 0.6;

/**
 * How long `frame` plays at speed 1, in seconds, given the hop and pulse times.
 * A screen moves on once its last change has landed: a flow screen when the
 * front reaches its farthest target (one hop when it has none — long enough to
 * see the flow), a logical step when its pulse arrives; then a short pause.
 * Converged stays until Done.
 */
export function screenSeconds(frame: Frame, hopSeconds: number, pulseSeconds: number): number {
  if (frame.phase === "converged") return 0;
  if (frame.phase === "logical") return pulseSeconds + LINGER_SECONDS;
  const lastArrival = Math.max(1, ...frame.focus.map((id) => frame.arrival[id] ?? 0));
  return lastArrival * hopSeconds + LINGER_SECONDS;
}

/** Every Element's Functionality and countdown once `frame` shows. */
export function stateAt(timeline: Timeline, start: PlaybackStart, frame: number): PlaybackStart {
  const levels = { ...start.levels };
  const functionalityTime = { ...start.functionalityTime };
  const applied = timeline.frames[frame]?.applied ?? 0;
  for (let i = 0; i < applied; i++) {
    const c = timeline.changes[i];
    levels[c.id] = c.functionality;
    if (c.functionality_time !== undefined) functionalityTime[c.id] = c.functionality_time;
  }
  return { levels, functionalityTime };
}
