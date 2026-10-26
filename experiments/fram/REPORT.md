# FRAM experiments — first run report (2026-10-26)

Branch `feat/fram-experiments`. Translation frozen in [TRANSLATION.md](TRANSLATION.md) v0
(commit 96fda35) before any ground-truth run. Raw numbers in `results/`.
Re-run: `CASCADE-backend/.venv/bin/python experiments/fram/run_v1.py` (then `run_e1.py`, `run_e2.py`).

## 1. Verification (V1) — passes

**FMI.** 11 models, 2,624 scenarios (baseline, every single knockout, 200 random pairs each).

| Result | Value |
|---|---|
| CASCADE = greatest fixed point of the FMI operator | **2,624 / 2,624** (every model, cycles and Grabbe's 117 non-default profiles included) |
| CASCADE = FMI (least fixed point) on the 7 acyclic models | **all scenarios** (P1) |
| CASCADE = FMI on the 4 cyclic models | Resilience potentials 0: 207/209; Grabbe: 357/486; the other two: all |

The divergences are exactly P3's loops:
- **Resilience potentials 0:** the four potentials feed each other, so the FMI deadlocks 7 of 8 functions. Versions 1 and 2 of the *same* library model add profiles that break the loop, i.e. the modellers repair the deadlock by hand.
- **Grabbe:** one strongly connected component of 162 functions. At baseline the FMI never activates 7 oncoming-vehicle functions (*driving free (OV)*, *plan escape route (OV)* …), which the authors clearly intend as active.

**Fault tree.** Khakzad 2011 enumerated through CASCADE (2⁷ scenarios): **0.272042**; closed form 0.272042; published 0.2720 (P2).

## 2. RQ1 — faithful collapse (E1): recall yes, specificity no

**Zheng 2024** (earthquake: communications 2, firefighters 3):
- negatives F12, F17, F20: **3/3 recovered**, all structural;
- positives F2, F14, F15: **0/3 kept**; 21 of 22 functions degrade.
- F2 itself requires *Radio/Telephone* in Table 1, yet the experts say it performs well; F14 and F15 sit downstream of F12 and are also judged fine.
- The declared variants change nothing on this case (communications enter as Resources). With Resource attenuation (R_dep3), F12 and F17 become mild, and the rule written from the paper's text ("F12 + F17 → F20 cannot extinguish") is what makes F20 severe. This is a working example of the rule-encoded class.

**Kaya & Hocaoğlu 2020**, exact over 81 SPC scenarios:

| Method | Couplings flagged | P / R / F1 vs Fig. 5 | Spearman | Top-4 functions ∩ workshop {F1, F2, F8, F9} |
|---|---|---|---|---|
| VPN re-run (paper's method) | 16 | 0.62 / 0.62 / 0.62 | 0.49 | 3 (F2 F8 F1 F6) |
| CASCADE one-hop | 36 | 0.42 / 0.94 / 0.58 | 0.25 | 2 |
| CASCADE transitive | 45 | 0.36 / 1.00 / 0.52 | −0.21 | 1 (saturated: most functions 66–77 %) |

Why: 48 of 49 couplings amplify when the output deviates (A_T = A_P = 2), so after the one-level collapse every variable output passes, and transitivity floods the model. Kaya's discrimination lives in the probability mass that the VPN multiplies; the collapse keeps only "possibly variable".

**Ground-truth finding (post-freeze, labelled).** Fig. 5 is the output of Kaya's own Monte Carlo. The independent expert conclusion is the workshop: the functions that "vary the most" are F1, F2, F8, F9. The nurses also say variability "is likely to aggregate and, in turn, delay other activities", which is a statement of transitivity.

## 2b. RQ1 under the v1 proposal (E1b, frozen at f22f61b)

The proposal is two parts:
- **Damping:** every coupling absorbs one level.
- **Resonance:** a function also follows the *second-worst* of its distinct inputs, so level = min(worst + 1, second worst). This is compiled into Specific Rules; no engine change.

**Trigger couplings:** an Input that a function acts on when it deviates (a monitor watching what it monitors) does not count as a dependency. Raw: `results/e1b_*.csv`.

| Case (ground truth) | S0 = v0 | S1 damping | **S2 damping + resonance** |
|---|---|---|---|
| Zheng, 16 functions of Table 2, comms = 2 (frozen) | 8/8 neg · 0/8 pos · bal. acc 0.50 | 5/8 · 5/8 · 0.63 | **8/8 · 3/8 · 0.69** |
| Zheng, comms = 3 (sensitivity) | 0.50 | 1/8 · 8/8 · 0.56 | **8/8 · 6/8 · 0.875** (wrong: F18, F19) |
| Tian, 6 scenarios (model checking) | 4/6 | 2/6 | 3/6 |
| Tian + the paper's rule "time pressure from F7 → untrimmed" | 5/6 | 5/6 | 5/6 |
| Kaya workshop, top-4 ∩ {F1, F2, F8, F9} (VPN: 3) | 1 | 2 | 2 |

**Reading the table**
- **Zheng.** Resonance reproduces the experts' chain: F5 → F7 → F9–F11 → F12 → F17 and F20 are flagged, while F13 → F14 → F15 → F16 absorb F12's single delay. The F20 rule from §4.2.1 makes F20 *severe* (rule-encoded class).
  - F18 and F19 remain wrong. They receive F12 and F17, whose deficits share one origin, so the rule counts a common cause as a coincidence.
  - The severity given to "damaged communications" is the largest sensitivity (0.69 vs 0.875). The paper does not quantify it.
- **Tian.** The remaining miss (bosun present, early call) needs the paper's Table 3 rule for F2 (an early call pulls the bosun away before closing). That rule was not in the freeze.
- **Kaya.** Unchanged in substance: its information sits in the probability mass, which the one-level collapse cannot carry.

**Smith 2017** (P of losing *controlled propane flow*, 2⁵ scenarios):
- (a) literal translation: **0.7326**. The monitor and the alarm depend on the automatic feed they watch, so the manual backup is useless.
- (b) with trigger couplings: **0.2720**, the fault tree exactly.
- (c) (b) plus Smith's shared-sensor question: **0.3756**, i.e. +38 % from the dependency the FT and BN hide. This quantifies the paper's qualitative conclusion.

## 2c. Exploratory fidelity study (E1c — after v1, not frozen; informs Gate 1)

Raw: `results/e1c_*.csv`.

1. **Resonance with existing rule types only.** One nested intercategorical rule per function implements it: `worst_of(dmp_a, dmp_b, …, best_of(a, b), best_of(a, c), …) propagates to F`. Here `dmp_x` is a damped copy of input x, carrying `dependency_level` N − 1, and the best_of pairs give the second-worst term.
   - **Identical to the compiled Specific Rules:** 0 mismatches in 64 toy cases and 800 random scenarios on four models.
   - Responsibility shares stay meaningful, and no new operator is needed.
   - Pitfall: rule arguments must name *categories*. The parser resolves node ids first, and an all-node rule is intracategorical, which overrides nothing.
2. **Wider scale (Zheng; N ∈ {4, 7, 10}, damping Δ, severities as fractions of the scale).**
   - No fidelity gain. The outcome depends only on whether the single-input damping covers the event's deficit, which is a ratio, so every N reaches the same best value (0.875) at the matching ratio.
   - N = 4 with Δ = 2 gives 0.875 for every communications severity, **but it breaks Tian (2/6 even with rules)**: over-damping stops the "faster" deviation before F8. Δ = 1 is the robust choice across cases.
3. **Common-cause refinement** (drop pairs whose inputs share an upstream origin): worse, losing F9–F12, F17 and F20. The experts *do* pass delays with a shared origin (F7's lateness through F9–F11 to F12). Dropped.
4. **Tian with the rules written from the paper** ("time pressure from F7 → untrimmed", text; "early call → doors not closed even with an order", Table 3): **6/6** under both S0 and S2. S2 also removes S0's 2 spurious violations from late loading alone.
5. **Kaya on N = 10** (exceedance probability graded onto the scale, functions ranked by expected deficit): still 1/4. The workshop truth is coarse, and the per-coupling probabilities do not localise to functions.

**Candidate v2 for Gate 1:**
- S2 in nested-rule form, N = 4, Δ = 1;
- trigger couplings and rules written from the papers' descriptions;
- event severity "damaged" = one level unless the paper says otherwise.

| Case | v2 candidate |
|---|---|
| Zheng | 8/8 neg, 6/8 pos (0.875); 0.69 if communications count as severe |
| Tian | 6/6 |
| Smith | FT exact (0.2720); shared sensor 0.3756 |
| Kaya workshop | 2/4 |

Remaining misses, all in the *beyond the scale* class:
- F18 and F19, which adapt ("quickly");
- Kaya's probability mass.

## 3. RQ2 — model-based centrality (E2): no, and the reason is informative

| Case (k) | Vitality | Degree | Betweenness | PageRank (rev.) | Katz (rev.) | Random |
|---|---|---|---|---|---|---|
| Grabbe human (23 of 285) | 0 | **16** | 14 | 11 | 13 | 1.9 |
| Grabbe automation (21 of 285) | 0 | 7 | **10** | 5 | 4 | 1.6 |
| Li 2026 DRL set (5 of 13) | 2 | 4 | 3 | **5** | **5** | 1.9 |
| Kaya couplings (13 of 49), Spearman | 6, 0.38 | — | 6, 0.19 (edge) | — | — | 3.5 |
| Zinetullina couplings (3 of 31), Spearman | 0, −0.49 | — | 1, 0.00 (edge) | — | — | 0.3 |

- **The published rankings are outputs of each paper's own method, and those methods are topological.**
  - Grabbe's "system resonance" weights functions by link counts, and degree recovers 16 of 23.
  - Li's one-hop propagation runs along out-links, and **reverse Katz/PageRank reproduce the learned DRL policy exactly (5/5)**.
  - Kaya's and Zinetullina's rankings come from per-coupling factors that no structural measure can see.
- **Vitality answers a different question:** what the system cannot lose.
  - Grabbe's top Vitality functions are background provisions: *enable clear view ahead*, *provide road signs*, *provide speedometer*, *observe road signs*. This is Falegnami 2026's power-supply point, the functions topology ranks low.
  - Li's top is P5, cross-department coordination.
- **Saturation again:** in Grabbe's 162-function loop, one knockout costs about 50 % of operativity for almost every function, so Vitality barely discriminates there.

## 4. Issues found

1. **Engine behaviour (by design, documented):** a parent passes all its Requisite categories to every child, so the translation needs one output node per (function, output text).
2. **Kaya CSV:** F20's rows print the aspect as "F15R"; the reader accepts both spellings.
3. **Grabbe Table A4:** 21 automation marks against 22 in the text; three names are spelled differently from the model file (aliases in `data/`).
4. **Zheng:** the destroyed fire-water network and the "limited time" have no coupling in Table 1, so they are not representable in v0.
5. **FMI oracle assumption:** entries are functions without incoming couplings. The 7-function deadlock in Grabbe should be confirmed in FMV's own FMI.

## 5. Not yet run

- Transcriptions: Smith 2017 FRAM, Kim & Yoon 2021, Tian 2016, the FRW toy.
- The FRW oracle; Shapley Value (only Vitality so far).
- The demonstration's Temporal Simulation and SourceToDemands resources.
