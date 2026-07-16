# Experiments log — every attempt, its idea, and what happened

The institutional memory of the engine/importer fidelity work (2026-07).
Benchmark throughout: **FMS** (demand-weighted level agreement between
CASCADE's propagation and a live WNTR/EPANET PDD solve of the same
situation), swept over generated situations on Net1/Net3/Net6 + three real
aqueduct exports (Cassacco, Tarcento, Zampis — anonymized, never committed).
"Worst-10" = the 10 lowest-FMS situations across networks
(`collect_worst_situations.py` → `worst-situations/`, gitignored).

Legend: ✅ adopted / recommended · ❌ tried, worse or no effect · ⚠️ open.

---

## 1. Priority derivation (which junctions the engine sheds first)

| attempt | idea | result |
|---|---|---|
| ❌ Demand-multiplier failure-order sweep (`scarcity_priorities`, shipped) | Junctions WNTR abandons first as demand scales → low engine priority | Works, but its FMS contribution measured ≈ **0.000** (E3′ ablation) |
| ❌ Single-link-closure failure frequency (`contingency_priorities`) | Priority from *structural* fragility (who fails under closures), the question shedding actually answers | Also ≈ 0 FMS delta (`archive/complenet-sweeps/prio_contingency.csv`) |
| ❌ No priorities at all | Ablated arm | Indistinguishable (`prio_none.csv`; re-confirmed on worst-10, ≤0.01 everywhere) |

**Conclusion (superseded 2026-07-16, see below)**: priority is irrelevant to
*hydraulic-fidelity emulation* under the priority-greedy LP. Kept in
schema/UI regardless — it's the right lever for hand-built networks with no
.inp ground truth.

### 1a. Priority derivation UNDER TIERED FAIR-SHARE (2026-07-16)

The null result above was measured under the LP (where priority is only a
tie-break reward) and under a harness fair-share that ignored priority. The
shipped `tiered_fair_share` (ADR-0014) uses priority as **strict preemption
tiers**, and there the derivation matters a lot — in both directions
(`priority_modes_fairshare.py`, real engine, worst-10 kits, as-imported
capacities, raw FMS):

| priority mode | mean FMS | notes |
|---|---|---|
| pressure-margin (NEW: deciles of baseline PDD pressure surplus) | **0.665** | Zampis kits transformed (0.27→0.78, 0.40→0.62); one bad loss (Net3 kit 01: 0.62→0.34) |
| sweep (shipped importer derivation) | 0.620 | |
| none (single tier = pure max-min) | 0.514 | catastrophic on kits 04/10 (0.14, 0.02) — uniform pain is NOT what PDD does |
| (reference: priority-greedy LP + sweep) | 0.724 | |

Takeaways: (1) under fair-share, wrong tiers actively hurt — strict
preemption zeroes low tiers under scarcity, so 10 fine-grained tiers amplify
derivation errors; (2) **pressure-margin beats the demand sweep on average**
and is the physically-grounded derivation (PDD sheds where pressure margin
is thinnest), but with high variance — not a safe default switch yet;
(3) all of this is second-order next to the capacity fix (§2): these kits'
scarcity is largely an artifact of under-imported capacities, and with
margin ×2 + full-duplex the allocation/priority axis collapses to ≈0.92
regardless. (4) For *emulation* use, the LP still beats fair-share on
as-imported networks — worth considering having the .inp importer emit an
explicit `allocation: priority_greedy` on its graph type while fair-share
stays the hand-modelling default.

**Verification for the paper's simple story (2026-07-16, capfix +
fair-share, sweep vs none priorities, raw FMS)**: with margin ×2 +
full-duplex capacities, priorities have **zero effect on 9 of 10 kits**
(identical FMS to 3 decimals); the single exception is Zampis kit 06
(0.616 sweep vs 0.270 none — the network with the known `PFRC_*` import
anomaly). Means 0.858 vs 0.824. This supports presenting fair-share with
priority as a pure expert-knowledge knob: once capacities are parameterized
correctly, derived priorities are not needed for fidelity.

## 2. Pipe capacity discovery (importer)

