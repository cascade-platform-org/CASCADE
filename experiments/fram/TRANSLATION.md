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
  - Kim: the re-implemented simulation (Sect. 3, Eqs. 1–6). It reproduces Table 7 within 4 points, systematically lower, and its durations run about 1.25× Table 5's.
- **Expert claims.**
  - Extraction rules (3afa017). A claim is a statement in the paper's own analysis or recommendations that a named change would move a named outcome. It must map to a model edit (remove a deviation, hold a function nominal, add or remove a coupling or function) and to outcome functions. Statements with no stated effect, or with effects outside the model, are excluded.
  - Verdict on the case's RQ1 scenario. *Improve* means at least one outcome function rises and none falls; *avoid* means the outcome returns to nominal; *stays degraded* means it stays below nominal.
  - The list (`data/e3_claims.csv`, 15 claims, 7 exclusions) was frozen at c2249b7.
- **Exploratory, declared after the claims run: protective information as an alternative path** (Wenzhou C10, C11). It tests whether the two claims fail because the method cannot express them or because Fig. 4 does not draw the path they act through. The verdicts in the frozen list stay as they are.
  - The path: a function W *warn dispatch of an M8 failure* takes M8's output as a trigger (it acts when M8 deviates). A function D *dispatch warns the D301 driver* takes W's output (I) and the communication channel, M10's output (R). D delivers the occupancy information to M20's Precondition as an alternative to M8's (`best_of`).
  - The alternative channel: a function ALT, which the lightning does not reach, produces M10's output as an alternative for every consumer.
  - Runs on the RQ1 event (M7, M10 = 1): (a) the path alone, which is C11; (b) ALT alone, which is C10; (c) the path with ALT. Outcome M20, verdict *avoid*. The RQ1 scores of the base case are recomputed with the path drawn and no ALT. W, D and ALT are not scored.

## 4a. Sensitivity: cumulative worsening

Declared before running, in answer to the owner's Gate 2 question (can resonance carry cumulative worsening?). Reported beside v2; v2, the frozen claim list and the verdict rules stay as they are.

- **The term.** With m ≥ 3 distinct inputs at or below level k, the function is at most max(1, k + 2 − m). This continues v2's series: m = 1 gives worst + 1 (damping), m = 2 the second worst (resonance), m = 3 one level below the third worst, m = 4 two below the fourth.
- **Variants.** *v2+3* adds m = 3 only (PLAN §7.2). *v2+c* adds every m; on N = 4 it saturates at m = 4.
- **Encoding.** Specific Rules on one helper node per function with at least three distinct non-trigger inputs. An input counts as ≤ k when every producer of its text is (alternatives). The helper's category enters the function's nested `worst_of` undamped. A helper, because a firing Specific Rule on the function itself replaces its proposal and would undo a lower v2 level.
- **Scope.** Every N = 4 run under v2: RQ1 (Zheng, Tian, Kaya, Wenzhou, Koriyama) and the claims run on v2 (C1, C2, C4–C6, C8–C10, C12, C14). Kim (N = 7, compiled rules) and Smith (N = 2) are unaffected.
- **Recorded before running: the hand reading behind v2+c.** Under v2 Koriyama's T6 has four inputs deviating at level 3 (immediate environment, PC4, night, T5), and T9 has three (119 calls, night, T6). Expected: v2+3 flips C6 (T9) but not C4, since holding T5 leaves three deviations on T6; v2+c flips both. The cost to watch: lower levels travel further, so RQ1 precision may fall, notably on the held-out cases.

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
| c8e8c2b | exploratory: protective information as an alternative path (Wenzhou) |
| d3312fa | sensitivity: cumulative worsening, v2+3 and v2+c |
