# FRAM → CASCADE: results

Translation and protocol: [TRANSLATION.md](TRANSLATION.md). Raw numbers: `results/`.
Re-run from the repository root, each with `CASCADE-backend/.venv/bin/python`:

| Script | Covers | Run time |
|---|---|---|
| `run_v1.py` | verification | ~1 min |
| `run_rq1.py` | RQ1 | 4 s |
| `run_rq2.py` | RQ2 | ~3 min |
| `run_cumulative.py` | sensitivity: cumulative worsening | 6 s |
| `check_kim.py` | Kim's F11 claim (footnote) | ~4 min |
| `demo_zheng.py` | demonstration | 4 s |

## Research questions

- **RQ1.** Does converting a FRAM model into a propagation model preserve the conclusions of the original analysis?
- **RQ2.** Does the converted model correctly predict the effect of interventions on the system?
- **RQ3.** What does each of the two analyses capture that the other misses?

## V1. Verification (`results/v1_*.csv`)

- **FMI semantics.** 11 models, 2,613 scenarios.
  - CASCADE equals the greatest fixed point of the FMI activation operator in every scenario.
  - It equals the FMI's least fixed point on every acyclic model.
  - The divergences are cyclic deadlocks the modellers break by hand (Resilience potentials v0; Grabbe's 162-function loop).
- **Fault tree.** Khakzad 2011 gives a top event of 0.272042 in CASCADE, equal to the closed form and to the published 0.2720.

## RQ1. Preserving the analysis (`results/rq1.csv`)

| Case | Ground truth | S0 (reachability) recall · precision | **v2** recall · precision |
|---|---|---|---|
| Zheng | Table 2 judgements | 8/8 · 8/16 | **8/8 · 8/10** (misses F18, F19) |
| Tian | model-checking violations | 4/4 · 4/4 | 4/4 · 4/4 |
| Kaya | workshop top-4 | 1/4 | 2/4 (VPN re-run 3/4) |
| **Wenzhou** (held out) | accident report | 7/7 · 7/9; couplings P 12/18 | **7/7 · 7/7; couplings P 10/10, R 10/12** |
| **Koriyama** (held out) | Fig. 6 | 3/3 · 3/5; couplings P 4/9 | **3/3 · 3/3; couplings P 4/4, R 4/4** |
| Kim (N = 7) | Tables 6–7 | shape only: 0/7 | **formula rules: 7/7 · 7/8**; resonance set 5/8 |
| Smith | FT 0.2720 | — | **0.2720**; shared sensor 0.3756 |

- **Recall is easy and precision is the test.** Reachability finds every affected function but degrades about half the uninvolved ones. v2's damping keeps them nominal, because a single deviating input is absorbed and coinciding ones pass. On the two held-out cases v2 is exact at function level.
- **Misses, each with a cause.**
  - Zheng F18, F19: their staff adapt ("don PPE quickly").
  - Kaya: its information lives in probability mass, which a collapsed level cannot carry.
  - Kim F2: a government function the paper holds acceptable by assumption.
- **Kim needs its formulas.** Kim's additive and multiplicative aggregation drives its resonance. The formula's shape alone propagates nothing; the formulas compiled into Specific Rules reproduce the pattern. Only N = 7 resolves the three scenarios.
- **Event severity is the largest sensitivity.**
  - Zheng with communications at 2: bal. acc. 0.69.
  - Koriyama with the alerts read as timely: 2/3.
  - Wenzhou with lightning at 2: 6/7.

  The conversion preserves the conclusions *given the analysts' own description of the event*.

## RQ2. Predicting interventions (`results/rq2_*.csv`)

**Exact importance, Smith / Khakzad.**
- CASCADE's Birnbaum importance equals the fault tree's (ρ = 1.00), and it and Shapley put the manual backup S2 first.
- Single-knockout Vitality (ρ = −0.67) and every topological measure miss S2 (out-reach −0.70, reverse Katz −0.30, degree 0.72, but S3 first). A backup matters only together with another failure, which one-at-a-time and link-counting measures cannot see.
- With the shared sensor Smith asks about, the transmitter S8 becomes the most critical component (0.75 vs 0.57). The fault tree, which hides the dependency, still says S2.

**The experts' counterfactual claims.** 15 claims extracted, 7 statements excluded; list frozen before the run.

| Verdict | Claims |
|---|---|
| **agree (7)** | Tian: fixing the door alone would not avoid the accident; a direct order helps. Togawa: better public communication reduces resonance. Zheng: two-way updates improve the chain; cancelling F5 plus mutual aid lets F20 extinguish in time. Wenzhou: barriers on M5, M7, M8, M10 prevent the accident. Smith: a shared sensor worsens both branches. |
| disagree (4) | Wenzhou: an alternative channel avoids the accident (model: M20 2 → 3, direction right, not nominal). Togawa: preparation time affected evacuation (evacuation behaviour is overdetermined by three other deviations). Togawa: better evacuation relieves rescue (the paper's map has 119 calls as exogenous). Both Togawa claims agree under cumulative worsening (below). Li 2026: the stage hierarchy (a learned policy's frequency, a different quantity). |
| not expressible (3) | berth renewal; community engagement (no such functions); failure warnings to dispatch (a protective information flow) |

**Exploratory, declared after the run (c8e8c2b): protective information as an alternative path** (`results/rq2_paths.csv`). Fig. 4 draws no link by which dispatch reaches the D301 driver. Drawn as an alternative source of the occupancy information for M20, with the failure warning as a trigger:

| Run | M20 |
|---|---|
| the path drawn, no intervention | 2 (RQ1 unchanged: 7/7 · 7/7) |
| failure warning alone (C11) | 2: the warning travels on the GSM-R the lightning destroyed |
| alternative channel alone (C10) | 2 → 3 |
| both | **2 → 4: avoided** |

The two claims are expressible once the path is drawn, and the model shows they work only together. The scope boundary is the map, which lacks the path; the method can express it.

**Sensitivity, declared at d3312fa: cumulative worsening** (`results/cumulative_*.csv`). v2 lets a function fall to its second-worst input and no lower. The variants add Specific Rules, so that three coinciding deviations cost one level more (v2+3), or each one beyond two does (v2+c).

| | v2 | v2+3 | v2+c |
|---|---|---|---|
| RQ1, all five N = 4 cases | as above | identical | identical |
| claims agreeing | 7/11 | **8/11**: C6 (T9 2 → 3) | **9/11**: C6, and C4 (T6 1 → 2) |
| C10, C14 | disagree | disagree | disagree (C14 moves to DER > PEP > PER) |

- The hand reading recorded with the declaration predicted every change. v2+c was shaped by C4's structure (T6 has four deviating inputs), so the claim gains are not independent evidence.
- The independent part: deeper levels change no function-level score on any case, held-out ones included. Only the levels of functions already degraded fall (Koriyama T6 reaches 1 under v2+c).
- Togawa's two "overdetermined" disagreements are therefore a question of how coinciding deviations combine. The paper leaves that implicit, and the converted model makes it an explicit, testable choice.

**Kim interventions** (IEV_p × factor vs the oracle).
- At × 0.9 (the paper's Fig. 8) the model resolves 1 of 12 functions (ρ = −0.35).
- At × 0.5 it resolves 8 (ρ = 0.26; finds F7 and F5).
- A small change in *how variable* a function is rarely crosses a level band.

**Why single-failure rankings carry little model content.** Single-knockout Vitality is a topological measure in disguise:
- under S0 it equals out-reach (ρ ≥ 0.99 on all five cases);
- under v2 it tracks reverse Katz (ρ = 0.74–1.00), because a lone failure loses one level per hop and dies after N − 1.

Coincidence, redundancy and capacity, the model's own content, appear only when several elements deviate together (Birnbaum, Shapley) or carry quantities (flow).

## RQ3. What each analysis captures that the other misses

| The propagation model adds | Evidence |
|---|---|
| answers to questions the FRAM raises but cannot settle | Smith's shared sensor: +38 % P(top); the sensor becomes the most critical component |
| mechanisms a FRAM table cannot express | demonstration: fire water decides F20 and Tank 63 (below) |
| criticality that accounts for redundancy and coincidence | Smith's backup first by Birnbaum; topology misses it |
| repeatable what-ifs that expose gaps in the map | 7/11 claims agree; Wenzhou's warnings need a path Fig. 4 lacks |
| an explicit rule for how coinciding deviations combine | Togawa's two claims turn on it (cumulative worsening: 9/11); RQ1 does not |
| how recommendations combine | Wenzhou: the failure warning and the alternative channel avoid the accident only together |
| precision about what stays nominal | held-out cases: contained and uninvolved functions kept |

| FRAM keeps | Evidence |
|---|---|
| adaptation and positive variability | Zheng F18, F19 |
| where variability is born and amplified, and how likely it is | Kaya's probability mass; Kim's small variability changes |
| the paths that information takes, which the analyst must draw | Wenzhou's warning path, absent from Fig. 4 |
| the events themselves | the severity of the triggering deviations is the largest sensitivity |

## Demonstration: Zheng with physical networks (`demo_zheng.py`, `demo/*.json`, `results/d_*.csv`)

**Setup.** Zheng's FRAM (v2) on three physical canvases. Quantities are illustrative:
- telecom (Requisite);
- firefighter crews (SourceToDemands; other affected areas served first);
- fire water (SourceToDemands; main → hydrants → F20 foam and the cooling of Tank 63; firetruck tanks as a small second source).

The 12-hour Temporal Simulation of damage and repairs is stored in the bundle, and the bundle opens in the app.

**Results.**
- **Claim from physical damage alone** (hour 0): 8/8 negatives, 6/8 positives, F12 = 3, F17 = 3, F20 = 2, with F2, F14, F15 nominal. This is RQ1, produced by the physical layer.
- **Operativity, as planned / with Zheng's Fig. 9 remedy:**

  | Hour | 0 | 6 | 8 |
  |---|---|---|---|
  | as planned | 0.80 | 0.92 | 0.985 |
  | remedy | 0.94 | 0.94 | 1.00 |

- **The remedy fixes F12 and F17 from hour 0, not F20.** With the main destroyed, foam gets the trucks' 80 of 240 m³/h until the repair at hour 8. Tank 63's cooling gets nothing: the paper's "radiation may fail Tank 63", through a mechanism its FRAM cannot express.
- **Shapley on the hour-0 damage** (Operativity loss 0.197 in total): F5 one-way 0.051, fire-water main 0.049, exchange 0.036, fibre 0.036, crews 0.026, radio repeater 0. The repeater is redundant with the exchange.

## Design decisions behind v2 (exploration, in the git history before aebd4b0)

- **Resonance as one nested rule per function**, using existing rule types only. It is identical to the compiled-Specific-Rule version (0 of 864 scenarios differ).
- **N = 4 for qualitative sources.** A wider scale gave no gain: what matters is the ratio of damping to the event's deficit.
- **One level of damping.** Two levels fit Zheng at every severity but break Tian (2/6).
- **No common-cause pruning.** Dropping coincidences with a shared origin made results worse: the experts do pass shared-origin delays.

## Caveats

- **Wenzhou's network** is digitised from a raster figure. Every Table 1 and Table 3 coupling is present, and three readings at crossings are noted in the transcription.
- **Kim's oracle** (`check_kim.py`, 3,000 paired trials) runs about 1.25× Table 5's durations and stays within 4 points of Table 7, systematically lower (F10 15.4 vs 19.5). On it, "F11 is critical" does not reproduce:
  - Fig. 8: F11 ranks 8th of 12 at both ×0.9 and ×1.1. F7 and F5 lead, and a 20-trial run puts F11 in the top two 1–3 % of the time, so sampling noise does not explain the claim.
  - Tables 6–7: excluding F3–F5, as the paper does, F7 changes most from S1 to S3 (+4.1 points) and F11 changes +0.7.

  The difference may lie in our re-implementation. This is a footnote, not a finding of this paper.
- **The ground truths** are the analysts' conclusions. Only the two held-out cases rest on official reports (Wenzhou: State Council; Koriyama: city retrospective).

## Dropped from scope

| Dropped | Why |
|---|---|
| Ranking comparisons on Grabbe 2022, Li 2026, Zinetullina 2021 | the published rankings are their methods' topological outputs (Grabbe ≈ degree; Li ≈ reverse Katz); one sentence in the discussion |
| Scenario attribution vs topology (5b31c45) | superseded by RQ2's counterfactual design |
| The FRW toy | related work only |
