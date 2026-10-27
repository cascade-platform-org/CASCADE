"""
framkit/readers.py — load the published models into a FramModel.

Sources live outside the repository, in the gitignored paper folder
(`docs/paper/FRAM/models/` and `FRAM_Model_Examples-main/`), because two of the
transcriptions are (c) Elsevier and stay private. Override the folder with the
FRAM_DATA environment variable.

Readers keep the papers' own identifiers (F1, P4, ...) as function ids.
"""
from __future__ import annotations

import csv
import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from .model import FramModel

REPO = Path(__file__).resolve().parents[3]
DATA = Path(os.environ.get("FRAM_DATA", REPO / "docs" / "paper" / "FRAM"))
MODELS = DATA / "models"
LIBRARY = DATA / "FRAM_Model_Examples-main"
LOCAL = Path(__file__).resolve().parents[1] / "data"

_FN_REF = re.compile(r"^F(\d+)\(O\)$")


def _rows(path: Path) -> list[dict[str, str]]:
    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if not ln.startswith("#")]
    return list(csv.DictReader(lines))


def read_xfmv(path: Path) -> FramModel:
    """FMV file: functions with FMI profiles; one <Aspect> per drawn coupling.

    An Aspect's <Name> is `outputFn|output text|toFn|TYPE`; the text may itself
    contain '|', so the first and the last two fields are split off.
    """
    root = ET.parse(path).getroot()
    model = FramModel(path.stem)
    for f in root.find("Functions") or []:
        fid = f.findtext("IDNr").strip()
        fn = model.add_function(fid, (f.findtext("IDName") or "").strip(),
                                background=(f.findtext("FunctionType") or "0").strip() == "2")
        for aspect in "IPRCT":
            value = f.get(f"profile{aspect}")
            if value and value != "All":
                fn.profiles[aspect] = value
    aspects = root.find("Aspects")
    for a in (aspects if aspects is not None else []):
        name = a.findtext("Name") or ""
        head, rest = name.split("|", 1)
        text, to_fn, kind = rest.rsplit("|", 2)
        src, dst = a.get("outputFn"), a.get("toFn")
        if src is None or dst is None or kind not in "IPRCT" or not kind:
            continue
        if src not in model.functions or dst not in model.functions:
            continue
        model.add_coupling(src, text.strip(), dst, kind)
    return model


def read_zheng() -> FramModel:
    """Zheng et al. 2024 Table 1: values are either F_k(O) or an external text."""
    model = FramModel("zheng_2024_natech")
    rows = _rows(MODELS / "zheng_2024_natech_functions.csv")
    out_text: dict[str, str] = {}
    for r in rows:
        model.add_function(r["function"], r["name"])
        if r["aspect"] == "O":
            out_text[r["function"]] = r["value"]
    for r in rows:
        if r["aspect"] == "O":
            continue
        m = _FN_REF.match(r["value"])
        if m:
            src = f"F{m.group(1)}"
            model.add_coupling(src, out_text[src], r["function"], r["aspect"])
        else:
            ext = "X:" + r["value"]
            model.add_function(ext, r["value"], background=True)
            model.add_coupling(ext, r["value"], r["function"], r["aspect"])
    return model


def read_long(path: Path, name: str) -> FramModel:
    """Long format `function,name,aspect,value` with O rows naming outputs
    (Smith 2017, Tian 2016). A received value no function outputs becomes a
    background function, as in read_zheng."""
    model = FramModel(name)
    rows = _rows(path)
    producers: dict[str, list[str]] = {}
    for r in rows:
        model.add_function(r["function"], r["name"])
        if r["aspect"] == "O":
            producers.setdefault(r["value"], []).append(r["function"])
    for r in rows:
        if r["aspect"] == "O":
            continue
        srcs = producers.get(r["value"])
        if not srcs:
            ext = "X:" + r["value"]
            model.add_function(ext, r["value"], background=True)
            srcs = [ext]
        for src in srcs:
            model.add_coupling(src, r["value"], r["function"], r["aspect"])
    return model


def read_smith() -> FramModel:
    return read_long(MODELS / "smith_2017_propane_fram.csv", "smith_2017_propane")


def read_tian() -> FramModel:
    return read_long(MODELS / "tian_2016_herald.csv", "tian_2016_herald")


