# Translation v2 and per-case mappings

The single translation the paper uses (approved at Gate 1, 2026-10-27). Every
experiment was declared in this file and committed **before** it ran; the git
history keeps each declaration verbatim (log at the end). Code: the product's FMV importer, `CASCADE-backend/core/importers/xfmv/map.py` (ADR-0026), which `framkit/translate.py` re-exports; moving it there changed no result.

## 1. Structure

- Function → node. A function with one distinct output text carries the Requisite category of that text, and its consumers wire to it directly. Consumers take `best_of` over producers of the same text (alternatives) and `worst_of` across texts.
- A function with several distinct output texts (or one that feeds an output back to itself) gets an output node per text, carrying that text's category and keeping the function's own category on the function.
  - The output nodes are needed there because the engine passes all of a parent's categories to every child. With one output text the function and its output are the same thing, so the node is omitted (compression of 2026-11-02: every harness CSV byte-identical).
- External resources and conditions that no function produces → background nodes, one per text.
- Scores count function nodes only.

## 2. Semantics

| | |
|---|---|
| **Damping** | every coupling absorbs one level (`dependency_level` N − 1): a single deviating input is absorbed |
| **Resonance** | a function also follows the **second-worst** of its distinct inputs, so level = min(worst + 1, second worst): two coinciding deviations pass. Implemented as one nested intercategorical rule per function over damped copies of its inputs: `worst_of(dmp_a, dmp_b, …, best_of(a, b), …) propagates to F`. Re-encoded with level offsets (ADR-0025) as `worst_of(worst_of(a, b, …) + 1, worst_of(best_of(a, b), …)) propagates to F`, with no copy nodes; every result identical |
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

Transcriptions: Zheng (CC BY) in `data/`, Grabbe's FMV file (CC BY) in `raw-networks/fram/`; the rest in the never-tracked `data/private/` and `raw-networks/fram/private/`, as their licences do not allow redistribution (README, "Where the inputs are").

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
- **Encoding.** Specific Rules on one helper node per function with at least three distinct non-trigger inputs. An input counts as ≤ k when every producer of its text is (alternatives). The helper's category enters the function's nested `worst_of` undamped. A helper, because a firing Specific Rule on the function itself replaces its proposal and would undo a lower v2 level. Re-encoded with level offsets (ADR-0025): the m-th worst input `- (m − 2)` as one more `worst_of` term, with no helper node; every result identical.
- **Scope.** Every N = 4 run under v2: RQ1 (Zheng, Tian, Kaya, Wenzhou, Koriyama) and the claims run on v2 (C1, C2, C4–C6, C8–C10, C12, C14). Kim (N = 7, compiled rules) and Smith (N = 2) are unaffected.
- **Recorded before running: the hand reading behind v2+c.** Under v2 Koriyama's T6 has four inputs deviating at level 3 (immediate environment, PC4, night, T5), and T9 has three (119 calls, night, T6). Expected: v2+3 flips C6 (T9) but not C4, since holding T5 leaves three deviations on T6; v2+c flips both. The cost to watch: lower levels travel further, so RQ1 precision may fall, notably on the held-out cases.

## 4b. Declared 2026-10-29: S0 on the claims, two more verification models, Falegnami's ranking

The FMV files and spreadsheets of Falegnami et al. 2020 and Simone et al. 2025 were shared by A. Tomassi and A. Falegnami for this study only and stay private (`raw-networks/fram/private/`, `data/private/`; never tracked). The scripts skip what is missing.

