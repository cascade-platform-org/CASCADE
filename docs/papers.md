# From the papers to the code

If you arrived here from one of the CASCADE papers, this page maps what you read
to what runs. The LaTeX sources under [`docs/paper/`](paper/) are preprints —
pre-refereeing versions of manuscripts under review; the peer-reviewed versions
of record live with their publishers.

---

## Composable, Knowledge-Driven Disservice Propagation for Complex Interdependent Services

A category-typed propagation architecture in which quantity-aware and purely logical
interdependencies share one discrete functionality scale and converge through a single
monotonic update rule. The flow module — a max-min fair-share allocation — is built
directly from EPANET files by a hydraulic-sweep importer and validated against
pressure-driven WNTR simulation on eight networks, three of them real Italian
aqueducts, across four failure families.

| Paper section                                                                                          | Code                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.3 Logical propagation (`worst_of` / `best_of`, the three aggregation steps)                    | [`CASCADE-backend/engine/logical.py`](../CASCADE-backend/engine/logical.py)                                                                |
| §3.4 Flow module (priority-tiered max-min fairness, the auxiliary graph, node splitting)              | [`CASCADE-backend/engine/flow.py`](../CASCADE-backend/engine/flow.py)                                                                      |
| §3.5 Guards (dependency level, backup deferral) and the shared propose → guard → commit rule        | [`guards.py`](../CASCADE-backend/engine/guards.py), [`propagation.py`](../CASCADE-backend/engine/propagation.py)                          |
| §4 The EPANET importer (orientation from flow sign, design-velocity capacity, the pump-fed tank rule) | [`CASCADE-backend/core/importers/inp/`](../CASCADE-backend/core/importers/inp/) — `sim.py` runs the sweeps, `map.py` builds the model |
| §5 Validation protocol, FMS, the four failure families, the two baselines                             | [`experiments/aqueducts/validate_faithfulness.py`](../experiments/aqueducts/validate_faithfulness.py)                                  |
| §5 Table 1 and the headline numbers                                                                   | [`experiments/aqueducts/paper_numbers.py`](../experiments/aqueducts/paper_numbers.py)                                                      |

### Reproducing the numbers

Every per-situation result is in
[`experiments/aqueducts/results/`](../experiments/aqueducts/results/) — one row per
situation, with FMS, the confusion counts, and both baselines. Every table in the
paper and the Supplementary Material recomputes from these CSVs:

```bash
cd experiments/aqueducts
python3 paper_numbers.py        # Table 1, the headline figures, bootstrap CIs
python3 aggregate_final.py      # per-family / per-network breakdown
```

The ablations each have their own runner, all reported in Supp. S5 unless noted:
`orientation_ablation.py`, `run_capacity_drill_ablation.sh` (the capacity-method
comparison), `priority_steering.py` (the controllability arms),
`margin_sweep.py` (the capacity-margin sensitivity, Supp. S7), and
`cost_benchmark.py` (Supp. S8).

[`ATTEMPTS.md`](../experiments/aqueducts/ATTEMPTS.md) is the running log of every
approach tried and rejected — it is the source for the negative results in
Supplementary S7, several of which were measured on a superseded version of the
importer and are recorded there rather than reproducible from a current script.
[`benchmark-protocol.md`](../experiments/aqueducts/benchmark-protocol.md) is the full
specification of the experimental setup.

### About the networks

The five public benchmarks (Net1, Net2, Net3, Modena, C-Town) are in
[`raw-networks/aqueducts/`](../raw-networks/aqueducts/), so anything not depending on
the private data can be re-run end to end. The three real aqueducts — Aqueduct A, B
and C in the paper — are proprietary utility exports and are **not** distributed; the
result CSVs for them are included, with the network column carrying only the
anonymized label.

---

## Series and Parallel Dependency Links: Vitality for Interdependent Networks of Networks

Existing network-of-networks models give every dependency link the same reading:
either failure travels along all of them, or a node survives while any one supplier
remains. This paper lets the two coexist by labelling nodes with the services they
provide — two links entering a node are alternatives when they carry the same service,
and both required when they carry different ones. Node importance is then the ordinary
vitality index of the resulting operativity.

