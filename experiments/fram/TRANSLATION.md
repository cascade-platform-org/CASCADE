# Translation v2 and per-case mappings

> Notation (2026-11-03): the interventions are labelled I0–I3 in both cases, following the paper; they were O0–O3 (Zheng) and K0–K3 (Koriyama) when declared. The rule variant K2 keeps its name. The git history keeps each declaration verbatim.

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

**Second screening (2026-11-03), same criteria, systematic frame.** Frame: the retrospective analyses listed in Patriarca et al. 2020 §4.1 (to 2019); an OpenAlex query, title and abstract `"functional resonance" AND (accident OR incident OR collision OR explosion OR crash OR grounding OR disaster OR blowout OR derailment)`, from 2019 (206 records); and the works citing Zheng, Tian, Li & Huang and Togawa (273 records in all). Title screen: 31 analyses of a specific event from 2019 on. Full text read (open access): 14. Pass criterion 3, pending the owner and a transcription check of criterion 2:
- Koo, Seo & Kim 2021, chemical plant explosion during commissioning (Fire Sci. Eng. 35(5), 10.7731/KIFSE.613c0e37, CC BY-NC): 18 functions; Table 1 gives each function's variability and resonance effect; F7, F16 and F18 "variability is low", no effect (F16 downstream of the varying risk assessment). Couplings only in Fig. 5 (FMV drawing, crossing curves): criterion 2 borderline.
- Adhita & Furusho 2021, ship-to-ship collision (J. ETA Marit. Sci. 9(2), 10.4274/jems.2021.43660, CC BY-NC): couplings with aspects in Tables 2-3; two encounters on one structure. Encounter 1: MAN_A slightly imprecise, BCM, WAT and BBC "on time and acceptable" (damping named). Encounter 2: Table 5 rates the affected functions.
- Nayak, Manning & Waterson 2021, fipronil in eggs (Food Control 108605, 10.1016/j.foodcont.2021.108605; accepted manuscript in repositories): about 40 functions; Fig. 3 marks the non-compliant functions red (4.1-4.5, 4.8-4.10), the rest performed, several downstream of red ones (3.13-3.16 after 4.8; 2.5 after 4.4); aspects in Appendix 2. Open: which red functions are origins and which propagated.

Fail: Wang & Huang 2026, Air Canada 143 (ranking only); Turkish maritime 2020 (5 functions, potential variability); Turkish post-earthquake 2021 and the ESREL 2025 SAR drones (prospective); Japanese fall 2021 (3 functions); França et al. 2026 berthing, França et al. 2022 Copiapó/FPSO, França & Hollnagel 2023 AF447/Concordia (narrative); Korean Challenger 2026 (model in a figure only, no judgement); Pereira et al. 2015 Deepwater Horizon (no stable function named); TM-FRAM 2025 (a database of many collisions). Not read: 16 behind paywalls and 3 open ones without a fetchable text (list in the session report); the pre-2019 review items without a card.

Paywalled batch, read 2026-11-03 from the owner's Zotero (12 of the 16). Borderline: Wicaksana et al. 2025, Dover Strait near miss (10.1007/s13437-025-00388-3): Table 3 rates each Grand Neptune function's timing and precision at each time step, so on-time and precise functions are named; but the analysis is iterative over time and covers one ship, and the couplings are only in Fig. 6. Fail: Slater 2023 and Pereira 2015 Deepwater Horizon, França & Hollnagel 2025 Texas City, França et al. 2023 Imperial Sugar (critical functions only, no stable function named); *Stolt Groenland* 2026 (all ten functions varied); Yu et al. 2021 *Clipper Adventurer* (counterfactual narrative); Qiao et al. 2022 (Bayesian scoring of a response, no judgement of the event); Yu et al. 2024 (many groundings); Hosseinnia et al. 2019 (illustrative maintenance case); Burmana et al. 2024 (no FRAM). Not read: the cathode-leakage paper (abstract only), Rutkowska et al. 2020 (no file), and three not added (chemical tanker fire 2026, SWA 1380, Exxon Valdez/Ever Given).

