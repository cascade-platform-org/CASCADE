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
