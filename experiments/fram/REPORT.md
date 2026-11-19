# FRAM → CASCADE: results

Translation and protocol: [TRANSLATION.md](TRANSLATION.md). Raw numbers: `results/`.
Re-run from the repository root, each with `CASCADE-backend/.venv/bin/python`:

| Script | Covers | Run time |
|---|---|---|
| `run_v1.py` | verification | ~1 min |
| `run_rq1.py` | RQ1 | 4 s |
| `run_rq2.py` | RQ2 | ~3 min |
| `run_cumulative.py` | sensitivity: cumulative worsening | 6 s |
| `run_ablation.py` | ablations, severity grid, claim tiers, reference check | ~60 min (Grabbe under the cumulative members) |
| `check_kim.py` | Kim's F11 claim (footnote) | ~4 min |
| `check_falegnami.py` | Falegnami 2020's Katz ranking (private data) | 5 s |
| `decide_zheng.py` | decision model (Zheng's recommendations under firefighters and time) and its scale sensitivity, every grid point a Temporal Simulation run | 6 min |
| `decide_rules.py` | both decision models under the alternative rules S0, D1, K2 | ~15 min |
| `export_bundles.py` | the core cases as projects for the platform, with `CHECKS.md` | 5 s |

## Research questions

- **RQ1.** Does converting a FRAM model into a propagation model preserve the conclusions of the original analysis?
- **RQ2.** Does the converted model correctly predict the effect of interventions on the system?
- **RQ3.** What does each of the two analyses capture that the other misses?

## V1. Verification (`results/v1_*.csv`)

- **FMI semantics.** 13 models, 3,152 scenarios, including two real FMV models shared privately (TRANSLATION.md §4b): Falegnami 2020 (52 functions, 290 couplings) and Simone 2025 (85 functions, 191 couplings).
  - CASCADE equals the greatest fixed point of the FMI activation operator in every scenario.
  - It equals the FMI's least fixed point on every acyclic model.
  - The divergences are cyclic deadlocks: Resilience potentials v0 and Grabbe's 162-function loop, which their modellers break by hand; Falegnami (229/253 scenarios equal); Simone, where most functions never start under the FMI (20/286 equal). Between the two walker papers Simone et al. changed the rule to "one Input suffices", which this deadlock would require.
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

**Baseline, declared at 7f5c33a** (`results/rq2_claims_baseline.csv`). The same edits under S0 (reachability) agree on 4 of 11. C13, Smith's fault tree, is binary and identical under both, so on the 10 claims the translation affects v2 agrees on 6 and S0 on 3. The three v2 adds (Togawa's public communication, Zheng's two-way updates, cancelling F5) are cases where damping absorbs the one deviation the edit leaves. S0 agrees nowhere v2 disagrees.

| Direction | v2 | S0 |
|---|---|---|
| improve (C2, C4, C5, C6, C8) | 3/5 | 1/5 |
| stays degraded (C1) | 1/1 | 1/1 |
| avoid (C9, C10, C12) | 2/3 | 1/3 |
| worse (C13, binary) | 1/1 | 1/1 |
| ordering (C14) | 0/1 | 0/1 |

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

**Why single-failure rankings carry little model content here.** On these converted models one failure alone meets only damping, so single-knockout Vitality reduces to a topological measure:
- under S0 it equals out-reach (ρ ≥ 0.99 on all five cases);
- under v2 it tracks reverse Katz (ρ = 0.74–1.00), because a lone failure loses one level per hop and dies after N − 1.

Coincidence, redundancy and capacity, the model's own content, appear only when several elements deviate together (Birnbaum, Shapley) or carry quantities (flow).

## RQ3. What each analysis captures that the other misses

| The propagation model adds | Evidence |
|---|---|
| answers to questions the FRAM raises but cannot settle | Smith's shared sensor: +38 % P(top); the sensor becomes the most critical component |
| comparison of recommendations under resources and a deadline | decision model: two-way updates suffice below half the brigade drawn away; beyond, mutual aid within 30 min (below) |
| criticality that accounts for redundancy and coincidence | Smith's backup first by Birnbaum; topology misses it |
| repeatable what-ifs that expose gaps in the map | 7/11 claims agree; Wenzhou's warnings need a path Fig. 4 lacks |
| an explicit rule for how coinciding deviations combine | Togawa's two claims turn on it (cumulative worsening: 9/11); RQ1 does not |
| how recommendations combine | Wenzhou: the failure warning and the alternative channel avoid the accident only together |
| precision about what stays nominal | held-out cases: contained and uninvolved functions kept |

| FRAM keeps | Evidence |
|---|---|
| adaptation and positive variability | Zheng F18, F19 |
| where variability is born and amplified, and how likely it is | Kaya's probability mass; Kim's small variability changes; Falegnami's ranking is carried by its variability scores |
| the paths that information takes, which the analyst must draw | Wenzhou's warning path, absent from Fig. 4 |
| the events themselves | the severity of the triggering deviations is the largest sensitivity |

## Decision model: Zheng's recommendations under firefighters and time (`decide_zheng.py`; declared at 882d4a1, TRANSLATION.md §4d)

Replaces the earlier demonstration, whose telecom and fire-water canvases and quantities were ours (Table 1 gives F20 no water aspect). Imported: the converted FRAM and its event, firefighters as F17's Resource with other affected areas served first, the exposed ring's time to failure (33–117 min; Tank 63 at 33–42 min, Baser & Behnam 2020 Table 8), the four options. Swept: share of the brigade drawn away d, mutual-aid arrival a, telecom severity s.

**F20 by option** (`results/decision_map.csv`), telecom at the declared level 3:

| d | I0 plan | I1 two-way updates | I2, I3 + mutual aid |
|---|---|---|---|
| < 0.25 | nominal | nominal | nominal |
| 0.25–0.49 | severe (F12 and F17 coincide: the rule) | nominal | nominal |
| ≥ 0.5 | severe | 3 | 3, nominal from a: the whole deadline band if a ≤ 30 min, part of it if a ≤ 110 |

- Telecom at 2: two-way updates stop sufficing from d = 0.3 (F12 degrades again); mutual aid restores F20 up to d = 0.6 and not at 0.7, where the damaged telecom degrades the mobilisation.
- I2 and I3 coincide everywhere: cancelling F5 and making it two-way have the same effect here.
- Every line of the hand reading recorded at 882d4a1 held.
- The thresholds 0.25 and 0.5 are the 4-level scale's served-ratio steps (ceil(ratio · 4)) acting through v2's damping; the paper reports them as where the choice changes on this scale.

**Reference point** (d = 0.4, a = 30, s = 3; `results/decision_timeline.csv`): Operativity of the FRAM functions 0.80 under the plan throughout; 0.985 with two-way updates; 0.986 then 1.00 from minute 30 with mutual aid.

**Shapley on the plan at t = 0** (`results/decision_shapley.csv`; Operativity loss 0.197): F5 one-way 0.083, telecom 0.068, firefighters drawn away 0.046.

The four options open in the app with their Temporal Simulation: `CASCADE-app/samples/public/fram/zheng_I*.json`.

**Scale sensitivity** (declared at e084d58, TRANSLATION.md §4e; `results/decision_scale.csv`, `decision_scale_ref.csv`). The same model at N = 7 with v2 rescaled (two levels absorbed, imposed levels L → 2L − 1). Every line of the hand reading held; d = 0.4 under severe telecom, which serves exactly 6/7, came out not restored.

| F20 (before → after the mutual aid) | N = 4 | N = 7 |
|---|---|---|
| I0, plan fails from | d = 0.3 | d = 0.2 |
| I1 suffices up to (grid) | d = 0.4 | d = 0.4 |
| I1 beyond, F20 at (normalised) | 0.67 | 0.83, 0.67, 0.67 |
| I2/I3, s = 3 | nominal from a, every d | nominal from a, every d |
| I2/I3, s = 2, restored up to | d = 0.6 | d = 0.3 |
| reference point: Operativity, Shapley | 0.803 / 0.985 / 0.986 → 1.0; 0.083, 0.068, 0.046 | identical |

- **Holds at both scales:** under the plan any shortfall of firefighters the scale registers fails F20 (Zheng's rule: late guidelines and missing firefighters together); two-way updates suffice up to 40 % drawn away on the grid; beyond, only mutual aid restores F20, before the whole ring's deadline, Tank 63's included, when it arrives by 30 minutes; I2 = I3; Shapley puts F5's one-way communication first.
- **Belongs to the scale:** the plan's exact threshold (1/4, 1/7: the smallest shortfall the scale registers); the exact two-way threshold (1/2, 3/7; it tends to 1/3, the share one damping step absorbs, so the damping's size is the assumption); how degraded F20 is beyond it; and how far mutual aid reaches under severe telecom damage (60 % against 30 %).
- **Entailed:** the order of the options (each removes a deviation or adds supply; the engine is monotone).

## Decision model: Koriyama's recommendations on structure alone (`decide_koriyama.py`; declared at abd3314, TRANSLATION.md §4f)

Togawa et al. give two qualitative recommendations and no capacities, call counts or deadline, so the procedure runs on structure: options I0 (as happened), I1 (R1, public communication), I2 (R2, evacuation behaviour held nominal), I3 (both), under reading A (119-call load exogenous, as the FRAM draws it) and B (calls follow evacuation, as the case narrative says: one model edit, an edge T6 → 119 calls at full dependency; re-encoded from two harness passes at d2adf31, results identical). Every line of the hand reading held.

| Declared coding, N = 4 | T5 | T6 | T9 (Rescue) | Operativity A | Operativity B |
|---|---|---|---|---|---|
| I0 | 3 | 3 | 3 | 0.815 | 0.815 |
| I1 (R1) | 4 | 3 | 3 | 0.926 | 0.926 |
| I2 (R2) | 3 | 4 | A: 3, **B: 4** | 0.852 | 0.889 |
| I3 (both) | 4 | 4 | A: 3, **B: 4** | 0.963 | 1.000 |

- **Under A no option restores Rescue** (night and the 119 calls coincide at T9). **Under B only R2 does**; R1 repairs more functions (T1, T2, T5) and leaves T6 and T9 degraded, because the environment and the night coincide at T6.
- **Severity grid** (`koriyama_grid.csv`): I0 and I1 never restore Rescue; I2 and I3 restore it at 27 of 81 points under B and never under A. The order I0 ≤ I1, I2 ≤ I3 holds at every point (entailed).
- **Scale:** N = 7 gives the same table (normalised values identical).
- **Shapley of I0** (loss 0.185): T1 0.060, T2 0.051, environment 0.041, night 0.026, 119 calls 0.007.
- What the integration shows: the FRAM draws the call load as exogenous, and under that reading none of the recommendations helps Rescue. The recommendations' effect on Rescue rests on an assumption the FRAM does not state (calls follow evacuation), which the model makes explicit.

## Decision model: Koriyama with rescue capacity and the night (`decide_koriyama.py`; declared at 3532983, TRANSLATION.md §4j)

§4f's model with rescue capacity supplying the 119-call node (κ, in units of the event's call load) and hourly periods 13:00–10:00: night 17:00–06:00, calls from 22:00. Under A the load stays 1; under B it drops to r once Evacuation Behaviour holds. 576 points (`results/koriyama_capacity.csv`); §4f's three files regenerate byte-identical.

