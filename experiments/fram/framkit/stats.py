"""
framkit/stats.py — how much a handful of labelled cases establish (TRANSLATION.md §4l).

Pure functions over per-item predictions; no propagation here. A *case* is a
list of items, each (label, predicted) with label True = the analysts call it
affected and predicted True = the rule degrades it. Balanced accuracy is
(recall + specificity) / 2, the paper's score.
"""
from __future__ import annotations

import itertools
import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from scipy.stats import hypergeom

Item = tuple[bool, bool]            # (affected, predicted degraded)
EPS = 1e-12


@dataclass(frozen=True)
class Counts:
    tp: int
    fn: int
    tn: int
    fp: int

    @property
    def pos(self) -> int:
        return self.tp + self.fn

    @property
    def neg(self) -> int:
        return self.tn + self.fp

    @property
    def marked(self) -> int:
        return self.tp + self.fp

    def ba(self) -> float:
        return (self.tp / self.pos + self.tn / self.neg) / 2


def counts(items: Sequence[Item]) -> Counts:
    tp = sum(a and p for a, p in items)
    fn = sum(a and not p for a, p in items)
    tn = sum(not a and not p for a, p in items)
    fp = sum(not a and p for a, p in items)
    return Counts(tp, fn, tn, fp)


def ba_of(pos: int, neg: int, marked: int, k: int) -> float:
    """Balanced accuracy when `marked` items are marked and `k` of them are affected."""
    return (k / pos + (neg - (marked - k)) / neg) / 2


def null_p(c: Counts, pool_pos: int | None = None, pool_neg: int | None = None) -> float:
    """Exact P(BA >= observed) when c.marked items are drawn uniformly from a pool.

    The pool defaults to every labelled item (null a); pass the labelled items a
    reachability rule degrades (null b). BA is always scored on all labels.
    """
    pp = c.pos if pool_pos is None else pool_pos
    pn = c.neg if pool_neg is None else pool_neg
    m = c.marked
    if m > pp + pn:
        raise ValueError("more marks than the pool holds")
    obs = c.ba()
    dist = hypergeom(pp + pn, pp, m)
    return float(sum(dist.pmf(k) for k in range(max(0, m - pn), min(m, pp) + 1)
                     if ba_of(c.pos, c.neg, m, k) >= obs - EPS))


def pooled_null_p(cases: Sequence[Counts], pools: Sequence[tuple[int, int]], draws: int,
                  rng: np.random.Generator) -> float:
    """Monte Carlo P(mean BA >= observed mean) with each case drawn independently."""
    obs = float(np.mean([c.ba() for c in cases]))
    total = np.zeros(draws)
    for c, (pp, pn) in zip(cases, pools):
        k = rng.hypergeometric(pp, pn, c.marked, size=draws) if c.marked else np.zeros(draws, int)
        total += (k / c.pos + (c.neg - (c.marked - k)) / c.neg) / 2
    hits = int(np.sum(total / len(cases) >= obs - EPS))
    return (hits + 1) / (draws + 1)


def jeffreys_ba(c: Counts, draws: int, rng: np.random.Generator) -> np.ndarray:
    """Posterior draws of BA from independent Jeffreys Beta(1/2, 1/2) on recall and specificity."""
    rec = rng.beta(c.tp + 0.5, c.fn + 0.5, size=draws)
    spe = rng.beta(c.tn + 0.5, c.fp + 0.5, size=draws)
    return (rec + spe) / 2


def paired_bootstrap(cases: Sequence[tuple[Sequence[bool], Sequence[bool], Sequence[bool]]],
                     resamples: int, rng: np.random.Generator) -> np.ndarray:
    """Draws of mean-BA(a) - mean-BA(b), items resampled within each case's two strata.

    Each case is (labels, predictions of a, predictions of b), item-aligned.
    """
    diffs = np.zeros(resamples)
    for labels, pa, pb in cases:
        lab = np.asarray(labels, bool)
        a, b = np.asarray(pa, bool), np.asarray(pb, bool)
        pos, neg = np.flatnonzero(lab), np.flatnonzero(~lab)
        ip = rng.integers(0, len(pos), size=(resamples, len(pos)))
        ineg = rng.integers(0, len(neg), size=(resamples, len(neg)))
        for pred, sign in ((a, 1.0), (b, -1.0)):
            rec = pred[pos][ip].mean(axis=1)
            spe = (~pred[neg][ineg]).mean(axis=1)
            diffs += sign * (rec + spe) / 2
    return diffs / len(cases)


def _flip(c: Counts, label: bool, pred: bool) -> Counts | None:
    """The counts after one item's label is flipped; None if a stratum would empty."""
    if label:
        c = Counts(c.tp - pred, c.fn - (not pred), c.tn + (not pred), c.fp + pred)
    else:
        c = Counts(c.tp + pred, c.fn + (not pred), c.tn - (not pred), c.fp - pred)
    return c if c.pos > 0 and c.neg > 0 else None


def fragility(cases: Sequence[Sequence[tuple[bool, bool, bool]]], max_flips: int) -> int | None:
    """Fewest label flips after which member b's mean BA reaches member a's.

    Each case is a list of items (label, pred_a, pred_b). Returns 0 if b already
    reaches a, None if no set of at most `max_flips` flips does.
    """
    flat = [(ci, lab, pa, pb) for ci, case in enumerate(cases) for lab, pa, pb in case]
    base_a = [counts([(lab, pa) for lab, pa, _ in case]) for case in cases]
    base_b = [counts([(lab, pb) for lab, _, pb in case]) for case in cases]
    for size in range(max_flips + 1):
        for combo in itertools.combinations(range(len(flat)), size):
            ca, cb = list(base_a), list(base_b)
            ok = True
            for idx in combo:
                ci, lab, pa, pb = flat[idx]
                na, nb = _flip(ca[ci], lab, pa), _flip(cb[ci], lab, pb)
                if na is None or nb is None:
                    ok = False
                    break
                # a second flip on the same case reads the already-flipped counts: correct,
                # since each item is flipped at most once and counts are additive
                ca[ci], cb[ci] = na, nb
            if ok and sum(c.ba() for c in cb) >= sum(c.ba() for c in ca) - EPS:
                return size
    return None


def fisher(ps: Sequence[float]) -> float:
    """Fisher's combination of independent p-values."""
    stat = -2 * sum(math.log(max(p, 1e-300)) for p in ps)
    from scipy.stats import chi2
    return float(chi2.sf(stat, 2 * len(ps)))
