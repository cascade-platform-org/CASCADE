# Translation v2 and per-case mappings

The single translation the paper uses (approved at Gate 1, 2026-10-27). Every
experiment was declared in this file and committed **before** it ran; the git
history keeps each declaration verbatim (log at the end). Code: `framkit/translate.py`.

## 1. Structure

- Function → node with its own Requisite category.
- Each distinct (function, output text) → an output node carrying the category of that text. Consumers take `best_of` over producers of the same text (alternatives) and `worst_of` across texts.
  - The output nodes are needed because the engine passes all of a parent's categories to every child.
- External resources and conditions that no function produces → background nodes, one per text.
- Scores count function nodes only.

## 2. Semantics

| | |
|---|---|
| **Damping** | every coupling absorbs one level (`dependency_level` N − 1): a single deviating input is absorbed |
| **Resonance** | a function also follows the **second-worst** of its distinct inputs, so level = min(worst + 1, second worst): two coinciding deviations pass. Implemented as one nested intercategorical rule per function over damped copies of its inputs: `worst_of(dmp_a, dmp_b, …, best_of(a, b), …) propagates to F` |
| **Trigger couplings** | an Input the function acts on *when it deviates* (a monitor watching what it monitors) has `dependency_level` 1 and no rule |
| **Baseline S0** | full dependency on I, P, R; one level absorbed on C, T. A drop reaches everything downstream, i.e. reachability |

**Scale.**
- N = 4 (nominal, variable, severe, not performed) for qualitative sources.
- N = 7, logarithmic between V = 1 and the source's resonance criterion, when the source propagates variability as a ratio-scale quantity through formulas (Kim).
- N = 2, every coupling blocking, for binary sources (fault-tree events; V1).

**Events.** A deviation the source calls damaged, delayed or variable is one level; failed or not delivered is level 1. Quantitative sources use their own distributions (Kaya: the SPC scenarios; Kim: the 95th percentile of the published variability).

**Rules from the description.** These are the only case-specific content.

| Case | Rule | Source |
|---|---|---|
| Zheng | F12 and F17 below nominal → F20 severe | §4.2.1 |
| Tian | F7 below nominal → F5 not performed; F7 below nominal → F2 not performed | text; Table 3 |
| Smith | Monitor and Alert read the automatic feed as a trigger; *Controlled propane flow* takes its two Inputs as alternatives | App. A |
| Kaya | a coupling whose expected amplification does not exceed 1 absorbs one more level | App. 1 |
| Kim | each function's aggregation rule, θ and IEV_p compiled to monotone Specific Rules (`framkit/kim.py`) | Table 3 |
| Wenzhou, Koriyama | none | — |

## 3. Cases, events and ground truth

| Case | Model | Event | Ground truth |
|---|---|---|---|
| Zheng 2024 (CC BY) | Table 1, 22 functions | communications and firefighters damaged (3); F5 one-way (3) | Table 2: 8 negative, 8 positive |
| Tian 2016 | Table 1, 8 functions | F7 ∈ {4, 3, 2}; bosun absent (F2 = 1) or present | model-checking scenarios (violations at F7 < 4) |
| Smith 2017 / Khakzad 2011 | App. A; FT basic events → functions | 2⁵ failure combinations | FT top event 0.2720 |
| Kaya 2020 | App. 1, 21 functions, 49 couplings | 81 SPC scenarios, exact | workshop: F1, F2, F8, F9 vary most |
| Kim & Yoon 2021 | Table 3, 14 functions | F3–F5 at 1.96·IEV_p | Tables 6–7: F7–F13 high, F2 and F6 not |
| **Wenzhou 2011** (held out) | Li & Huang 2025 Fig. 4, digitised: 20 modules, 35 couplings | lightning: M7, M10 = 1 | report via Tables 1, 3, 4: chain M5, M8, M11, M16, M17, M19, M20; M12, M13 uninvolved |
| **Koriyama 2019** (held out) | Togawa 2023 Fig. 5, 9 functions | PC3, PC4, environment, night, 119 calls (3) | Fig. 6: resonated / contained / uninvolved |

Transcriptions: Zheng and Grabbe (CC BY) in `data/`; the rest in the gitignored `docs/paper/FRAM/models/`, whose licences do not allow redistribution.

## 4. RQ2 protocol

- **Exact oracles.**
  - Smith: closed-form Birnbaum importance.
  - Kim: the re-implemented simulation (Sect. 3, Eqs. 1–6). It reproduces Table 7 within about 2 points, though its durations run about 1.25× Table 5's.
- **Expert claims.**
  - Extraction rules (3afa017). A claim is a statement in the paper's own analysis or recommendations that a named change would move a named outcome. It must map to a model edit (remove a deviation, hold a function nominal, add or remove a coupling or function) and to outcome functions. Statements with no stated effect, or with effects outside the model, are excluded.
  - Verdict on the case's RQ1 scenario. *Improve* means at least one outcome function rises and none falls; *avoid* means the outcome returns to nominal; *stays degraded* means it stays below nominal.
  - The list (`data/e3_claims.csv`, 15 claims, 7 exclusions) was frozen at c2249b7.

## 5. Declaration log

| Commit | Declared |
|---|---|
| 96fda35 | v0 translation, E1/E2 |
| f22f61b | damping + resonance (v1), new cases |
| 504048f | Wenzhou held-out test |
| 6fa015a | Kim: formula rules vs structure |
| aebd4b0 | **v2 fixed** |
| afc1bf5 | Koriyama held-out test |
| 5b31c45 | scenario attribution vs topology (superseded by RQ2) |
| 9e5c3e2 | RQ2 exact counterfactuals |
| 3afa017, c2249b7 | RQ2 extraction rules; frozen claim list |
