# Importer-attribute variants — worst 10 situations

Follow-up to `algorithm_variants_report.md`. That experiment varied the
*allocation algorithm*; this one varies the *importer-derived attributes*
(edge capacity, orientation, supply) that the algorithm consumes — again with
**zero shipped-file edits** (`experiments/importer_variants.py` rescales
attributes directly on the kit bundles and reuses the monkeypatch harness).
All capacity variants are computed from the `diameter_m` / `velocity_ms`
properties every imported edge already carries — no WNTR re-sweep needed, so
the full 22-variant × 10-kit sweep runs in minutes.

## First-principles diagnosis

What EPANET actually solves: head-based nonlinear equations (Hazen-Williams /
Darcy-Weisbach head loss) with pressure-driven demand (Wagner: full demand
above 20 m, nothing below 0 m). Three structural mismatches with CASCADE's
capacitated-max-flow abstraction follow:

1. **Real pipes have no hard capacity.** Pushing more flow just costs more
   head. CASCADE's per-pipe cap = π/4·d²·v_peak, with v_peak the largest
   velocity the import-time stress sweep happened to observe. Any hazard
   forcing MORE flow through a pipe than the sweep ever exercised hits an
   artificial ceiling real hydraulics doesn't have → systematic pessimism.
   This is the root of the "engine is always a bit more pessimistic" trend.
2. **EPANET links are undirected; CASCADE edges are frozen** at the sweep's
   observed direction (bidirectional pipes get a *proportional* capacity
   split). A reversal the sweep never saw — e.g. a tank feeder that normally
   recharges but must discharge when its upstream feed breaks — is starved to
   a sliver of capacity.
3. **A severed component isn't EPANET-solvable at all** — see the
   ground-truth correction below.

## Ground-truth correction (a real bug in the benchmark, not the engine)

Debugging kit 05 (Cassacco targeted#2, previously "identical across all
algorithms, hard topological cut") revealed the cut is real **in the .inp
too**: the three broken trunk pipes sever the whole network from both
reservoirs. WNTR/EPANET's PDD solve for such a component is **singular** — it
converges without warning to an arbitrary internal circulation (signed
demands summing to ~0) that *reads* as "fully served" for ~124 junctions.
Physically nobody gets water; CASCADE's all-critical answer was **correct**
and the raw FMS was penalizing it. The harness therefore corrects each kit's
ground truth: any demand junction with no undirected path to a functional
source through non-broken elements → true level 1. Kits 05 (410 junctions)
and 07 (243) are affected; corrected control FMS rises 0.724 → 0.770 mean.
`scripts/validate_faithfulness.py` inherits this artifact — worth fixing
there (and in the paper numbers) as a separate task.

## Results (baseline allocation algorithm, corrected FMS, 10 kits)

| variant | mean FMS | win/tie/loss vs control | Σpess | Σopt |
|---|---:|---|---:|---:|
| **margin_2.0 + split_full** | **0.927** | **8 / 2 / 0** | 300 | 246 |
| margin_3.0 + split_full | 0.923 | 8 / 2 / 0 | 300 | 277 |
| margin_5.0 | 0.920 | 8 / 2 / 0 | 291 | 313 |
| margin_3.0 | 0.908 | 8 / 2 / 0 | 298 | 299 |
| margin_2.0 | 0.878 | 7 / 3 / 0 | 359 | 231 |
| split_full | 0.874 | 8 / 2 / 0 | 515 | 203 |
| vfloor_2.0 | 0.840 | 7 / 3 / 0 | 516 | 202 |
| control (as imported) | 0.770 | — | 588 | 167 |
| bidir_1.0 (reverse edge on every pipe) | 0.772 | 1 / 5 / 4 | 588 | 174 |
| uncap_pv / supply_unbounded | 0.770 | 0 / 10 / 0 | 588 | 167 |
| constv_1.0 (ignore sweep, 1 m/s design) | 0.681 | 2 / 3 / 5 | 699 | 93 |

Variant glossary: `margin_k` multiplies every pipe/valve capacity by k (source
supply re-derived consistently); `split_full` floors BOTH directions of each
already-split bidirectional pipe at the pipe's full physical capacity (full
duplex — physically a pipe carries its whole capacity either way, just not
both at once); `vfloor_v` floors the sweep velocity at v m/s; `bidir` adds a
synthetic reverse edge to every one-way pipe; `constv` discards the sweep and
uses one design velocity; `uncap_pv` lifts pump/valve caps;
`supply_unbounded` removes source supply limits.

