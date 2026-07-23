"""Tests for the EPANET .inp importer (core/importers/inp/, api/import_routes).

A small synthetic network exercises every mapping rule deterministically:

      R1 ──pump P1──▶ J1 ──pipe A──▶ J2 (demand)
                       │
      T1 ──pipe B──────┘        J2 ──valve V1──▶ J3 (demand)

Real aqueduct files live in raw-networks/ (untracked); the tests that use them
skip when absent so CI stays self-contained.
"""
from __future__ import annotations

import math
from pathlib import Path

import pytest

from core.importers.inp import ImportOptions, InpParseError, build_bundle, load_inp

RAW = Path(__file__).resolve().parents[2] / "raw-networks" / "aqueducts"

SYNTHETIC_INP = """
[TITLE]
Synthetic import test net

[JUNCTIONS]
;ID   Elev   Demand  Pattern
 J1   100    0
 J2   95     10      pat1
 J3   90     5

[RESERVOIRS]
;ID   Head
 R1   200

[TANKS]
;ID  Elevation InitLevel MinLevel MaxLevel Diameter MinVol VolCurve
 T1  150       5         0        10       10       0

[PIPES]
;ID  Node1 Node2 Length Diameter Roughness MinorLoss Status
 A   J1    J2    1000   300      100       0         Open
 B   T1    J1    500    200      100       0         Open

[PUMPS]
;ID  Node1 Node2 Parameters
 P1  R1    J1    HEAD curve1

[VALVES]
;ID  Node1 Node2 Diameter Type Setting MinorLoss
 V1  J2    J3    150      PRV  50      0

[PATTERNS]
 pat1  1.0  2.0  0.5

[CURVES]
 curve1  30  80

[COORDINATES]
 J1  100  100
 J2  200  100
 J3  300  100
 R1  0    100
 T1  100  200

[OPTIONS]
 Units  LPS

[END]
"""


@pytest.fixture()
def bundle_and_warnings():
    wn = load_inp(SYNTHETIC_INP)
    warnings: list[str] = []
    bundle = build_bundle(wn, name="synthetic", warnings=warnings)
    return bundle, warnings


def test_rejects_non_inp_text():
    with pytest.raises(InpParseError):
        load_inp('{"this is": "json, not inp"}')


def test_node_and_edge_mapping(bundle_and_warnings):
    bundle, _ = bundle_and_warnings
    nodes, edges = bundle.project.nodes, bundle.project.edges

    # 5 wn nodes + inline pump + inline valve
    assert len(nodes) == 7
    # pipes A,B + 2 pump halves + 2 valve halves
    assert len(edges) == 6

    assert nodes["R1"].node_type == "Source"
    assert nodes["R1"].supply_capacity is not None
    assert nodes["T1"].node_type == "Source"
    assert nodes["J1"].node_type == "Infrastructure"  # zero demand
    assert nodes["J2"].node_type == "Service"
    assert nodes["J3"].node_type == "Service"

    # every water-path node declares "water" (flow pass only routes members)
    assert all("water" in (node.node_categories or []) for node in nodes.values())

    pump = nodes["pump_P1"]
    assert pump.node_categories == ["water", "pumping"]
    valve = nodes["valve_V1"]
    assert valve.node_categories == ["water", "valve"]


def test_demand_modes():
    wn = load_inp(SYNTHETIC_INP)
    peak = build_bundle(wn, name="p", options=ImportOptions(demand_mode="peak"))
    base = build_bundle(wn, name="b", options=ImportOptions(demand_mode="base"))
    peak_d = peak.project.nodes["J2"].category_dependency_profiles["water"].demand
    base_d = base.project.nodes["J2"].category_dependency_profiles["water"].demand
    # pattern multipliers [1, 2, 0.5] → peak = 2 × base
    assert peak_d == pytest.approx(2 * base_d)
    # LPS → SI 0.01 m³/s → FLOW_UNIT_SCALE (×1e6, see core/importers/inp/map.py) = 10000
    assert base_d == pytest.approx(10_000.0)


