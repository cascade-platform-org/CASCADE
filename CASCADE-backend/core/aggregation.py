"""
core/aggregation.py — Integer Functionality aggregation operators (OPEN, auditable).

These are the combinators the propagation engine uses to aggregate Functionality
levels. They are NOT proprietary: they are plain, well-known reductions over an
integer scale, documented in ADR-0003. The proprietary part — *when* and *in what
order* these are applied — lives exclusively in engine/propagation.py.

Functionality is a discrete integer on the scale 1..N defined by the Model
Configuration (1 = worst, N = fully operational). See CONTEXT.md → *Functionality*.

Design rule (ADR-0003): every ambiguous case resolves **pessimistically — toward
the worse (lower) level**. The whole engine is pessimistic-monotone, so an
operator must never let a node end up *better* than a strict reading of its
inputs. Concretely:

    worst_of      = min
    best_of       = max
    majority_of   = mode; ties broken toward the WORSE (lower) level
    average_of    = arithmetic mean, rounded DOWN (floor)
    median_of     = middle value; even count -> LOWER median

Why integers make average_of/median_of meaningful: on the retired four-state
label domain ("critical".."operational") an average had no natural value. On the
integer 1..N scale it is simply the rounded mean — which is exactly why v2 moved
to integers (see CONTEXT.md flagged ambiguity on the four-state domain).

All operators take a non-empty iterable of integer levels and return one integer
level. An empty input is a programming error (there is nothing to aggregate) and
raises ValueError, mirroring the old engine's behaviour.
"""
from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass


def _materialise(levels: Iterable[int]) -> list[int]:
    """Turn the input into a concrete list and reject emptiness early.

    We accept any iterable (lists, generators, dict.values(), ...) so callers
    don't have to pre-convert, but we need the values more than once (length,
    sorting, counting), so we snapshot into a list first.
    """
    values = list(levels)
    if not values:
        raise ValueError("Cannot aggregate an empty collection of Functionality levels.")
    return values


def worst_of(levels: Iterable[int]) -> int:
    """Lattice meet — the worst (lowest) level. Models necessity / pessimism.

    Used as the intercategorical default (all categories needed) and as the
    deliverable limiter worst_of(node, edge).
    """
    return min(_materialise(levels))


def best_of(levels: Iterable[int]) -> int:
    """Lattice join — the best (highest) level. Models redundancy.

    Used as the intracategorical default: one healthy supplier suffices.
    """
    return max(_materialise(levels))


def majority_of(levels: Iterable[int]) -> int:
    """Most frequent level (statistical mode), ties broken toward the WORSE level.

    Example: [4, 4, 2, 2, 3] -> 2 (4 and 2 both occur twice; the worse, 2, wins).

    Counter.most_common() does not promise a deterministic tie order, so we do
    not rely on it for tie-breaking. Instead we find the maximum frequency, then
    take the minimum level among all levels sharing that frequency — making the
    result deterministic and pessimistic.
    """
    values = _materialise(levels)
    counts = Counter(values)
    top_frequency = max(counts.values())
    tied_levels = [level for level, freq in counts.items() if freq == top_frequency]
    return min(tied_levels)


def average_of(levels: Iterable[int]) -> int:
    """Arithmetic mean rounded DOWN (floor) — the pessimistic rounding.

    Example: [4, 3] -> floor(3.5) = 3 (not 4). Integer floor division on a
    non-negative sum is exactly floor(mean).
    """
    values = _materialise(levels)
    return sum(values) // len(values)


def median_of(levels: Iterable[int]) -> int:
    """Middle value; for an even count, the LOWER of the two central values.

    Example (odd):  [1, 3, 4]    -> 3
    Example (even): [2, 3, 4, 4] -> 3 (lower of the two central values 3 and 4).

    The lower-median choice keeps the operator pessimistic; we deliberately do
    not interpolate (which could invent a level that no input held).
    """
    values = sorted(_materialise(levels))
    n = len(values)
    if n % 2 == 1:
        return values[n // 2]
    # Even count: indices n//2 - 1 and n//2 straddle the middle; take the lower.
    return values[n // 2 - 1]


# Registry so the engine and the rule layer can resolve an operator by its
# DSL name without a chain of if/elif. Keys match the rule grammar tokens.
OPERATORS = {
    "worst_of": worst_of,
    "best_of": best_of,
    "majority_of": majority_of,
    "average_of": average_of,
    "median_of": median_of,
}


# ---------------------------------------------------------------------------
# Attributed aggregation — value PLUS responsibility (ADR-0003)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Attribution:
    """An aggregation result together with the responsibility for it.

    `level`   — the aggregated Functionality level (same value the bare operator
                would return).
    `shares`  — the responsibility-share dictionary: each contributing input key
                mapped to its share in [0, 1], summing to 1. This is exactly the
                `responsibility_share` shape the engine emits (ADR-0003), so the
                engine can thread it straight through (modulo guard re-attribution
                and cross-category ties).

    Responsibility means *who pulled the level down*: an input contributes iff
    raising it would raise the aggregate. Where contributors sit at different
    distances below the result (only `average_of`), the share is weighted by that
    distance; otherwise it is uniform.
    """
    level: int
    shares: dict[str, float]


def _uniform_shares(keys: Iterable[str]) -> dict[str, float]:
    """Split responsibility equally across `keys`. Used whenever the contributors
    all sit at the same level (worst/best/majority/median), where there is no
    'how far below' to weight by.
    """
    keys = list(keys)
    weight = 1.0 / len(keys)
    return {key: weight for key in keys}


def _average_shares(items: Mapping[str, int]) -> dict[str, float]:
    """Blame the lower half of an average: inputs strictly below the mean,
    weighted by how far below they sit (a node far under the mean pulled it down
    harder than one just under). Inputs at or above the mean are blameless.

    If no input is strictly below the mean (all equal), there is no lower half to
    single out, so responsibility is uniform across all inputs.
    """
    mean = sum(items.values()) / len(items)
    gaps = {key: mean - value for key, value in items.items() if value < mean}
    if not gaps:
        return _uniform_shares(items)
    total = sum(gaps.values())
    return {key: gap / total for key, gap in gaps.items()}


def attributed(operator: str, items: Mapping[str, int]) -> Attribution:
    """Aggregate keyed Functionality inputs, returning the level AND its blame.

    `items` maps an input key (an ElementId — the binding element of a
    deliverable, or a supplier) to its integer Functionality level. The engine
    builds these keys; this function stays agnostic about what they identify.

    Per operator:

        worst_of    -> the argmin (worst inputs), uniform among ties
        best_of     -> the argmax (best surviving supplier; under redundancy the
                       node rides its best input, so worse inputs are NOT to blame),
                       uniform among ties
        majority_of -> the holders of the winning (modal, worse-tie) level, uniform
        median_of   -> the holders of the median value, uniform
        average_of  -> the inputs BELOW the mean, weighted by their gap below it
                       (the one operator with an informative, non-uniform share)
    """
    if not items:
        raise ValueError("Cannot aggregate an empty collection of Functionality levels.")
    try:
        op = OPERATORS[operator]
    except KeyError:
        raise ValueError(
            f"Unknown aggregation operator '{operator}'. "
            f"Known operators: {sorted(OPERATORS)}."
        ) from None

    level = op(items.values())

    if operator == "average_of":
        shares = _average_shares(items)
    else:
        # Contributors are the inputs sitting at the binding level; uniform split.
        pivotal = [key for key, value in items.items() if value == level]
        shares = _uniform_shares(pivotal)

    return Attribution(level=level, shares=shares)
