# Architecture Overview

## Design Philosophy

CASCADE follows a **local-first** architecture. All project data — graphs, rules, configurations, canvas state — lives on the client as JSON files. The user owns their data, can work offline, and decides when (and whether) to interact with the server.

The server has exactly two responsibilities:

1. **Execute the propagation engine** on submitted payloads. The engine is published openly and may become proprietary in part as it is refined (ADR-0009).
2. **Enforce identity and access control** via OAuth2/OIDC and role-based policies.

By default no project data is stored server-side; users may opt in to **server sync**, which stores their project versions in PostgreSQL, per user. The engine operates identically in both modes. The wire format itself is documented once, in [local-first-guide.md](local-first-guide.md).

---

## High-Level Diagram

```
┌─────────────────────────────────────────────────────┐
│                    CLIENT (Browser)                  │
│                                                      │
│  ┌──────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Zustand       │  │ MapLibre │  │ File I/O       │  │
│  │ Stores        │  │ GL JS    │  │ upload/download│  │
│  │ canvas        │  │          │  │ + versioned    │  │
│  │ network       │  └──────────┘  │   auto-save    │  │
│  │ config        │                └────────────────┘  │
│  │ clipboard     │  ┌──────────────────────────────┐  │
│  │ auth / ui     │  │ Next.js App Router            │  │
│  └──────────────┘  │ Canvas Editor · Editors       │  │
│                     │ Rules · Events · Scorecard    │  │
│                     └────────────┬─────────────────┘  │
└──────────────────────────────────┼────────────────────┘
                                   │ HTTPS (JSON payloads)
                                   ▼
┌──────────────────────────────────────────────────────┐
│                   SERVER (FastAPI)                    │
│                                                      │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ API Routes │  │ Auth / RBAC  │  │ Propagation  │  │
│  │ /propagate │  │ OAuth2/OIDC  │  │ Service      │  │
│  │ /engine    │  │ Role guards  │  │              │  │
│  │ /sync      │  └──────┬───────┘  └──────┬───────┘  │
│  │ /admin     │         │                 │           │
│  └────────────┘         ▼                 ▼           │
│                  ┌────────────┐   ┌──────────────┐    │
│                  │ PostgreSQL │   │ ENGINE       │    │
│                  │ users      │   │ (package)    │    │
│                  │ roles      │   │ propagation  │    │
│                  │ opt: files │   │ algorithm    │    │
│                  └────────────┘   └──────────────┘    │
└──────────────────────────────────────────────────────┘
```

---

## Multi-Canvas Model

The core modelling primitive is a **multi-canvas**: multiple Canvases, each representing an independent Entity (water network, electricity grid, ICT infrastructure, …), connected by inter-canvas edges stored in the global element registry.

- Each Canvas can be independently **georeferenced** (MapLibre) or abstract (flow layout).
- Each Canvas carries a **`graph_type`** (`canvas.graph.graph_type`) — a name referencing a `ModelConfiguration.graph_types` entry. The Model Configuration defines what a graph type is (name + heuristic pipeline); the Canvas holds the assignment. Assignments can be made from both the Inspector's Canvas Meta panel and the Graph Types tab of the Config modal.
- The **Global view** (all Canvases together) also has an explicit `graph_type`, stored as `Project.global_graph_type`. Settable from the Graph Types tab alongside per-Canvas assignments.
- **Inter-canvas edges** are regular edges in the global registry whose target node belongs to a different Canvas. Identified at render time — no special type or field in the data model (ADR-0001).
- A node may appear in multiple Canvases. Because element IDs are globally unique, it is stored exactly once in the registry regardless of how many Canvases reference it.
- **Propagation scope** governs the engine payload only. Local: client sends active Canvas nodes + intra-canvas edges only. Global: client sends full Project. Event application always writes to the full registry, independent of scope.
- **Global display mode** (implemented, `components/canvas/global-view-canvas.tsx`): renders all Canvases in one read-only React Flow instance, each Canvas as its own group region. Because IDs are unique, each node appears exactly once — no deduplication step needed. Inter-canvas edges render as dashed connectors. Pure render-time operation; no data model change.

---

## Client Architecture

### State Management — Zustand

All application state is managed through nine Zustand stores:

