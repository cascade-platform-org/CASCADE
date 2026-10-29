"""
Export the paper's core cases as CASCADE projects, to check them in the platform.

Each bundle is the exact translation the results come from (the run scripts'
case builders), laid out by the importer's own layout, with:
  - the case's event as Disservice Events (fire them, then Propagate);
  - for a claim, its edit already applied (a function held nominal shows
    dependency level 1 on every input and no rule in the Inspector).
CHECKS.md beside the bundles says, for each one, what to fire and the levels
the scored functions should show after Propagate, with the paper's truth.

A bundle is a derivative of its source model, so it goes where the source's
licence allows: CASCADE-app/samples/public/fram/ for CC BY sources (tracked),
CASCADE-app/samples/private/fram/ for the rest (never tracked). Each folder
has its own CHECKS.md.

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/export_bundles.py
"""
from __future__ import annotations

import json

import run_rq1 as r1
import run_rq2 as r2
from core.importers.xfmv.map import layout
from framkit.engine import function_levels, propagate
from framkit.translate import Translated
from schemas.config import EventDefinition
from schemas.sync import ProjectBundle

SAMPLES = r1.readers.REPO / "CASCADE-app" / "samples"
OUT = {True: SAMPLES / "public" / "fram", False: SAMPLES / "private" / "fram"}


def bundle(model, t: Translated, name: str, events: dict[str, tuple[str, dict[str, int]]]) -> ProjectBundle:
    """`events`: id -> (label, {function id: level it imposes})."""
    n = len(t.config.functionality_scale)
    project = layout(model, t)
    nodes = dict(project.nodes)
    for eid, (_, imposed) in events.items():
        for fid, level in imposed.items():
            if level < n:
                node = nodes[t.fn_node[fid]]
                nodes[node.id] = node.model_copy(update={
                    "vulnerability_levels": {**(node.vulnerability_levels or {}), eid: n - level}})
    project = project.model_copy(update={"nodes": nodes, "meta": project.meta.model_copy(update={"name": name})})
    config = t.config.model_copy(update={"events": [
        EventDefinition(id=eid, label=label, type="disservice") for eid, (label, _) in events.items()]})
    return ProjectBundle(project=project, config=config)


def label(model, fid: str) -> str:
    return model.functions[fid].name


def expected(model, t: Translated, start: dict[str, int], fids: list[str]) -> str:
    lv = function_levels(t, propagate(t, {t.fn_node[f]: v for f, v in start.items()}))
    names = {lv_.level: lv_.label for lv_ in t.config.functionality_scale}
    return "; ".join(f"{f} {label(model, f)}: **{lv[f]}** ({names[lv[f]]})" for f in fids)