| T9 (Rescue) held through the night, 22:00–06:00 | Assumption A | Assumption B |
|---|---|---|
| I0 the event, I1 R1 | never: the night and Evacuation Behaviour coincide at T9 | never |
| I2 R2, I3 R1 + R2 | once κ > 0.75 (N = 4), κ > 6/7 (N = 7) | once κ > 0.75 r (N = 4), κ > (6/7) r (N = 7) |

After dawn (N = 4, A): I1, I2, I3 nominal once κ > 0.5; I0 once κ > 0.75 (Evacuation Behaviour still deviates by day under I0).

- **Every line of the hand reading held**: 0 of 576 points differ on the night; I1 never changes T9 at night; the order I0 ≤ I1, I2 ≤ I3 holds at every hour of every point.
- **What it shows.** §4f's answer was the case κ ≤ 0.75 of this one. With capacity in the model, R2 is the intervention that holds rescue at night under both assumptions, and what it needs differs: capacity for three quarters of the calls if calls are external (A), or a drop of the backlog to below κ/0.75 if they follow evacuation (B). R1 acts only after dawn.

## The decision models under the alternative rules (`decide_rules.py`; declared at 3187cdb, TRANSLATION.md §4h)

Does the conversion rule RQ1 checks matter to what the comparisons conclude? Both models rebuilt with the rule swapped; everything else unchanged (`results/decision_rules_zheng.csv`, `decision_rules_koriyama.csv`).