def test_negative_demand_junction_becomes_source():
    """Regression (found on Net2, whose ONLY real source is a -43.8 L/s
    junction — the EPANET well/inflow idiom): a junction with net negative
    demand must import as a Source supplying its injection rate, not as inert
    Infrastructure — the old `demand > 0` mapping silently deleted the
    network's supply and left most consumers permanently critical."""
    well_inp = SYNTHETIC_INP.replace(" J3   90     5", " J3   90     -8")
    wn = load_inp(well_inp)
    warnings: list[str] = []
    bundle = build_bundle(wn, name="well", warnings=warnings)
    j3 = bundle.project.nodes["J3"]
    assert j3.node_type == "Source"
    assert j3.category_dependency_profiles is None  # no demand profile
    # supply = |injection| in flow units: 8 L/s → 0.008 m³/s × 1e6
    assert j3.supply_capacity["water"] == pytest.approx(8_000.0)
    assert j3.properties["kind"] == "injection_well"
    assert any("negative demand" in w for w in warnings)


def test_functionality_scale_is_settable():
    """n_levels is a real knob, not the old hardcoded constant: every node's
    functionality and every profile's dependency_level must be expressed on
    whatever scale size was requested, and the emitted config's own
    functionality_scale must have exactly that many levels."""
    wn = load_inp(SYNTHETIC_INP)
    bundle = build_bundle(wn, name="t", options=ImportOptions(n_levels=5))

    assert len(bundle.config.functionality_scale) == 5
    assert [lvl.level for lvl in bundle.config.functionality_scale] == [1, 2, 3, 4, 5]
    assert bundle.project.nodes["R1"].functionality == 5  # fully-operational == n
    j2_profile = bundle.project.nodes["J2"].category_dependency_profiles["water"]
    assert j2_profile.dependency_level == 5


def test_generate_scale_matches_app_default_at_n3():
    """n_levels == 3 (the default) must reproduce the app's own hardcoded
    default scale exactly — labels and colors both — since that is the scale
    every hand-authored project already uses."""
    from core.importers.inp import generate_scale

    scale = generate_scale(3)
    assert [(lvl.level, lvl.label, lvl.color) for lvl in scale] == [
        (1, "critical", "#ef4444"),
        (2, "operational_warning", "#f97316"),
        (3, "operational", "#22c55e"),
    ]


def test_generate_scale_other_sizes():
    from core.importers.inp import generate_scale

    two = generate_scale(2)
    assert [lvl.label for lvl in two] == ["critical", "operational"]

    four = generate_scale(4)
    assert [lvl.label for lvl in four] == [
        "critical", "degraded (2/4)", "degraded (3/4)", "operational",
    ]
    # Every level gets a distinct, valid hex color.
    assert len({lvl.color for lvl in four}) == 4
    assert all(len(lvl.color) == 7 and lvl.color.startswith("#") for lvl in four)


def test_demand_survives_engine_fixed_point_rounding():
    """Regression: the engine's SourceToDemands flow heuristic
    (engine/flow.py `_scaled`) converts every quantity via
    `round(value * 1000)` for its integer min-cost-flow solver. Real water
    demand in SI units (m³/s) is tiny — on a real aqueduct export
    (Cassacco_totale.inp) EVERY SINGLE one of its 410 demand-bearing
    junctions rounded to exactly 0 under that conversion, meaning every
    consumer's demand-sink edge had zero capacity — no flow could ever reach
    ANY of them regardless of actual supply, so Propagation showed the
    entire network permanently critical. FLOW_UNIT_SCALE rescales demand /
    supply_capacity / edge capacity (uniformly, so their ratios — all that
    the engine's flow heuristic cares about — are unaffected) before they're
    written into the model, so even a tiny realistic demand survives the
    engine's fixed-point resolution."""
    from engine.flow import _scaled

    tiny_demand_inp = SYNTHETIC_INP.replace(
        " J2   95     10      pat1", " J2   95     0.03    pat1"
    )  # 0.03 L/s = 3e-5 m³/s — Cassacco's real magnitude
    wn = load_inp(tiny_demand_inp)
    bundle = build_bundle(wn, name="tiny", options=ImportOptions(demand_mode="base"))
    demand = bundle.project.nodes["J2"].category_dependency_profiles["water"].demand
    assert demand > 0
    assert _scaled(demand) > 0  # must NOT round away to zero


