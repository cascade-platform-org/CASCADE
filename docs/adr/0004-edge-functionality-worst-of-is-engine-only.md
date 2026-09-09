# ADR-0004 — Edge functionality worst-of rule is engine-only

**Status:** accepted

`edge.functionality` is the edge's intrinsic level. During Propagation the engine computes `worst_of(edge.functionality, source_node.functionality)` and writes the result back via `ElementUpdate`. The frontend never replicates this rule client-side.

## Considered options

**Client recomputes worst-of for display**: edge color and tooltip would show the live worst-of value even before Propagation runs. Simpler visual consistency — the edge "instantly" reflects its source node's degradation.

**Engine-only (chosen)**: `edge.functionality` is authoritative as stored. The engine owns the worst-of computation and writes the result back. The client displays only what is stored.

## Reasons for engine-only

- Replicating engine logic client-side creates a second implementation that can silently diverge. The engine owns the algorithm; its exact semantics are the source of truth.
- The user-set intrinsic value must be preserved separately from the propagated result. If the client overwrote display with worst-of, the user could not distinguish "I set this edge to level 2" from "the engine degraded it to level 2 because the source is degraded."
- After undo, `edge.functionality` is restored from the `before` snapshot — the stored intrinsic value is what matters, not a derived worst-of.
