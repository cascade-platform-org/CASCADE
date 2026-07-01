"""Tests for core/aggregation.py — the integer Functionality operators.

Every operator must resolve ambiguous cases pessimistically (toward the worse,
lower level), per ADR-0003. These tests pin that behaviour so a future "tidy-up"
can't silently flip rounding to nearest/optimistic.
"""
import pytest

from core.aggregation import (
    OPERATORS,
    Attribution,
    attributed,
    average_of,
    best_of,
    majority_of,
    median_of,
    worst_of,
)


def test_worst_and_best_are_min_and_max():
    assert worst_of([4, 2, 3]) == 2
    assert best_of([4, 2, 3]) == 4


def test_singletons_are_identity():
    for op in (worst_of, best_of, majority_of, average_of, median_of):
        assert op([3]) == 3


def test_majority_returns_mode():
    assert majority_of([4, 4, 4, 2]) == 4


def test_majority_breaks_ties_toward_worse():
    # 4 and 2 each occur twice; the worse (2) must win.
    assert majority_of([4, 4, 2, 2, 3]) == 2


def test_majority_three_way_tie_picks_lowest():
    assert majority_of([1, 3, 5]) == 1


def test_average_floors_not_rounds():
    # mean is 3.5 -> floor 3, never 4.
    assert average_of([4, 3]) == 3
    # mean is 3.66 -> 3.
    assert average_of([3, 4, 4]) == 3
    # exact integer mean is preserved.
    assert average_of([2, 4]) == 3
    assert average_of([5, 5, 5]) == 5


def test_median_odd_count():
    assert median_of([1, 3, 4]) == 3
    assert median_of([4, 1, 3]) == 3  # unsorted input handled


def test_median_even_count_takes_lower():
    # central values 3 and 4 -> lower median 3.
    assert median_of([2, 3, 4, 4]) == 3
    assert median_of([1, 2]) == 1


def test_empty_input_raises():
    for op in (worst_of, best_of, majority_of, average_of, median_of):
        with pytest.raises(ValueError):
            op([])


def test_accepts_generators_and_dict_values():
    assert worst_of(x for x in [5, 2, 4]) == 2
    assert best_of({"a": 1, "b": 4}.values()) == 4


def test_operator_registry_matches_dsl_names():
    assert set(OPERATORS) == {
        "worst_of",
        "best_of",
        "majority_of",
        "average_of",
        "median_of",
    }
    assert OPERATORS["worst_of"]([1, 2]) == 1


# --- attributed aggregation (value + responsibility) ------------------------


def _assert_shares_sum_to_one(shares):
    assert sum(shares.values()) == pytest.approx(1.0)


def test_attributed_worst_of_blames_argmin():
    result = attributed("worst_of", {"a": 4, "b": 2, "c": 3})
    assert result == Attribution(level=2, shares={"b": 1.0})


def test_attributed_best_of_blames_only_the_best_supplier():
    # Redundancy: node rides its best input (b=3); the worse ones are NOT blamed.
    result = attributed("best_of", {"a": 1, "b": 3, "c": 2})
    assert result.level == 3
    assert result.shares == {"b": 1.0}


def test_attributed_ties_split_uniformly_at_binding_level():
    result = attributed("worst_of", {"a": 2, "b": 2, "c": 4})
    assert result.level == 2
    assert result.shares == {"a": 0.5, "b": 0.5}


def test_attributed_majority_blames_winning_level_holders():
    result = attributed("majority_of", {"a": 4, "b": 4, "c": 2})
    assert result.level == 4
    assert result.shares == {"a": 0.5, "b": 0.5}


def test_attributed_median_blames_median_value_holder():
    result = attributed("median_of", {"a": 1, "b": 3, "c": 4})
    assert result.level == 3
    assert result.shares == {"b": 1.0}


def test_attributed_average_blames_lower_half_only():
    # mean is 3.0; only the 1 is below it -> it carries all the blame, the 5 none.
    result = attributed("average_of", {"a": 1, "b": 5})
    assert result.level == 3  # floor(3.0)
    assert result.shares == {"a": 1.0}


def test_attributed_average_weights_by_gap_below_mean():
    # values 1, 2, 5 -> mean 2.6667; below-mean = {1, 2} with gaps 1.6667, 0.6667.
    result = attributed("average_of", {"a": 1, "b": 2, "c": 5})
    assert result.level == 2  # floor(8/3)
    assert "c" not in result.shares  # above the mean, blameless
    assert result.shares["a"] == pytest.approx(1.6667 / 2.3333, rel=1e-3)
    assert result.shares["b"] == pytest.approx(0.6667 / 2.3333, rel=1e-3)
    _assert_shares_sum_to_one(result.shares)


def test_attributed_average_all_equal_is_uniform():
    result = attributed("average_of", {"a": 3, "b": 3})
    assert result.level == 3
    assert result.shares == {"a": 0.5, "b": 0.5}


def test_attributed_singleton():
    assert attributed("worst_of", {"only": 3}) == Attribution(3, {"only": 1.0})


def test_attributed_empty_raises():
    with pytest.raises(ValueError):
        attributed("worst_of", {})


def test_attributed_unknown_operator_raises():
    with pytest.raises(ValueError, match="Unknown aggregation operator"):
        attributed("sum_of", {"a": 1})