**Zheng** (F20; telecom at 3, a = 30 min):

| Rule | I0 the plan | I1 two-way updates | I2, I3 + mutual aid | What the comparison would recommend |
|---|---|---|---|---|
| **Eq. (1)** | severe from d = 0.3 | nominal to d = 0.4, then 3 | restored on arrival | each intervention has its region |
| S0 reachability | severe at every d | severe at every d | severe at every d | nothing helps: the telecom damage alone reaches F12, F17 and F20 |
| D1 damping only | nominal to d = 0.4, then 3 | same as the plan | restored on arrival | two-way updates have no effect (F12 never deviates) |
| K2 coincidence only | severe from d = 0.3 | nominal at every d | nominal at every d | two-way updates always suffice; mutual aid is never needed |

Every Zheng line of the hand reading held. Telecom at 2 (not predicted): D1 and K2 give the same rows as at 3; S0 stays severe everywhere.

**Koriyama** (T9, Rescue; declared coding):

| Rule | Reading A | Reading B |
|---|---|---|
| **Eq. (1)** | no intervention restores T9 | I2 and I3 restore T9 |
| S0 | no intervention restores T9 | I2 and I3 restore T9 |
| D1 | T9 nominal in every intervention, I0 included | same |
| K2 | no intervention restores T9 | I2 and I3 restore T9 |

