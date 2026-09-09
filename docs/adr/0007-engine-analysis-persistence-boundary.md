# ADR-0007 — Engine request path persists nothing; the Analysis Log stores only run metadata

**Status:** accepted

The server runs the propagation engine on payloads that always contain the full
network (topology, geo, labels, rules) — that is unavoidable, the engine needs
it to compute. We decided the engine request path **persists none of it**: the
network exists only transiently in memory for the duration of a Propagation and
is never written to disk or database. The single privacy guarantee we make to
users is therefore narrow and unconditional: **the network is never stored
server-side unless the user explicitly opts into Sync.**

Alongside this we keep an **Analysis Log** — one append-only, operator-only row
per Propagation — containing only data that describes the *input shape and run*,
never outcomes and never anything that names or locates a real-world Element or
Entity:

- **Input shape:** node count, edge count, canvas count, category names + count,
  functionality-scale N, event-definition count, rule count.
- **Run context:** timestamp, engine compute time, graph_type(s), scope
  (local/global), engine/heuristic version.
- **Audit join:** user ID (clusters all runs by the same user), role.

## Considered options

- *Log the graph payloads (type-3 content log) for reproducibility/engine
  debugging.* Rejected: silently persists every non-Sync user's network, which
  breaks the local-first guarantee.
- *Log run-level result aggregates* (compromised counts, functionality
  distribution, responsibility-share by category). Rejected for v1: they are
  derived from the network and invite the "that's my data" argument; the log
  stays purely descriptive of input + run.
- *Store the GeoAnchor (or an `is_georeferenced` flag).* Rejected. The anchor is
  the projection key — anchor + node `position` reconstructs every node's real
  lat/lon (`lib/geo-utils.ts`), so it is strictly *more* revealing than one
  coordinate. No geo, and no georeferenced flag, enters the log at all.

## Consequences

- The guarantee is writable as one sentence: *"we never store anything that
  identifies or locates an element of your network."*
- Category names may be stored because they describe the **model**
  (`ModelConfiguration` vocabulary: "water", "electricity"), not the network.
  The load-bearing rule: **config-level vocabulary may be persisted; anything
  naming or locating a real-world Element or Entity may not.**
- The Analysis Log is operator-only: admin-scoped, append-only, no user-facing
  history UI and no per-user Sync/RBAC plumbing. It sits outside the
  local-first data path.