### What the negatives establish

- **The sweep earns its keep**: replacing it with any constant design
  velocity is much worse (0.681–0.791). The sweep's *relative* capacity
  profile is right; only its absolute level is too tight.
- **Pump curves, valve caps and the supply rule are not binding** — lifting
  them changes nothing (0.770 exactly, all 10 kits). No tank/pump/valve
  capacity issue exists in these situations.
- **Blanket bidirectionalization doesn't help** (and slightly hurts via
  degenerate-tie noise). The orientation problem is specifically the
  *proportional split share* on pipes already known to be two-way — fixed by
  `split_full` — not missing reverse edges in general.

### Allocation algorithm interaction (stage 2)

With capacities fixed, the fair-share algorithm from the previous experiment
**stops paying**: fairshare mean is 0.820/0.880/0.907 on control/margin_2/
margin_3 vs baseline's 0.770/0.878/0.908 — and on the winning variant
fairshare is *worse* (0.918 vs 0.927; it overshoots into optimism on Zampis
kit 06). Fairshare's earlier wins were mostly *compensating for under-imported
capacities* by spreading an artificial shortage more realistically. Fixing
the importer is cheaper (zero runtime cost vs one max-flow per consumer) and
strictly better. **Keep the current engine algorithm.**

### Per-kit (corrected FMS)

| kit | control | margin_2.0 | margin_2.0+split_full |
|---|---:|---:|---:|
| 01 Net3 targeted#27 | 0.606 | 0.840 | **0.996** |
| 02 Net1 both#12 | 0.608 | 0.608 | **0.866** |
| 03 Zampis targeted#22 (s1) | 0.712 | 0.793 | **0.844** |
| 04 Net1 cluster#10 | 0.727 | 1.000 | **1.000** |
| 05 Cassacco targeted#2 | 1.000 | 1.000 | 1.000 |
| 06 Zampis targeted#22 (s2) | 0.758 | 0.843 | **0.844** |
| 07 Cassacco targeted#3 | 0.952 | 1.000 | **1.000** |
| 08 Net3 cluster#17 | 0.770 | 0.933 | **0.950** |
| 09 Zampis targeted#26 | 0.780 | 0.780 | 0.780 |
| 10 Net3 targeted#4 | 0.785 | 0.989 | **0.989** |
| **mean** | **0.770** | **0.878** | **0.927** |

Kit 09 (Zampis targeted#26, 198 pessimistic mismatches) is immune to *every*
variant — capacity ×5, full duplex, reverse edges, unbounded supply — so its
gap is neither capacity nor orientation nor allocation. It is the strongest
remaining evidence for the previously-flagged `PFRC_*` sub-network import
anomaly (likely a mis-modelled connection), and needs its own investigation.

## Recommendation

Change the **importer**, not the engine:

1. **Capacity margin ×2** on the sweep-derived pipe/valve capacity
   (`map._pipe_capacity` × 2, supply re-derived as today). Physically honest:
   the sweep observes velocities under a *bounded* scenario set, so its peak
   is a lower bound on deliverable flow; EPANET lets head loss absorb roughly
   this much overshoot before pressure actually collapses. ×2 is the knee of
   the curve — ×3/×5 keep buying a little mean FMS but visibly grow
   too-optimistic errors (231 → 299 → 313) and regress Zampis kit 06.
2. **Full-duplex split pipes**: when the sweep marks a pipe bidirectional,
   give BOTH directional edges the full physical capacity instead of a
   proportional share (drop `_emit_split`'s share arithmetic and
   MIN_HEDGE_SHARE — a strict simplification). The proportional split
   answered "how is this pipe used normally?" when the question is "what can
   this pipe do when the network is re-routed around a failure?".
3. **Keep the current allocation algorithm** (winner-take-all LP) — with the
   capacity fix, fair-share no longer wins and costs far more runtime. Do not
   pursue proportional rationing or blanket reverse edges.
4. **Fix the benchmark**: teach `validate_faithfulness.py` (and any FMS
   reporting) to mark source-severed demand junctions level 1 instead of
   trusting the singular PDD solve.
5. Keep `priority` as a modeller-facing knob (unchanged conclusion —
   irrelevant to hydraulic fidelity, still the right lever for hand-built
   networks without ground truth).

Data: `importer_variants_stage1.csv` (22 variants × 10 kits, baseline
algorithm, raw + corrected FMS), `importer_variants_stage2.csv` (fairshare on
the finalists). Harness: `experiments/importer_variants.py` (nothing shipped
was modified).