def test_source_supply_reservoir_unbounded_pumpfed_tank_pipe_limited(bundle_and_warnings):
    """Supply by source TYPE (2026-07-23 model):
      - a RESERVOIR is fixed-head / near-infinite, so supply_capacity is
        UNBOUNDED_SUPPLY_FALLBACK — the outlet pipe, not the source, is the limit.
      - a PUMP-FED tank (a reservoir reaches it ONLY across a pump) is a
        PASS-THROUGH: the pump keeps it full, so its supply is its incident-pipe
        capacity, not a nominal cap. In the synthetic net R1 reaches T1 only
        through pump P1, so T1 is pump-fed and its supply equals pipe B's
        capacity (see `test_gravity_tank_supply_is_nominal_outflow` for the
        gravity/nominal path)."""
    from core.importers.inp import UNBOUNDED_SUPPLY_FALLBACK
    from core.importers.inp.sim import pump_fed_tanks

    bundle, _ = bundle_and_warnings
    assert bundle.project.nodes["R1"].supply_capacity["water"] == UNBOUNDED_SUPPLY_FALLBACK
    assert pump_fed_tanks(load_inp(SYNTHETIC_INP)) == {"T1"}
    t1_supply = bundle.project.nodes["T1"].supply_capacity["water"]
    b_capacity = bundle.project.edges["e_B"].capacity  # T1's only incident pipe
    assert t1_supply == pytest.approx(b_capacity)


# Gravity net: reservoir R reaches tank T through pipes alone (no pump), so T is
# terminal storage — the gravity/nominal supply path and the classifier's other
# branch. J1/J2 draw demand; T and R both feed J1.
GRAVITY_TANK_INP = """
[TITLE]
Gravity tank test net
[JUNCTIONS]
 J1   50   5
 J2   40   8
[RESERVOIRS]
 R    100
[TANKS]
 T    80   5   0   10   10   0
[PIPES]
 PR   R    J1   500   300   100   0   Open
 PT   T    J1   500   200   100   0   Open
 PJ   J1   J2   500   250   100   0   Open
[COORDINATES]
 J1  100  100
 J2  200  100
 R   0    100
 T   100  200
[OPTIONS]
 Units  LPS
[END]
"""


def test_gravity_tank_supply_is_nominal_outflow():
    """A tank a reservoir reaches through PIPES (no pump) is gravity-fed terminal
    storage: `pump_fed_tanks` leaves it out, so its supply is its NOMINAL
    delivered outflow — a tighter bound than the over-sized incident-pipe
    capacity a pass-through tank would get."""
    from core.importers.inp import UNBOUNDED_SUPPLY_FALLBACK
    from core.importers.inp.sim import pump_fed_tanks

    wn = load_inp(GRAVITY_TANK_INP)
    assert pump_fed_tanks(wn) == set()  # R reaches T via pipes → gravity-fed
    bundle = build_bundle(wn, name="grav")
    assert bundle.project.nodes["R"].supply_capacity["water"] == UNBOUNDED_SUPPLY_FALLBACK
    t_supply = bundle.project.nodes["T"].supply_capacity["water"]
    pt_capacity = bundle.project.edges["e_PT"].capacity  # T's incident pipe
    # Nominal outflow: finite, positive, and strictly below the over-sized pipe.
    assert 0 < t_supply < UNBOUNDED_SUPPLY_FALLBACK
    assert t_supply < pt_capacity


def test_isolated_tank_supply_falls_back_without_a_capacitated_pipe():
    """A TANK with no incident link has no outgoing pipe capacity to derive
    supply from — falls back to UNBOUNDED_SUPPLY_FALLBACK with a warning,
    never crashes or zeroes out. T1 is pump-fed (per
    `test_source_supply_reservoir_unbounded_pumpfed_tank_pipe_limited`), so
    isolating it exercises `_pipe_supply`'s own fallback directly, without
    ever consulting `tank_nominal` — a GRAVITY tank falling back from a
    zero/missing nominal outflow to `_pipe_supply` is a separate code path
    this test does not cover.
    (Reservoirs are UNBOUNDED unconditionally and never reach this path.)"""
    from core.importers.inp import UNBOUNDED_SUPPLY_FALLBACK

    wn = load_inp(SYNTHETIC_INP)
    wn.remove_link("B")  # T1's only connection — now fully isolated
    warnings: list[str] = []
    bundle = build_bundle(wn, name="t", warnings=warnings)
    assert bundle.project.nodes["T1"].supply_capacity["water"] == UNBOUNDED_SUPPLY_FALLBACK
    assert any("no capacitated outgoing pipe" in w for w in warnings)


