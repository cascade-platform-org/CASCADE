# Frozen translation and per-case mappings — v0 (2026-10-26)

PLAN §6 requires the translation, the per-case mappings, the class rules and the
E1b variants to be fixed **before any comparison with ground truth**. This file is
that freeze. It is committed before E1/E2 are run; its git history is the record.
Status: **provisional**, written by Claude, pending Cristian's Gate 1 review. If
Gate 1 changes anything, both v0 and the new version are reported.

## 1. Structure (all cases)

- Scale N = 4: 4 nominal, 3 variable, 2 severe, 1 not performed. V1 uses N = 2.
- Function → node with its own Requisite category. Each distinct (function,
  output text) → an output node with the category of that text. Consumers take
  `best_of` over producers of the same text and `worst_of` across texts.
- External resources and conditions no function produces → background function
  nodes (one per distinct text).
- Scores count function nodes only. Operativity = mean of (level − 1)/(N − 1).

## 2. Aspect → Category Dependency Profile (default translation)

| Aspect | `dependency_level` (N = 4) | Reading |
|---|---|---|
| I, P | 4 | full: the drop passes |
| R (no quantity published) | 4 | presence; SourceToDemands only where a quantity is published (none in v0) |
| C, T | 3 | degrades without blocking: one level absorbed, "not performed" arrives as "severe" |

V1 (FMI mode): every aspect blocks; profile None → `dependency_level` 1; Any →
`best_of` within that aspect type via an intercategorical rule.

## 3. Per-case mappings

### E1-Zheng 2024 (also the demonstration's testable claim)
- Event = the earthquake damage the paper names: background nodes
  "Radio/Telephone" and "Internet/Telephone" → 2 (communications damaged);
  "Firetruck; firefighter; PPE, SCBAS, etc." → 3 (firefighters drawn elsewhere).
- Not representable in v0: "limited time" (the paper's Time aspects all read
  "as soon as possible" and were not transcribed); the destroyed fire-water
  network (no function couples to it in Table 1).
