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

**Conclusion**: priority is irrelevant to *hydraulic-fidelity emulation* under
every allocation algorithm tested. Kept in schema/UI regardless — it's the
right lever for hand-built networks with no .inp ground truth.

## 2. Pipe capacity discovery (importer)

| attempt | idea | result |
|---|---|---|
| ❌ Constant design velocity (1–2 m/s), no simulation | capacity = π/4·d²·v_design | Much worse than the sweep (worst-10 mean 0.681–0.791 vs 0.770 control) — the sweep's *relative* profile is real signal |
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

- `importer_variants.py` + `importer_variants_report.md` + `importer_variants_stage{1,2}.csv` — importer-attribute A/B (22 variants × worst-10)
- `algorithm_variants.py` + `algorithm_variants_report.md` + `algorithm_variants_report.csv` — allocation-algorithm A/B
- `collect_worst_situations.py` — builds the worst-10 kits; `render_variant_bundles.py` — bakes variant results into loadable bundles for screenshots
- `archive/complenet-sweeps/` (gitignored) — raw CompleNet E-run outputs; headline numbers live in the paper and `docs/paper/.../complenet_todos.md`
- `worst-situations/` (gitignored, **never commit** — real aqueduct data): per-kit `scenario.bundle.json`, engine/EPANET results, `combined5.png` visual comparisons
