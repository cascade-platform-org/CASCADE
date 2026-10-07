/**
 * stock-math.ts — the Stock formulas of ADR-0020 §1c and §2.
 *
 * Step-operator arithmetic, which ADR-0020 places client-side; the engine only
 * ever receives numbers. With a = retention, n = efficiency, R = inflow (or
 * rate), m = min (or 0), M = max (or none):
 *
 *   ordinary   supply = rate + min(max_draw, max(0, a·L + n·R − rate − m))   (engine applies φ)
 *              L'     = clamp(a·L + n·φ·R − D, m, M)
 *   storage    source = min(max_draw, a·L + n·R − m)       used last
 *              sink   = min(max_fill, M − L)                filled last
 *              L'     = clamp(a·L + n·φ·R + filled − drawn, m, M)
 *
 * A clamp is reported: `spilled` above M, `unmet` below m.
 */

import type { CapacityValue, GraphSnapshot, Stock } from "@/lib/schemas/network";

/** The Stock fields the formulas read; `retention` and `efficiency` default to 1. */
export type StockFields = Omit<Stock, "retention" | "efficiency"> & { retention?: number; efficiency?: number };

export interface StockSupply {
  /** The number `buildPropagationPayload` sends in the Stock's place. */
  supply: number;
  /** The part of `supply` drawn from the stored level. */
  draw: number;
}

export interface StockIntegration {
  level: number;
  /** Amount above `max` the clamp removed. */
  spilled: number;
  /** Amount below `min` the clamp removed. */
  unmet: number;
}

const floorOf = (s: StockFields) => s.min ?? 0;
const credited = (s: StockFields) => s.inflow ?? s.rate;
const retained = (s: StockFields) => (s.retention ?? 1) * s.level;
const efficient = (s: StockFields, phi = 1) => (s.efficiency ?? 1) * phi * credited(s);

/**
 * φ: the share of its capacity an Element carries at a Functionality level
 * (ADR-0003, and the user manual): all of it at the top level, none at the
 * bottom, `(functionality − 0.5) / N` between. ADR-0020 §2 has the step
 * operator apply it to the credited inflow; the engine applies it to the
 * supply number it receives.
 */
export function capacityShare(functionality: number, n: number): number {
  if (n <= 1 || functionality >= n) return 1;
  if (functionality <= 1) return 0;
  return (functionality - 0.5) / n;
}

/** Storage (ADR-0020 §1c): a node Stock that fills from the network. A plain number is not. */
export const isStorage = (s: StockFields | number): s is StockFields => typeof s !== "number" && s.max_fill !== undefined;

export function stockSupply(s: StockFields): StockSupply {
  const headroom = Math.max(0, retained(s) + efficient(s) - s.rate - floorOf(s));
  const draw = Math.min(s.max_draw ?? Infinity, headroom);
  return { supply: s.rate + draw, draw };
}

/** What storage offers this Propagation, used only for demand other sources cannot cover. */
export const storageSource = (s: StockFields): number =>
  Math.max(0, Math.min(s.max_draw ?? Infinity, retained(s) + efficient(s) - floorOf(s)));

/** What storage may take from the network this Propagation, after every consumer. */
export const storageSink = (s: StockFields): number =>
  Math.max(0, Math.min(s.max_fill ?? 0, (s.max ?? Infinity) - s.level));

/** The number the engine sees for a capacity: a plain number as it is, a Stock's supply (or storage's source). */
export function capacityNumber(value: CapacityValue): number {
  if (typeof value === "number") return value;
  return isStorage(value) ? storageSource(value) : stockSupply(value).supply;
}

/** A Stock where it sits: a node's under its Category's key, an edge's with no Category. */
export interface PlacedStock {
  element: string;
  category?: string;
  stock: Stock;
}

/** Every Stock of a snapshot, node Stocks first. */
export function stocksIn(snapshot: Pick<GraphSnapshot, "nodes" | "edges">): PlacedStock[] {
  const out: PlacedStock[] = [];
  for (const node of Object.values(snapshot.nodes)) {
    for (const [category, value] of Object.entries(node.supply_capacity ?? {})) {
      if (typeof value !== "number") out.push({ element: node.id, category, stock: value });
    }
  }
  for (const edge of Object.values(snapshot.edges)) {
    if (edge.capacity !== undefined && typeof edge.capacity !== "number") out.push({ element: edge.id, stock: edge.capacity });
  }
  return out;
}

function clampLevel(s: StockFields, raw: number): StockIntegration {
  const lo = floorOf(s);
  const hi = s.max ?? Infinity;
  return {
    level: Math.min(hi, Math.max(lo, raw)),
    spilled: Math.max(0, raw - hi),
    unmet: Math.max(0, lo - raw),
  };
}

/**
 * Integrate one period. `delivered` is D (the last propagating Phase's
 * delivery); `phi` is the Functionality-to-capacity ratio the Propagation
 * returned for the Stock's node or edge (1 at the top level).
 */
export const integrateStock = (s: StockFields, delivered: number, phi = 1): StockIntegration =>
  clampLevel(s, retained(s) + efficient(s, phi) - delivered);

/** Integrate storage over one period from what the engine says it filled and drew. */
export const integrateStorage = (s: StockFields, filled: number, drawn: number, phi = 1): StockIntegration =>
  clampLevel(s, retained(s) + efficient(s, phi) + filled - drawn);
