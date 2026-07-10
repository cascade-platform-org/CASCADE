# Paper sketch — Complex Networks & Their Applications

**Target venue:** International Conference on Complex Networks and their Applications (complexnetworks.org).
**Format:** full paper, 8–10 pages recommended, hard cap 12 pages including bibliography (Springer *Studies in Computational Intelligence* style).

**Sources this sketch is built from**: `docs/paper/IJDRR_paper.tex` and `docs/paper/technical.tex` (a companion manuscript on the wider CASCADE framework — Curaba, Grimaz, Zorzini — **in preparation, not published, not confirmed submitted anywhere**; cite it only as "in preparation," never with a stable reference, and don't lean on it for anything this paper needs to stand alone on); `docs/paper/cas-refs (1).bib` and `docs/paper/complexnetworkpaper.bib` (bibliography); the CASCADE engine and importer source (`CASCADE-backend/engine/`, `CASCADE-backend/core/importers/inp/`) and its validation harness (`CASCADE-backend/scripts/validate_faithfulness.py`, `CASCADE-backend/scripts/benchmark_engine.py`).

**Do not name or otherwise make identifiable the real utilities/locations behind the three imported aqueduct networks anywhere in the paper, figures, or supplementary artifacts** — refer to them only as "three real Italian aqueducts" or similar. One prior leak of derived project data was found and purged from this repository's git history; treat this as a hard constraint on every subsequent commit, not a one-time cleanup.

---

## Narrative

CASCADE is a knowledge-driven propagation architecture for cascading failure in interdependent infrastructure. Its **logical propagation mechanism** — intracategorical aggregation (`best_of`, redundancy) composed with intercategorical aggregation (`worst_of`, conjunctive necessity) over categorical tags — resolves arbitrary multi-dependency and redundancy structures with no per-domain solver, purely from how edges are categorized. This is the paper's central claim. Its **capacity-based propagation mechanism** (SourceToDemands: priority-aware min-cost max-flow) is one plug-in module for the subset of dependencies that are quantity-aware, such as water distribution — and it is the one module for which an independent physical simulator exists to check against. The paper's structure follows from that asymmetry: state the architecture (§3), validate the one checkable module against real hydraulics (§4–§5), then spend that earned trust demonstrating the architecture's actual selling point — composing heterogeneous interdependencies, quantity-aware and purely logical, in one pipeline with no new solver (§6). A possible further extension — additional mechanism *types* beyond these two sharing the same pipeline — is discussed as future work, not claimed as demonstrated.

## Title (working)

> **Composable, Knowledge-Driven Propagation for Complex Interdependent Infrastructure: A Flow-Allocation Module Validated Against Hydraulic Simulation**

Alternatives: *Beyond Topology: Logical Propagation and Rule-Based Composition for Complex Interdependent Networks, with a Validated Flow Module*; *Modeling Arbitrary Interdependencies with Category-Typed Propagation: One Module Checked Against EPANET*.

---

## Proposed structure

### 1. Introduction (~1 page)
**Narrative role**: establish the gap (no framework combines quantity-aware and purely-logical interdependency modeling in one composable architecture) and state up front that this paper covers the architecture plus a validated flow module, not the wider CASCADE framework.
**Contents**: cross-domain, cross-type cascading failure problem statement; the physical-simulator-vs-topological-abstraction dichotomy in prior work; explicit scope statement (companion manuscript covers the authoring workflow and Shapley-based neuralgic-node analysis, cited only in passing); contribution list — (1) the composable category-typed architecture, (2) a demonstration that it resolves multi-dependency/redundancy structures via categorical tags with zero new solver code, (3) validation of the capacity-based module against WNTR across six scenario families and six networks, (4) a possible-extension note on composing further mechanism types, explicitly flagged as future work.

### 2. Related work (~0.75 page)
**Narrative role**: position the logical mechanism against interdependency taxonomies and network-of-networks theory (which classify or model structure but don't operationalize it as a computational propagation mechanism), and position the capacity-based module against flow/cascade models and water-network tooling.
**Contents**: interdependency taxonomies (Rinaldi et al.) and network-of-networks/multilayer theory (Buldyrev et al., Gao et al., Kenett et al., Scala & D'Agostino); the Inoperability Input-Output Model (Haimes et al.) as a contrasting economic-flow formalism worth one sentence of comparison; random-vs-targeted robustness (Albert, Jeong & Barabási) as the precedent for §5's targeted-attack finding; load-redistribution cascade models (Motter & Lai; Crucitti, Latora & Marchiori) contrasted against commodity-flow-against-demand models; quantitative resilience reviews (De Marco et al.; Ouyang; Hines et al.; Bachmann et al.; Zhou et al.); water-network tooling (Klise et al./WNTR; a PDD reference, Wagner, Shamir & Marks 1988; a skeletonization reference, Saldarriaga et al. 2012); min-cost flow algorithms (Edmonds & Karp; Orlin) and their NetworkX implementation; Shapley value (Shapley 1953), cited only in passing.

### 3. The propagation architecture (~2.25 pages)
**Narrative role**: the paper's central section. Present the logical mechanism first, as the general-purpose default; present the capacity-based mechanism second, explicitly as one plug-in module.
**Contents**:
- Elements, functionality scale `1..N`, category typing (`SourceToDemands` vs `Requisite`), and the deliverable primitive `L(u→v) = worst_of(f_u, f_uv)`.
- Logical propagation: intracategorical `C_g(v) = best_of{L(u→v) : cat(u)=g}`, intercategorical `I(v) = worst_of{C_g(v) : g ∈ G(v)}`, customizable with user rules (`best_of`/`worst_of`/`majority_of`/`average_of`, conditional `if/then` overrides). Runs universally with no explicit declaration required.
- Capacity-based propagation: the auxiliary flow graph (super-source/super-sink, priority-scaled sink rewards, friction costs) and the min-cost max-flow solve, framed explicitly as one instantiation of a general plug-in point for quantity-aware categories — not a second core contribution.
- The shared pipeline every proposal passes through regardless of mechanism: Specific-Rule Override → Dependency Level / Time-Constrained Backup adjustment → Monotonic Commit.
- Convergence: monotone on a bounded lattice ⇒ termination in at most `N−1` rounds per element. Short proposition + proof.
- A three-column table contrasting input requirements: EPANET vs. the capacity-based module vs. the logical module — the logical module needs categorized edges only, which is the point.
- A short note distinguishing this paper's validation metric (FMS, §5) from the framework's native aggregate output (Operativity Score `Ω`) — different purposes, not two measurements of the same thing.

### 4. Parameterizing the flow module from data: the EPANET importer (~1.5 pages)
**Narrative role**: infrastructure for the validation in §5, not the paper's headline. One explicit contrast: the logical module needs no comparable pipeline because it is authored directly from categorized edges, not derived from a physical solve.
**Contents**: import pipeline (parse → hydraulic sweeps → skeletonize → orient → map); structural mapping table (reservoir/tank → source, junction → sink, pump/valve → inline logical node, pipe → edge); capacity and orientation from a demand-multiplier PDD sweep (peak-of-sweep velocity, signed-flow orientation, bidirectional-edge splitting for genuinely two-way pipes, contingency sampling for backup mains); priorities from a failure-order sweep; skeletonization to a node budget with demand conservation. Two solver-correctness issues found and fixed during this work, each stated in one sentence: EPANET's PDD solver silently returning unconverged results without raising an exception (now checked and discarded), and a demand-multiplier sweep with hash-seed-dependent (non-reproducible) sampling (now sorted before sampling).

### 5. Module validation: the capacity-based mechanism against WNTR (~1.5 pages)
**Narrative role**: supporting evidence, explicitly scoped as validating one module, not the architecture's general interdependency-modeling claim — stated as the section's opening sentence.
**Contents**:
- Protocol: six scenario families per network — independent random component breaks, a network-wide moderate demand increase, both combined, spatially-clustered failure, capacity-targeted attack on trunk mains/pumps, and an exhaustive per-source complete-outage family — each applied identically to a WNTR PDD ground-truth solve and to the imported CASCADE project.
- Metric: FMS (demand-weighted level-agreement score) as primary; a secondary binary critical/operational confusion-matrix metric, with the caveat that recall only holds at 1.0 under the random/demand-increase families and drops once clustered/targeted attack is included.
- Networks: three textbook (up to 3,300 junctions) plus three real Italian aqueducts (unnamed).
- Results table: aggregate FMS 0.97–0.99 under random failure; 0.85–0.92 under clustered/targeted attack — reported as a genuine, not-hidden robustness profile, not a uniform headline number.
- Ablation: FMS as importer components (orientation, capacity source, contingency sampling, hedged splitting) are added one at a time — demonstrates that fidelity is a function of parameter quality, not an intrinsic property of the heuristic.
- Threshold sensitivity: FMS is stable across a range of PDD service-pressure conventions and quantization granularities — the headline number is not an artifact of one arbitrary choice.

### 6. The architecture's payoff: composing interdependencies beyond hydraulics (~1.25 pages + 1 figure) — **not yet written, single most important remaining task**
**Narrative role**: this is the section the paper is actually about. §5 earns the right to make this claim by showing the flow module is trustworthy; this section spends that trust.
**Contents (to build)**: extend a validated water import with a power layer (one grid node feeding all pumps) and an operator layer (a logical-category personnel node), using the *unmodified* logical mechanism from §3 — no new propagation code. A worked blackout scenario: grid node fails → pumps drop → the capacity-based mechanism propagates the shortage through the already-validated flow topology → tank backups defer downstream failure → a temporal jump realizes it. An honest paragraph: this composite result is not validated against ground truth and cannot be, because no physical simulator represents purely logical dependencies (operator availability, digital control) — what §5 buys this section is a measured bound on the flow layer's own error, so remaining uncertainty is attributable to the logical layer's structural assumptions, not to unmeasured drift underneath it.

### 7. Cost (~0.5 page)
**Narrative role**: an honest, disclosed limitation, not a speed claim.
**Contents**: import is a one-time cost dominated by the hydraulic sweeps (order of seconds to low tens of seconds depending on network size); per-situation, the engine's capacity-based module is competitive with a WNTR solve up to a few hundred junctions and 6–7× slower at the largest network tested (3,300 junctions) — down from 28× slower before a solver-correctness/performance fix found during this work (NetworkX's `max_flow_min_cost` was running a redundant max-flow pre-pass; reformulating as a min-cost circulation reaches the identical optimum in one pass, verified as zero diffs in per-consumer output). State plainly that this paper does not close the remaining gap and does not claim a runtime advantage over WNTR — the defensible claim is data requirements (§3's input table), not speed.

### 8. Limitations & future work (~0.5 page)
**Contents**: steady-state snapshots only, recovery handled by a separate mechanism not covered here; quantization loses sub-level information (what FMS measures); flow attribution uses a provisional uniform-blame rule, distinct from the framework's fuller Shapley-based analysis (companion manuscript); this paper validates one module in one domain — the architecture's generality claim rests on a convergence guarantee and one worked demonstration (§6), not a second physical-simulator comparison, because none exists for the logical mechanism's target relationships; the possible extension to further mechanism types (§3) is unbuilt and untested.

### 9. Conclusion (~0.25 page)
Restate the architecture first, the validation second: a category-typed propagation engine composes quantity-aware and purely logical interdependencies through one convergent pipeline; the one module checkable against independent physical ground truth reproduces it at FMS ≥ 0.97 under random failure, ≥ 0.85 under targeted attack, across six networks including three real utility exports — evidence that makes trusting the architecture reasonable, not the paper's main claim.

---

## Figures (5) & tables (3)

| # | Type | Content |
|---|---|---|
| F1 | diagram | the composable architecture: logical mechanism (general) + capacity-based mechanism (one plug-in module) merging into the shared pipeline — the paper's opening figure |
| F2 | diagram | importer pipeline (parse → sweep → skeletonize → orient → map), labelled as parameterizing the flow module specifically |
| F3 | chart | ablation FMS as importer components are added |
| F4 | map/canvas | one real aqueduct rendered in CASCADE, pre/post cascade coloring (anonymized) |
| F5 | diagram | §6's multi-layer coupling scenario (water + power + operator) |
| T1 | table | flow-module inputs vs. EPANET inputs vs. logical-module inputs (three columns, §3) |
| T2 | table | EPANET→flow-module mapping rules |
| T3 | table | per-network FMS results by scenario family, mean ± sd over seeds |

## Bibliography

Keys below are from `docs/paper/cas-refs (1).bib` and `docs/paper/complexnetworkpaper.bib` (the latter is a larger, shared bibliography that also covers an unrelated logic/LLM-reasoning paper — only the entries below are relevant here).

**Interdependency theory & network-of-networks**: `rinaldi_identifying_2002`, `rinaldi_modeling_2004` (interdependency taxonomy), `buldyrev_catastrophic_2010` (catastrophic cascades in coupled networks), `gao_networks_2011`, `kenett_network_2014`, `scala_networks_2014`, `aleta_multilayer_2026` (network-of-networks/multilayer theory), `haimes_inoperability_2005` (Inoperability Input-Output Model, contrasting economic-flow formalism).

**Robustness & cascading failure**: `albert_error_2000` (random-vs-targeted attack tolerance — the precedent for §5's targeted-attack finding), `motter_cascade-based_2002`, `crucitti_model_2004` (load-redistribution cascade models, contrasted against commodity-flow models), `artime_robustness_2024`, `zhou_robustness_2018`, `de_marco_quantitative_2025`, `ouyang_review_2014`, `hines_topological_2010`, `ouyang_comparisons_2013`, `bachmann_survey_2020`.

**Water-network tooling**: `klise_software_2017` (WNTR), `wagner_water_1988` (pressure-driven-demand formulation), `saldarriaga_water_2012` (skeletonization).

**Algorithms**: `edmonds_theoretical_1972`, `orlin_polynomial_1997` (min-cost flow), `shapley_value_1953` (cited in passing, §3/§8 only).

**Still to source** (absent from both bib files, confirmed by grep): the EPANET user manual (Rossman) and a HAZUS or other functional-state/discrete-damage-scale precedent for the integer functionality-level representation (§3).

## Open decisions

- **Companion manuscript status**: confirm before drafting whether it has any stable reference yet; until it does, §3 should read as fully self-contained rather than depend on a citation that doesn't exist.
- **Utility anonymization**: confirm the exact phrasing to use for the three real aqueducts (region-only, no names) before any figure or table is finalized — this is now a hard constraint, not a style preference, given the prior data-leak incident.
- **§6 is unwritten.** Everything else in this sketch describes content that exists in some form (validated numbers, a working importer, a working engine); §6 is the one section that needs to be built from scratch, and the paper's narrative depends on it more than on any other section.