def test_pipe_capacity_uses_simulated_velocity_not_a_constant():
    """Regression: pipe capacity used to come from ONE global assumed
    velocity (design_velocity, now removed) applied uniformly to every pipe.
    It is now derived per-pipe from a demand-multiplier sweep
    (core.importers.inp.sim.link_flow_profiles, the highest velocity each
    link reaches under stress — its velocity at rest would understate real
    capacity) — different pipes in the same network must be able to end up
    with different capacities even at the same diameter, because they carry
    different simulated flow."""
    from core.importers.inp import FALLBACK_VELOCITY_MS, compute_junction_demands, link_flow_profiles

    wn = load_inp(SYNTHETIC_INP)
    demands = compute_junction_demands(wn, "peak")
    profiles = link_flow_profiles(wn, demands, steps=4)
    assert profiles  # the synthetic network's sweep must produce results

    bundle = build_bundle(wn, name="t", flow_profiles=profiles)
    edge_a = bundle.project.edges["e_A"]  # pipe J1->J2, diameter 300mm
    # Pipe T1->J1 (200mm) genuinely reverses across the 1x->8x stress sweep
    # (the tank recharges at light load, discharges once demand outgrows the
    # pump — real, demand-magnitude-driven behaviour, not sensor noise), so it
    # is correctly split into two edges rather than staying "e_B".
    assert "e_B" not in bundle.project.edges
    edge_b_fwd = bundle.project.edges["e_B__fwd"]
    # Not using the removed constant: at least one pipe's derived velocity
    # differs from the old flat default, proving it came from the simulation.
    assert any(abs(p.peak - FALLBACK_VELOCITY_MS) > 1e-6 for p in profiles.values())
    assert edge_a.capacity is not None and edge_b_fwd.capacity is not None
    # Capacity from the ACTUAL simulated velocity, not FALLBACK_VELOCITY_MS.
    fallback_a = math.pi / 4.0 * 0.300**2 * FALLBACK_VELOCITY_MS * 1_000_000.0
    assert edge_a.capacity != pytest.approx(fallback_a)


def test_flow_profiles_missing_returns_default_capacity():
    """No `flow_profiles` passed (e.g. a caller that skips the velocity
    sweep) — every pipe falls back to FALLBACK_VELOCITY_MS, never crashes or
    zeroes capacity out."""
    from core.importers.inp import FALLBACK_VELOCITY_MS
    from core.importers.inp.map import DEFAULT_CAPACITY_MARGIN

    wn = load_inp(SYNTHETIC_INP)
    bundle = build_bundle(wn, name="t")  # flow_profiles omitted
    edge_a = bundle.project.edges["e_A"]
    # diameter 300mm (J1->J2 pipe "A" in SYNTHETIC_INP), fallback velocity
    expected = math.pi / 4.0 * 0.300**2 * FALLBACK_VELOCITY_MS * DEFAULT_CAPACITY_MARGIN * 1_000_000.0
    assert edge_a.capacity == pytest.approx(expected, rel=1e-3)


def test_capacity_margin_knob_scales_capacity_linearly():
    """The `capacity_margin` ImportOptions knob multiplies every derived
    pipe/valve capacity linearly (default 2.0) — a first-class per-import
    parameter, not a hardcoded constant. Quadrupling it quadruples capacity.
    The `max_velocity` ceiling is disabled here (None) so it can't clamp the
    high-margin case and hide the linearity — the clamp itself is exercised by
    `test_max_velocity_caps_capacity_and_default_is_3ms`."""
    from core.importers.inp import ImportOptions

    wn = load_inp(SYNTHETIC_INP)
    cap_1 = build_bundle(
        wn, name="t", options=ImportOptions(capacity_margin=1.0, max_velocity=None)
    ).project.edges["e_A"].capacity
    cap_4 = build_bundle(
        wn, name="t", options=ImportOptions(capacity_margin=4.0, max_velocity=None)
    ).project.edges["e_A"].capacity
    assert cap_1 is not None and cap_4 is not None
    assert cap_4 == pytest.approx(4.0 * cap_1, rel=1e-6)


