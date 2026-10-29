"""The FMV (.xfmv) FRAM importer (ADR-0026): parse both FMV layouts, convert
with a declared semantics, lay out, and serve it at POST /api/import/xfmv."""
from __future__ import annotations

import httpx
import pytest
from httpx import ASGITransport

from auth.dependencies import get_current_user
from core.importers.xfmv import XfmvParseError, build_bundle, parse_xfmv
from engine.propagation import run
from schemas.auth import AuthUser
from schemas.results import PropagationRequest

# Drawn-coupling layout: one <Aspect> per coupling. A -> B -> C, and A also
# feeds C, so C has two distinct inputs.
DRAWN = """<?xml version="1.0" standalone="yes"?>
<FM>
  <Functions>
    <Function x="10" y="20"><IDNr>0</IDNr><FunctionType>0</FunctionType><IDName>Dispatch crew</IDName>
      <Description>The centre sends a crew.</Description></Function>
    <Function x="200" y="20"><IDNr>1</IDNr><FunctionType>0</FunctionType><IDName>Drive to site</IDName></Function>
    <Function x="400" y="20" profileI="Any"><IDNr>2</IDNr><FunctionType>0</FunctionType><IDName>Repair main</IDName></Function>
  </Functions>
  <Aspects>
    <Aspect outputFn="0" toFn="1"><Name>0|Crew dispatched|1|I</Name></Aspect>
    <Aspect outputFn="1" toFn="2"><Name>1|Crew on site|2|P</Name></Aspect>
    <Aspect outputFn="0" toFn="2"><Name>0|Crew dispatched|2|I</Name></Aspect>
  </Aspects>
</FM>"""

# Aspects-as-texts layout (<Aspects/> empty): FMV couples equal texts. Two
# functions produce "Water supplied", so they are alternatives for the pump.
TEXTS = """<?xml version="1.0" standalone="yes"?>
<FM>
  <Functions>
    <Function><IDNr>1</IDNr><FunctionType>0</FunctionType><IDName>Main supply</IDName></Function>
    <Function><IDNr>2</IDNr><FunctionType>0</FunctionType><IDName>Tank supply</IDName></Function>
    <Function><IDNr>3</IDNr><FunctionType>0</FunctionType><IDName>Run pump</IDName></Function>
  </Functions>
  <Aspects/>
  <Outputs>
    <Output><IDNr>1</IDNr><IDName>Water supplied</IDName><FunctionIDNr>1</FunctionIDNr></Output>
    <Output><IDNr>2</IDNr><IDName>Water supplied</IDName><FunctionIDNr>2</FunctionIDNr></Output>
  </Outputs>
  <Resources>
    <Resource><IDNr>1</IDNr><IDName>Water supplied</IDName><FunctionIDNr>3</FunctionIDNr></Resource>
    <Resource><IDNr>2</IDNr><IDName>Nobody produces this</IDName><FunctionIDNr>3</FunctionIDNr></Resource>
  </Resources>
</FM>"""


# --- parsing ----------------------------------------------------------------------


def test_drawn_couplings_functions_profiles_and_positions():
    m = parse_xfmv(DRAWN, "drawn")
    assert [f.name for f in m.functions.values()] == ["Dispatch crew", "Drive to site", "Repair main"]
    assert [(c.source, c.output, c.target, c.aspect) for c in m.couplings] == [
        ("0", "Crew dispatched", "1", "I"), ("1", "Crew on site", "2", "P"), ("0", "Crew dispatched", "2", "I")]
    assert m.functions["2"].profiles == {"I": "Any"}
    assert m.functions["0"].position == (10.0, 20.0)
    assert m.functions["0"].description == "The centre sends a crew."


def test_aspects_as_texts_are_coupled_by_equal_text():
    m = parse_xfmv(TEXTS, "texts")
    assert sorted((c.source, c.target, c.aspect) for c in m.couplings) == [("1", "3", "R"), ("2", "3", "R")]


def test_cp1252_bytes_are_decoded():
    data = TEXTS.replace("Main supply", "Rete idrica è attiva").encode("cp1252")
    assert parse_xfmv(data, "cp").functions["1"].name == "Rete idrica è attiva"