def main() -> None:
    header = ["# Checking the core cases in the platform",
              "",
              "Open a bundle (File → Open), fire the listed Event(s) from the Action Bar, press Propagate, and read the "
              "levels of the listed functions (Inspector, or the node colours). Expected levels come from the same "
              "translation the paper's results use; truth is the source paper's. Written by "
              "`experiments/fram/export_bundles.py`.",
              ""]
    sheets = {public: list(header) for public in OUT}

    def write(slug: str, model, b: ProjectBundle, fire: str, check: str, truth: str) -> None:
        public = model.name in r1.readers.REDISTRIBUTABLE
        OUT[public].mkdir(parents=True, exist_ok=True)
        (OUT[public] / f"{slug}.json").write_text(json.dumps(b.model_dump(mode="json", exclude_none=True), indent=1))
        sheets[public].extend([f"## `{slug}.json` — {b.project.meta.name}", "", f"- **Fire:** {fire}",
                               f"- **Expect:** {check}", f"- **Truth:** {truth}", ""])

    # --- RQ1 -------------------------------------------------------------------------
    m, t, start = r2.zheng_case()
    truth = r1.readers.zheng_judgements()
    neg = [k for k, j in truth.items() if j == "negative"]
    pos = [k for k, j in truth.items() if j == "positive"]
    write("rq1_zheng", m, bundle(m, t, "Zheng 2024 (RQ1)", {"ev": ("Earthquake: communications, firefighters, F5 one-way", start)}),
          "Earthquake", expected(m, t, start, neg + pos),
          f"Table 2: negative {', '.join(neg)}; positive {', '.join(pos)} (v2 misses F18, F19: their staff adapt)")

    m, t, _ = r2.tian_case()
    events = {"f7v": ("F7 door-closing variable (3)", {"F7": 3}), "f7s": ("F7 door-closing severe (2)", {"F7": 2}),
              "bosun": ("Bosun absent (F2 not performed)", {"F2": 1}), "order": ("No order to close the door (F3 not performed)", {"F3": 1})}
    write("rq1_tian", m, bundle(m, t, "Tian 2016 (RQ1, C2)", events),
          "F7 variable (with and without Bosun absent); then F7 severe",
          expected(m, t, {"F7": 3, "F1": 4}, ["F2", "F5", "F8"]) + " — for F7 variable, bosun present",
          "violation (F2, F5, F8 all degraded) whenever F7 < 4, bosun present or absent; none at F7 = 4")

    for shared in (False, True):
        m = r1.smith_model(shared)
        t = r1.smith_translation(shared)
        events = {e.lower(): (f"{e} {label(m, e)} fails", {e: 1}) for e in r1.SMITH_EVENTS}
        write("rq1_smith" + ("_shared_sensor" if shared else ""), m,
              bundle(m, t, "Smith 2017 / Khakzad 2011" + (" + shared sensor (C13)" if shared else " (RQ1)"), events),
              "any combination of the five failures",
              "S1 is not performed exactly when an automatic element (S8, S9, S6 or S3) fails AND S2 fails"
              + ("; with the shared sensor, S8 alone also disables the alarm branch" if shared else ""),
              "fault tree top event 0.2720" + (" → 0.3756 with the shared sensor" if shared else ""))

    m, t, start = r2.wenzhou_case([])
    write("rq1_wenzhou", m, bundle(m, t, "Wenzhou 2011 (RQ1, held out)", {"ev": ("Lightning: M7, M10 not performed", start)}),
          "Lightning", expected(m, t, start, r1.WZ_DEGRADED + r1.WZ_NOMINAL),
          f"accident report: degraded {', '.join(r1.WZ_DEGRADED)}; uninvolved {', '.join(r1.WZ_NOMINAL)}")

    m, t, start = r2.koriyama_case([])
    write("rq1_koriyama", m, bundle(m, t, "Koriyama 2019 (RQ1, held out)", {"ev": ("Typhoon Hagibis: alerts, environment, night, 119 calls", start)}),
          "Typhoon Hagibis", expected(m, t, start, ["T5", "T6", "T9", "T3", "T4", "T7", "T8"]),
          "Fig. 6: T5, T6, T9 resonated; T7, T8 contained; T3, T4 uninvolved")

    # --- RQ2 claims: the edit applied, the case's event to fire ------------------------
    claims = [
        ("c1_tian_door_fixed", "C1", r2.tian_case(barrier_f2=True), ["F5", "F8"], "stays degraded"),
        ("c4_koriyama_preparation", "C4", r2.koriyama_case(["T5"]), ["T6"], "T6 improves"),
        ("c5_koriyama_communication", "C5", r2.koriyama_case(["T1", "T2"]), ["T5", "T6", "T9"], "improve"),
        ("c6_koriyama_evacuation", "C6", r2.koriyama_case(["T6"]), ["T9"], "T9 improves"),
        ("c8_zheng_two_way_updates", "C8", r2.zheng_case("C8"), ["F7", "F9", "F10", "F11", "F12"], "improve"),
        ("c9_zheng_cancel_f5_mutual_aid", "C9", r2.zheng_case("C9"), ["F20"], "F20 nominal"),
        ("c10_wenzhou_alternative_channel", "C10", r2.wenzhou_case(["M10"]), ["M20"], "M20 nominal"),
        ("c12_wenzhou_barriers", "C12", r2.wenzhou_case(["M5", "M7", "M8", "M10"]), ["M20"], "M20 nominal"),
    ]
    quotes = {r["id"]: r for r in r2.claims()}
    for slug, cid, (m, t, start), outcome, direction in claims:
        write(slug, m, bundle(m, t, f"{cid}: {quotes[cid]['claim'][:60]}…", {"ev": ("The case's event, minus what the edit removes", start)}),
              "the Event, then compare with the matching rq1_ bundle",
              expected(m, t, start, outcome) + f" — verdict in the paper: **{quotes[cid]['verdict']}**",
              f"the claim says: {direction}")

    for public, sheet in sheets.items():
        if len(sheet) > len(header):
            (OUT[public] / "CHECKS.md").write_text("\n".join(sheet))
            print(f"wrote {len(sheet[len(header):]) // 6} bundles and CHECKS.md to {OUT[public]}")


if __name__ == "__main__":
    main()
