# Algorithm variant comparison — worst 10 situations

Tests three SourceToDemands flow-allocation algorithms against the 10
hardest situations found earlier (lowest FMS vs live EPANET/WNTR ground
truth). Built **without touching any shipped backend file**: `engine/flow.py`
and `engine/propagation.py` are untouched on disk — the harness
(`experiments/algorithm_variants.py`) monkeypatches `engine.propagation`'s
own reference to `flow_category_candidates` at runtime, for the duration of
one call, so every other part of the real engine (round iteration, guards,
Requisite/logical mechanism, convergence, commit) runs unmodified; only the
flow-allocation math differs. Priority (a second, independent axis — see
below) is varied by mutating a project copy before the call.

## Algorithms tested

Selected by graph-type name, mirroring how the real "epanet" escape hatch is
selected (ADR-0013), but purely within this offline harness:

- **`water_network`** — the real, shipped algorithm (control). Priority-reward
  min-cost-max-flow (`nx.max_flow_min_cost`) — a single global LP optimum;
  under a shared bottleneck it is winner-take-all (some consumers get 100%,
  others exactly 0%), which is where the pessimism trend traced back to.
- **`water_network_proportional`** — one-shot global water-filling: find the
  single scale factor θ such that giving every consumer θ×demand is
  simultaneously feasible network-wide, deliver that. Cheap (one bisection),
  ignores priority entirely.
