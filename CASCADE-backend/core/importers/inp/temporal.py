"""
core/importers/inp/temporal.py — the EPANET importer for a Temporal Simulation
(ADR-0020 Consequences, ADR-0019).

Runs on the bundle `build_bundle` produced, so the published importer stays
exactly as it is (its benchmarks reproduce) and this one only adds:

  Tank          → storage: `supply_capacity["water"]` becomes a Stock with
                  `max_fill` (ADR-0020 §1c). Its level, min and max are the
                  tank's volumes at the initial, minimum and maximum levels;
                  `max_draw` is what its outlet pipes carry, `max_fill` what its
                  inlet pipes carry. A tank fills and drains through the same
                  pipes, so each of its pipes gets an edge in both directions.
                  No backup countdown and no reserve Event: the level is the
                  reserve now.
  [TIMES]       → one hourly Step per stretch of the run's duration.
  [PATTERNS]    → the profile: each consumer's demand, set in every hour it
                  changes (base demand × multiplier, the file's own timeseries).
  [CONTROLS]    → a time-based control (AT TIME, AT CLOCKTIME) becomes a
                  Temporal-Simulation-only Event in its hour, opening (top
                  Functionality) or closing (Functionality 1) its link.
                  Level-based controls and [RULES] are conditionals, which
                  v1.1 lacks; each is reported as skipped (a full tank already
                  stops taking water).

Units. A run's period is one hour, and Stock arithmetic is per period, so a
volume is written as the flow that would move it in one hour, in the
importer's flow units (`FLOW_UNIT_SCALE`): level = V / 3600 s × scale. Then a
period's delivery (a flow) and a level (a volume) subtract directly.

No Metrics and no hazards are added: those are the modeller's questions.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any

import wntr

from core.importers.inp.map import FLOW_UNIT_SCALE, TANK_RESERVE_EVENT_ID, _wn_node
from schemas.config import AttributeOperation, EventDefinition
from schemas.network import Edge, Stock
from schemas.sync import ProjectBundle
from schemas.temporal_simulation import Phase, PhaseEvent, Step, TemporalSimulation, Timeline

PERIOD_S = 3600  # one period = one hour (ADR-0019: the `hour` unit)


def _per_period(volume_m3: float) -> float:
    """A volume as the flow (in model flow units) that moves it in one period."""
    return round(volume_m3 / PERIOD_S * FLOW_UNIT_SCALE, 3)


def _tank_volume(tank: Any, level_m: float) -> float:
    return math.pi / 4.0 * tank.diameter**2 * level_m


def _tanks_to_storage(wn: wntr.network.WaterNetworkModel, bundle: ProjectBundle) -> None:
    project = bundle.project
    for tid in wn.tank_name_list:
        node = project.nodes.get(tid)
        if node is None:
            continue
        tank = _wn_node(wn, tid)
        # Each pipe of the tank carries water both ways: add any missing direction.
        for edge in [e for e in project.edges.values() if tid in (e.source, e.target)]:
            reverse_id = f"{edge.id}~rev"
            exists = any(e.source == edge.target and e.target == edge.source for e in project.edges.values())
            if not exists and reverse_id not in project.edges:
                project.edges[reverse_id] = Edge(
                    id=reverse_id, source=edge.target, target=edge.source, functionality=edge.functionality,
                    capacity=edge.capacity, properties={**(edge.properties or {}), "storage_return": True},
                )
                for canvas in project.canvases:
                    if edge.id in canvas.graph.edge_ids:
                        canvas.graph.edge_ids.append(reverse_id)
        out_cap = sum(_number(e.capacity) for e in project.edges.values() if e.source == tid)
        in_cap = sum(_number(e.capacity) for e in project.edges.values() if e.target == tid)
        node.supply_capacity = {
            "water": Stock(
                rate=0,
                level=_per_period(_tank_volume(tank, tank.init_level)),
                min=_per_period(_tank_volume(tank, tank.min_level)),
                max=_per_period(_tank_volume(tank, tank.max_level)),
                max_draw=round(out_cap, 3),
                max_fill=round(in_cap, 3),
            )
        }
        if node.category_dependency_profiles:
            node.category_dependency_profiles.pop("water", None)
            node.category_dependency_profiles = node.category_dependency_profiles or None
        node.functionality_time = None
        node.properties = {**(node.properties or {}), "storage": True}

    bundle.config.events = [e for e in bundle.config.events if e.id != TANK_RESERVE_EVENT_ID]
    for element in [*project.nodes.values(), *project.edges.values()]:
        if element.vulnerability_levels:
            element.vulnerability_levels.pop(TANK_RESERVE_EVENT_ID, None)


def _number(value: float | Stock | None) -> float:
    return value if isinstance(value, (int, float)) else 0.0


def _demand_profile(
    wn: wntr.network.WaterNetworkModel,
    bundle: ProjectBundle,
    merged_map: dict[str, list[str]],
    labels: list[str],
) -> dict[str, list[AttributeOperation]]:
    """Each consumer's demand in every hour it changes, from the file's own timeseries."""
    profile: dict[str, list[AttributeOperation]] = {}
    junctions = set(wn.junction_name_list)
    for nid, node in sorted(bundle.project.nodes.items()):
        water = (node.category_dependency_profiles or {}).get("water")
        if water is None or not water.demand or nid not in junctions:
            continue
        members = [nid, *merged_map.get(nid, [])]
        previous: float | None = None
        for k, label in enumerate(labels):
            t = k * PERIOD_S
            demand_si = sum(
                _wn_node(wn, m).demand_timeseries_list.at(t, multiplier=wn.options.hydraulic.demand_multiplier)
                for m in members
                if m in junctions
            )
            value = round(demand_si * FLOW_UNIT_SCALE, 3)
            if value != previous:
                profile.setdefault(label, []).append(
                    AttributeOperation(element=nid, path=["category_dependency_profiles", "water", "demand"], op="set", value=value)
                )
                previous = value
    return profile


def _control_events(
    wn: wntr.network.WaterNetworkModel,
    bundle: ProjectBundle,
    hours: int,
    start_hour: int,
    warnings: list[str],
) -> dict[int, list[str]]:
    """Time-based controls as Temporal-Simulation-only Events, by the 0-based hour they fire in."""
    n = max(level.level for level in bundle.config.functionality_scale)
    by_link: dict[str, list[str]] = {}
    for element in [*bundle.project.nodes.values(), *bundle.project.edges.values()]:
        inp_id = (element.properties or {}).get("inp_id")
        if isinstance(inp_id, str) and element.id not in wn.node_name_list:
            by_link.setdefault(inp_id, []).append(element.id)

    fires: dict[int, list[str]] = {}
    for name, control in wn.controls():
        condition = getattr(control, "condition", None)
        kind = type(condition).__name__
        if kind not in ("SimTimeCondition", "TimeOfDayCondition"):
            warnings.append(f"Control '{name}' skipped: '{condition}' is a condition, which a Temporal Simulation does not evaluate (a full tank already stops taking water).")
            continue
        actions = control.actions()
        operations: list[AttributeOperation] = []
        for action in actions:
            target = action.target()
            link_id, attribute = target[0].name, target[1]
            value = getattr(action, "_value", None)
            if attribute != "status" or link_id not in by_link or value is None:
                warnings.append(f"Control '{name}' skipped: only opening or closing a link maps to an Event ({action}).")
                operations = []
                break
            level = n if int(value) == 1 else 1  # EPANET LinkStatus: 1 = open, 0 = closed
            operations += [AttributeOperation(element=eid, path=["functionality"], op="set", value=level) for eid in sorted(by_link[link_id])]
        if not operations:
            continue
        seconds = float(getattr(condition, "_threshold", 0.0))
        if kind == "SimTimeCondition":
            moments = [int(seconds // PERIOD_S)]
        else:  # a clock time recurs every day of the run
            first = (int(seconds // PERIOD_S) - start_hour) % 24
            moments = list(range(first, hours, 24))
        event_id = f"control-{name}".replace(" ", "-")
        bundle.config.events.append(EventDefinition(
            id=event_id, label=f"Control {name}: {'; '.join(str(a) for a in actions)}",
            type="disservice", temporal_simulation_only=True, attribute_operations=operations,
        ))
        for hour in moments:
            if 0 <= hour < hours:
                fires.setdefault(hour, []).append(event_id)
    return fires


def to_temporal_simulation(
    wn: wntr.network.WaterNetworkModel,
    bundle: ProjectBundle,
    merged_map: dict[str, list[str]],
    warnings: list[str],
) -> None:
    """Make `bundle` a Temporal Simulation model: storage tanks and a starting simulation."""
    times = wn.options.time
    hours = max(1, round(times.duration / PERIOD_S))
    if times.hydraulic_timestep != PERIOD_S:
        warnings.append(f"Periods are hourly; the file's {times.hydraulic_timestep / 60:g}-minute hydraulic step is not kept.")
    start_hour = int(times.start_clocktime // PERIOD_S) % 24
    first = datetime(2023, 1, 1, start_hour)  # EPANET carries a clock time and no date
    labels = [(first + timedelta(hours=k)).strftime("%Y-%m-%dT%H") for k in range(hours)]

    _tanks_to_storage(wn, bundle)
    profile = _demand_profile(wn, bundle, merged_map, labels)
    fires = _control_events(wn, bundle, hours, start_hour, warnings)

    # A Phase Event fires in every period of its Step, so each control hour is a
    # Step of its own and the hours between them are one Step each.
    boundaries = sorted({0, *fires, *(h + 1 for h in fires)} - {hours})
    steps = [
        Step(
            label=labels[begin],
            unit="hour",
            repeat=(boundaries[i + 1] if i + 1 < len(boundaries) else hours) - begin,
            phases=[Phase(events=[PhaseEvent(event=e) for e in fires.get(begin, [])], propagate=True)],
        )
        for i, begin in enumerate(boundaries)
    ]
    bundle.project.temporal_simulation = TemporalSimulation(
        format="cascade.temporal-simulation/v1",
        timeline=Timeline(name=f"{bundle.project.meta.name} — {hours} h", steps=steps),
        profile=profile,
        metrics=[],
    )
