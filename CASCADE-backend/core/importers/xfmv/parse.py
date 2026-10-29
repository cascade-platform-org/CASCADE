# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Cristian Curaba
"""
core/importers/xfmv/parse.py — an FMV (FRAM Model Visualiser) `.xfmv` file →
FramModel (ADR-0026).

FMV writes two layouts, and both are read:

- **Drawn couplings.** An <Aspects> list holds one <Aspect> per coupling; its
  <Name> is `outputFn|output text|toFn|TYPE`, and the text may itself contain
  '|', so the first and the last two fields are split off.
- **Aspects as texts.** <Aspects/> is empty and each function's aspects are
  listed by text (<Outputs>, <Inputs>, <Preconditions>, <Resources>,
  <Controls>, <Times>, each entry naming its function). FMV draws a coupling
  wherever an Output's text equals another function's aspect text, and so does
  this parser.

Some FMV versions write cp1252 bytes under an XML declaration that names no
encoding; such a file is decoded as cp1252. The XML is parsed with defusedxml,
because the file is user input.
"""
from __future__ import annotations

from xml.etree.ElementTree import Element  # nosec B405 - the type only; every parse goes through defusedxml

from defusedxml import DefusedXmlException
from defusedxml import ElementTree as SafeET

from core.importers.xfmv.model import FramModel

_ASPECT_LISTS = {"Inputs": "I", "Preconditions": "P", "Resources": "R", "Controls": "C", "Times": "T"}


class XfmvParseError(ValueError):
    """The file is not a readable FMV model."""


def parse_xfmv(data: bytes | str, name: str) -> FramModel:
    """Read an FMV file's functions, FMI profiles, positions and couplings."""
    root = _root(data)
    functions = root.find("Functions")
    if functions is None or len(functions) == 0:
        raise XfmvParseError("No <Functions> in the file: is it an FMV model?")
    model = FramModel(name)
    for f in functions:
        fid = (f.findtext("IDNr") or "").strip()
        if not fid:
            continue
        fn = model.add_function(fid, (f.findtext("IDName") or "").strip() or f"Function {fid}",
                                background=(f.findtext("FunctionType") or "0").strip() == "2")
        fn.description = (f.findtext("Description") or "").strip()
        x, y = f.get("x"), f.get("y")
        if x is not None and y is not None:
            try:
                fn.position = (float(x), float(y))
            except ValueError:
                pass
        for aspect in "IPRCT":
            value = f.get(f"profile{aspect}")
            if value and value != "All":
                fn.profiles[aspect] = value
    aspects = root.find("Aspects")
    for a in (aspects if aspects is not None else []):
        label = a.findtext("Name") or ""
        if "|" not in label:
            continue
        _, rest = label.split("|", 1)
        parts = rest.rsplit("|", 2)
        if len(parts) != 3:
            continue
        text, _, kind = parts
        src, dst = a.get("outputFn"), a.get("toFn")
        if src is None or dst is None or kind not in "IPRCT" or not kind:
            continue
        if src not in model.functions or dst not in model.functions:
            continue
        model.add_coupling(src, text.strip(), dst, kind)
    if aspects is None or len(aspects) == 0:
        _couple_by_text(root, model)
    return model


def _root(data: bytes | str) -> Element:
    try:
        if isinstance(data, bytes):
            try:
                data.decode("utf-8")
            except UnicodeDecodeError:
                data = data.decode("cp1252")
        return SafeET.fromstring(data)
    except SafeET.ParseError as exc:
        raise XfmvParseError(f"Not a well-formed FMV file: {exc}") from exc
    except DefusedXmlException as exc:
        raise XfmvParseError(f"Refused: the file declares XML entities or a DTD ({exc!r}).") from exc


def _couple_by_text(root: Element, model: FramModel) -> None:
    def entries(tag: str):
        listing = root.find(tag)
        for e in (listing if listing is not None else []):
            yield (e.findtext("IDName") or "").strip(), (e.findtext("FunctionIDNr") or "").strip()

    producers: dict[str, list[str]] = {}
    for text, fid in entries("Outputs"):
        producers.setdefault(text, []).append(fid)
    for tag, kind in _ASPECT_LISTS.items():
        for text, dst in entries(tag):
            for src in producers.get(text, []):
                if src in model.functions and dst in model.functions:
                    model.add_coupling(src, text, dst, kind)
