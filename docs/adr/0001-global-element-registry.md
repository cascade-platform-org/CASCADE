# ADR-0001 — Global element registry with Canvas membership by reference

**Status:** accepted

Elements (nodes and edges) have globally unique IDs and live in a single authoritative registry at the Project level (`Project.nodes`, `Project.edges`). Each Canvas/Graph holds only a list of element IDs it visualises — not copies of the element data.

A real-world element (e.g. a pumping station that belongs to both a water network and a power network) maps to one node in the registry. Both Canvases reference its ID. Propagation updates it once; both Canvases reflect the change automatically.

## Considered options

**Copy-per-canvas**: element data embedded inside each `Canvas.graph.nodes` list. Simpler initial schema, but the same real element would be duplicated across Canvases. Propagation results would need to fan out to every copy, and copies could silently diverge.

**Global registry (chosen)**: single record per element, referenced by ID from any number of Canvases. No duplication, no divergence.

## Inter-canvas edges are a UI concept only

An edge is "inter-canvas" when its target node is not in the node_ids of the Canvas currently being rendered. This is computed at render time — there is no `InterCanvasEdge` type, no `source_canvas`/`target_canvas` fields, and no separate list in the project file. The data model has one uniform `Edge` type.