def test_max_velocity_caps_capacity_and_default_is_3ms():
    """`max_velocity` clamps the margined pipe velocity to a physical ceiling,
    so a large margin can't imply an unphysically fast pipe. The DEFAULT is
    3.0 m/s (the water-main design ceiling, matching the ground-truth
    velocity-exceedance flag); max_velocity=None disables the cap (legacy
    pre-2026-07 behaviour)."""
    import math

    from core.importers.inp import ImportOptions

    wn = load_inp(SYNTHETIC_INP)
    # fallback velocity 1.0 m/s × margin 4.0 = 4.0 m/s margined, above the 3.0 ceiling.
    capped_default = build_bundle(
        wn, name="t", options=ImportOptions(capacity_margin=4.0)
    ).project.edges["e_A"].capacity
    capped_explicit = build_bundle(
        wn, name="t", options=ImportOptions(capacity_margin=4.0, max_velocity=3.0)
    ).project.edges["e_A"].capacity
    uncapped = build_bundle(
        wn, name="t", options=ImportOptions(capacity_margin=4.0, max_velocity=None)
    ).project.edges["e_A"].capacity
    assert capped_default is not None and uncapped is not None
    # The default reproduces the explicit 3.0 ceiling, and both cap below uncapped.
    assert capped_default == pytest.approx(capped_explicit)
    assert capped_default < uncapped
    # Capped capacity is exactly area × 3.0 m/s × 1e6 (velocity pinned to the ceiling).
    area = math.pi / 4.0 * 0.300**2
    assert capped_default == pytest.approx(area * 3.0 * 1_000_000.0, rel=1e-6)


def test_orientation_trusts_simulated_direction_over_bfs():
    """A pipe with a clear single simulated direction is oriented by that
    sign, not BFS depth — regression guard for the old "orientation is a
    pure graph-distance guess" behaviour. Pipe A (J1->J2 in the .inp) is
    downstream of R1's pump; the sweep must show real forward flow J1->J2."""
    from core.importers.inp import compute_junction_demands, link_flow_profiles

    wn = load_inp(SYNTHETIC_INP)
    demands = compute_junction_demands(wn, "peak")
    profiles = link_flow_profiles(wn, demands, steps=4)
    profile_a = profiles["A"]
    assert profile_a.velocity_fwd > profile_a.velocity_rev
    assert not profile_a.bidirectional

    bundle = build_bundle(wn, name="t", flow_profiles=profiles)
    edge_a = bundle.project.edges["e_A"]
    assert (edge_a.source, edge_a.target) == ("J1", "J2")
    assert "direction" not in edge_a.properties


def test_bidirectional_pipe_becomes_two_edges():
    """A pipe the sweep reports meaningful flow in BOTH directions is split
    into two independently-capacitated edges instead of being forced onto one
    (possibly wrong) direction — the max-flow-min-cost engine solver handles
    two opposing capacitated arcs between the same pair of nodes without any
    special-casing (schemas.network.Edge has no undirected concept, so this
    is the only way to represent it)."""
    from core.importers.inp import LinkFlowProfile, build_bundle as _build_bundle

    wn = load_inp(SYNTHETIC_INP)
    # Force pipe A's profile into a clearly bidirectional shape (both
    # directions well above the noise floor) — deterministic, no need for a
    # real network topology that happens to reverse under stress.
    profiles = {"A": LinkFlowProfile(velocity_fwd=2.0, velocity_rev=1.0)}
    warnings: list[str] = []
    bundle = _build_bundle(wn, name="t", flow_profiles=profiles, warnings=warnings)

    assert "e_A" not in bundle.project.edges
    fwd, rev = bundle.project.edges["e_A__fwd"], bundle.project.edges["e_A__rev"]
    assert (fwd.source, fwd.target) == ("J1", "J2")
    assert (rev.source, rev.target) == ("J2", "J1")
    assert fwd.properties["direction"] == "forward"
    assert rev.properties["direction"] == "reverse"
    # FULL-DUPLEX (CONTEXT.md, ADR-0012 addendum): each direction carries
    # the pipe's WHOLE physical capacity — not a proportional share. A pipe
    # can carry all of it either way, just not both at once, and the flow
    # solver never gains from a cancelling two-way cycle.
    # peak velocity 2.0 m/s × default margin 2.0 = 4.0 m/s, clamped to the
    # default 3.0 m/s max_velocity ceiling → capacity = area × 3.0 × 1e6.
    full_cap = math.pi / 4.0 * 0.300**2 * 3.0 * 1_000_000.0
    assert fwd.capacity == pytest.approx(full_cap, rel=1e-6)
    assert rev.capacity == pytest.approx(full_cap, rel=1e-6)
    assert any("both directions" in w for w in warnings)


