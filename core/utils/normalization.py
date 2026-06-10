"""
core/utils/normalization.py — Human-vocabulary normalisation (OPEN).

Categories and Functionality labels are authored by humans, so rules match them
case-insensitively: we normalise both the rule token and the configured name the
same way (strip, collapse whitespace to '_', drop dots, lowercase) and compare
normalised-against-normalised.

Element IDs are NOT normalised — they are canonical, case-sensitive registry keys
matched exactly (ADR-0002). This module intentionally covers only the human
vocabulary.
"""
from __future__ import annotations

import re
from typing import Optional


def _normalize_basic(name: Optional[str]) -> Optional[str]:
    """Strip, collapse internal whitespace to '_', replace '.' with '_', lowercase.

    Returns the input unchanged when it is falsy (None / empty), so callers can
    pass optional values through without guarding.
    """
    if not name:
        return name
    collapsed = re.sub(r"\s+", "_", name.strip())
    collapsed = collapsed.replace(".", "_")
    return collapsed.lower()


def normalize_category_name(name: Optional[str]) -> Optional[str]:
    """Normalise a category name for case-insensitive lookup."""
    return _normalize_basic(name)


def normalize_label(name: Optional[str]) -> Optional[str]:
    """Normalise a Functionality-scale label (e.g. 'Operational Warning') for
    case-insensitive lookup against the Model Configuration.
    """
    return _normalize_basic(name)