- **One line of the hand reading failed.** S0 was predicted to leave T9 degraded under both readings; under B it restores T9 with I2 and I3, as Eq. (1) does. The night restriction enters T9 through a Time aspect, which S0 damps by one step. S0 differs from Eq. (1) elsewhere (I1 does not restore T5; Operativity 0.741 against 0.815 under I0), and not at T9.
- **What it shows.** On Zheng the rule decides the comparison: each of the three alternatives changes what it recommends. On Koriyama the answer about Rescue is the same under three of the four rules and differs only under damping only, where the event degrades nothing downstream. The link between RQ1 and RQ2 is strong on the case with quantities and weak on the structural one, whose finding (the answer turns on whether calls follow evacuation) is robust to the rule.

## Ablations, severity grid, claim tiers, reference check (`run_ablation.py`; declared at 44fc0bc, TRANSLATION.md §4c)

**Reference evaluator** (`results/reference_check.csv`): the printed formula, re-implemented without the engine, equals the engine in every function level of 13,864 Scenarios (8 semantics × the three grids and 100 random Scenarios on each of 13 `.xfmv` models). 0 differences.

**RQ1 under the family** (`results/ablation_rq1.csv`), balanced accuracy at the declared event coding:

| | Zheng | Tian | Wenzhou | Koriyama |
|---|---|---|---|---|
| S0 reachability | 0.50 | 1 | 0.50 | 0.75 |
| D1 damping only | 0.56 | 1 | 1 | 0.50 |
| K2 coincidence only | 0.88 | 0.50 | 0.50 | 1 |
| **v2** (= v2+3 = v2+c) | **0.88** | **1** | **1** | **1** |
| v2-D2 | 0.88 | 0.50 | 0.93 | 1 |
| v2-typed (FRW) | 0.50 | 1 | 0.50 | 0.75 |
| FMI | 0.50 | 0.50 | 0.50 | 0.50 |

- v2 is the only rule that passes all four. On the two cases it was not designed on, removing coincidence loses Koriyama and removing damping loses Wenzhou.
- FRW-typed damping behaves as reachability (I, P, R pass the drop undamped); the FMI degrades nothing, since no event is a failure.
- Severity grid: v2's mean is 0.72 (Zheng), 0.83 (Wenzhou, Koriyama), minimum 0.5. K2 and v2-D2 are more robust on the Zheng and Koriyama grids and fail Wenzhou or Tian at the declared coding. The reading of the event is the main sensitivity.
- Kaya top-4: 2/4 for every coincidence or damping member, 1/4 for S0 and v2-typed.
- Hand reading at 44fc0bc: D1, K2, v2-typed and FMI as predicted; v2's grid fall as predicted.