def read_wenzhou() -> FramModel:
    """Li & Huang 2025 Fig. 4, digitised (one output per module)."""
    return read_long(MODELS / "li_2025_wenzhou.csv", "li_2025_wenzhou")


def read_togawa() -> FramModel:
    """Togawa et al. 2023 Fig. 5 with Table 2's output texts."""
    return read_long(MODELS / "togawa_2023_koriyama.csv", "togawa_2023_koriyama")


def read_kim() -> tuple[FramModel, list[dict[str, str]]]:
    """Kim & Yoon 2021 Table 3. The upstream set of each rule is the coupling
    list; aspect types are only in Fig. 5, so every coupling is read as I."""
    model = FramModel("kim_2021_covid")
    rows = _rows(MODELS / "kim_2021_covid_rules.csv")
    for r in rows:
        model.add_function(r["function"], r["name"])
    for r in rows:
        for src in dict.fromkeys(re.findall(r"F\d+", r["rule"])):
            model.add_coupling(src, f"output of {src}", r["function"], "I")
    return model, rows


def zheng_judgements() -> dict[str, str]:
    return {r["function"]: r["judgement"] for r in _rows(LOCAL / "zheng_2024_table2.csv")}


def read_kaya() -> tuple[FramModel, list[dict[str, str]]]:
    """Kaya & Hocaoglu 2020 Appendix 1. Returns the model and the raw rows
    (the per-coupling distributions and factors are inputs to E1 and the VPN
    oracle). Downstream "F9(P)" = function F9, aspect P; an "x" suffix marks a
    second coupling between the same pair; "F15R" (printed without parentheses
    for F20's rows) means aspect R; "N/A" rows are terminal outputs."""
    model = FramModel("kaya_2020_nicu")
    rows = _rows(MODELS / "kaya_2020_nicu_couplings.csv")
    names = _kaya_names()
    for r in rows:
        model.add_function(r["upstream"], names.get(r["upstream"], r["upstream"]))
        m = re.match(r"^(F\d+)\(?([IPRCT])\)?x?$", r["downstream"].strip())
        if m:
            model.add_function(m.group(1), names.get(m.group(1), m.group(1)))
            model.add_coupling(r["upstream"], r["output"], m.group(1), m.group(2))
    return model, rows


def _kaya_names() -> dict[str, str]:
    for ln in (MODELS / "kaya_2020_nicu_couplings.csv").read_text(encoding="utf-8").splitlines():
        if ln.startswith("# Functions:"):
            return dict(re.findall(r"(F\d+) ([^;]+?)(?:;|$)", ln[len("# Functions:"):]))
    return {}


def read_li() -> tuple[FramModel, dict[str, dict[str, str]]]:
    """Li et al. 2026 Tables 4-5. Returns the model and per-function parameters
    (only the 13 control domains carry them)."""
    model = FramModel("li_2026_metro")
    params: dict[str, dict[str, str]] = {}
    rows = _rows(MODELS / "li_2026_metro_rainfall.csv")
    for r in rows:
        model.add_function(r["upstream"], r["function_name"])
        if r["V"]:
            params[r["upstream"]] = r
    for r in rows:
        if r["downstream"]:
            model.add_function(r["downstream"], r["downstream"])
            model.add_coupling(r["upstream"], r["function_name"], r["downstream"], r["aspect"])
    return model, params


def read_zinetullina() -> tuple[FramModel, list[dict[str, str]]]:
    """Zinetullina et al. 2021 Table 5: coupling id, downstream, aspect, upstream."""
    model = FramModel("zinetullina_2021_separator")
    rows = _rows(MODELS / "zinetullina_2021_separator_couplings.csv")
    aspect = {"Input": "I", "Precondition": "P", "Resource": "R", "Control": "C", "Time": "T"}
    for r in rows:
        model.add_function(r["upstream"], r["upstream"])
        model.add_function(r["downstream"], r["downstream"])
        model.add_coupling(r["upstream"], r["upstream"], r["downstream"], aspect[r["aspect"]])
    return model, rows


def library_models() -> list[Path]:
    return sorted(LIBRARY.rglob("*.xfmv"))


def grabbe_path() -> Path:
    return MODELS / "grabbe_2022_overtaking.xfmv"


def grabbe_risk_functions() -> list[dict[str, str]]:
    return _rows(LOCAL / "grabbe_2022_table_a4.csv")
