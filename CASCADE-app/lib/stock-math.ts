/**
 * stock-math.ts — the two Stock formulas of ADR-0020 §2.
 *
 * PROTOTYPE. `StockDraft` is local until the Stock schema exists
 * (schema-first, CLAUDE.md §6). This is step-operator arithmetic, which
 * ADR-0020 places client-side; the engine only ever receives the supply number.
 *
 *   supply = rate + min(max_draw, max(0, a·L + n·R − rate − m))     (engine applies φ)
 *   L'     = clamp(a·L + n·φ·R − D, m, M)                           (spilled / unmet reported)
 */

export interface StockDraft {
  rate: number;
  /** Inflow credited in integration; absent = rate. */
  inflow?: number;
  level: number;
  /** Floor; absent = 0. */
  min?: number;
  /** Ceiling; absent = none. */
  max?: number;
  /** Most the level may add to supply per period; absent = no limit. */
  max_draw?: number;
  retention?: number;
  efficiency?: number;
}

export interface StockSupply {
  /** The number `buildPropagationPayload` would send as `supply_capacity`. */
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

const floorOf = (s: StockDraft) => s.min ?? 0;
const credited = (s: StockDraft) => s.inflow ?? s.rate;

export function stockSupply(s: StockDraft): StockSupply {
  const a = s.retention ?? 1;
  const n = s.efficiency ?? 1;
  const headroom = Math.max(0, a * s.level + n * credited(s) - s.rate - floorOf(s));
  const draw = Math.min(s.max_draw ?? Infinity, headroom);
  return { supply: s.rate + draw, draw };
}

/**
 * Integrate one period. `delivered` is D (the last propagating Phase's
 * delivery); `phi` is the Functionality-to-capacity ratio the Propagation
 * returned for the Stock's node or edge (1 at the top level).
 */
export function integrateStock(s: StockDraft, delivered: number, phi = 1): StockIntegration {
  const a = s.retention ?? 1;
  const n = s.efficiency ?? 1;
  const raw = a * s.level + n * phi * credited(s) - delivered;
  const lo = floorOf(s);
  const hi = s.max ?? Infinity;
  return {
    level: Math.min(hi, Math.max(lo, raw)),
    spilled: Math.max(0, raw - hi),
    unmet: Math.max(0, lo - raw),
  };
}