def test_unreachable_demand_node_warns():
    """A demand-bearing junction with no path from any Source after
    orientation is a real import defect, not a normal network property —
    surfaced as a warning instead of silently importing as permanently
    critical. Isolating J3 (only reachable via valve V1 from J2) reproduces
    this deterministically."""
    wn = load_inp(SYNTHETIC_INP)
    wn.remove_link("V1")
    warnings: list[str] = []
    build_bundle(wn, name="t", warnings=warnings)
    assert any("not reachable from any Source" in w for w in warnings)
    assert any("J3" in w for w in warnings)


def test_tank_backup_from_volume(bundle_and_warnings):
    bundle, _ = bundle_and_warnings
    profile = bundle.project.nodes["T1"].category_dependency_profiles["water"]
    assert profile.backup is True
    # volume = π/4·10²·10 ≈ 785 m³; downstream demand (J2 peak 0.02 + J3 0.005)
    # → ≈ 785 / 0.025 / 3600 ≈ 8.7 h
    assert 5 <= profile.backup_duration <= 12


def test_tank_reserve_disservice_event(bundle_and_warnings):
    """Every Tank with a backup profile is covered by ONE shared Disservice
    event that starts all their reserve countdowns together
    (functionality_time = backup_duration per tank) — a repeatable way to set
    up "the whole system lost its upstream feed" without reconstructing a
    whole upstream-failure chain, and without needing any engine change
    (attribute_mutations already supports overwriting any field,
    schemas/config.py)."""
    from core.importers.inp import TANK_RESERVE_EVENT_ID

    bundle, _ = bundle_and_warnings
    profile = bundle.project.nodes["T1"].category_dependency_profiles["water"]

    events = {e.id: e for e in bundle.config.events}
    assert TANK_RESERVE_EVENT_ID in events
    event = events[TANK_RESERVE_EVENT_ID]
    assert event.type == "disservice"  # no physical damage — the tanks are intact
    assert event.attribute_mutations == {"T1.functionality_time": profile.backup_duration}


def test_no_reserve_event_without_a_backup_profile():
    """A tank whose downstream has zero demand gets no backup profile (see
    build_bundle) — with no tank contributing a mutation, no reserve event is
    created at all (nothing to start a countdown from)."""
    from core.importers.inp import TANK_RESERVE_EVENT_ID

    no_demand_inp = SYNTHETIC_INP.replace(
        ' J2   95     10      pat1', ' J2   95     0'
    ).replace(' J3   90     5', ' J3   90     0')
    wn = load_inp(no_demand_inp)
    bundle = build_bundle(wn, name="t")
    assert bundle.project.nodes["T1"].category_dependency_profiles is None
    assert not any(e.id == TANK_RESERVE_EVENT_ID for e in bundle.config.events)


def test_blackout_hazard_targets_every_pump(bundle_and_warnings):
    """A pump is electrically driven — one shared Hazard event should carry
    full vulnerability on EVERY pump node in the imported network, so
    applying it fails them all at once (a real blackout, not a per-pump
    nuisance button). Uses the idiomatic vulnerability_levels +
    default_repair_time mechanism, not attribute_mutations — the schema
    itself says physical damage should not be expressed solely via
    attribute_mutations."""
    from core.importers.inp import BLACKOUT_EVENT_ID, DEFAULT_N_LEVELS

    bundle, _ = bundle_and_warnings
    events = {e.id: e for e in bundle.config.events}
    assert BLACKOUT_EVENT_ID in events
    event = events[BLACKOUT_EVENT_ID]
    assert event.type == "hazard"
    assert event.default_repair_time is not None and event.default_repair_time > 0
    assert event.attribute_mutations == {}  # damage carried by vulnerability_levels instead

    pump = bundle.project.nodes["pump_P1"]
    level = pump.vulnerability_levels[BLACKOUT_EVENT_ID]
    # Full vulnerability: imposed = max(1, N - level) must equal 1 (critical).
    # bundle_and_warnings uses the default ImportOptions (n_levels unset).
    assert max(1, DEFAULT_N_LEVELS - level) == 1

    # Non-pump nodes carry no vulnerability to this event.
    for nid, node in bundle.project.nodes.items():
        if nid != "pump_P1":
            assert not (node.vulnerability_levels or {}).get(BLACKOUT_EVENT_ID)