- **`water_network_fairshare`** — max-min fair-share via ascending-demand
  sequential water-filling: process consumers smallest-demand-first, freeze
  each at what a single max-flow call gives it (with every already-processed
  consumer's sink capacity fixed at its own achieved amount), continue. One
  max-flow call per consumer; no bisection, no flow-decomposition ambiguity.

An earlier bisection-based fairshare design was discarded after producing an
obviously-wrong result (FMS≈0 — every consumer capped at the same global
ratio) caused by `nx.maximum_flow`'s arbitrary flow decomposition making
"did this specific consumer hit its own local bottleneck" unreadable from a
shared-θ solve. The sequential design sidesteps that ambiguity entirely.

**A real, separate finding surfaced while debugging this**: `_build_base_graph`'s
member iteration originally used a bare `set`, whose iteration order is
per-process hash-seed dependent — the *exact* mechanism behind the original
engine bug this whole investigation started from (ADR-0003's 2026-07-11
addendum). Sorting it removed run-to-run FMS variance of up to ~0.05 on the
larger networks. `engine/flow.py` has the same latent property and was
intentionally left untouched (out of scope here), but is worth fixing for
real if this work continues.

## Priority axis (independent of algorithm)

Re-confirmed on all 10 kits × all 3 algorithms: **priority mode changes
almost nothing.** `sweep` (imported failure-order priority) vs `none`
(uniform) differ by ≤0.01 FMS everywhere except two Zampis kits (±0.01) and
one Cassacco kit (07: 0.760→0.809, the one case with any real movement, and
that's noise-sized). Full 60-row data in `algorithm_variants_report.csv`.

**Recommendation for the product, not just this analysis**: priority stays
in the model as a modeller-facing knob. It is proven irrelevant to matching
*hydraulic* fidelity — but a user without an `.inp` file, building a network
from expert knowledge alone, has no ground truth to match at all; priority
is their only lever to express "serve the hospital before the car wash" when
supply runs short, regardless of which allocation algorithm sits underneath.
Useless for the emulator is a *good* outcome here, not a reason to remove it.

## Results (sweep priority mode; full data in the CSV)

| kit | baseline | proportional | fairshare |
|---|---:|---:|---:|
| 01 Net3 targeted#27 | 0.606 | 0.004 | **0.622** |
| 02 Net1 both#12 | 0.608 | 0.134 | 0.608 (tie) |
| 03 Zampis targeted#22 (s1) | 0.712 | 0.395 | **0.825** |
| 04 Net1 cluster#10 | 0.727 | 0.136 | **1.000** |
| 05 Cassacco targeted#2 | 0.734 | 0.734 | 0.734 (tie — no allocation ambiguity in this cut) |
| 06 Zampis targeted#22 (s2) | 0.758 | 0.270 | 0.760 (~tie, see caveat) |
| 07 Cassacco targeted#3 | 0.760 | 0.383 | **0.809** |
| 08 Net3 cluster#17 | 0.770 | 0.131 | **0.773** |
| 09 Zampis targeted#26 | 0.780 | 0.553 | 0.780 (tie) |
| 10 Net3 targeted#4 | 0.785 | **0.989** | 0.833 |
| **mean** | **0.724** | **0.373** | **0.774** |
| **win/tie/loss vs baseline** | — | 1 / 1 / 8 | **7 / 3 / 0** |

Fairshare **never loses** to the baseline on any of the 10 hardest cases and
wins outright on 7, sometimes dramatically (kit 04: 0.727→1.000, exact
match; kit 03: +0.11). Proportional is a clear **negative** result — global
uniform rationing punishes consumers who have nothing to do with the actual
local bottleneck, and is worse than the current algorithm on 8 of 10 kits.
Aggregated over all 10 kits: too-pessimistic mismatches drop from 806 to 614
(−24%); too-optimistic mismatches rise from 167 to 237 — fairshare trades a
few new false-not-criticals for a much larger reduction in false-criticals,
consistent with a genuine trade-off (redistributing bottleneck capacity to
previously-starved consumers necessarily gives some of them *more* than they
had, occasionally past the true level).

**Kit 05 (Cassacco targeted#2) is identical across all three algorithms** —
the same 124 mismatches regardless of allocation strategy. That is the
signature of a **hard topological cut**, not an allocation-fairness problem:
there is no choice being made, no tie to break, just literally no path.
Fairshare (or any allocation-shape fix) cannot help here — this points at a
capacity/topology import gap specific to that scenario, a different kind of
fix than the one this experiment tests.

**Kit 06** is the one place fairshare's trade-off shows up clearly:
too-pessimistic drops (150→95) but too-optimistic rises more (93→147), a
mild net FMS gain (0.758→0.760) that undersells how much the error pattern
actually shifted. Zampis in general (kits 03/06/09) is also where the
`PFRC_*`-prefixed sub-network was independently flagged as a likely
importer-side (capacity/orientation) issue, separate from allocation shape —
worth investigating on its own before trusting Zampis's numbers fully either
way.

## Images

`experiments/worst-situations/<kit>/combined5.png` — five panels per kit,
side by side: starting scenario, EPANET ground truth, CASCADE baseline
(current algorithm), proportional, fairshare. Georeferencing stripped from
every capture (the real aqueduct kits would otherwise render over real
MapLibre map tiles showing the utility's true location — a direct violation
of the anonymization constraint; caught and fixed before any image left this
machine). **Kit 04 is the clearest single illustration**: baseline
over-reddens roughly half the small loop network, proportional makes it
uniformly worse, fairshare reproduces the EPANET ground truth exactly.

## Recommendation

**Prototype max-min fair-share (`water_network_fairshare`) as a real
alternative allocation mode in `engine/flow.py`**, gated behind an explicit
choice (not a silent replacement of the current algorithm — the current one
is simpler, faster, and may be preferable for interactive/low-latency use;
fair-share costs one `nx.maximum_flow` call per consumer, materially slower
on large networks — Zampis/607 junctions took ~140s per solve here, vs the
current algorithm's single LP call). It is the only alternative tested that
consistently helps and never hurts. Do **not** pursue global proportional
rationing further — it is a clear regression, kept in the report only
because it was worth measuring, not because it's a candidate.

Before committing to an engine change: (1) fix kit 05's underlying
topology/capacity gap first, since no allocation algorithm can fix a true
cut; (2) resolve the Zampis `PFRC_*` import question separately; (3) if
fair-share is adopted, its runtime cost needs a real fix (batched/incremental
max-flow, or a bound on iteration count) before it's viable beyond a handful
of hundreds of junctions.
