"""
The Zheng and Koriyama variants under the alternative conversion rules
(TRANSLATION.md §4h, declared at 3187cdb): does the rule RQ1 checks matter to
what the comparison of recommended interventions concludes?

Each model of decide_zheng.py and decide_koriyama.py is rebuilt with the
conversion rule swapped for S0 (reachability), D1 (damping only) and K2
(coincidence only); v2 is run beside them. Everything else is unchanged.
§4n (declared at a535e8a) adds the rest of the §4c family: v2-D2, v2-typed,
v2+3 and v2+c, so the rules RQ1 cannot reject (run_stats.py) are covered.

  results/decision_rules_zheng.csv, decision_rules_koriyama.csv

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/decide_rules.py
"""
from __future__ import annotations

import contextlib
import itertools
from collections.abc import Iterator

import decide_koriyama
import decide_zheng
from decide_zheng import D_GRID, N, REF, S_GRID, write
from run_ablation import FAMILY

RULES = ("v2", "S0", "D1", "K2",
         "v2-D2", "v2-typed", "v2+3", "v2+c")          # §4n: the rest of the family, appended


@contextlib.contextmanager
def rule(member: str) -> Iterator[None]:
    """Both decision models built with `member` as the conversion rule."""
    saved = decide_zheng.config_at, decide_koriyama.config_at
    decide_zheng.config_at = decide_koriyama.config_at = lambda _n: FAMILY[member]
    try:
        yield
    finally:
        decide_zheng.config_at, decide_koriyama.config_at = saved


def zheng() -> list[dict[str, object]]:
    rows = []
    points = [{"s": s, "d": d, "a": REF["a"]} for s, d in itertools.product(S_GRID, D_GRID)]
    for member, intervention in itertools.product(RULES, decide_zheng.INTERVENTIONS):
        with rule(member):
            fn = decide_zheng.build(intervention).fn_node
            runs = decide_zheng.run_points(intervention, N, points)
        for p, periods in zip(points, runs):
            rows.append({"rule": member, "intervention": intervention, "s": p["s"], "d": p["d"],
                         "F12": periods[0][fn["F12"]], "F17_before": periods[0][fn["F17"]],
                         "F20_before": periods[0][fn["F20"]], "F20_after": periods[-1][fn["F20"]]})
    return rows


def koriyama() -> list[dict[str, object]]:
    rows = []
    for member, reading, intervention in itertools.product(RULES, decide_koriyama.READINGS,
                                                           decide_koriyama.INTERVENTIONS):
        with rule(member):
            lv = decide_koriyama.run(intervention, N, reading, decide_koriyama.DECLARED)
        rows.append({"rule": member, "reading": reading, "intervention": intervention,
                     "T5": lv["T5"], "T6": lv["T6"], "T9": lv["T9"],
                     "operativity": round(decide_koriyama.operativity(lv, N), 3)})
    return rows


def koriyama_capacity() -> list[dict[str, object]]:
    """§4k: the §4j capacity model under each rule, N = 4."""
    dk = decide_koriyama
    rows = []
    for member, intervention, kappa in itertools.product(RULES, dk.INTERVENTIONS, dk.KAPPA):
        with rule(member):
            t = dk.build_flow(intervention, N, kappa)
            for assumption in dk.READINGS:
                for r in (dk.R if assumption == "B" else [1]):
                    t9 = [dk.hour(t, intervention, N, assumption, r, h)["T9"] for h in dk.HOURS]
                    night = [v for h, v in zip(dk.HOURS, t9) if dk.CALLING(h) and dk.NIGHT(h)]
                    rows.append({"rule": member, "assumption": assumption, "intervention": intervention,
                                 "kappa": kappa, "r": r, "night_held": all(v == N for v in night),
                                 "T9_by_hour": " ".join(str(v) for v in t9)})
    return rows


def main() -> None:
    write("decision_rules_zheng.csv", zheng())
    write("decision_rules_koriyama.csv", koriyama())
    write("decision_rules_koriyama_capacity.csv", koriyama_capacity())


if __name__ == "__main__":
    main()