def test_blackout_absent_without_pumps():
    """A network with no pumps gets no blackout event — nothing for it to
    target."""
    no_pump_inp = SYNTHETIC_INP.replace(
        "[PUMPS]\n;ID  Node1 Node2 Parameters\n P1  R1    J1    HEAD curve1",
        "[PUMPS]\n;ID  Node1 Node2 Parameters",
    ).replace(
        "[PIPES]\n;ID  Node1 Node2 Length Diameter Roughness MinorLoss Status\n",
        "[PIPES]\n;ID  Node1 Node2 Length Diameter Roughness MinorLoss Status\n"
        " R1PIPE R1  J1    500    300      100       0         Open\n",
    )
    wn = load_inp(no_pump_inp)
    assert wn.pump_name_list == []  # confirms the substitution actually worked
    from core.importers.inp import BLACKOUT_EVENT_ID

    bundle = build_bundle(wn, name="t")
    assert not any(e.id == BLACKOUT_EVENT_ID for e in bundle.config.events)


def test_demand_surge_doubles_top_10_percent(bundle_and_warnings):
    """The surge event must double demand for the top 10% of demand-bearing
    junctions (rounded up to at least one) and leave everyone else alone."""
    bundle, _ = bundle_and_warnings
    events = {e.id: e for e in bundle.config.events}
    assert "evt-demand-surge-top10" in events
    event = events["evt-demand-surge-top10"]
    assert event.type == "disservice"

    # SYNTHETIC_INP has 2 demand-bearing junctions (J2, J3); top 10% rounds
    # up to 1 — only the highest-demand one (J2) should be mutated.
    assert set(k.split(".")[0] for k in event.attribute_mutations) == {"J2"}

    original = bundle.project.nodes["J2"].category_dependency_profiles["water"].demand
    surged = event.attribute_mutations["J2.category_dependency_profiles"]["water"]["demand"]
    assert surged == pytest.approx(2 * original)


def test_pump_capacity_from_curve(bundle_and_warnings):
    bundle, _ = bundle_and_warnings
    edges = bundle.project.edges
    # pump curve x = 30 L/s = 0.03 m³/s SI, × FLOW_UNIT_SCALE = 30000
    assert edges["e_P1__in"].capacity == pytest.approx(30_000.0)
    assert edges["e_P1__out"].capacity == pytest.approx(30_000.0)


def test_orientation_flows_source_to_demand(bundle_and_warnings):
    bundle, _ = bundle_and_warnings
    edges = bundle.project.edges
    # pipe B written T1→J1 in the file and T1 is a source: stays T1→J1
    assert (edges["e_B"].source, edges["e_B"].target) == ("T1", "J1")
    # pump halves flow R1 → pump → J1
    assert edges["e_P1__in"].source == "R1"
    assert edges["e_P1__out"].target == "J1"


def test_abstract_coordinates_stay_non_georeferenced(bundle_and_warnings):
    bundle, _ = bundle_and_warnings
    canvas = bundle.project.canvases[0]
    assert canvas.georeferenced is None
    assert canvas.geo_anchor is None
    assert all(node.position is not None for node in bundle.project.nodes.values())
    assert all(node.geo is None for node in bundle.project.nodes.values())


def test_canvas_id_unique_across_imports():
    """Two separate imports must never produce the same canvas id — merging
    both into one project (frontend 'add as extra canvas' mode) would
    otherwise silently collide the second import onto the first."""
    wn = load_inp(SYNTHETIC_INP)
    first = build_bundle(wn, name="t")
    second = build_bundle(wn, name="t")
    assert first.project.canvases[0].id != second.project.canvases[0].id