| Paper section                                                                                                                   | Code                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| §5.1 Relabelling a fixed graph — same nodes, same links, only the service labels change                                       | [`experiments/centrality/category_ablation.py`](../experiments/centrality/category_ablation.py) |
| §5.2 The series limit — where a topological ranking is exactly right, and how its accuracy falls as parallel structure enters | [`experiments/centrality/regime_probe.py`](../experiments/centrality/regime_probe.py)           |
| §3 When a node's required services are computed, and what that choice does to the index                                        | [`experiments/centrality/vitality_class.py`](../experiments/centrality/vitality_class.py)       |

The propagation model these measure is the same engine as the first paper:
[`CASCADE-backend/engine/`](../CASCADE-backend/engine/).

---

## Customizable Assessment of System Cascades And Dependency Effects for Improving Resilience of Interdependent Essential Services

The framework paper (submitted to the *International Journal of Disaster Risk
Reduction*). It presents CASCADE end to end — the compositional network-of-networks
model, the functionality-status propagation engine (logical aggregation plus a
capacity-aware flow pass, reconciled through one monotonic propose → guard → commit
rule), and a sampling-based Shapley analysis that ranks nodes and edges by their
marginal contribution to Operativity loss — and demonstrates it on a synthetic
39-node, 93-edge multi-utility network of the Palmanova area under an earthquake, a
flood, and a digital-attack scenario.

| Paper section                                                                                     | Code                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §3.1 Operativity Score $\Omega(s)$ and the equal / importance / cost-of-disservice weightings     | [`CASCADE-app/lib/scorecard-utils.ts`](../CASCADE-app/lib/scorecard-utils.ts), [`CASCADE-app/lib/oi-weight-attrs.ts`](../CASCADE-app/lib/oi-weight-attrs.ts)                        |
| §3.3 Propagation engine: universal logical pass, capacity-based (min-cost max-flow) pass          | [`CASCADE-backend/engine/propagation.py`](../CASCADE-backend/engine/propagation.py), [`logical.py`](../CASCADE-backend/engine/logical.py), [`flow.py`](../CASCADE-backend/engine/flow.py) |
| §3.3 Heuristic pipeline: dependency-level attenuation, time-limited backup deferral, monotone commit | [`CASCADE-backend/engine/guards.py`](../CASCADE-backend/engine/guards.py)                                                                                                          |
| §3.3 Specific-rule override (`if … then … is …`), rule parsing and the `best_of` / `worst_of` / `average_of` aggregators | [`CASCADE-backend/engine/rules_eval.py`](../CASCADE-backend/engine/rules_eval.py), [`core/rule_parser.py`](../CASCADE-backend/core/rule_parser.py), [`core/rule_grammar.py`](../CASCADE-backend/core/rule_grammar.py), [`core/aggregation.py`](../CASCADE-backend/core/aggregation.py) |
| §3.4 Shapley-based neuralgic node analysis (Monte-Carlo truncated permutations, $k_{\max}$, wall-clock budget) | [`CASCADE-app/lib/model-based-analysis.ts`](../CASCADE-app/lib/model-based-analysis.ts) — `estimateShapley`; the Analysis page wires it to the engine in [`section-model-based.tsx`](../CASCADE-app/components/analysis/section-model-based.tsx) |
| §4.4 Centrality vs. Shapley: the Spearman table, the ranking figures, the reproduction script      | [`CASCADE-backend/scripts/paper_shapley_vs_centrality.py`](../CASCADE-backend/scripts/paper_shapley_vs_centrality.py), fed by the app's Shapley export ([`CASCADE-app/lib/analysis-export.ts`](../CASCADE-app/lib/analysis-export.ts)); production topological metrics in [`CASCADE-app/lib/topological-analysis.ts`](../CASCADE-app/lib/topological-analysis.ts) |

### Reproducing the numbers

The case-study model and its two strategic-update variants are git-tracked public
samples:

§4.4 is reproduced in two steps. The Shapley estimator has exactly one
implementation — the one the product runs — so the paper's $\hat{\phi}_i$ come
from a real Analysis run rather than from a second copy of the algorithm:

1. Produce the Shapley Export. **Tick *Nodes only*** — §4.4 compares node Shapley
   against node centrality, so the coalition game is over nodes; letting edges
   fail as well is a different game and shifts every node's $\hat{\phi}_i$ (the
   script warns when handed such an export). Scope `global`, samples 800,
   k_max 3.

   Either in the app — **Analysis → Model-based → Shapley Values → Compute →
   Export Shapley values (JSON)** — or headlessly, which is how the committed
   artifact was regenerated:

   ```bash
   # engine, from CASCADE-backend/ — a blank DATABASE_URL runs auth-free
   DATABASE_URL= uvicorn main:app --host 127.0.0.1 --port 8123

   # harness, from CASCADE-app/ — runs the app's own estimator, no browser
   SHAPLEY_SAMPLES=800 SHAPLEY_KMAX=3 SHAPLEY_SEED=0 \
   SHAPLEY_OUT=/tmp/shapley-palmanova.json npm run harness:shapley
   ```

2. Join it against the structural centralities:

```bash
# from CASCADE-backend/  (same sys.path convention as scripts/benchmark_engine.py)
python scripts/paper_shapley_vs_centrality.py \
    --network ../CASCADE-app/samples/public/Palmanova_Complete.json \
    --shapley /tmp/shapley-palmanova.json
```

That produces §4.4 (Table 3, the Shapley ranks, the Spearman correlations, and the
$\hat{\phi}_i$ values in Figure `Shapley_uniform`). The export records the seed the
run used, so the Analysis page replays the same estimate on demand.

**The committed `experiments/shapley_vs_centrality.json` was regenerated this way
on 2026-09-09** (800 samples, k_max 3, seed 0, 1297 engine calls). What changed
against the retired Python estimator, and what did not:

| | Python estimator (before) | App estimator (now) |
|---|---|---|
| $\rho$(Shapley, Betweenness) | 0.743 (p = 6.3e-8) | **0.752** (p = 3.3e-8) |
| $\rho$(Shapley, Eigenvector) | −0.311 (p = 0.054) | **−0.325 (p = 0.043)** |
| $\rho$(Eigenvector, Betweenness) | −0.037 (p = 0.83) | −0.037 (p = 0.83) — pure topology, identical |
| $\sum_i \hat{\phi}_i$ | 11.21 (0–100 scale) | 0.1164 (fraction) |

Note the eigenvector correlation **crosses p = 0.05**: a claim of "not
significant at the 5% level" no longer holds and must be reworded. The two runs
otherwise agree as well as Monte Carlo allows — rank correlation between old and
new $\hat{\phi}$ is $\rho = 0.93$, the scale ratio is 96.3 against an expected
100, and 9 of the top 10 nodes are the same. The residual difference is sampling
noise, not a change of method: Python drew permutations from Mersenne Twister and
the app draws them from mulberry32, so the same seed cannot produce the same
permutations across the two languages. That divergence is now retired along with
the second implementation.

Two notes on reading the file. The $\hat{\phi}_i$ are Operativity Score
**fractions** (0–1); results recorded before 2026-09-09 are on the 0–100 scale
and so are ~100× larger — Spearman $\rho$ is rank-based and unaffected, a plotted
axis is not. And the script writes to `experiments/shapley_vs_centrality.json` by
default; pass `--out` when trying it out so the git-tracked artifact is not
overwritten. The `_water_improvement` and
`_electric_priority` variants under the same directory are the post-intervention
models of §4.3 (`Flood_Propagated_after_improvement`,
`electric_propagated_prioritized`). The minimal five-node network of the "Anatomy of
a CASCADE analysis" figure is
[`CASCADE-app/samples/public/IJDRR_example.json`](../CASCADE-app/samples/public/IJDRR_example.json).

The propagation engine behind every scenario is the same one measured by the first
two papers: [`CASCADE-backend/engine/`](../CASCADE-backend/engine/), contract in
[ADR-0003](adr/).

---

## Orientation for readers who want the architecture, not the experiments

- [`CONTEXT.md`](../CONTEXT.md) — the domain glossary. One concept, one term; worth
  skimming before reading the code, since the paper's vocabulary and the code's are
  deliberately the same.
- [`docs/adr/`](adr/) — decision records. ADR-0003 (the engine's propose/guard/commit
  contract), ADR-0012 (importer mapping rules), ADR-0014 (flow allocation strategy)
  are the ones the papers lean on.
- [`docs/project/architecture.md`](project/architecture.md) — how the pieces fit
  together as a system rather than as a paper.