@pytest.mark.parametrize("text, message", [
    ("<FM><Functions></Functions></FM>", "No <Functions>"),
    ("<FM><Functions>", "well-formed"),
    ('<?xml version="1.0"?><!DOCTYPE FM [<!ENTITY x "boom">]><FM><Functions/></FM>', "entities or a DTD"),
])
def test_unreadable_files_are_refused(text, message):
    with pytest.raises(XfmvParseError, match=message):
        parse_xfmv(text, "bad")


# --- conversion -------------------------------------------------------------------


def test_v2_bundle_is_readable_and_uses_offsets():
    bundle = build_bundle(parse_xfmv(DRAWN, "drawn"))
    nodes = bundle.project.nodes
    assert nodes["fn_0"].label == "Dispatch crew"
    assert nodes["fn_0"].properties == {"description": "The centre sends a crew."}
    assert {nodes[n].label for n in nodes if n.startswith("o_")} == {"Crew dispatched", "Crew on site"}
    assert nodes["fn_2"].rules == [
        "worst_of(worst_of(crew_on_site, crew_dispatched) + 1, best_of(crew_on_site, crew_dispatched)) "
        "propagates to fn_2"]
    assert nodes["fn_1"].rules == ["worst_of(crew_dispatched) + 1 propagates to fn_1"]
    assert [lv.label for lv in bundle.config.functionality_scale] == ["not performed", "severe", "variable", "nominal"]
    assert bundle.project.canvases[0].graph.graph_type == "fram"
    assert nodes["fn_0"].position is not None and (nodes["fn_0"].position.x, nodes["fn_0"].position.y) == (10.0, 20.0)


def test_every_node_label_is_distinct():
    # Both supplies produce "Water supplied": two output nodes, one text.
    nodes = build_bundle(parse_xfmv(TEXTS, "texts")).project.nodes
    labels = [n.label for n in nodes.values()]
    assert len(labels) == len(set(labels))
    assert "Water supplied (output of Main supply)" in labels


def test_models_without_positions_are_laid_out_by_depth():
    nodes = build_bundle(parse_xfmv(TEXTS, "texts")).project.nodes
    xs = {nodes[n].label: nodes[n].position.x for n in ("fn_0", "fn_1", "fn_2") if nodes[n].position}
    assert xs["Main supply"] == xs["Tank supply"] < xs["Run pump"]


# FMV groups: a parent function collapses its children; groups nest. "Prepare"
# (0) holds 1, and "Respond" (2) holds 3, which holds 4: 4 belongs to its
# outermost group. 5 is ungrouped, 6 is a background function.
GROUPED = """<?xml version="1.0" standalone="yes"?>
<FM>
  <Functions>
    <Function><IDNr>0</IDNr><FunctionType>0</FunctionType><IDName>Prepare</IDName></Function>
    <Function><IDNr>1</IDNr><FunctionType>0</FunctionType><IDName>Brief crew</IDName></Function>
    <Function><IDNr>2</IDNr><FunctionType>0</FunctionType><IDName>Respond</IDName></Function>
    <Function><IDNr>3</IDNr><FunctionType>0</FunctionType><IDName>Drive</IDName></Function>
    <Function><IDNr>4</IDNr><FunctionType>0</FunctionType><IDName>Repair</IDName></Function>
    <Function><IDNr>5</IDNr><FunctionType>0</FunctionType><IDName>Report</IDName></Function>
    <Function><IDNr>6</IDNr><FunctionType>2</FunctionType><IDName>Weather</IDName></Function>
  </Functions>
  <Groups>
    <Group active="false"><FunctionIDNr>0</FunctionIDNr><CHILD>1</CHILD></Group>
    <Group active="false"><FunctionIDNr>3</FunctionIDNr><CHILD>4</CHILD></Group>
    <Group active="false"><FunctionIDNr>2</FunctionIDNr><CHILD>3</CHILD></Group>
  </Groups>
  <Aspects>
    <Aspect outputFn="0" toFn="1"><Name>0|Plan|1|I</Name></Aspect>
    <Aspect outputFn="1" toFn="3"><Name>1|Crew briefed|3|P</Name></Aspect>
    <Aspect outputFn="3" toFn="4"><Name>3|On site|4|I</Name></Aspect>
    <Aspect outputFn="4" toFn="5"><Name>4|Repaired|5|I</Name></Aspect>
    <Aspect outputFn="6" toFn="3"><Name>6|Visibility|3|C</Name></Aspect>
  </Aspects>
</FM>"""