- **S0 baseline on the frozen claims.** The 11 expressible claims run as model edits under S0 (reachability, the RQ1 baseline), with the same description rules, events and verdict rules as v2. Reported beside v2, grouped by direction. It answers whether v2's agreement comes from damping and resonance or from structure alone. A monotone model can never make an outcome worse by holding a function nominal, so "improve" claims are the easy direction; "stays degraded" (C1) and "avoid" are the hard ones.
- **Verification on two more real models.** Falegnami 2020 (52 functions, 290 couplings) and Simone 2025 (85 functions, 191 couplings) join V1 under the same protocol: the baseline, every single knockout and 200 random pairs. The reader rebuilds couplings from aspect texts, as FMV does when a file stores no drawn couplings; it gives 290 and 191, the counts Table 1 and the authors report. Expected, as on the other models: CASCADE equals the greatest fixed point everywhere, and the FMI except where a loop deadlocks.
- **Falegnami's Katz ranking: reproduction, then topology** (exploratory; Discussion only).
  - (a) *Reproduce* Table 2 from the authors' weighted edge list: a node-aligned five-layer multiplex, intralayer weights from the list, interlayer links of weight 1 between every pair of a node's replicas, and Katz on the supra-adjacency matrix with α = 0.99999/ρ (muxViz's choice as we understand it), counting walks that leave each node, summed over replicas. Spearman ρ with Table 2 and the overlap with its top 15. Robustness grid: α × {0.1, 0.5, 0.99999}/ρ, walks leaving or arriving.
  - (b) *Topology*: the same computation with every coupling at weight 1, which drops the phenotype scores and keeps the structure. If (b) matches Table 2 about as well as (a), the published ranking is carried by the network's shape.
- **Not used.** Falegnami's three alternative instantiations, which are ranked by sums of weight differences with no event or outcome to propagate; Simone's walker results, whose inputs are not held; Simone's spreadsheet, which the authors state is not the 2025 input.

## 4c. Declared 2026-10-29: ablation family, severity grid, claim tiers, reference evaluator, new held-out cases

Answers the Gate 3 pre-mortem: is v2 better than simpler semantics anyone could use, how much of RQ1 rests on our reading of the event, which claims test anything, and does the engine compute the formula the paper prints. v2, the frozen claim list and the verdict rules stay as they are; everything below is reported beside them.

**Held-out status, corrected.** Wenzhou ran (e81e47d) under the v2 candidate before v2 was fixed (aebd4b0), and its result was in the table that approved v2. The paper reports it as "run before v2 was fixed"; Koriyama (afc1bf5, after aebd4b0) is the only held-out case.

**The family.** Every member is a `TranslationConfig` of the importer; the description rules (§2) stay on in every member except FMI.

| Member | Function level | Why it is in the family |
|---|---|---|
| S0 | worst of its inputs; C, T absorb one level | reachability, the existing baseline |
| D1 | worst + 1 | damping only: distance decay, no coincidence |
| K2 | second worst | coincidence only: a single deviation, however severe, is absorbed (a 2-of-n vote) |
| **v2** | min(worst + 1, second worst) | the paper's semantics |
| v2-D2 | min(worst + 2, second worst) | two levels of damping (reported at Gate 1 on Tian only) |
| v2-typed | min over inputs of (level + 0 on I, P, R; + 1 on C, T), and the second worst | aspect-typed damping after the FRW (Patriarca 2024, DC3: P and R gate; DC4: C and T degrade without blocking) |
| v2+3, v2+c | v2 and the cumulative terms of §4a | amplification (Patriarca 2018, Table 1: late, missing and imprecise outputs amplify on every aspect) |
| FMI | N = 2, profiles from the model; only events at level 1 stop a function; no description rules (written on the 4-level scale) | the community's own executable semantics |

**RQ1 under the family.** Zheng, Tian, Wenzhou, Koriyama with the existing truth; Kaya's top-4 reported. Score: balanced accuracy, (recall + specificity) / 2 over the labelled functions (Tian: over its six scenarios). FMI predicts a function degraded when it is at 1.

**Event-severity grid (primary RQ1 result beside the declared coding).** Every event element independently at 1, 2 and 3: Zheng 3⁴ = 81 points, Wenzhou 3² = 9, Koriyama 3⁵ = 243. Tian (its scenarios are the truth) and Kaya (its own distributions) are not gridded. Per member and case: balanced accuracy at the declared coding, mean and minimum over the grid, share of grid points where the member does at least as well as v2.

**Claims re-analysis (frozen list, verdicts unchanged).**
- Every expressible N = 4 claim (C1, C2, C4–C6, C8–C10, C12, C14) under every N = 4 member. C13 (N = 2) is entailed by monotonicity: adding a dependency can only lower a level, so every monotone semantics says "worse".
- Tiers, assigned mechanically: *rule-decided* if v2's verdict changes when the description rules are removed; else *entailed* if every N = 4 member gives v2's verdict; else *discriminating*. Each member's agreements are reported on the discriminating claims.
- Strict verdict beside the frozen one: the share of named outcome functions that move as claimed (improve: rises; stay degraded: stays below N; avoid: reaches N).

**Reference evaluator (verification of v2 itself).** A plain-Python fixed point of the formulas above, written from this file without calling the engine (`framkit/oracles.py`): a function reads `best_of` over the producers of each output text, damps it by N − dependency, takes `worst_of` across texts, or the coincidence and cumulative terms with their offsets; levels only fall, starting from the event. Compared with the engine on every N = 4 member, without description rules: every grid point of the three gridded cases, and 100 random scenarios (1 to 3 functions at random levels 1–3) on each N = 4-translated `.xfmv` model present. Pass: zero differences in any function level.

**Recorded before running: the hand reading.**
- D1 absorbs every level-3 event in one hop, so its recall collapses on Zheng and Koriyama at the declared coding.
- K2 absorbs any single deviation, so on Wenzhou (two level-1 events with mostly single-input chains) its recall falls; on Zheng and Koriyama, where events are all at 3, it is close to v2.
- v2-typed passes I, P, R undamped and so behaves close to S0, with S0's false positives.
- FMI degrades nothing on Zheng and Koriyama (no event at 1) and behaves as reachability on Wenzhou.
- On the grid, v2's exactness on the held-out cases holds near the declared coding and falls where events are read at 1 (more travels) or where single deviations are read at 2.

**New held-out cases: selection criteria, declared before searching.**
1. A published FRAM analysis of a specific event or instantiation, with at least six foreground functions.
2. Couplings recoverable with their aspects, from a table or a legible figure.
3. The authors judge, function by function, which outputs varied or resonated, and name at least two functions as unaffected or contained (precision needs negatives).
4. The triggering deviations are described in the text.
5. Never used to design or tune any translation. Licence noted; CC BY preferred.

The owner approves each case. Then, per case and before any run, a commit holds: the transcription, the event under the §2 convention, the truth, and the case's description rules if the text states any.

**Screening result (2026-10-29): no case qualifies.** Criterion 3 failed everywhere: the Kunshan dust explosion (PLOS ONE 2023, 10.1371/journal.pone.0287328, CC BY: only F1 unaffected); Manchester Arena 2024 (no aspects, no labels); de Carvalho 2011 and Herrera & Woltjer 2010 (no function named unaffected); Bouasla et al. (AJSS: no event); Yu et al. 2023 (Milano Bridge, Appl. Sci., CC BY: network ranking, no labels); Fargnoli et al. 2024 (hyperbaric fire, Appl. Sci., CC BY: Fig. 5 marks every function downstream of the origins); Salihoglu & Bal Beşikçi 2021 (Prestige: hypothetical variants, model in figures only). Owner: stop and report. Only Togawa and Li & Huang, among the event analyses screened, name contained or uninvolved functions; the paper says so.

**Decision rule among v2, v2+3 and v2+c, fixed now.** The paper's main semantics is the candidate with the highest mean balanced accuracy over the new held-out cases at the declared event coding; ties go to the simpler (v2, then v2+3, then v2+c). With fewer than two new cases the contest is reported as inconclusive and v2 stays. Every family member is reported on the new cases, with their grid.

## 4d. Declared 2026-10-29: the Zheng decision model (paper §5)

Compares the analysts' own recommendations under resources and time, on the converted model RQ1 checked. Replaces the demonstration (`demo_zheng.py`): its telecom and fire-water canvases and its quantities were ours, and Zheng's Table 1 gives F20 no water aspect.

**Imported from Zheng 2024 (and its source plan, Baser & Behnam 2020).**
- The converted FRAM under v2 with the F20 rule (§2): F20 is severe when F12 and F17 both deviate.
- The event: Radio/Telephone and Internet/Telephone damaged (level 3), F5's one-way communication (level 3), firefighters limited because some are sent to other earthquake-affected areas (§4.2.1).
- Firefighters are F17's Resource (Table 1); F20 receives them only through F17's output.
- The deadline: Tank 63 and its neighbours fail 2,000–7,000 s after exposure (Fig. 6, after Cozzani 2006).
- The options, from §4.2.1–4.2.2: **O0** the plan; **O1** two-way updates (F5 not deviating); **O2** the first-round remedy (Fig. 9): O1 plus a function locating and mobilising other organisations' firefighters (F23: Input F2's guidelines, Resource Radio/Telephone); **O3** the second round: F5 cancelled (F7 takes F4's output, as C9) plus F23.

**The added layer.** Firefighters as a SourceToDemands flow, in units of F17's need (100): the brigade supplies 100; the other affected areas draw 100·d and are served first (priority); F17 demands 100, its served level entering its rule undamped (a shortfall is a shortfall). The event's level-3 on F17's background resource is replaced by this flow. Under O2 and O3 a mutual-aid source supplies 100·d from the arrival time a on, through a Requisite coupling from F23 (no mobilisation, no mutual aid). Nothing else is added.

**Assumed and swept.** d ∈ {0, 0.1, …, 0.7} (share of the brigade drawn away); a ∈ {10, 20, …, 120} min; telecom severity s ∈ {3 (declared), 2}. Telecom is not repaired within the window. Time: 5-minute periods from 0 to 120 min.

**Outputs.**
- Per (option, d, a, s): t_F20, the first period from which F20 is nominal to the end of the window (or never). Deadline met for the whole band if t_F20 ≤ 33 min, for part of it if ≤ 117 min, not met otherwise.
- At one reference point (d = 0.4, a = 30, s = 3): Operativity of the FRAM functions over time per option; Shapley attribution of the Operativity loss at t = 0 to the three damages (telecom, F5 one-way, firefighters drawn away).
- The four options as projects with their Temporal Simulation, opening in the app (`CASCADE-app/samples/public/fram/`, Zheng is CC BY).

**Recorded before running: the hand reading.**
- O0: whenever more than a quarter of the brigade is drawn away (d ≥ 0.25: served ratio ≤ 0.75, F17 below nominal), F12 and F17 deviate together and the rule holds F20 severe: never met. With d < 0.25 F20 is nominal at once.
- O1: F12 is nominal (as C8), so the rule never fires; F17's shortfall alone is damped. F20 nominal at once for d < 0.5, held at 3 for d ≥ 0.5: two-way updates suffice up to about half the brigade drawn away.
- O2, O3: as O1 until the mutual aid arrives, nominal from a for every d. The deadline is met for d ≥ 0.5 only when a ≤ 117 min, and for the whole band when a ≤ 33 min.
- s = 2: telecom severe reaches F12 even under O1 and degrades F23; two-way updates stop sufficing once d ≥ 0.25, and mutual aid may arrive reduced.
- These thresholds follow from v2's one-level damping and the linear served-ratio levels (ceil(ratio · 4)); the paper says so.

## 4e. Declared 2026-11-02: scale sensitivity of the decision model

**Question.** Which of §4d's answers belong to Zheng's case and which to the 4-level scale? The thresholds d = 0.25 and 0.5 are steps of ceil(ratio · 4); a reviewer can derive them on paper.

**What changes.** The decision model of §4d is rebuilt at N = 7 with v2 rescaled, everything else unchanged:
- damping absorbs 2 levels (`dependency_level` N − 2), the same third of the range one level absorbs at N = 4;
- every imposed level maps as L7 = 2·L4 − 1: telecom s = 3 → 5, s = 2 → 3; F5 one-way 3 → 5; the F20 rule reads "F12 and F17 below 7 → F20 at 3" (severe);
- the crews flow, its priorities and the sweeps are those of §4d; Operativity is normalised, (L − 1)/(N − 1).

With these choices the logical part is the N = 4 model on the odd levels {1, 3, 5, 7}: min(worst + 2, second worst) maps them onto each other exactly. Only the served ratio of the crews flow gains the even levels, so the test isolates the resolution of the one quantity the decision turns on. (Kim, the one N = 7 case of RQ1, used one level of damping; that semantics is a different rule and is not tested here.)

**Recorded before running: the hand reading** (L17 = ceil(7·(1 − d)) = 7, 7, 6, 5, 5, 4, 3, 3 for d = 0 … 0.7; at N = 4: 4, 4, 4, 3, 3, 2, 2, 2).
- O0, s = 3: F20 severe from d = 0.2 (N = 4: from 0.3), as soon as F17 is below 7. The plan's threshold moves from 1/4 to 1/7.
- O1, s = 3: F20 = min(L17 + 2, 7): nominal for d ≤ 0.4, 6 at d = 0.5, 5 at 0.6 and 0.7. On the grid two-way updates suffice up to d = 0.4 at both scales (exact threshold 1/2 at N = 4, 3/7 at N = 7). Beyond, F20 is never severe and is graded (6, 5, 5 against 3, 3, 3 at N = 4).
- O2, O3, s = 3: as O1 until a; F23 is nominal (Radio at 5, absorbed), so the mutual aid supplies 100·d in full and F20 is nominal from a for every d. The deadline verdicts equal §4d's.
- O1, s = 2: F12 deviates, so the rule fires from d = 0.2 (N = 4: 0.3).
- O2, O3, s = 2: F23 at 5, the mutual aid carries (5 − 0.5)/7 of its supply, F17 is served 1 − 0.357·d. F20 is nominal from a for d ≤ 0.3, and not for d ≥ 0.5; d = 0.4 serves exactly 6/7, so its outcome is the flow's rounding. At N = 4 the mutual aid sufficed up to d = 0.6. **The claim "mutual aid restores F20 under severe telecom damage up to 60 % drawn away" belongs to the scale.**
- Reference point (d = 0.4, a = 30, s = 3): every level maps exactly (L17 = 5 ↔ 3), so the timeline and the Shapley shares equal §4d's.
- The order of the options cannot change at any N: each option removes a deviation or adds supply, and the engine is monotone. It is entailed, and the paper says so.

**Outputs.** `results/decision_scale.csv`: per (N, option, s, d) the F20 level before and after the mutual aid; the timeline and Shapley at the reference point at N = 7.

## 4f. Declared 2026-11-02: the Koriyama decision model (paper §5, second case)

The same procedure as §4d on Togawa et al. 2023 (CC BY-NC-ND: the transcription stays in `data/private/`; numbers and script are tracked).

**What the source gives, and what it does not.** Two recommendations, both qualitative (§4.5): **R1** review public communication (better and earlier information, so the levels 3 and 4 alerts do not misfire); **R2** a framework that minimises variability in evacuation behaviour (neighbours urging neighbours). No capacities, no call counts, no deadline: the quantity-and-time steps of the procedure (steps 1 and 2) have nothing to import here, and the case tests the remaining steps (3 to 5) on structure alone. The paper says so.

**Imported.** The converted FRAM under v2 and the event of RQ1 (§3): Public Communication levels 3 and 4 (T1, T2), the immediate environment, the night restriction and the 119-call load, each at 3.

**Options** (edits, as in the claims C4–C6): **K0** the event as it happened; **K1** R1 (T1 and T2 do not deviate); **K2** R2 (T6 holds nominal: the framework absorbs what reaches it, the source's own words, §4.5.2); **K3** R1 + R2.

**The assumption the FRAM leaves implicit, made explicit and swept.** The FRAM treats the 119-call load as an external function, unrelated to evacuation, while the case narrative says the backlog came from residents who did not evacuate. Two readings are run: **A** (calls exogenous, as drawn): the call load stays at level 3 in every option; **B** (calls follow evacuation): the call load sits at the level T6 reaches in the option (two passes: T6 does not depend on the calls). The paper reports which answers hold under both.

**Sweeps.** Severity: each event element independently at 1, 2, 3 (A: 3⁵ = 243 points; B: the call load is tied to T6, 3⁴ = 81); the scale: N = 4 and N = 7 (v2 rescaled as in §4e: damping absorbs 2 levels, imposed level L → 2L − 1).

**Outputs** (`decide_koriyama.py`; `results/koriyama_options.csv`, `koriyama_grid.csv`, `koriyama_shapley.csv`).
- Per (N, reading, option): the level of every function and Operativity (function levels, normalised (L − 1)/(N − 1)).
- Per (N, reading, option): over the grid, the share of points where Rescue (T9) is nominal, and mean Operativity; plus whether the order K0 ≤ K1, K2 ≤ K3 holds at every point.
- Shapley attribution of the Operativity loss of K0 (declared coding) to the five event elements.

**Recorded before running: the hand reading** (N = 4, declared coding).
- A: no option restores Rescue (T9 stays at 3 because night and the 119 calls, both at 3, coincide). K1: T5 = 4, T6 = 3 (environment and night coincide at T6), T9 = 3. K2: T6 = 4, T5 = 3, T9 = 3. K3: T5 = 4, T6 = 4, T9 = 3.
- B: calls sit at T6's level. K0, K1: T9 = 3. K2, K3: calls nominal, only night deviates at T9 and is absorbed: T9 = 4. So **under B, R2 restores Rescue and R1 alone does not**.
- Operativity order at the declared coding: K0 < K2 < K1 < K3 under A (K1 repairs T1, T2, T5; K2 repairs T6 alone); under B, K2 gains T9 and passes K1 or ties it (not predicted).
- N = 7: the same pattern (the logical part maps exactly onto the odd levels).
- Over the grids the order K0 ≤ K1, K2 ≤ K3 holds at every point: each option only removes a deviation and the engine is monotone. This is entailed, and the paper says so.
- The Shapley ranking is not predicted.
- What would count against the reading: under B, K1 restoring T9; under A, any option restoring it.

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
| (re-encoding, no new test) | v2 and the sensitivity written with level offsets (ADR-0025); all results byte-identical |
| 7f5c33a | S0 on the claims; Falegnami and Simone in V1; Falegnami's Katz ranking (§4b) |
| 44fc0bc | ablation family, severity grid, claim tiers, reference evaluator, new held-out protocol and decision rule (§4c) |
| 882d4a1 | the Zheng decision model: options, added layer, sweeps, outputs (§4d) |
| e084d58 | scale sensitivity of the decision model, N = 7 with v2 rescaled (§4e) |
| (this commit) | the Koriyama decision model: options, call-load assumption, severity grid, scale (§4f) |