- Ground truth: negative {F12, F17, F20}; positive {F2, F14, F15}.
- Flag: a function is predicted negative when its level < 4.
- Rule-encoded class, written from §4.2.1 ("coupled F12 + F17 → F20 cannot
  extinguish within the specified time"): `if fn_F12 is variable and fn_F17 is
  variable then fn_F20 is severe` (applied with the node ids of F12/F17/F20).

### E1-Kaya & Hocaoğlu 2020
- 81 SPC scenarios, each weighted by its probability (exact, as the VPN oracle).
- Output node initial level in scenario z: 3 if P(V_T·V_P·e_z ≥ 54/4) ≥ 5 %,
  else 4. 54/4 is Kaya's threshold divided by the maximal amplification (2·2);
  an output shared by several rows takes the worst level over them.
- Coupling dependency from the amplification expected when the output deviates
  (V_T ∈ {3,4}, V_P ∈ {3,4}, weighted by the SME distributions): passes
  (`dependency_level` 4) if E[A_T·A_P | deviated] > 1, absorbs one level (3) otherwise.
- A coupling is flagged in a scenario when its output node is below 4 and the
  coupling passes the drop. Frequency = 100 × Σ_z P(z)·flag.
- Ground truth: the 13 critical couplings of Fig. 5 with their frequencies.
- One-hop truncation (E1b): the same flag computed from each output's own initial
  level only (no inheritance through functions).

## 4. E2 rankings (structural, default translation)
- Vitality Centrality of a function = Operativity drop when it is set to 1.
  Of a coupling = drop when its edge is set to 1.
- Grabbe 2022: top-k functions (k = 23 human, 21 automation) vs Table A4 sets.
- Li 2026: top-5 of the 13 control domains vs {P4, P5, R3, S2, R5}.
- Kaya 2020: coupling ranking vs Fig. 5 frequencies (Spearman over 49; top-13 overlap).
- Zinetullina 2021: coupling ranking vs cv_p5 (Spearman over 31; top-3 vs C15, C11, C23).
- Baselines on the function graph: total degree, betweenness, PageRank, Katz
  (α = 0.1); edge betweenness for couplings. Ties are broken by id; overlap
  significance by the hypergeometric tail.

## 5. E1b variants (declared now, run after E1)
Control/Time attenuation 4 (blocking) and 2; Resource attenuation 3; one-hop truncation.

---

# v1 proposal and new cases (frozen 2026-10-26, before the runs below)

Motivation (from the v0 run, not from the new ground truths): v0 recovers the
negatives but degrades almost everything downstream. Zheng's own narrative
(Table 2) states the mechanism FRAM assumes: one deviating input is absorbed
("F17 assembles on time although guidelines from F12 are delayed"), two
coinciding deviations pass ("coupled F12 + F17 → F20").

## S2 — damping + resonance (`resonance_config`)
- Every coupling absorbs one level (`dependency_level` = N − 1).
- The function also follows the **second-worst** of its distinct inputs.
- Compiled into Specific Rules (a firing rule replaces the proposal, engine
  Guard 3), giving level = min(worst input + 1, second-worst input).
- S1 = damping alone (`dependency_level` N − 1 on every aspect, no rules).
- **Trigger couplings:** an Input the function acts on when it *deviates* (a monitor watching what it monitors) gets `dependency_level` 1 and no rule.

## New cases and mappings
**Zheng, expanded truth** (Table 2 + §4.2.1, 16 labelled functions: 8 negative, 8 positive; `data/zheng_2024_table2.csv`).
- Origins as v0, plus F5's own variability = 3 ("one-way communication", stated as the origin of the delay chain).
- Communications at 2, the v0 value; 3 is reported as a sensitivity.
- Metric: negatives recovered, positives kept, balanced accuracy.

**Kaya workshop** (function level, {F1, F2, F8, F9}).
- Output levels as v0.
- Metric: top-4 functions by frequency of degradation.

**Smith 2017 FRAM** (App. A).
- N = 2. Basic events map to functions: PT → Measure pressure; PC → Control pressure; PY → Relay pressure; A_valve ∪ Actuator → Automatically operate valve; Hum_error ∪ M_valve → Manually operate valve.
- *Controlled propane flow* takes its two Inputs as alternatives (profile Any, from its description).
- Variants:
  - (a) literal;
  - (b) Monitor and Alert read *Feed controlled automatically* as a trigger;
  - (c) (b) plus Smith's question: Monitor also needs *Pressure measured* (shared sensor).
- Ground truth: the FT top event 0.2720 for (b); the direction of (c).

**Tian 2016** (Table 1).
- States → levels: nominal 4; "earlier / later / faster" 3; "too early" 2; "not closed / not trimmed / absent" 1.
- Inputs searched: F7 ∈ {4, 3, 2}; assistant bosun absent (F2 = 1) or present; F1 ∈ {4, 3}.
- The violation is F2 < 4 ∧ F5 < 4 ∧ F8 < 4.
- Ground truth: goal0 (bosun absent, F7 = 3), goal1 (bosun present, F7 = 3), goal2 (F7 = 2) violate; F7 = 4 does not.
- Rule-encoded variant, from the paper's text ("time pressure from F7 resonates through untrimmed ballast and higher speed"): `if F7 below 4 then F5 is not performed`.

---

# Held-out case: Wenzhou 2011 (declared 2026-10-26, before the run)

Model: Li & Huang 2025 Fig. 4, digitised (`models/li_2025_wenzhou.csv`, 20 modules, 35 couplings; all 12 Table 3 and all 5 Table 1 couplings present). Translation: the v2 candidate (nested S2, N = 4, Δ = 1), compared with S0. **No case-specific rules**: the paper's text (v)–(viii) only restates transmissions the network already carries.

**Scenarios** (from Sect. 6 and Table 2):
- A, physical trigger only: lightning fails the track circuit M7 and GSM-R M10 → level 1 (they no longer deliver their output).
- A2, sensitivity: M7 = M10 = 2.
- B, all origins of Table 2: A plus the human/management variability of M5, M8, M11, M16, M19 → 3.

**Ground truth and metrics**
- Functions (scenario A). Positives: Table 1's influenced modules and the accident's chain {M5, M8, M11, M16, M17, M19, M20} (M20 = D301 fails to brake, the collision). Negatives: the downstream modules with no variability in Table 4 {M12, M13}. M15 and M18 are reported but not scored: the paper gives them only transmitted variability (~10⁻⁸), and the report is silent on them.
- Couplings (scenario A). A coupling is flagged when its source and its target are both below 4. Truth: Table 1's five broken connections; secondary truth: Table 3's twelve transmission paths.
- Critical modules (scenario B). Shapley value of the seven origins for the collision, v(S) = 4 − level(M20) when only the origins in S deviate. Top-4 vs {M5, M7, M8, M10} (Table 5, which the authors state agrees with the report).

---

# Kim & Yoon 2021: two translations compared (declared 2026-10-27, before the run)

Model: Table 3 (14 functions, aggregation rules, θ, IEV_p). An oracle re-implements their simulation (Sect. 3, Eqs. 1–6). It reproduces Table 7's shares within about 2 points; durations run about 1.25× Table 5's. Run deterministically, their recurrence has a sharp threshold: nothing propagates at IEV ≤ IEV_p, and everything except F2 and F6 resonates from about 1.25·IEV_p. Resonance in their model is therefore a tail event of the sampling.

**Common choices**
- Scale: logarithmic between nominal (V = 1) and Kim's resonance criterion (V = 10). Level k stands for V = 10^((N−k)/(N−1)). N = 4 primary, N = 7 secondary.
- IEV fixed at the published IEV_p. The effective threshold on the aggregated coupling variability is θ_i / IEV_p,i.
- Scenario events: F3, F4, F5 start at the level of their 95th-percentile own variability, 1.96·IEV_p (from Table 2). Sensitivity: one level worse.

**Translations**
- **A, Specific Rules:** Kim's rule, θ and IEV_p, evaluated on the level representatives and compiled into minimal monotone Specific Rules. Couplings carry dependency_level 1.
- **B, structural:** the formula's shape becomes one nested rule (max, +, × → worst_of; min → best_of). Damping = the level of θ_i / IEV_p,i.
- **References:** S0 and the generic v2 candidate (no formulas).

**Ground truth (the paper's published results) and metrics**
- G1, pattern (Table 7, share of high-variability time points). Positives: F7–F13 (≥ 5 % in every scenario). Negatives: F2 (≤ 1.6 %) and F6 (0 %). Score = degraded (< N) on positives and nominal on negatives, union over S1–S3.
- G2, resonance (Table 6, > 10 in any scenario). Positives: F4, F5, F7–F12. Negatives: F2, F3, F6, F13. Predicted = level 1.
- G3, influence (Fig. 8 and Sect. 4.4.3): F7 and F11 most influential; F11 critical. Vitality under S2 (drop from the S2 state when a function is set to 1) over the 12 non-background functions: top-2 vs {F7, F11}, and the rank of F11.
- G4, scenario order (Table 5): total deficit S1 ≤ S2 ≤ S3, strict at least once.

---

# v2 — the translation the paper uses (fixed 2026-10-27, approved by Cristian at Gate 1)

One translation for every case. Case-specific content enters only as rules read from the source paper's description, listed per case below.

**Structure.** As v0 §1: function nodes, one output node per (function, output text), background nodes for external texts.

**Semantics** (`resonance_config(mode="nested")`):
- every coupling absorbs one level (`dependency_level` N − 1);
- each function follows the second-worst of its distinct inputs, as one nested intercategorical rule over damped copies of its inputs; level = min(worst + 1, second worst);
- **trigger couplings:** an Input the function acts on when it deviates (a monitor watching what it monitors) has `dependency_level` 1 and no rule.

**Scale.**
- N = 4 (nominal, variable, severe, not performed) for qualitative sources.
- N = 7, logarithmic between V = 1 and the source's resonance criterion, when the source propagates variability as a ratio-scale quantity through formulas (Kim).
- N = 2 with every coupling blocking for binary sources (fault-tree events), where one-level damping does not exist (V1, Smith).

**Events.** A deviation the source calls "damaged/delayed/variable" is one level; "failed / not delivered" is level 1; quantitative sources use their own distributions (Kaya: SPC scenarios; Kim: 95th percentile of the published variability).

**Rules from the description** (the only case-specific content):

| Case | Rule | Source |
|---|---|---|
| Zheng | F12 and F17 below nominal → F20 severe | §4.2.1 |
| Tian | F7 below nominal → F5 not performed; F7 below nominal → F2 not performed | text; Table 3 |
| Smith | Monitor and Alert read the automatic feed as a trigger; *Controlled propane flow* takes its two Inputs as alternatives | App. A descriptions |
| Kaya | per-coupling amplification (E[A_T·A_P | deviated] > 1 passes, else one more level absorbed) | Appendix 1 |
| Kim | each function's aggregation rule, θ and IEV_p, compiled to Specific Rules | Table 3 |
| Wenzhou | none | — |

---

# Second held-out case: Koriyama 2019 (declared 2026-10-27, before the run)

Model: Togawa et al. 2023 Fig. 5 with Table 2's output texts (`models/togawa_2023_koriyama.csv`, 9 functions). Translation: v2, no case rules (the paper writes none beyond the map).

**Event** (Sects. 3.3 and 4.4.1), each one level, by the v2 convention:
- PC3 and PC4: alerts issued early, yet "residents may still have lacked sufficient time", and the system "failed to communicate information across the municipality, resulting in confusion";
- *Immediate environment*: flooded routes, storm, events still underway;
- *Function restricted during nighttime*: evacuation and rescue after dark;
- *Emergency call (119)*: the surge after the levee breach.

Sensitivity: the same event without PC3 and PC4 (alerts read as timely).

**Ground truth: Fig. 6.**
- Functions. Resonated, non-origin: Evacuation Preparation, Evacuation Behavior, Rescue Operations → predicted below 4. Contained: Shelters, Care Needs → predicted 4. Uninvolved: PC5, Emergency Deployment → predicted 4.
- Couplings. Flagged when source and target are both below 4. Truth: the red couplings PC3→EP, PC4→EB, EP→EB, EB→Rescue. Precision and recall over all couplings.

---

# E2b — RQ2 reframed: scenario attribution vs topology (declared 2026-10-27, before the run)

Question: what do model-based metrics reveal that topological rankings miss? Tested on every case whose source reports which of the observed deviations produced the outcome. Translation: v2.

**Metrics.** Each ranks the case's candidate deviations.
- **Shapley:** scenario-conditioned, exact over the players. v(S) = summed deficit (N − level) of the outcome functions when only the players in S deviate, at the severities of the RQ1 mapping.
- **Vitality:** structural; the Operativity drop when the candidate alone is set to 1, on v2.
- **Topological:** degree, betweenness, reverse PageRank, reverse Katz (α = 0.1), out-reach, all on the function graph.

**Cases.**
- **Wenzhou.** Players: the seven Table 2 origins (M7, M10 = 1; M5, M8, M11, M16, M19 = 3). Outcome: M20. Truth: {M5, M7, M8, M10}; top-4 overlap.
- **Koriyama.** Players: PC3, PC4, Shelters, Care Needs (the functions with variability in Fig. 6, one level each), plus the context conditions of E1f (*Immediate environment*, night, 119 calls). Outcome: Evacuation Behavior + Rescue. Truth: the resonated PC3 and PC4 rank above the contained Shelters and Care Needs. Score = the share of correctly ordered (red, blue) pairs (4 pairs; ties count ½).
- **Tian.** Players: F7 early call (3), assistant bosun absent (F2 = 1), late loading (F1 = 3). Outcome: F2, F5, F8 (the safety constraint), with the v2 description rules. Truth: F7 ranks first ("fixing door closing alone would not avoid the hazard").