- **`canvas-store`** — global element registry (`nodes`, `edges`), Canvas list, active Canvas, serialisation to/from `Project`. Hosts `undo()`/`redo()` (they must write the registry) but the history data itself lives in `history-store`.
- **`history-store`** — the Any Graph Update ring buffer (`update_history`) plus the session-only redo stack. Capped at 20 entries **and** at a byte budget, because entries are variable-size Graph Diffs and one bulk deletion can exceed twenty ordinary edits (ADR-0017). Evicted entries are retired into a Scenario Baseline map on the way out, so a scenario can outlive the buffer (ADR-0016).
- **`network-store`** — UI-only selection and hover state for the active Canvas. Intentionally thin — no graph data. High-frequency updates (every pointer event) stay isolated from the registry.
- **`config-store`** — `ModelConfiguration`: functionality scale, category definitions, Event definitions, graph-type algorithm pipelines. Owns a draft/commit lifecycle for the Config modal.
- **`scorecard-store`** — the Scorecard entry list, serialised into `Project.scorecard` via canvas-store.
- **`analysis-store`** — ephemeral Analysis-page state (selected metric, results, heatmap colours). Never persisted.
- **`clipboard-store`** — transient copy/paste state. Never persisted.
- **`auth-store`** — user profile, current role, session lifecycle. Holds no tokens — the session lives in httpOnly cookies set by the backend; JavaScript never sees a token. UI permission gating uses the `permissions` list served by `GET /api/auth/me` (computed in `auth/rbac.py`) — there is no client-side role→permission map to drift.
- **`ui-store`** — panel visibility, active tool, propagation scope, category filter, toast queue.

The stores are the single source of truth. Components subscribe to slices they need.

### Event Application

`lib/event-application.ts` is the single home for what an Event *does* to a
Scenario: the imposed Functionality from `vulnerability_levels`, the Hazard
`direct_damage` fan-out, `attribute_mutations`, and Temporal Jump expiry. It is a
pure transform — `(GraphSnapshot, EventDefinition, N) → { snapshot, reversal }` —
so the live canvas and every what-if path (Save-to-Scorecard, Scorecard gap-fill,
the Run button on an uncovered Event) get the same answer from the same code.
`reverseMutations` is its inverse, driven by the Mutation Reversal record the
application returns.

`canvas-store.applyEvent` / `clearEvent` are thin adapters over it: they build a
snapshot, call the module, commit the result, and push the history entry. The
transform itself touches no store, which is what makes it testable.

**Per-Element reference identity is part of its interface.** The returned
snapshot reuses the caller's object for every Element the Event did not touch, so
callers can diff before/after by identity to count affected Elements
(`countChangedElements` in `components/canvas/action-bar.tsx`). A wholesale clone
would silently report every Element as affected.

### Saving an Analysis to the Scorecard

`lib/analysis-entry.ts` builds the Scorecard entry from the Analysis Result and
nothing else that could drift. The Save dialog previously stamped the entry with
the analysis store's `activeMetric`, which is selector state that only three of
the four Analysis sections write — `section-topological.tsx` keeps its selection
in local React state — so every topological entry was labelled with whatever had
last been selected elsewhere, defaulting to `betweenness`. The label is shown on
the Scorecard card and persisted in the project file, so the record was wrong for
good. A Result carries the metric that produced it, stamped by the analysis
function itself, so taking both from one object makes the mismatch
unrepresentable rather than merely corrected.

### Batched coalition evaluation

A model-based Analysis run evaluates hundreds of Scenarios over an **unchanged**
Project. Each one used to be its own `POST /api/propagate` carrying that Project
again: 1,297 requests and ~29 MB for a 39-node network at default settings, with
measured per-call overhead (~19 ms) dominating the engine's actual work (~8 ms).

`POST /api/propagate/batch` takes the Project once plus a list of coalitions.
Server-side it loops over the existing `propagate()` — deliberately sequential,
because the engine already owns a bounded worker pool and one request must not be
able to occupy all of it. The endpoint removes transport cost; it adds no
concurrency the engine did not have.

The client side is arranged so the estimator never learns about any of it.
`estimateShapley`'s sampling is seeded, so `planPermutations` (extracted from it,
and still the only shuffle) yields every Scenario a run will visit before the
first is evaluated. `lib/coalition-batch.ts` scores those in chunks of 50 and
hands the estimator a `CoalitionEvaluator` backed by the filled map; a coalition
missing from the map falls back to a single call, so an unavailable batch
endpoint costs speed rather than the run. `lib/model-based-analysis.ts` keeps its
one-coalition-at-a-time interface and its pure-function tests.

Measured on the case-study network: **1,297 requests → 26**, and the resulting
φ̂ are bit-identical to the pre-batch run at the same seed — the property that
makes the optimisation safe to have made at all.

### The Temporal Jump run

A **Temporal Jump** writes to the graph like any Event. A *run* is the state that
lives outside it for as long as the user keeps jumping: the pre-jump Scenario the
`−Xh` control restores, the hours elapsed, and the history entry the run started
from.

That state had no owner. It sat as three fields on `ui-store` and its four
operations were spread across three layers — starting and extending a run in
`action-bar.tsx`, reverting one in a helper beside it, ending one because the
scenario ended in `network-utils.ts`, partially unwinding one in `canvas-store`'s
`clearEvent`. Nothing could answer "is a run active, and what ends it" in one
place, which is how **Reset** came to end the scenario without ending the run,
leaving `−Xh` offering to rewind into a scenario that was over.

