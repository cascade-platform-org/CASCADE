# ADR-0006 — Scorecard Entry as Discriminated Union

**Status:** Accepted  
**Date:** 2026-06-17

---

## Context

The Scorecard was originally designed exclusively for Propagation results: each entry stored a before/after Scenario pair and the raw `PropagationResult`. The Topological Analysis feature (Slice 3) produces a qualitatively different kind of result — per-Element centrality scores, NofN structural metrics, model-based Vitality and Shapley values — that users need to persist and compare across sessions. These are not Scenarios and carry no `PropagationResult`.

Three alternatives were considered:

1. **Separate export only** — analysis results are never stored in the Scorecard; users download a PNG/JSON. Loses in-app comparison across time; the Scorecard becomes the right place for both kinds of insight.
2. **Annotate existing Propagation entries** — add an optional `analysis` field to the existing `ScorecardEntry`. Breaks Single Responsibility: a Propagation entry and an Analysis result are different concerns. Also breaks when the user saves analysis on a baseline graph with no Propagation.
3. **Discriminated union** — `ScorecardEntry` becomes `PropagationScorecardEntry | AnalysisScorecardEntry`, discriminated by `type: "propagation" | "analysis"`. Each variant carries only the fields relevant to it.

## Decision

Extend `ScorecardEntry` to a **discriminated union** on `type`.

### `PropagationScorecardEntry` (`type: "propagation"`)
Unchanged from the existing schema — see requirements §12.

### `AnalysisScorecardEntry` (`type: "analysis"`)

| Field | Type | Description |
|---|---|---|
| `type` | `"analysis"` | Discriminant |
| `id` | string | Unique entry id |
| `label` | string | User-editable label |
| `created_at` | ISO timestamp | |
| `metric` | string | The Analysis Metric name (e.g. `"betweenness"`, `"vitality"`, `"shapley"`) |
| `scope` | `"local" \| "global"` | Active Canvas or full multi-canvas |
| `canvas_id` | string? | Set when `scope = "local"` |
| `scores` | `{ [elementId]: number }` | Per-Element score at time of computation |
| `snapshot` | GraphSnapshot | Graph state at time of computation (for reproducibility) |
| `image_png` | string? | Base64 PNG of the canvas with Analysis Heatmap applied |

## Consequences

- Pydantic model in `CASCADE-backend/schemas/` must be updated to a union type before any backend work touches the Scorecard.
- Zod schema in `CASCADE-app/lib/schemas/` must be updated in the same session (schema-first rule).
- All Scorecard consumers (panel UI, export, gap detection) must handle both entry types via a type-narrowing switch on `entry.type`. Existing Propagation paths are unchanged.
- The Scorecard ZIP export (§12.7) gains an `analysis/` directory alongside `images/` for analysis entries.