def test_bundle_serialises_null_free(bundle_and_warnings):
    """Same contract as Server Sync Load: `.optional()` Zod fields reject null."""
    bundle, _ = bundle_and_warnings
    import json

    def nulls(obj):
        if isinstance(obj, dict):
            return sum((v is None) + nulls(v) for v in obj.values())
        if isinstance(obj, list):
            return sum(nulls(v) for v in obj)
        return 0

    assert nulls(json.loads(bundle.model_dump_json(exclude_none=True))) == 0


PBV_CHAIN_INP = """
[JUNCTIONS]
 J1  100  0
 J2  95   0
 J3  90   0
 J4  85   0
 J5  80   10

[RESERVOIRS]
 R1  200

[PIPES]
 A  R1  J1  200  300  100  0  Open
 B  J2  J3  200  200  100  0  Open
 C  J3  J4  200  200  100  0  Open
 D  J4  J5  200  200  100  0  Open

[VALVES]
;ID  Node1 Node2 Diameter Type Setting MinorLoss
 V1  J1    J2    150      PBV  10      0

[COORDINATES]
 R1  0    0
 J1  100  0
 J2  200  0
 J3  300  0
 J4  400  0
 J5  500  0

[OPTIONS]
 Units  LPS

[END]
"""


def test_skeletonize_handles_pbv_valve():
    """Regression: WNTR's pure-Python WNTRSimulator raises an uncaught
    NotImplementedError on PBV/GPV valves, and `wntr.morph.skeletonize`
    internally runs a hydraulic solve to decide merge directions — so any
    network with one of these common real-world valve types crashed
    skeletonization outright (observed on a real aqueduct export). The fix
    runs skeletonization with `use_epanet=True` (the real EPANET toolkit,
    which supports the full valve vocabulary)."""
    from core.importers.inp import skeletonize_to_target

    wn = load_inp(PBV_CHAIN_INP)
    assert wn.num_nodes == 6  # R1 + J1..J5
    reduced, merged_map, threshold = skeletonize_to_target(wn, 3)
    assert reduced.num_nodes <= 3
    assert threshold is not None


# --- real aqueduct files (skipped when raw-networks/ absent) -----------------

needs_cassacco = pytest.mark.skipif(
    not (RAW / "Cassacco_totale.inp").exists(),
    reason="raw-networks/aqueducts not present",
)


@needs_cassacco
def test_skeletonize_to_target_conserves_demand():
    from core.importers.inp import skeletonize_to_target

    wn = load_inp((RAW / "Cassacco_totale.inp").read_text(encoding="latin-1"))
    original_demand = sum(
        ts.base_value or 0
        for j in wn.junction_name_list
        for ts in wn.get_node(j).demand_timeseries_list
    )
    reduced, merged_map, threshold = skeletonize_to_target(wn, 100)
    assert reduced.num_nodes <= 100
    assert threshold is not None
    assert merged_map  # something was absorbed
    reduced_demand = sum(
        ts.base_value or 0
        for j in reduced.junction_name_list
        for ts in reduced.get_node(j).demand_timeseries_list
    )
    assert reduced_demand == pytest.approx(original_demand, rel=1e-6)


@needs_cassacco
def test_projected_coordinates_georeference():
    wn = load_inp((RAW / "Cassacco_totale.inp").read_text(encoding="latin-1"))
    bundle = build_bundle(wn, name="cassacco")
    canvas = bundle.project.canvases[0]
    assert canvas.georeferenced is True
    anchor = canvas.geo_anchor
    assert anchor is not None
    # Cassacco is in Friuli, Italy (EPSG:3004 default CRS)
    assert 12.5 < anchor.geo.lng < 14.0
    assert 45.5 < anchor.geo.lat < 46.8


@needs_cassacco
def test_scarcity_priorities_spread():
    from core.importers.inp import compute_junction_demands
    from core.importers.inp import scarcity_priorities

    wn = load_inp((RAW / "Cassacco_totale.inp").read_text(encoding="latin-1"))
    demands = compute_junction_demands(wn, "peak")
    priorities = scarcity_priorities(wn, demands, steps=6)
    assert priorities  # sweep produced a ranking
    values = set(priorities.values())
    assert values <= set(range(1, 11))
    assert len(values) >= 2  # not everything identical