**Claims by tier** (`results/ablation_claims.csv`): rule-decided C1; entailed C12, C13; discriminating C2, C4–C6, C8–C10, C14. Agreements on the 8 discriminating: S0 1, v2-typed 1, D1 3, **v2 4**, K2 4, v2+3 5, v2-D2 5, v2+c 6. The claims separate coincidence-based rules from reachability, not v2 from its variants. Strict verdict: C5 is 1/3 under v2 (2/3 under v2+3, v2+c).

**New held-out cases:** none qualified in the first screening (TRANSLATION.md §4c). The second, systematic screening found three; two entered after reading (§4g, below).

## New held-out cases (`run_newcases.py`; declared at 43b0532, TRANSLATION.md §4g)

Balanced accuracy at the declared coding (mean / minimum over all codings), `results/newcases_rq1.csv`. No Specific Rules: neither source states one.

| | Adhita (2 encounters) | Adhita, reading B | Nayak (fipronil) | mean of six, declared |
|---|---|---|---|---|
| S0 reachability | 0.50 (0.50/0.50) | 0.50 | 0.65 (0.62/0.57) | 0.65 |
| D1 damping only | 0.50 (0.59/0.12) | 0.50 | 0.52 (0.48/0.35) | 0.68 |
| K2 coincidence only | 0.50 (0.50/0.50) | 0.62 | 0.50 (0.50/0.50) | 0.65 |
| **v2** | **0.50** (0.55/0.12) | **0.62** | **0.73** (0.55/0.38) | **0.85** |
| v2-D2 | 0.50 (0.51/0.12) | 0.62 | 0.54 (0.51/0.44) | 0.73 |
| v2-typed (FRW) | 0.50 (0.50/0.50) | 0.50 | 0.65 (0.62/0.61) | 0.65 |
| v2+3, v2+c | 0.50 (0.47/0.00) | 0.62 | 0.70 (0.56/0.38) | 0.85 |
| FMI | 0.50 (0.57/0.00) | 0.50 | 0.59 (0.59/0.50) | 0.52 |

- **Decision rule (§4c):** mean over the two new cases at the declared coding, v2 0.615, v2+3 and v2+c 0.601: **v2 stays**, now decided rather than by default.
- **Adhita does not separate the rules.** As in the hand reading: v2 keeps all four encounter-1 functions nominal (specificity 1) and marks none of encounter 2's five (recall 0); reachability does the reverse. Encounter 2's single deviations reach their consumers alone or through a loop, so damping absorbs them; the authors see them resonate. Under reading B (WAT_A a third, coincident deviation) the coincidence rules reach 0.62.
- **Nayak:** v2 marks N4.3, N4.4, N4.5, N4.10 and misses N4.1, N4.2, N4.9 (each fed by a function drawn as performed, so the drop is damped on the way); its two false positives are N3.5 and N3.6, downstream of the functions with no input activity (level 1).
- The six-case mean uses Tian with its Specific Rules (§4c table). Without them (`run_ablation.no_description_rules`, checked 2026-11-03) Tian is v2 0.62, v2+3 0.75, and the six-case mean is v2 0.79, v2+3 0.80.

## Design decisions behind v2 (exploration, in the git history before aebd4b0)

- **Resonance as one rule per function.** First written over damped copy nodes, identical to a compiled-Specific-Rule version (0 of 864 scenarios differ). Now written with level offsets (ADR-0025), `worst_of(worst_of(a, b, …) + 1, <second worst>)`, with no copy or helper nodes: every result byte-identical, and the earlier demonstration model shrank from 178 to 101 nodes.
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
| Falegnami 2020's Katz ranking as ground truth | it is a method output (the focus group confirmed its top 15). Checked instead (declared at 7f5c33a, `results/falegnami_katz.csv`): the authors' weighted edge list reproduces Table 2 (Spearman 0.988, top 15 identical); with every coupling at weight 1 it falls to 0.28 (top 15: 10). This published ranking is carried by its variability scores, so the discussion sentence above excludes it. Weight 1 also restores the 104 couplings the authors left unscored; the declared test does not separate the two effects |
| Scenario attribution vs topology (5b31c45) | superseded by RQ2's counterfactual design |
| The FRW toy | related work only |
