"""
core/importers/inp/parse.py — load EPANET .inp text into a WNTR WaterNetworkModel.

WNTR (BSD-3, EPA/Sandia) is the reference Python implementation for EPANET
networks. Parsing through it (instead of a hand-rolled section parser) buys:
  - unit normalisation: whatever flow units the file declares (GPM, LPS, …),
    the resulting model is always SI (m³/s, m),
  - a battle-tested reader for the many .inp dialect quirks,
  - the same object model reused by skeletonization (core/importers/inp/skeleton.py)
    and hydraulic simulation (core/importers/inp/sim.py).

This module is a deliberately thin seam: everything downstream consumes the
WaterNetworkModel, so a future format (e.g. GIS shapefiles) only needs its own
loader that produces the same object.
"""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path

import wntr

# WNTR logs every skeletonization merge at INFO — noise at request time.
logging.getLogger("wntr").setLevel(logging.WARNING)


class InpParseError(ValueError):
    """Raised when the uploaded text is not a readable EPANET .inp file."""


def load_inp(content: str) -> wntr.network.WaterNetworkModel:
    """Parse .inp file text into a WNTR model (SI units).

    WNTR's reader only accepts a file path, so the text is round-tripped
    through a temporary file. The file is removed before returning.
    """
    if "[JUNCTIONS]" not in content.upper():
        raise InpParseError("Not an EPANET .inp file (no [JUNCTIONS] section).")

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".inp", delete=False, encoding="latin-1", errors="replace"
    ) as handle:
        handle.write(content)
        tmp_path = Path(handle.name)

    try:
        return wntr.network.WaterNetworkModel(str(tmp_path))
    except Exception as exc:  # wntr raises bare Exceptions for malformed files
        raise InpParseError(f"WNTR could not parse the .inp file: {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)
