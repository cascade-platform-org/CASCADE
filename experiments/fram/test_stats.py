"""
Unit tests for framkit/stats.py, each against a brute-force enumeration.

    CASCADE-backend/.venv/bin/python -m pytest experiments/fram/test_stats.py -q
"""
from __future__ import annotations

import itertools
import statistics

import numpy as np
import pytest

from framkit.stats import (Counts, counts, fisher, fragility, jeffreys_ba, null_p, paired_bootstrap,
                           pooled_null_p)


def brute_null_p(items, pool):
    """Enumerate every way of marking len(marked) items within `pool` (indices)."""
    labels = [a for a, _ in items]
    m = sum(p for _, p in items)
    obs = counts(items).ba()
    hits = total = 0
    for chosen in itertools.combinations(pool, m):
        pred = [i in chosen for i in range(len(items))]
        hits += counts(list(zip(labels, pred))).ba() >= obs - 1e-12
        total += 1
    return hits / total


CASES = [
    [(True, True)] * 7 + [(False, False)] * 2,                          # Li-like: perfect
    [(True, True)] * 8 + [(False, True)] * 2 + [(False, False)] * 6,     # Zheng-like
    [(True, True)] * 4 + [(True, False)] * 3 + [(False, True)] * 2 + [(False, False)] * 5,
    [(True, False)] * 3 + [(False, False)] * 3,                         # no marks
]


@pytest.mark.parametrize("items", CASES)
def test_null_a_matches_enumeration(items):
    assert null_p(counts(items)) == pytest.approx(brute_null_p(items, range(len(items))))


def test_null_b_matches_enumeration():
    items = CASES[2]
    pool = [0, 1, 2, 3, 4, 7, 8, 9, 10]                       # a reachable subset holding every mark
    pp = sum(items[i][0] for i in pool)
    assert null_p(counts(items), pp, len(pool) - pp) == pytest.approx(brute_null_p(items, pool))


def test_null_exact_values_of_the_hand_reading():
    assert null_p(counts(CASES[0])) == pytest.approx(1 / 36)
    assert null_p(counts(CASES[1])) == pytest.approx(28 / 8008)
    assert null_p(counts(CASES[3])) == pytest.approx(1.0)


def test_pooled_null_close_to_exact_for_one_case():
    rng = np.random.default_rng(1)
    c = counts(CASES[1])
    assert pooled_null_p([c], [(c.pos, c.neg)], 200_000, rng) == pytest.approx(28 / 8008, abs=1e-3)


def test_jeffreys_mean_and_perfect_case_below_one():
    rng = np.random.default_rng(2)
    draws = jeffreys_ba(Counts(7, 0, 2, 0), 40_000, rng)
    assert 0.8 < draws.mean() < 1
    assert np.quantile(draws, 0.025) < 0.9


def test_paired_bootstrap_identical_members_is_zero():
    rng = np.random.default_rng(3)
    lab = [a for a, _ in CASES[2]]
    pred = [p for _, p in CASES[2]]
    assert np.all(paired_bootstrap([(lab, pred, pred)], 500, rng) == 0)


def test_paired_bootstrap_mean_near_observed_difference():
    rng = np.random.default_rng(4)
    lab = [a for a, _ in CASES[1]]
    pa = [p for _, p in CASES[1]]
    pb = [True] * len(lab)                                    # marks everything: BA 0.5
    diff = paired_bootstrap([(lab, pa, pb)], 20_000, rng)
    assert diff.mean() == pytest.approx(counts(CASES[1]).ba() - 0.5, abs=0.02)


def brute_fragility(cases, max_flips):
    flat = [(ci, i) for ci, case in enumerate(cases) for i in range(len(case))]
    for size in range(max_flips + 1):
        for combo in itertools.combinations(flat, size):
            new = [list(case) for case in cases]
            for ci, i in combo:
                lab, pa, pb = new[ci][i]
                new[ci][i] = (not lab, pa, pb)
            try:
                a = [counts([(lab, p) for lab, p, _ in c]).ba() for c in new]
                b = [counts([(lab, p) for lab, _, p in c]).ba() for c in new]
            except ZeroDivisionError:
                continue
            if statistics.mean(b) >= statistics.mean(a) - 1e-12:
                return size
    return None


def test_fragility_matches_enumeration():
    a_case = [(True, True, False)] * 3 + [(False, False, False)] * 2 + [(True, True, True)]
    b_case = [(True, True, True)] * 2 + [(False, False, True)] * 3 + [(True, False, False)]
    cases = [a_case, b_case]
    for k in (0, 1, 2, 3):
        assert fragility(cases, k) == brute_fragility(cases, k)


def test_fragility_zero_when_already_reached():
    case = [(True, True, True), (False, False, False)]
    assert fragility([case], 2) == 0


def test_fisher_of_ones_is_one():
    assert fisher([1.0, 1.0]) == pytest.approx(1.0)