`lib/temporal-jump-run.ts` owns the lifecycle: `extendRun` (start or continue),
`revertRun` (rewind the whole run and end it), `endRun` (discard the run, keep
the jumps — what Reset calls), plus the pure `remainingJumpHours` /
`nextJumpHours` that read a Scenario's pending Functionality Times. Those two
replaced three hand-rolled copies of the same loop inside one component, and are
what the slider's ticks and auto-advance's step size both come from.

The one operation that stays out is `clearEvent`'s give-back of a cleared jump's
hours: `canvas-store` cannot import this module (it already depends on
`canvas-store`, so the reverse edge is a cycle), and it writes `ui-store`
directly, which it does for its sibling stores anyway.

### The Analysis Metric registry

A client-side Analysis Metric used to have no single definition: adding one meant
editing an id union in `analysis-store.ts`, a `METRICS` array inside whichever
section component owned it, a `switch` dispatching that id to a compute function,
`buildLegend`'s own switch, and `CATEGORICAL_METRICS` — five places nothing
connected, so a metric half-added failed at runtime or rendered with the wrong
key. The four section components each carried their own copy of the same run
cycle around it.

`lib/analysis-metrics.ts` makes a metric one object — label, description, panel,
forced scope, whether it needs an Element picked first, and how to run it — and
the sections read the registry instead of carrying lists. Two rules that used to
be per-component branches are now properties of the metric:
`effectiveScope` (Network-of-Networks insists on the full multi-canvas) and
`canRun` (the cone metrics need a source). `lib/analysis-metrics.test.ts` then
asserts what nothing could assert before: every registered metric runs, and every
scored result both colours and explains itself.

`lib/topological-analysis.ts` is left as graph algorithms only. Its colour ramp
and categorical palette moved to `lib/colors.ts`, and `buildColorMap`,
`CATEGORICAL_METRICS` and `getElementLabel` to `lib/analysis-legend.ts` — a
metric module had no business knowing what any of it looks like on screen.

### Analysis Heatmap legend

An Analysis Heatmap overrides every Element's fill, so while one is applied the
canvas legend's Functionality scale is a key to colours that are not on screen.
`lib/analysis-legend.ts` derives the metric's own key instead — a gradient for
score magnitudes, named swatches for categorical metrics — and the canvas legend
swaps to it.

Two properties keep the key honest. It is built at **apply** time and written to
the store in the same action as the colours (`applyHeatmap`), so the canvas can
never explain one Analysis Metric while displaying another's. And it takes its
colours from `buildColorMap`'s own sources — `CATEGORY_COLORS` and
`scoreToColor` — rather than restating them, because the two had already drifted:
the community legend showed a grey "+N more" swatch for a palette that actually
wraps, so overflow communities were painted like communities 1..N while the key
claimed grey. `lib/analysis-legend.test.ts` compares the key against
`buildColorMap` directly, which is the assertion that would have caught it.

`components/analysis/legend-view.tsx` renders the key for both the Analysis page
and the canvas overlay, so the two cannot disagree about presentation either. The
overlay is mounted by all three canvas views — single canvas, merged "all", and
grouped "all" — because an Analysis Heatmap colours the Element registry, so its
colours appear wherever Elements are drawn.

A gradient's two ends are labelled with the Analysis Result's own `min` and
`max`, which is exactly what `buildColorMap`'s `(score - min) / (max - min)`
normalisation makes them stand for; `formatScore` picks a precision per
magnitude, since a reach count and a Shapley Value differ by two orders of
magnitude. A result whose scores are all equal renders as one swatch rather than
a gradient: the guarded divisor paints every Element the ramp's low end, so a
gradient would advertise a spread that is not there.

### Model-based Analysis

`lib/model-based-analysis.ts` holds the two engine-side Analysis Metrics —
Vitality Centrality and Shapley Value. Both are numerical estimators, so they
live apart from the Analysis page and take Propagation as an **injected
evaluator**: production passes an adapter that applies a coalition to a
GraphSnapshot and calls `POST /api/propagate`; tests pass a pure scoring
function. That is what lets the estimators be checked against cooperative games
whose exact Shapley values are known, with no engine and no renderer.

Shapley sampling draws **uniform** permutations (Fisher-Yates over a seeded
PRNG) and returns the seed it used, so a reported run replays exactly. This
matters beyond tidiness: the previous in-component implementation shuffled with
`sort(() => Math.random() - 0.5)`, which is not uniform — measured over 200k
draws it put the first Element in front 22% of the time against an ideal of
12.5%, systematically inflating the Shapley rank of whichever Elements happened
to come first in registry order. It was also unseeded, so no run could be
reproduced.

