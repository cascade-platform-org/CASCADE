"""
framkit/oracles.py — independent reference computations the engine is checked against.

* FMI activation (Hill & Slater 2024): start with nothing active and activate a
  function once its coupled aspects are present under its profiles -> the
  LEAST fixed point of the activation operator.
* The same operator iterated from "everything active" -> the GREATEST fixed
  point. On a binary scale this is what CASCADE should compute (P1/P3).
* The one-hop VPN of Patriarca 2017 / Kaya 2020, enumerated exactly over the
  81 SPC scenarios (no sampling).

These re-implement FRAM-side methods only; no CASCADE propagation logic is
reproduced here.
"""
from __future__ import annotations

import itertools

from .model import ASPECTS, FramModel


def _satisfied(model: FramModel, fid: str, active: set[str]) -> bool:
    fn = model.functions[fid]
    incoming = model.incoming(fid)
    for aspect in ASPECTS:
        profile = fn.profile(aspect)
        if profile == "None":
            continue
        slots: dict[str, list[str]] = {}
        for c in incoming:
            if c.aspect == aspect:
                slots.setdefault(c.output, []).append(c.source)
        if not slots:
            continue
        present = [any(src in active for src in producers) for producers in slots.values()]
        if profile == "All" and not all(present):
            return False
        if profile == "Any" and not any(present):
            return False
    return True


def activation(model: FramModel, knocked_out: set[str], start: str) -> set[str]:
    """Fixed point of the FMI activation operator.

    start = "empty" -> least fixed point (the FMI's own run);
    start = "full"  -> greatest fixed point.
    A knocked-out function never activates.
    """
    fids = [f for f in model.functions if f not in knocked_out]
    if start == "empty":
        active: set[str] = set()
        changed = True
        while changed:
            changed = False
            for f in fids:
                if f not in active and _satisfied(model, f, active):
                    active.add(f)
                    changed = True
        return active
    active = set(fids)
    changed = True
    while changed:
        changed = False
        for f in list(active):
            if not _satisfied(model, f, active):
                active.discard(f)
                changed = True
    return active


# --- Kaya & Hocaoglu 2020 one-hop VPN ------------------------------------------

SPC_LEVELS = (1, 2, 4)
SPC_PROB = ((0.2, 0.5, 0.3), (0.3, 0.6, 0.1), (0.5, 0.4, 0.1), (0.2, 0.25, 0.55))
VPN_THRESHOLD = 54
CONFIDENCE = 0.05


def spc_scenarios():
    """All 3^4 = 81 SPC scenarios with their probabilities."""
    for idx in itertools.product(range(3), repeat=4):
        levels = tuple(SPC_LEVELS[i] for i in idx)
        prob = 1.0
        for k, i in enumerate(idx):
            prob *= SPC_PROB[k][i]
        yield levels, prob


def e_factor(row: dict[str, str], spc: tuple[int, ...]) -> float:
    return max(1.0, sum(s * float(row[f"b{k + 1}"]) for k, s in enumerate(spc)) / 4)


def vpn_exceedance(row: dict[str, str], spc: tuple[int, ...]) -> float:
    """P(VPN >= threshold) for one coupling in one scenario (inclusive >=)."""
    e = e_factor(row, spc)
    p = 0.0
    for t in range(1, 5):
        for q in range(1, 5):
            pt, pq = float(row[f"P_T{t}"]) / 100, float(row[f"P_P{q}"]) / 100
            if pt == 0 or pq == 0:
                continue
            vpn = t * q * float(row[f"A_T{t}"]) * float(row[f"A_P{q}"]) * e
            if vpn >= VPN_THRESHOLD:
                p += pt * pq
    return p


def vpn_frequency(row: dict[str, str]) -> float:
    """Expected number of critical scenarios per 100 (Kaya's Fig. 5 quantity)."""
    return 100 * sum(prob for spc, prob in spc_scenarios()
                     if vpn_exceedance(row, spc) >= CONFIDENCE)


# --- Fault tree (Khakzad, Khan & Amyotte 2011) -----------------------------------

KHAKZAD_BASIC = {"PT": 0.1647, "PC": 0.2818, "PY": 0.1538, "A_valve": 0.3403,
                 "Actuator": 0.2015, "Hum_error": 0.2696, "M_valve": 0.1393}
KHAKZAD_AUTO = ("PT", "PC", "PY", "A_valve", "Actuator")
KHAKZAD_MANUAL = ("Hum_error", "M_valve")


def khakzad_top_event() -> float:
    """Top event = AND(OR(automatic branch), OR(manual branch)), closed form."""
    def or_gate(events):
        ok = 1.0
        for e in events:
            ok *= 1 - KHAKZAD_BASIC[e]
        return 1 - ok
    return or_gate(KHAKZAD_AUTO) * or_gate(KHAKZAD_MANUAL)