def test_fmv_groups_take_the_outermost_parent():
    m = parse_xfmv(GROUPED, "grouped")
    assert {fid: f.group for fid, f in m.functions.items()} == {
        "0": "Prepare", "1": "Prepare", "2": "Respond", "3": "Respond", "4": "Respond", "5": "", "6": ""}


def test_groups_and_background_become_canvases():
    project = build_bundle(parse_xfmv(GROUPED, "grouped")).project
    canvases = {c.label: c.graph for c in project.canvases}
    assert list(canvases) == ["Prepare", "Respond", "Functions", "Background"]
    assert {project.nodes[n].label for n in canvases["Respond"].node_ids} == {
        "Respond", "Drive", "Repair", "On site", "Repaired"}
    assert {project.nodes[n].label for n in canvases["Background"].node_ids} == {"Weather", "Visibility"}
    # every element on a canvas; a crossing edge on both of its canvases, as the Inter-Canvas Edge tool does
    on = [i for g in canvases.values() for i in g.node_ids + g.edge_ids]
    assert set(project.nodes) | set(project.edges) <= set(on)
    briefed = next(e for e in project.edges.values()
                   if project.nodes[e.source].label == "Crew briefed" and project.nodes[e.target].label == "Drive")
    assert briefed.id in canvases["Prepare"].edge_ids and briefed.id in canvases["Respond"].edge_ids


def test_a_model_without_groups_or_background_keeps_one_canvas():
    assert len(build_bundle(parse_xfmv(DRAWN, "drawn")).project.canvases) == 1


def test_fmi_semantics_is_binary_and_reads_profiles():
    bundle = build_bundle(parse_xfmv(DRAWN, "drawn"), "fmi")
    assert len(bundle.config.functionality_scale) == 2
    assert bundle.project.nodes["fn_2"].rules is not None


def _propagate(bundle, levels: dict[str, int]) -> dict[str, int]:
    nodes = {nid: (n.model_copy(update={"functionality": levels[nid]}) if nid in levels else n)
             for nid, n in bundle.project.nodes.items()}
    project = bundle.project.model_copy(update={"nodes": nodes})
    result = run(PropagationRequest(project=project, config=bundle.config, scope="global"))
    out = {nid: n.functionality for nid, n in nodes.items()}
    out.update({u.id: u.functionality for u in result.updates if u.functionality is not None})
    return out


def test_v2_absorbs_one_level_per_hop_and_passes_coinciding_drops():
    bundle = build_bundle(parse_xfmv(DRAWN, "drawn"))
    lv = _propagate(bundle, {"fn_0": 1})
    # Drive to site loses one level less than dispatch; Repair main has both
    # inputs degraded (dispatch 1, on-site 2), so the second-worst (2) passes.
    assert (lv["fn_1"], lv["fn_2"]) == (2, 2)


def test_alternative_producers_keep_the_consumer_up():
    bundle = build_bundle(parse_xfmv(TEXTS, "texts"))
    assert _propagate(bundle, {"fn_0": 1})["fn_2"] == 4
    assert _propagate(bundle, {"fn_0": 1, "fn_1": 1})["fn_2"] == 2


# --- the endpoint -------------------------------------------------------------------


async def _post(body: dict) -> httpx.Response:
    from main import create_app

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        sub="u", email="u@x", display_name="U", roles=["editor"], db_id=None)
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        return await client.post("/api/import/xfmv", json=body)


async def test_endpoint_returns_a_bundle_and_counts():
    resp = await _post({"filename": "crew.xfmv", "content": DRAWN})
    assert resp.status_code == 200
    data = resp.json()
    assert (data["functions"], data["couplings"]) == (3, 3)
    assert data["bundle"]["project"]["meta"]["name"] == "crew"
    assert any("FMI profiles" in w for w in data["warnings"])


async def test_endpoint_rejects_a_malformed_file():
    resp = await _post({"filename": "x.xfmv", "content": "<FM><Functions>"})
    assert resp.status_code == 422