The three user-facing parameters carry the paper's names — **M** permutations,
**k_max** coalition size, wall-clock budget — because the same three knobs are
described in IJDRR §3.4.2 and reported in §4.4. One consequence is worth stating
where callers can see it: with k_max < N the estimator does not converge to the
true Shapley value however large M grows. Marginals from permutation positions
beyond k_max are counted as zero rather than dropped, so on an additive game
Σφ̂ = (k_max/N)·v(N) exactly, with no sampling variance — a property the test
suite pins. Truncated values rank Elements against each other; they are not each
Element's full share of the Operativity loss.

`lib/analysis-export.ts` turns a finished Shapley run into the **Shapley
Export**, the JSON the user downloads. It exists because the estimator used to
have a second implementation in `CASCADE-backend/scripts/paper_shapley_vs_centrality.py`,
so the paper's §4.4 numbers were produced by code that was not the code the
product runs — and the two had in fact drifted (that script sampled uniformly
while the client did not). The script now reads this document and contributes
only what was never duplicated: networkx centralities and the Spearman
comparison. It no longer imports `engine.*`, so it also gave up its
import-linter carve-out. The cost is that reproducing §4.4 takes an Analysis run
plus a command instead of one command; the return is that the published φ̂ are by
construction the φ̂ the product computes. Because a program in another language
parses these field names, `lib/analysis-export.test.ts` asserts them literally —
nothing in the TypeScript build can catch a rename.

`scripts/shapley-export.harness.ts` (run via `npm run harness:shapley`, config in
`vitest.harness.config.mts`) produces that same document without a browser, for
paper runs that need to be repeatable. It is not a third implementation: it
imports `estimateShapley`, `computeOperativityScore`, `buildPropagationPayload`
and `mergeUpdatesIntoSnapshot` — the modules the Analysis page uses — and
supplies only what React and Zustand would otherwise supply, a Project read from
disk and a `fetch` pointed at a local engine. It is deliberately outside
`npm test`: it needs a live engine, so it must never gate a commit.

### Data Model — Global Element Registry (ADR-0001)

Nodes and edges have globally unique IDs and live in a single registry at the Project level (`Project.nodes`, `Project.edges`). Each Canvas holds only `node_ids` and `edge_ids` — references, not copies. A node that participates in multiple Canvases is stored once; both Canvases reference the same ID. Propagation updates the registry once; all Canvases reflect the change automatically.

The project file structure:

```json
{
  "version": "2.0",
  "nodes": { "<id>": { … } },
  "edges": { "<id>": { … } },
  "canvases": [
    { "id": "…", "graph": { "graph_type": "…", "node_ids": […], "edge_ids": […] } }
  ],
  "update_history": [],
  "scorecard": []
}
```

There is no top-level `inter_canvas_edges` array. Inter-canvas edges are plain edges in the registry; their inter-canvas nature is computed at render time.

### Any Graph Update History — Undo Stack

Every user action that changes graph state pushes an `AnyUpdateEntry` to `update_history`. Each entry carries a **Graph Diff** — a field-level, invertible record of exactly what it changed, in both directions (ADR-0017). Ctrl+Z applies it backwards against the live graph, Ctrl+Y forwards; no snapshot is rebuilt, so there is no chain to replay and no checkpoint to keep. Entries written before ADR-0017 carry a `before`/`after` `GraphSnapshot` pair instead and are still read.

