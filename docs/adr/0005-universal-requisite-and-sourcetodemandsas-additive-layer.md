# Universal Requisite as default propagation; SourceToDemands as additive layer

Every node now runs a **Requisite logical aggregation pass** over all its incoming edges as the
default proposal mechanism, regardless of the categories involved. `SourceToDemands` flow runs
as an additional pass, only for nodes that carry a demand in a `SourceToDemands`-typed category.
Both passes produce candidate Functionality values that are merged into the running proposal `P`
via `worst_of` before the guard phase.

## Context

Under the prior model (ADR-0003), the proposal mechanism dispatched strictly on category type:
`SourceToDemands` categories used the flow heuristic, `Requisite` categories used logical
aggregation. A node only received a proposal for categories it was either tagged with
(`node_categories`) or had explicitly declared in `category_dependency_profiles`. This meant that
a "city" node downstream of a "water" infrastructure node received no proposal from the water
heuristic unless it declared a water dependency profile *and* a positive demand — even though the
connecting edge clearly models a dependency. Nodes representing complex consumers (urban areas,
hospitals) had to enumerate every upstream category dependency explicitly or remain invisible to
propagation.

## Decision

**1. Universal Requisite pass (every node, every round).**
The engine runs a Requisite logical aggregation pass for every node in every round. It scans all
incoming edges, groups them by the source node's declared categories, applies `best_of` over
deliverables `L(u→v) = worst_of(node_func, edge_func)` within each source-category group, then
applies `worst_of` across groups to produce a single candidate `P_req`. This is merged into `P`
via `worst_of`. Category type of the source does not affect this pass — water, power, transport
edges are all treated identically by the Requisite pass.

**2. SourceToDemands remains an additive flow pass.**
For each node that has `demand > 0` in at least one `SourceToDemands`-typed category, the flow
heuristic runs as before (priority min-cost max-flow, served-ratio → Functionality mapping). Its
candidate `P_flow` is also merged into `P` via `worst_of`. Nodes without demand are unaffected by
this pass.

**3. Guard applies once, after both passes.**
The guard phase (dependency_level attenuation → backup deferral → specific-rule override) reads
the single merged `P` and the node's `category_dependency_profiles`. The binding category for
guard lookup is whichever source-category group produced the worst `P_req` component (or the flow
category if `P_flow` was worse). When multiple categories tie, their guard parameters are
evaluated independently and the worst resulting `P` is used.

**4. Absent profile defaults to full dependency.**
When the Requisite pass discovers a source-category `C` for which the target node has no declared
`category_dependency_profiles[C]`, the guard uses `dependency_level = N` (full dependency — the
drop passes unattenuated). The modeller adds an explicit profile only when they need to attenuate
the drop (lower `dependency_level`), add backup, or customise other guard parameters.

**5. Frontend auto-populates profiles on edge creation.**
When an edge is created between nodes whose source carries a category not yet declared in the
target's `category_dependency_profiles`, the frontend automatically adds a default entry
(`dependency_level = N`, no backup, no demand). This ensures the guard is visible and editable
in the Inspector without requiring the modeller to know about the auto-population rule. On edge
deletion, the profile entry is retained and flagged as orphaned in the Inspector (no incoming
edge for this category); the modeller decides whether to remove it.

**6. Responsibility share.**
Attribution for the universal Requisite pass follows the existing Requisite rule (ADR-0003): blame
falls on the inputs that pulled the level down (argmax for `best_of`, argmin for `worst_of`),
split uniformly among the contributors at the binding level. Cross-category blame is attributed to
the upstream node (not the edge), exactly as for same-category Requisite aggregation.

**7. Engine efficiency hint.**
The Requisite pass can be seeded from the forward-reachable set of currently-degraded nodes
(BFS) rather than re-evaluating the entire graph each round. Monotonicity guarantees this is
semantically equivalent and reduces the evaluated set on sparse degradation scenarios.

## Considered options

**Explicit profile requirement (rejected).** Keep the old detection rule (union of declared
categories) and require the modeller to add cross-category profiles manually. This leaves nodes
like "Palmanova city" silently disconnected from upstream infrastructure degradation unless every
edge-implied dependency is manually enumerated. Fragile and non-obvious.

**Engine-side profile inference (rejected).** Have the engine dynamically inject synthetic
profiles at runtime rather than reading from the project JSON. This would replicate topology
reasoning inside the private engine and make the guard parameters invisible to the frontend,
breaking the schema boundary.

## Consequences

- ADR-0003's dependency detection rule ("union of declared categories and parent-supplied
  categories") is superseded. Detection is now purely topology-driven (incoming edges); declared
  profiles are guard parameters only.
- Every `SourceToDemands` node also receives a Requisite proposal. For nodes with demand, the
  flow result typically dominates (it accounts for capacity and priority); the Requisite pass
  adds a worst_of floor that can only make the result equal or worse, never better.
- **Skip refinement (shipped later):** the Requisite floor for a `SourceToDemands` category is
  waived only when BOTH hold: the node is itself a demand-bearing flow consumer of that category
  (`flow.py::is_flow_consumer`), AND every parent supplying it is tagged with that same category —
  i.e. the flow pass fully captures the dependency and the floor would be an unfair ceiling.
  A node the flow pass does not model (it left the category, or is tagged but demandless) always
  keeps the Requisite floor, otherwise the dependency would vanish entirely
  (`engine/propagation.py` `requisite_skip`; regression tests
  `test_engine_flow.py::test_node_out_of_category_keeps_requisite_floor` /
  `test_demandless_member_keeps_requisite_floor`).
- The frontend must implement edge-creation profile auto-population and the orphaned-profile
  warning in the Inspector. These are Client Configuration concerns and are not sent to the
  engine differently — the engine continues to read `category_dependency_profiles` as before.