| attempt | idea | result |
|---|---|---|
| ❌ Constant design velocity (1–2 m/s), no simulation | capacity = π/4·d²·v_design | Much worse than the sweep (worst-10 mean 0.681–0.791 vs 0.770 control) — the sweep's *relative* profile is real signal |
| ❌ Hazen-Williams design flow from pipe physics alone, no simulation (`physical_capacity_variants.py`) | capacity = 0.278·C·D^2.63·S^0.54 from imported diameter+roughness only — zero WNTR sweep needed | Correlates with shipped capacity (log-log Pearson r=0.84 across 3271 pooled pipes) but the correlation is ~entirely diameter (r=0.844 for diameter alone; roughness spans only 91–199 vs diameter's 2+ orders of magnitude, contributes almost nothing) — best-fit-scaled variant on worst-10: mean 0.821→0.724, worse on 7/10, tied 3/10, never better. A per-pipe geometric formula can't see what the sweep sees: topology + demand distribution (a fat pipe past a light-demand branch needs no capacity; D,C alone can't tell) |
| ✅ Demand-multiplier sweep peak velocity (shipped) | "What can this pipe do when pushed" ≠ its idle flow | The baseline everything else builds on |
| ✅ + contingency closures, trunk-biased → exhaustive trunk + N-2 pairs (shipped) | Backup pipes only reveal capacity when something else closes (Net3 pipe 317: 0.44→several× m/s) | Headline import config (E3″/E3‴; `cap_*.csv`, `pairsweep_*.csv` in archive) |
| ❌ Strict noise floor + dominance ratio for orientation | Be "smarter" about near-zero readings | Reverted — confidently wrong direction can disconnect a whole mesh branch (ADR-0012 "Pipe capacity / orientation") |
| ✅ **Capacity margin ×2** (`importer_variants.py`, recommended, not yet shipped) | Sweep peak is a *lower bound*; EPANET has no hard cap, head loss absorbs ~2× overshoot | Worst-10 mean 0.770→0.878 alone; ×2 is the knee — ×3/×5 buy little and grow over-optimism (231→313 Σopt), regress Zampis kit 06 |
| ❌ Velocity floor 0.5–2 m/s | Floor only the weakly-observed pipes | Helps (0.840 @ 2 m/s) but strictly dominated by the plain margin |

## 3. Orientation / direction (importer)

| attempt | idea | result |
|---|---|---|
| ✅ Sign-of-simulated-flow orientation + proportional bidirectional split (shipped) | Orient by physics, not BFS guess | Shipped; but the *proportional share* is the flaw below |
| ✅ **Full-duplex split (`split_full`, recommended)** | Both directions of a two-way pipe get the FULL physical capacity (a pipe carries all of it either way, just not both at once) | +0.05 mean on top of margin ×2 → combined **0.927**, 8/2/0 vs control; fixes tank-feeder reversals (recharge-dominated share starved the discharge direction) |
| ❌ Synthetic reverse edge on every one-way pipe (`bidir`) | EPANET links are undirected; maybe CASCADE needs both directions everywhere | No help, slight harm from degenerate ties — the sweep's one-way calls are trustworthy; only the split *shares* were wrong |
| ❌ Half-capacity floors (`split_floor_0.5`) | Hedge between proportional and full | Worse than full duplex |

## 4. Tanks / pumps / valves / supply (importer)

| attempt | idea | result |
|---|---|---|
| ❌ Uncap pumps (curve max) and valves | Curve-derived caps might undersize | **Zero effect** on all 10 worst kits — not binding |
| ❌ Unbounded source supply | "supply = Σ incident pipe capacity" might throttle | **Zero effect** — not binding |

No tank/pump/valve capacity issue exists in the worst situations; the
pessimism was pipes (capacity level + split shares) all along.

## 5. Allocation algorithm (engine-side, tested via monkeypatch harness only)

| attempt | idea | result |
|---|---|---|
| ❌ Global proportional water-filling | One θ scaling every consumer | Disaster (worst-10 mean 0.373) — punishes consumers unrelated to the bottleneck |
| ❌→ moot: Max-min fair-share (ascending-demand sequential max-flow) | Spread scarcity like real pressure does, vs the LP's winner-take-all | Won 7/10 on *as-imported* capacities (0.774 vs 0.724) — but with the capacity fix applied it's **slightly worse** (0.918 vs 0.927) and ~100× slower. Its wins were compensating for under-imported capacity. **Keep the shipped LP.** |
| ❌ Bisection-based fair-share | Shared-θ freeze/continue | Buggy by construction — max-flow's arbitrary decomposition makes per-consumer attainment unreadable (FMS≈0 on kit 01) |

## 6. Benchmark (ground truth) corrections

| finding | consequence |
|---|---|
| ✅ Net6 global default pattern silently scaled "fixed" demands ×0.1 | Fixed in `_fixed_demand_model` (shipped) |
| ⚠️ **Singular PDD on source-severed components**: WNTR converges to an arbitrary internal circulation that *reads* "fully served" | Kits 05/07 (Cassacco): CASCADE's all-critical answer was **correct**, the "ground truth" wrong. Corrected in `importer_variants.py` (undirected source-reachability → level 1); **`scripts/validate_faithfulness.py` still has this artifact** — fixing it will raise reported FMS everywhere |
| Set-iteration nondeterminism (hash seed → edge insertion order → degenerate LP tie flips) | Root cause of the original engine bug AND a harness bug here; `engine/flow.py` retains the latent property (`members` set) — worth `sorted()` when next touched |

## 7. Still open

- ⚠️ **Zampis kit 09** (targeted#26, 198 pessimistic mismatches): immune to
  capacity ×5, full duplex, reverse edges, unbounded supply, and every
  allocation algorithm — strongest evidence for the suspected `PFRC_*`
  sub-network import anomaly (likely a mis-modelled connection). Needs its
  own investigation before trusting Zampis numbers.
- ⚠️ Apply the winning combo (margin ×2 + full-duplex split) for real in
  `core/importers/inp/map.py`, and the severed-component correction in
  `validate_faithfulness.py`.

## Files

This file is the **single tracked narrative** for all experiment attempts —
every other doc (ADRs, CONTEXT.md, project docs) links here instead of
retelling the journey. Tracked alongside it: the harness scripts only.

- `importer_variants.py` — importer-attribute A/B (22 variants × worst-10)
- `algorithm_variants.py` — allocation-algorithm A/B (monkeypatch harness)
- `priority_modes_fairshare.py` — priority-derivation ablation under tiered fair-share
- `collect_worst_situations.py` — builds the worst-10 kits; `render_variant_bundles.py` — bakes variant results into loadable bundles for screenshots
- `run_headline_fairshare.sh` — the paper's headline benchmark configuration
- `archive/` (gitignored, local-only) — full detail: per-experiment reports, result CSVs, logs, CompleNet sweep outputs
- `worst-situations/` (gitignored, **never commit** — real aqueduct data): per-kit `scenario.bundle.json`, engine/EPANET results, `combined5.png` visual comparisons

## 8. Headline benchmark (2026-07-16, +Net2 2026-07-16) — the paper's numbers

Full re-run after shipping the capacity fix: 6 networks (Net1, Net2, Net3,
Cassacco, Tarcento, Zampis) × 3 seeds × 30 situations + exhaustive tanks,
exhaustive-trunk + 30 N-2 pairs + 20 uniform contingencies, **engine default
tiered fair-share, NO derived priorities (`--priority-mode none`)**,
corrected ground truth (severed-component + convergence checks). Net2 added
after the original 5-network run to restore parity with the paper's
originally-drafted "six networks, three textbook" framing; its known
negative-demand well junction is handled correctly by the shipped
injection-well fix (§4), no separate treatment needed. Raw data:
`archive/results/headline_fairshare_none.csv` (537 rows; the original
444-row 5-network file plus 93 Net2 rows, `net2_addon.csv`, merged in).

| | mean FMS | min | n |
|---|---:|---:|---:|
| **AGGREGATE** | **0.958** | | 537 |
| Net1 | 0.988 | 0.818 | 93 |
| Net2 | 0.937 | 0.232 | 93 |
| Net3 | 0.990 | 0.857 | 99 |
| Cassacco | 0.992 | 0.823 | 90 |
| Tarcento | 0.990 | 0.370 | 70 |
| Zampis | 0.857 | 0.002 | 92 |

By family: break 0.983, tank 0.976, cluster 0.968, hot 0.962, targeted
0.939, both 0.934 — **"both" (demand-surge stacked on breaks) is the
actual weakest family, not targeted alone**; the paper's Discussion
originally claimed targeted attack was "consistently the weakest," which
was already imprecise before Net2 was added (both was 0.939 in the
5-network run too) — corrected in the paper text. Zampis remains the
outlier (known `PFRC_*` import anomaly, ATTEMPTS §7) with a heavy tail —
disclosed in the paper's limitations. Every other network sits ≈0.94–0.99
with **zero fitted parameters** (no priorities, no per-network tuning).

Binary-confusion recheck (Appendix~app:extended in the paper): the
original plan expected recall on the critical class to degrade under
harder families. It doesn't (0.81 under break → 0.97 under both,
pooled n=537) — **precision** collapses instead (0.92 → 0.35). The
module gets more false-positive-critical, not more false-negative-critical,
as families get harder — consistent with the disclosed pessimism bias, but
the opposite of what was originally predicted.