**Decision rule among v2, v2+3 and v2+c, fixed now.** The paper's main semantics is the candidate with the highest mean balanced accuracy over the new held-out cases at the declared event coding; ties go to the simpler (v2, then v2+3, then v2+c). With fewer than two new cases the contest is reported as inconclusive and v2 stays. Every family member is reported on the new cases, with their grid.

## 4d. Declared 2026-10-29: the Zheng decision model (paper §5)

Compares the analysts' own recommendations under resources and time, on the converted model RQ1 checked. Replaces the demonstration (`demo_zheng.py`): its telecom and fire-water canvases and its quantities were ours, and Zheng's Table 1 gives F20 no water aspect.

**Imported from Zheng 2024 (and its source plan, Baser & Behnam 2020).**
- The converted FRAM under v2 with the F20 rule (§2): F20 is severe when F12 and F17 both deviate.
- The event: Radio/Telephone and Internet/Telephone damaged (level 3), F5's one-way communication (level 3), firefighters limited because some are sent to other earthquake-affected areas (§4.2.1).
- Firefighters are F17's Resource (Table 1); F20 receives them only through F17's output.
- The deadline: Tank 63 and its neighbours fail 2,000–7,000 s after exposure (Fig. 6, after Cozzani 2006). (Note 2026-11-02, reading the source: Tank 63 itself at 2,000–2,500 s, Baser & Behnam 2020 Table 8; the band is the ring's. No result changes.)
- The options, from §4.2.1–4.2.2: **I0** the plan; **I1** two-way updates (F5 not deviating); **I2** the first-round remedy (Fig. 9): I1 plus a function locating and mobilising other organisations' firefighters (F23: Input F2's guidelines, Resource Radio/Telephone); **I3** the second round: F5 cancelled (F7 takes F4's output, as C9) plus F23.

**The added layer.** Firefighters as a SourceToDemands flow, in units of F17's need (100): the brigade supplies 100; the other affected areas draw 100·d and are served first (priority); F17 demands 100, its served level entering its rule undamped (a shortfall is a shortfall). The event's level-3 on F17's background resource is replaced by this flow. Under I2 and I3 a mutual-aid source supplies 100·d from the arrival time a on, through a Requisite coupling from F23 (no mobilisation, no mutual aid). Nothing else is added.

**Assumed and swept.** d ∈ {0, 0.1, …, 0.7} (share of the brigade drawn away); a ∈ {10, 20, …, 120} min; telecom severity s ∈ {3 (declared), 2}. Telecom is not repaired within the window. Time: 5-minute periods from 0 to 120 min.

**Outputs.**
- Per (option, d, a, s): t_F20, the first period from which F20 is nominal to the end of the window (or never). Deadline met for the whole band if t_F20 ≤ 33 min, for part of it if ≤ 117 min, not met otherwise.
- At one reference point (d = 0.4, a = 30, s = 3): Operativity of the FRAM functions over time per option; Shapley attribution of the Operativity loss at t = 0 to the three damages (telecom, F5 one-way, firefighters drawn away).
- The four options as projects with their Temporal Simulation, opening in the app (`CASCADE-app/samples/public/fram/`, Zheng is CC BY).

**Recorded before running: the hand reading.**
- I0: whenever more than a quarter of the brigade is drawn away (d ≥ 0.25: served ratio ≤ 0.75, F17 below nominal), F12 and F17 deviate together and the rule holds F20 severe: never met. With d < 0.25 F20 is nominal at once.
- I1: F12 is nominal (as C8), so the rule never fires; F17's shortfall alone is damped. F20 nominal at once for d < 0.5, held at 3 for d ≥ 0.5: two-way updates suffice up to about half the brigade drawn away.
- I2, I3: as I1 until the mutual aid arrives, nominal from a for every d. The deadline is met for d ≥ 0.5 only when a ≤ 117 min, and for the whole band when a ≤ 33 min.
- s = 2: telecom severe reaches F12 even under I1 and degrades F23; two-way updates stop sufficing once d ≥ 0.25, and mutual aid may arrive reduced.
- These thresholds follow from v2's one-level damping and the linear served-ratio levels (ceil(ratio · 4)); the paper says so.

## 4e. Declared 2026-11-02: scale sensitivity of the decision model

**Question.** Which of §4d's answers belong to Zheng's case and which to the 4-level scale? The thresholds d = 0.25 and 0.5 are steps of ceil(ratio · 4); a reviewer can derive them on paper.

**What changes.** The decision model of §4d is rebuilt at N = 7 with v2 rescaled, everything else unchanged:
- damping absorbs 2 levels (`dependency_level` N − 2), the same third of the range one level absorbs at N = 4;
- every imposed level maps as L7 = 2·L4 − 1: telecom s = 3 → 5, s = 2 → 3; F5 one-way 3 → 5; the F20 rule reads "F12 and F17 below 7 → F20 at 3" (severe);
- the crews flow, its priorities and the sweeps are those of §4d; Operativity is normalised, (L − 1)/(N − 1).

With these choices the logical part is the N = 4 model on the odd levels {1, 3, 5, 7}: min(worst + 2, second worst) maps them onto each other exactly. Only the served ratio of the crews flow gains the even levels, so the test isolates the resolution of the one quantity the decision turns on. (Kim, the one N = 7 case of RQ1, used one level of damping; that semantics is a different rule and is not tested here.)

**Recorded before running: the hand reading** (L17 = ceil(7·(1 − d)) = 7, 7, 6, 5, 5, 4, 3, 3 for d = 0 … 0.7; at N = 4: 4, 4, 4, 3, 3, 2, 2, 2).
- I0, s = 3: F20 severe from d = 0.2 (N = 4: from 0.3), as soon as F17 is below 7. The plan's threshold moves from 1/4 to 1/7.
- I1, s = 3: F20 = min(L17 + 2, 7): nominal for d ≤ 0.4, 6 at d = 0.5, 5 at 0.6 and 0.7. On the grid two-way updates suffice up to d = 0.4 at both scales (exact threshold 1/2 at N = 4, 3/7 at N = 7). Beyond, F20 is never severe and is graded (6, 5, 5 against 3, 3, 3 at N = 4).
- I2, I3, s = 3: as I1 until a; F23 is nominal (Radio at 5, absorbed), so the mutual aid supplies 100·d in full and F20 is nominal from a for every d. The deadline verdicts equal §4d's.
- I1, s = 2: F12 deviates, so the rule fires from d = 0.2 (N = 4: 0.3).
- I2, I3, s = 2: F23 at 5, the mutual aid carries (5 − 0.5)/7 of its supply, F17 is served 1 − 0.357·d. F20 is nominal from a for d ≤ 0.3, and not for d ≥ 0.5; d = 0.4 serves exactly 6/7, so its outcome is the flow's rounding. At N = 4 the mutual aid sufficed up to d = 0.6. **The claim "mutual aid restores F20 under severe telecom damage up to 60 % drawn away" belongs to the scale.**
- Reference point (d = 0.4, a = 30, s = 3): every level maps exactly (L17 = 5 ↔ 3), so the timeline and the Shapley shares equal §4d's.
- The order of the options cannot change at any N: each option removes a deviation or adds supply, and the engine is monotone. It is entailed, and the paper says so.

**Outputs.** `results/decision_scale.csv`: per (N, option, s, d) the F20 level before and after the mutual aid; the timeline and Shapley at the reference point at N = 7.

## 4f. Declared 2026-11-02: the Koriyama decision model (paper §5, second case)

The same procedure as §4d on Togawa et al. 2023 (CC BY-NC-ND: the transcription stays in `data/private/`; numbers and script are tracked).

**What the source gives, and what it does not.** Two recommendations, both qualitative (§4.5): **R1** review public communication (better and earlier information, so the levels 3 and 4 alerts do not misfire); **R2** a framework that minimises variability in evacuation behaviour (neighbours urging neighbours). No capacities, no call counts, no deadline: the quantity-and-time steps of the procedure (steps 1 and 2) have nothing to import here, and the case tests the remaining steps (3 to 5) on structure alone. The paper says so.

**Imported.** The converted FRAM under v2 and the event of RQ1 (§3): Public Communication levels 3 and 4 (T1, T2), the immediate environment, the night restriction and the 119-call load, each at 3.

**Options** (edits, as in the claims C4–C6): **I0** the event as it happened; **I1** R1 (T1 and T2 do not deviate); **I2** R2 (T6 holds nominal: the framework absorbs what reaches it, the source's own words, §4.5.2); **I3** R1 + R2.

**The assumption the FRAM leaves implicit, made explicit and swept.** The FRAM treats the 119-call load as an external function, unrelated to evacuation, while the case narrative says the backlog came from residents who did not evacuate. Two readings are run: **A** (calls exogenous, as drawn): the call load stays at level 3 in every option; **B** (calls follow evacuation): the call load sits at the level T6 reaches in the option (two passes: T6 does not depend on the calls). The paper reports which answers hold under both.

**Sweeps.** Severity: each event element independently at 1, 2, 3 (A: 3⁵ = 243 points; B: the call load is tied to T6, 3⁴ = 81); the scale: N = 4 and N = 7 (v2 rescaled as in §4e: damping absorbs 2 levels, imposed level L → 2L − 1).

**Outputs** (`decide_koriyama.py`; `results/koriyama_interventions.csv`, `koriyama_grid.csv`, `koriyama_shapley.csv`).
- Per (N, reading, option): the level of every function and Operativity (function levels, normalised (L − 1)/(N − 1)).
- Per (N, reading, option): over the grid, the share of points where Rescue (T9) is nominal, and mean Operativity; plus whether the order I0 ≤ I1, I2 ≤ I3 holds at every point.
- Shapley attribution of the Operativity loss of I0 (declared coding) to the five event elements.

**Recorded before running: the hand reading** (N = 4, declared coding).
- A: no option restores Rescue (T9 stays at 3 because night and the 119 calls, both at 3, coincide). I1: T5 = 4, T6 = 3 (environment and night coincide at T6), T9 = 3. I2: T6 = 4, T5 = 3, T9 = 3. I3: T5 = 4, T6 = 4, T9 = 3.
- B: calls sit at T6's level. I0, I1: T9 = 3. I2, I3: calls nominal, only night deviates at T9 and is absorbed: T9 = 4. So **under B, R2 restores Rescue and R1 alone does not**.
- Operativity order at the declared coding: I0 < I2 < I1 < I3 under A (I1 repairs T1, T2, T5; I2 repairs T6 alone); under B, I2 gains T9 and passes I1 or ties it (not predicted).
- N = 7: the same pattern (the logical part maps exactly onto the odd levels).
- Over the grids the order I0 ≤ I1, I2 ≤ I3 holds at every point: each option only removes a deviation and the engine is monotone. This is entailed, and the paper says so.
- The Shapley ranking is not predicted.
- What would count against the reading: under B, I1 restoring T9; under A, any option restoring it.

**Re-encoding, declared 2026-11-02 before running.** Reading B becomes a model edit in place of the harness's two passes: an edge from Evacuation Behaviour (T6) to the 119-call node, at full dependency (no damping, no rule), so the call load follows T6 within one propagation. It is the explicit form of the assumption the paper names. Expected: every `koriyama_*.csv` byte-identical.

## 4g. Declared 2026-11-03: two new held-out cases (Adhita & Furusho 2021, Nayak et al. 2022)

From the second screening (§4c). The owner approved the three passing candidates; Koo et al. 2021 is dropped on reading (owner's decision, 2026-11-03, after discussing the other reading of Table 1): its third column labels each function by its contribution to the cause, which measures a different thing from reach. The three "–" functions do not serve as negatives: the explosion occurred during the test run, F16; F18 (prototype production) comes after it and never took place; F7 repeats F6's name and cannot be placed in Fig. 5. The table also assigns one cause to several functions (F6 and F8; F9 and F13) and names no initiating deviation, so the events would be ours to choose. Neither new case was used to design or tune any rule; neither states a causal rule, so both run without Specific Rules (§2 table: none).

**Models** (`data/private/`, licences in each header; neither is redistributed).
- `adhita_2021_meeting1.csv`, `adhita_2021_meeting2.csv`: Tables 2 and 3, one file per encounter, 10 functions each, 22 and 17 couplings; checked against Figs. 3 and 4. Table 3 is transcribed as printed (it lists no BBC_A → BCM_A and no MAN_A → WAT_A; it prints WAT_B → MAN_B as R where the text says C).
- `nayak_2022_fipronil.csv`: Appendix 3 of the accepted manuscript (the work-as-done model, Fig. 3), 44 functions, 124 aspect rows, couplings by matching labels. Five received labels have no producer and become background functions: "Understanding of Regulation (EC) 2160/2003 …" (Control of 3.1, 3.14, 3.16), "Disapproved disinfectants", "Paperwork is available and completed", "Cleaning chemicals disapproved" (the Inputs of 3.7, 3.8, 4.5: the figure's red circles), "Cleaning chemicals discarded" (4.7's).

**Events** (§2 convention: damaged, delayed, imprecise or variable is one level; not delivered is level 1).
- Adhita, encounter 1: MAN_A = 3 ("slightly imprecise").
- Adhita, encounter 2: MAN_A = 3 (where "the presumed unintended action first occurred"), BCM_B = 3 (Pilot B and the crew "did not maintain their teamwork", before WAT_B and ECN_B followed). The text says MAN_A "was followed by" BCM_A and WAT_A, so WAT_A is an effect in the declared coding. **Reading B, reported beside it:** the same text calls the three "coincidentally" resonant and Table 3 prints WAT_A's output as "shallow water undetected", so WAT_A = 3 as a third event (then WAT_A is unlabelled).
- Nayak: X:Understanding of Regulation = 3 (the auditors' and stakeholders' "inadequate understanding"; the figure circles that Control on 3.1, 3.14, 3.16); X:Disapproved disinfectants, X:Paperwork is available and completed, X:Cleaning chemicals disapproved = 1 (the "functions without an input activity": not delivered); N4.8 = 3 (multiple auditors arrive "due to poor communication", leading to confusion).

**Ground truth.**
- Adhita, scored over the two encounters as one case, in the way Tian is scored over its scenarios. Affected (encounter 2, text and Table 5): BCM_A, WAT_A, WAT_B, ECN_B, MAN_B. Unaffected (encounter 1): BCM_A, BCM_C ("emerged on time and were acceptable"), WAT_A, BBC_A ("dampened the amplifying effect"). Recall over the five, specificity over the four.
- Nayak, Fig. 3 and §4. Affected (red, non-compliance): N4.1, N4.2, N4.3, N4.4, N4.5, N4.9, N4.10. Unaffected (hexagons drawn performed, no circled aspect): N1.3, N1.7, N1.8, N1.9, N1.11, N2.1–N2.5, N3.2–N3.6, N3.10, N3.13, N3.15 (18). Unlabelled: N4.8 (an event); N3.1, N3.7, N3.8, N3.14, N3.16 (circled aspect, drawn performed: the text calls them points of failure); the background boxes.

**Runs.** As §4c: every family member (S0, D1, K2, v2, v2-D2, v2-typed, v2+3, v2+c, FMI) at the declared coding and over all codings (each event element at 1, 2 and 3: Adhita 3 × 3² = 27 with encounter 1's element, Nayak 3⁵ = 243). FMI on N = 2 as in §4c. The §4c decision rule among v2, v2+3 and v2+c applies with these two cases. Also reported: each case at the declared coding with the existing four, the family's mean over all six cases.

**Hand reading, recorded before running (v2, Adhita).** Encounter 1: every function receiving MAN_A has another input at nominal, so nothing below nominal: specificity 1. Encounter 2: MAN_A's only consumer is BCM_A, whose other input WAT_A depends on BCM_A, and BCM_B's consumers WAT_B and ECN_B each receive it alone; so v2 marks none of the five: recall 0, balanced accuracy 0.50. Reachability expected at recall 1 and specificity 0. Under reading B, BCM_A has two deviating inputs and passes.

## 4h. Declared 2026-11-12: the decision models under the alternative rules

**Question.** RQ1 scores the automatic conversion without Specific Rules; the comparisons of §4d and §4f add a Specific Rule, a flow and a model edit. Does the conversion rule matter to what the comparisons conclude? If the three alternative rules of the paper's Fig. 2 gave the same comparison, the two halves of the paper would be independent.

**What changes.** The models of §4d (Zheng) and §4f (Koriyama) are rebuilt with the conversion rule swapped for S0 (reachability), D1 (damping only) and K2 (coincidence only), as defined in §4c. Everything else is unchanged: Zheng's F20 Specific Rule, the crews flow (F17 takes its served level undamped under every rule), the mutual aid, Koriyama's barrier at T6 and the edge of reading B. N = 4. Zheng: every intervention at d = 0 … 0.7, s = 3 and 2, a = 30 min; F20 at minute 0 and at minute 120. Koriyama: every intervention under readings A and B at the declared coding; T9.

**Recorded before running: the hand reading.**
- Zheng, S0. The telecom damage alone reaches F12, F17 and F20 through undamped couplings, so the F20 rule fires in every cell: F20 is severe under every intervention, at every d, before and after the mutual aid. No intervention is distinguishable from the plan. (Less sure: a cell where the damage reaches F12 or F17 only through Control or Time couplings, which S0 damps; then F20 is 3.)
- Zheng, D1. A single deviation is absorbed and coincident ones are too, so F5's one-way updates and the telecom damage never reach F12, and the rule never fires. F20 = min(F17 + 1, 4) under every intervention: nominal for d ≤ 0.4, 3 from d = 0.5, restored by the mutual aid under I2 and I3. **The plan equals two-way updates: I1 has no effect.**
- Zheng, K2. F12 deviates under the plan as under Eq. (1) (F5 and telecom coincide), so I0 is severe from d = 0.3. Under I1 the shortfall of F17 reaches F20 alone and K2 ignores a lone input: F20 nominal at every d. **Two-way updates always suffice and the mutual aid is never needed.** s = 2: not predicted.
- Koriyama, S0. Night at 3 reaches T9 undamped: T9 below nominal under every intervention and both readings.
- Koriyama, D1. Every deviation is absorbed within one coupling: T9 nominal under every intervention, I0 included, in both readings; there is nothing to restore.
- Koriyama, K2. As Eq. (1): T9 at 3 under A in every intervention; nominal under B for I2 and I3 only.
- If the reading holds, each alternative rule changes what the comparison recommends on Zheng, and two of three on Koriyama. What would count against the link: an alternative rule reproducing Eq. (1)'s Zheng map.

**Outputs.** `decide_rules.py`; `results/decision_rules_zheng.csv`, `decision_rules_koriyama.csv`.

## 4i. Declared 2026-11-12: a second, independent coding of the analysed scenarios

**Question.** The coding of each analysed scenario is the first author's reading of the analysts' words, and it is the largest sensitivity of RQ1 (§4c, §4g). How far does a second reader agree, and do the scores hold under the second coding?

**Protocol.** A second coder who has not seen the declared coding (S. Grimaz) receives, per case, the list of the scenario's elements, where the source describes each, and the convention of §2: delayed, imprecise, degraded or variable is level 3; not performed or not delivered is level 1; an element the coder judges an effect of another, and not a starting deviation, is marked "effect". The sheet is `docs/paper/FRAM/SECOND_CODING.md` (private: it quotes the sources). Tian is excluded: its scenarios are the source's own model-checking inputs. The sheet lists 18 elements: Zheng 4, Li 2, Togawa 5, Adhita 2 (and WAT_A, the declared coding's "effect"), Nayak 5.

**Reported, whatever the outcome.** The share of elements coded identically and Cohen's kappa over the three answers (3, 1, effect); the balanced accuracy of every rule of the paper's Fig. 2 on each case under the second coding, beside the declared one. The declared coding stays the paper's main result. No hand reading: the outcome depends on the coder.

## 4j. Declared 2026-11-19: the Koriyama decision model with rescue capacity and the night (paper §5.2)

§4f ran Koriyama on structure alone, so its comparison never involved a resource or a time limit, the terms of RQ2. The source describes both in words: the 119 line received more calls than Rescue Operations could serve, from residents who had not evacuated (21 % did not), and the levees were overtopped at night (river thresholds passed 20:00–22:00; level 3 alert at 13:00, evacuation order at 16:50). This section adds them as a flow and a timeline, with every quantity the source leaves open swept, as §4d does for Zheng.

**Imported.** Everything in §4f: the converted FRAM under v2, the event elements at 3, the options I0–I3, assumptions A and B. From the source: the timeline above; the call backlog came from residents who stayed; 21 % did not evacuate.

**The added layer.**
- *Rescue capacity as a flow.* A source "Rescue capacity" supplies κ·100 of a SourceToDemands category `rescue`; the 119-call node demands the call load ℓ·100 and takes the Functionality of its served ratio (ceil(ratio · N), as F17 in §4d). The call node's imposed level 3 is replaced by this flow; it feeds T9 through its existing coupling, so Eq. (1) at T9 is unchanged.
- *The call load.* Unit: the load of the event as it happened (ℓ = 1). Assumption A: ℓ = 1 under every option. Assumption B: ℓ = 1 while T6 is below nominal, ℓ = r while T6 is nominal, where r is the share of the original backlog that remains when evacuation behaviour holds (two passes per period: T6 does not depend on the calls).
- *Time.* Hourly periods from 13:00 to 10:00 the next morning (21 periods). The night restriction is imposed from dusk (17:00) to dawn (06:00); the call demand from overtopping (22:00) to the end; the other event elements over the whole window.

**Swept.** κ ∈ {0.1, 0.2, …, 1.2}; r ∈ {0, 0.25, 0.5, 0.75, 1}; N = 4 and N = 7 (v2 rescaled as §4e). The severity grid of §4f is not repeated here: the event elements stay at the declared coding.

**Outputs** (`decide_koriyama.py`; `results/koriyama_capacity.csv`).
- Per (N, assumption, option, κ, r): T9's level in every period; the number of night periods (22:00–06:00) with T9 nominal; the first period after 22:00 from which T9 is nominal to the end.
- Whether the order I0 ≤ I1, I2 ≤ I3 holds at every point (checked; the flow makes it no longer entailed).

**Recorded before running: the hand reading** (N = 4). Let c = ceil(4 · min(1, κ/ℓ)) be the call node's level once the demand starts. T9's degraded inputs can be the night, the calls and Evacuation Behaviour (T6, a Precondition of T9); T3 stays nominal. T6 is below nominal under I0 and I1 whenever two of its inputs deviate (I0: the level 4 alert and the environment all day, plus the night; I1: the environment and the night, so at night only), and nominal under I2 and I3.
- 13:00–17:00 (no night, no calls): at most T6 deviates at T9, alone and damped: T9 = 4 under every option.
- 17:00–22:00 (night, no calls): I0, I1: night and T6 coincide, T9 = 3 at every κ. I2, I3: the night alone, T9 = 4.
- 22:00–06:00 (night and calls): I0, I1: T9 = 3 (2 if c = 1) at every κ: the night and T6 hold it. I2, I3: T9 = 4 if c = 4 (κ > 0.75 ℓ), 3 if c ∈ {2, 3}, 2 if c = 1.
- 06:00–10:00 (calls, no night): I0: T6 and the calls; T9 = 4 if c = 4, else 3 (2 if c = 1). I1, I2, I3: T6 nominal, the calls alone; T9 = 4 once c ≥ 3 (κ > 0.5 ℓ).
- A (ℓ = 1): **R2 holds rescue through the night exactly when κ > 0.75; R1 never does; below that capacity no option does.** §4f's finding under A (no option restores rescue) is the case κ ≤ 0.75.
- B (ℓ = 1 while T6 is below nominal, r once it holds): I0 and I1 as under A at night. I2 and I3: ℓ = r, so **R2 holds rescue through the night once κ > 0.75 r**: at any κ when r = 0, as under A when r = 1.
- So R2 is what holds rescue at night in every case, and it needs either enough capacity (κ > 0.75, under A) or a large enough drop in calls (r < κ/0.75, under B). R1 matters only after dawn.
- At κ ∈ (0.5, 0.75] the night reproduces §4f's table (c = 3 under ℓ = 1). Reference point of the paper's figure: κ = 0.7, r = 0.25.
- N = 7: c = ceil(7 · min(1, κ/ℓ)), two levels of damping; the night threshold becomes κ > (6/7) ℓ. The paper reports both scales.
- What would count against the reading: I1 changing T9 at night; I2 failing to hold T9 at night when κ > 0.75 ℓ; under A, I2 holding T9 at night with κ ≤ 0.75.

## 4k. Declared 2026-11-19: the capacity model of §4j under the alternative rules

**Question.** §4h swapped the conversion rule on the Koriyama model without capacity or time. Does the answer of §4j (R2 holds rescue through the night once capacity is high enough or the calls fall enough) depend on Eq. (1)?

**What changes.** The §4j model is rebuilt with the rule swapped for S0 (reachability), D1 (damping only) and K2 (coincidence only), as §4h does; everything else is unchanged (the flow, the timeline, the barrier at T6, assumptions A and B). N = 4; κ and r as in §4j. Output: per (rule, assumption, variant, κ, r), T9 by hour and whether it holds nominal through the night (22:00–06:00). `decide_rules.py`; `results/decision_rules_koriyama_capacity.csv`.

**Recorded before running: the hand reading.** c is the call node's level, ceil(4 · min(1, κ/ℓ)).
- S0 (lowest input; Control and Time read one level higher). The night reaches T9 through Time, so it is absorbed. The environment alone reaches Evacuation Behaviour (Input), so T6 is below nominal all day under I0 and I1 and holds T9 there: never nominal. Under I2 and I3, T9 = c: nominal at night once κ > 0.75 ℓ. **Same night answer as Eq. (1).** By day it differs: under I0 and I1, T9 is below nominal from 13:00, before any call.
- D1 (one level above the lowest input). Every single deviation is absorbed, so Evacuation Behaviour is nominal under every variant, and under B the load is r under every variant. T9 = min(min(3, c) + 1, 4): nominal at night once c ≥ 3, κ > 0.5 ℓ. **The four variants give the same answer: no intervention matters.**
- K2 (second-lowest input). At night under I0 and I1 the night and T6 are two inputs at 3, so T9 = 3 at every κ. Under I2 and I3, T9 = 4 only when c = 4 (κ > 0.75 ℓ). **Same night answer as Eq. (1).** After dawn a lone shortfall is ignored: I1, I2, I3 nominal at every κ.
- So the night answer is the same under Eq. (1), S0 and K2, and D1 removes every difference between the interventions. What would count against the reading: S0 or K2 giving a different night answer from Eq. (1); D1 separating any two variants.

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
| abd3314 | the Koriyama decision model: options, call-load assumption, severity grid, scale (§4f) |
| d2adf31 | Koriyama reading B as a model edit, results expected identical (§4f re-encoding) |
| 43b0532 | two new held-out cases, Adhita & Furusho 2021 and Nayak et al. 2022; Koo et al. 2021 dropped (§4g) |
| 3187cdb | the decision models under the alternative rules S0, D1, K2 (§4h) |
| f1056e6 | protocol for a second, independent coding of the analysed scenarios (§4i) |
| 3532983 | the Koriyama decision model with rescue capacity and the night: flow, timeline, κ and r swept (§4j) |
| (this commit) | the capacity model under the alternative rules S0, D1, K2 (§4k) |