Entries are built in exactly one place, `lib/history-entry.ts`, reached either directly (canvas-store's own actions, which already hold both snapshots) or through `lib/run-with-history.ts` (everything else, which snapshots around a mutation). Nothing else may call `pushUpdateEntry`: a call site that built its own diff could produce an entry that undoes incorrectly, and nothing would fail — undo would just leave a value behind.

Two things then *read* that history to answer questions about the current scenario: the **Scenario Baseline** (`lib/scenario-baseline.ts`, what Reset and Clear Event put back) and the **Situation** (`lib/situation.ts`, what scenario is set up right now). Both first have to find where the current scenario begins, and both used to do it themselves — two copies of "a `scenario_reset` ends the scenario" and "a `temporal_jump_revert` skips back to `reverts_to_entry_id`", able to disagree about what the live scenario even is with nothing failing. `lib/scenario-history.ts` is now the only place either rule is written, exported as two named readings: `updatesInScenario` keeps a reverted Temporal Jump run (the Baseline still wants its pre-scenario values) and `liveUpdatesInScenario` drops it whole (the Situation must not describe jumps the canvas has rewound out of).

Entry types:

| `update_type` | Trigger |
|---|---|
| `graph_update` | Add/remove/edit nodes or edges |
| `event_applied` | Applying an Event (Hazard or Disservice). Recorded even when the Event changed nothing — the Situation is derived by finding these |
| `event_cleared` | Clearing a previously applied Event (Ctrl+R): reverts that Event's writes **and** every Propagation write, leaving the remaining Events un-propagated. Recorded so Ctrl+Z can bring the Event and its cascade back |
| `propagation` | Receiving a PropagationResult from the server |
| `manual_functionality_update` | User manually editing Functionality or Functionality Time |
| `scenario_reset` | Reset button (ADR-0016). Two independent halves: every Element is forced operational (full Functionality, no countdown, no damage or blame) consulting nothing, and every machine-written *model* attribute is reverted from the **Scenario Baseline**. Hand edits to model fields survive. A session boundary: it ends the current Situation and any Temporal Jump run, so the Situation window closes and Save-to-Scorecard falls back to the live canvas |
| `temporal_jump_revert` | Undoing every Temporal Jump of a run (the −Xh button). Carries `reverts_to_entry_id`, the newest entry at the time the pre-jump snapshot was taken: the Situation and the unsaved-run scan skip back to it, so the jumps and any Propagation run during them stop counting as the current scenario |

### Data Persistence — File I/O and Version History

- **Auto-save** — background save to `localStorage` after **10 seconds of inactivity, and only when the content changed** (ADR-0017). Discarded when an explicit save is made. `update_history` is included: it used to be stripped everywhere small, so undo was empty after a crash, and Graph Diffs made it small enough to keep. A history-free write is the fallback if the quota refuses.
- **Explicit save** — downloads `project.json` + `config.json` (or a bundle). Up to 10 previous explicit saves retained in browser storage.
- **Load** — Zod validation at the boundary before hydrating stores.

### Server Sync (opt-in)

When enabled, explicit saves are also pushed to `POST /api/projects` (each save is a new version, never an overwrite). The version list is accessible across devices via `GET /api/projects`; load/delete one version via `GET`/`DELETE /api/projects/{id}`. Requires the `can_sync` RBAC permission. See api-reference.md.

### Schema Layer

All shared data shapes are defined as Zod schemas (frontend) and Pydantic models (backend). Zod is the runtime validation boundary on the frontend; TypeScript types are inferred from Zod via `z.infer<>`.

The Pydantic models are the **Python source of truth**. A bridge script exports them to JSON Schema, which serves as the reference for keeping the Zod schemas in sync:

```
CASCADE-backend/schemas/*.py
        │
        │  python CASCADE-backend/scripts/export_json_schema.py
        ▼
CASCADE-app/shared/schemas/*.schema.json   ← drift is CI-enforced (backend job)
        │
        │  manual update
        ▼
CASCADE-app/lib/schemas/*.ts               ← TypeScript source of truth
```

Run the bridge script whenever a Pydantic model changes (see CLAUDE.md §6).

| File | Contents |
|---|---|
| `CASCADE-app/lib/schemas/network.ts` | `Node`, `Edge`, `Canvas`, `Graph`, `Project`, `GraphSnapshot`, `AnyUpdateEntry`, `ScorecardEntry` |
| `CASCADE-app/lib/schemas/config.ts` | `ModelConfiguration`, `FunctionalityScaleLevel`, `CategoryDefinition`, `EventDefinition`, `GraphTypeConfig`, `HeuristicConfig` |
| `CASCADE-app/lib/schemas/api.ts` | `PropagationRequest`, `PropagationResult`, `ElementUpdate`, sync types |
| `CASCADE-app/lib/schemas/primitives.ts` | Shared primitive schemas |
| `CASCADE-app/lib/schemas/audit.ts` | Audit log types |
| `CASCADE-app/lib/schemas/auth.ts` | `AuthUser`, session and permission types |
| `CASCADE-app/lib/schemas/propagation.ts` | Propagation request/response wire types |
| `CASCADE-app/shared/schemas/` | Generated JSON Schema bridge files (do not edit manually) |
| `CASCADE-backend/schemas/network.py` | Pydantic equivalents: `Node`, `Edge`, `Canvas`, `Project`, `ScorecardEntry` |
| `CASCADE-backend/schemas/config.py` | Pydantic equivalent of `ModelConfiguration` |
| `CASCADE-backend/schemas/results.py` | `PropagationRequest`, `PropagationResult`, `ElementUpdate`, sync models |
| `CASCADE-backend/schemas/engine.py` | `EngineAlgorithms`, `HeuristicMeta`, `GraphTypeMeta` — returned by `GET /api/engine/algorithms` |
| `CASCADE-backend/schemas/auth.py` | `AuthUser`, `TokenPair` |

### Geo Visualization — MapLibre GL JS

A georeferenced Canvas renders a MapLibre map as a **non-interactive background behind React Flow**, locked to the React Flow viewport. The nodes stay React Flow nodes; the map sits underneath and tracks every pan/zoom.

- **`components/geo/geo-map-background.tsx`** — owns the MapLibre lifecycle (init, tile-style swap, interaction toggle, resize) and the setup/synced UI (style picker, "Set anchor", crosshair, debug overlay). In *setup* mode the map is fully interactive so the user can navigate and drop a **GeoAnchor**; in *synced* mode interaction is disabled and the map follows the viewport.
- **`hooks/useMapViewportSync.ts`** — the viewport-sync seam. Mirrors React Flow's transform onto the map container every frame (GPU compositor, zero lag) and reloads sharp tiles via `map.jumpTo()` only when a gesture ends. Returns `invalidate()` for style swaps.
- **`lib/geo-utils.ts`** — the **GeoAnchor projection**: exact Web Mercator (`anchorFlowToGeo`, `anchorGeoToFlow`, `computeMapTarget`). One seam converts flow ↔ geo, so `node.geo`-on-drag and the map camera can never use disagreeing projections. See CONTEXT.md → *GeoAnchor*.

A node carries both `position` (flow) and `geo` (lng/lat); see CONTEXT.md → *Node Position vs Geo Coordinates*. The GeoAnchor is the single per-Canvas correspondence tying the two.

### Guided tour

The first-run walkthrough (requirements §8.5). Three constraints shape it, and
each rules out an off-the-shelf tour library.

**No library, because dimming is wrong here.** driver.js, shepherd and intro.js
all dim the page and make everything outside the spotlight inert. Both behaviours
break this tour: the user has to *read* the network while a step talks about it,
and has to *click* real controls, several of which sit outside whatever the step
highlights. driver.js additionally forced `pointer-events` onto every descendant
of its spotlight, which turned React Flow's transparent overlay layers into
click-catchers and made the canvas unselectable. So
`components/onboarding/guided-tour.tsx` draws only a ring around the target and a
card beside it, both in a portal, the ring `pointer-events: none`.

**The ring follows its target in a `requestAnimationFrame` loop.** The
most-highlighted target is a node the user can pan and zoom, which fires neither
`scroll` nor `resize`.

**Gates are armed when their step appears** — `waitFor` captures the state it
found and returns a predicate, so a step cannot be satisfied by something that
had already happened. This is load-bearing: the sample ships with the Earthquake
applied and propagated, and an absolute check ("the latest history entry is an
Event") skipped the step on arrival. Gates that watch history compare entry ids,
not just types.

**Steps are data** in `lib/tour/first-run-tour.ts`; **targets** are `data-tour`
attributes on the real components, never CSS or DOM-structure selectors. A step
whose anchor is missing renders centred rather than being dropped, and
`missingTourAnchors()` warns in development — do not remove a `data-tour`
attribute without removing its step. A step may add `resolve` for a target a
`data-tour` cannot aim at ("click the Substation" rings that node, found by label
in the canvas store), or `cardAnchor` to position its card against a different
element while the ring stays on the target (the Temporal Jump step does, because
Time opens its panel directly under its own button).

State lives in `ui-store.activeTour`; `startTour()` closes every drawer and modal
first so nothing covers a highlighted target. `lib/tour/start-tour.ts` is the
single launcher, and `hooks/useFirstRun.ts` owns the one-time offer
(`localStorage` key `cascade.tour.firstRun.offered`).

### Offline Capability

Editing, Event application, rule authoring, topological analysis, manual Functionality edits, and Scorecard entry authoring work fully offline. The server is only needed for Propagation and optional sync.

---

## Server Architecture

### Stateless Compute Model

The server accepts a JSON payload (project + config + scope), runs the propagation engine, and returns results. It holds no session state, and the network is never persisted (ADR-0007) unless the user has enabled server sync.

**One exception to statelessness:** the per-user Entitlement meter (the engine-evaluation token bucket, ADR-0008) is mutable state. In v1 it lives in-process, which assumes a **single backend instance** — the default for the single-VM deployment. Horizontal scaling (multiple backend instances) would require externalising the meter to PostgreSQL; until then, the "run multiple instances" note under *Scaling* is deferred.

### Global Unhandled-Exception Middleware

`main.py` registers a `BaseHTTPMiddleware` that catches any exception a route doesn't handle itself and returns a plain `500 {"detail": "Internal server error."}`. This is **not** done via `@app.exception_handler(Exception)` — Starlette special-cases a handler keyed on `Exception`/`500` to run inside `ServerErrorMiddleware`, which is the outermost layer, added above every user middleware including CORS; its response bypasses `CORSMiddleware` entirely, so the client gets a 500 with no `Access-Control-Allow-Origin` header. A browser's `fetch()` then rejects with a network-level *"Failed to fetch"*, hiding the real status and body — this is exactly what happened for `.inp` imports before the fix (see ADR-0012's `FLOW_UNIT_SCALE` note for the underlying import bug; this middleware would have kept the error diagnosable for the client regardless).

The fix: register the middleware via `app.add_middleware()` **before** `CORSMiddleware`. Since `add_middleware` prepends to the middleware list, adding it first places it *inside* (closer to the router than) `CORSMiddleware` once both are registered — so the 500 response it builds still passes through `CORSMiddleware`'s `send` wrapper on the way out and gets CORS headers like any other response. Order matters here; do not reorder these two `add_middleware` calls. Regression test: `test/test_error_handling.py`.

### Engine Capabilities Endpoint

`GET /api/engine/algorithms` returns an `EngineAlgorithms` snapshot listing available graph types and heuristics with their parameter schemas. The frontend uses this to populate the graph-type selector and the algorithm pipeline editor in the Config modal. Requires at minimum `viewer` role. Returns `HeuristicMeta.param_schema` fragments so the frontend can render typed parameter forms instead of raw JSON textareas (Slice 1 uses raw JSON as a fallback when this endpoint is unreachable).

### Engine Isolation

The propagation algorithm lives in `CASCADE-backend/engine/`, a dedicated Python package. The isolation below is not about secrecy — the engine is published — but about keeping it a single extractable package, so that if part of it is privatized later (ADR-0009) the split touches one seam:

- **Exposed** to clients only through `PropagationResult` — never as source in the client bundle.
- **Imported only** by `CASCADE-backend/services/propagation_service.py` (the single seam for a future private submodule/service split — ADR-0008).

The `CASCADE-backend/core/` package contains open, auditable graph logic (rules, analysis, utilities); `CASCADE-backend/engine/` is the algorithm proper.

A Canvas with `graph_type = "epanet"` (ADR-0013) is a deliberate second, non-engine solve path — `services/epanet_solve_service.py` runs a live WNTR/EPANET solve instead of `engine.propagation.run` for that canvas, is engine-import-free by construction, and `propagation_service.py` still does the one engine-touching step (ratio→level quantization, reusing `engine.flow._ratio_to_level`) — so the single-seam property above holds unchanged.

### Authentication & Authorization

Identity is handled via OAuth2/OIDC, using the self-hosted open-source **Zitadel** provider (provider-agnostic in principle — any OIDC IdP works). Signup is self-service; a new user is provisioned in PostgreSQL on first authenticated request with the default `analyst` role (ADR-0010 amendment — `viewer` is the guest/demotion role). The server validates JWT access tokens on every request. RBAC role assignments and per-role **Entitlements** (quotas — see ADR-0008) are stored in PostgreSQL; the role→permission mapping is code-owned (`auth/rbac.py`). Both are enforced through FastAPI dependency injection.

Relevant permissions:

| Permission | Grants |
|---|---|
| `can_propagate` | Call the propagation engine (`POST /api/propagate`) |
| `can_sync` | Store and retrieve project files server-side |
| `can_manage_users` | List users, assign/change roles via admin API |
| `can_admin` | Wildcard — implies all others; guards admin-role escalation/deletion |

### Database — PostgreSQL

The database stores identity and access data (users, roles + entitlements, audit logs) and the per-run Analysis Log (ADR-0007) always. When server sync is enabled for a user, their project versions are stored here too. No project data is stored for users who have not opted in to sync.

---

## Data Flow — Propagation

All Canvases are operationally interdependent — inter-canvas edges exist in the global registry regardless of scope. Scope controls what the client **sends**, not how the engine filters.

1. User builds/edits networks and config locally in the browser.
2. User applies an Event (Hazard or Disservice) client-side: functionality drops, `direct_damage`, `attribute_mutations` are applied to the registry; an `event_applied` entry is pushed to `update_history`.
3. User clicks **Propagate**.
4. The frontend builds a trimmed `PropagationRequest` payload:
   - **Local scope**: includes only the active Canvas's `node_ids` and the edges whose both endpoints are within that Canvas. Inter-canvas edges are physically absent from the payload.
   - **Global scope**: includes the full `Project` — all nodes, all edges, all Canvases.
   - Both scopes strip engine-irrelevant bookkeeping (`update_history`, `scorecard`, and `source_inp_content` on non-EPANET canvases) — history snapshots and Scorecard PNGs would otherwise blow past the edge's 10MB body cap.
5. `api-client` sends `POST /api/propagate` with the payload and the user's JWT.
6. The server validates the token and checks `can_propagate`.
7. `propagation_service` passes the validated payload to `engine.propagation`.
8. The engine computes `PropagationResult` — an `ElementUpdate` list with updated `functionality`, `functionality_time`, `direct_damage`, `responsibility_share` — and returns it.
9. The server responds with the `PropagationResult` JSON body.
10. The frontend merges the updates into the **global registry** (by element ID) and pushes a `propagation` entry to `update_history`.

No project data is persisted on the server during this flow unless the user has enabled sync.

---

## Repository Layout

```
CASCADE-v2/
├── CASCADE-app/                # Next.js frontend
│   ├── app/                    # App Router pages (layout, page)
│   ├── components/             # React components by domain
│   │   ├── analysis/           # Centrality, timeline, model-based tools
│   │   ├── auth/               # User button, anonymous banner
│   │   ├── canvas/             # Topbar, Action Bar, Flow Canvas, Status Bar
│   │   │   └── inspector/      # Inspector panel — split by selection mode
│   │   │       ├── index.tsx           # Thin dispatch root (routes to sub-panels)
│   │   │       ├── node-inspector.tsx  # Single-node panel
│   │   │       ├── edge-inspector.tsx  # Single-edge panel
│   │   │       ├── canvas-meta.tsx     # Canvas/All-Canvases meta (nothing selected)
│   │   │       ├── multi-select-panel.tsx # Batch editing panel
│   │   │       ├── canvas-membership.tsx  # Shared canvas copy/move section
│   │   │       ├── cause-banner.tsx    # Compromised-element cause banner
│   │   │       ├── editors.tsx         # RulesEditor, PropertiesEditor
│   │   │       └── primitives.tsx      # Section, Field, TextInput, NumberInput, Toggle…
│   │   ├── controls/           # Category panel, config override, file I/O
│   │   │   └── config-modal/   # ModelConfiguration modal — split by tab
│   │   │       ├── index.tsx              # Thin shell (draft lifecycle, tab bar, footer)
│   │   │       ├── primitives.tsx         # TextInput, NumberInput, ColBtn, CollapsibleSection
│   │   │       ├── icon-picker.tsx        # IconPickerButton + module-level icon cache
│   │   │       ├── event-editors.tsx      # DirectDamageEditor, VulnerabilityLevelsEditor, AttributeMutationsEditor
│   │   │       ├── tab-functionality-scale.tsx
│   │   │       ├── tab-categories.tsx     # TabCategories + CategoryRow
│   │   │       ├── tab-events.tsx
│   │   │       ├── tab-graph-types.tsx
│   │   │       └── tab-node-defaults.tsx
│   │   ├── geo/                # MapLibre background behind React Flow (geo-map-background)
│   │   ├── help/               # User Manual drawer (mirrors docs/project/user-manual.md)
│   │   ├── onboarding/         # New Project Wizard, guided tour, first-run prompt
│   │   ├── rules/              # Rule editor, autocomplete, active rules panel
│   │   └── scorecard/          # Scorecard panels
│   ├── hooks/                  # Custom React hooks
│   │   ├── useHistoryAction.ts # Snapshot-wrap-push hook for undoable mutations
│   ├── lib/
│   │   ├── schemas/            # Zod schemas (network, config, api, primitives, audit)
│   │   └── …                   # Utilities, API client, rule parser, file I/O
│   ├── shared/
│   │   ├── schemas/            # Generated JSON Schema bridge files (do not edit manually)
│   │   └── rule-grammar.json   # Rule DSL grammar spec — shared seam (functions, operators, attributes, disabled prefix)
│   └── store/                  # Zustand stores (canvas, history, network, config,
│                               #   scorecard, analysis, clipboard, auth, ui)
├── CASCADE-backend/            # FastAPI backend
│   ├── api/                    # Route handlers
│   ├── auth/                   # OAuth2/OIDC + RBAC
│   ├── core/                   # Open graph/rule logic
│   │   └── rule_grammar.py     # Python adapter: loads rule-grammar.json, exports typed constants
│   ├── engine/                 # Propagation algorithm (isolated package)
│   ├── schemas/                # Pydantic models (network, config, results, engine, auth)
│   ├── services/               # Business logic orchestration
│   └── db/                     # PostgreSQL schema (users/roles + opt. project files)
├── docs/                       # Workspace-level docs and ADRs
├── CONTEXT.md                  # Domain glossary and resolved ambiguities
└── CLAUDE.md                   # AI-assisted development guidelines
```

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| UI Framework | Next.js | 16 | App Router, server/static rendering |
| Canvas | React Flow (`@xyflow/react`) | 12 | Interactive graph editor |
| State | Zustand + Immer | 5 / 11 | Lightweight, immutable stores |
| Styling | Tailwind CSS | 4 | Utility-first design system |
| Validation | Zod | 4 | Runtime schema validation, type inference |
| Maps | MapLibre GL JS | 5 | Open-source map background for georeferenced Canvases |
| API Server | FastAPI | — | High-performance async Python API |
| Backend validation | Pydantic v2 | — | Request/response schema enforcement |
| Auth | OAuth2/OIDC (provider-agnostic) | — | Identity, JWT validation |
| Database | PostgreSQL | — | Users, roles, permissions; opt. project sync |
| Engine | Python (isolated package) | — | Propagation algorithm (public now, proprietary later — ADR-0009) |
