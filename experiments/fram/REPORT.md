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
