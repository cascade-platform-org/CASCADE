#!/usr/bin/env python3
"""
Migrate Full_Palmanova.json (old network_analysis_tool format)
to a CASCADE v2.0 project file + a CASCADE config file.

Usage:
    python CASCADE-backend/scripts/migrate_palmanova.py

Input:
    Full_Palmanova.json next to this script, or pass --src / --dst flags.

Canvas assignment rules:
  - electrical:  nodes with node_category == "electric"
  - water:       nodes with node_category == "water"
  - transport:   nodes with node_category == "transport"
  - ALL THREE:   nodes with node_category in {manager, city, essentials, relevants}

Nodes are stored once in the global registry and referenced by ID from each
canvas — the same node ID may appear in multiple canvas node_id lists.

An edge is included in a canvas only when BOTH its source and target nodes
belong to that canvas.

Migrated from old format:
  floodDependency             → vulnerability_levels["flood"]
  strong_earthquakeDependency → vulnerability_levels["strong_earthquake"]
  weak_earthquakeDependency   → vulnerability_levels["weak_earthquake"]
  (old value 1 → 0 = immune/omitted; 2 → 1; 3 → 2)

NOT migrated (no equivalent in new schema):
  digitalDependency, gas_heatDependency
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

N = 3  # Functionality scale: 1 = critical, 2 = operational_warning, 3 = operational

FUNC_MAP: dict[str, int] = {
    "operational": 3,
    "operational_warning": 2,
    "critical": 1,
}

# Old node_category value → CASCADE category name (engine-facing).
# The engine's built-in electricity graph type is "power"; the old tool used "electric".
# All other categories keep their name unchanged.
CAT_RENAME: dict[str, str] = {
    "electric": "power",
}

# Old field-prefix for categories that were renamed.
# build_profiles reads old fields like "{old_prefix}__dependency"; for renamed cats
# we must look up the OLD prefix, not the new name.
OLD_FIELD_PREFIX: dict[str, str] = {
    "power": "electric",  # new name → old prefix used in the source JSON
}

# new category name → which canvas IDs that node belongs to
CANVAS_OF: dict[str, list[str]] = {
    "power":      ["electrical"],
    "water":      ["water"],
    "transport":  ["transport"],
    # cross-cutting: appear in all three
    "manager":    ["electrical", "water", "transport"],
    "city":       ["electrical", "water", "transport"],
    "essentials": ["electrical", "water", "transport"],
    "relevants":  ["electrical", "water", "transport"],
}

# NEW category names we migrate (those that map to one of our three canvases)
MIGRATE_CATS = {"power", "water", "transport", "manager"}

# Old *Dependency field name → event ID used in the config and vulnerability_levels.
# Old values: 1 = low / immune, 2 = medium, 3 = high.
# CASCADE vulnerability_levels value = old_value - 1  (so 1 → 0 = immune → omitted).
EVENT_DEPENDENCY_FIELDS: dict[str, str] = {
    "floodDependency":              "flood",
    "strong_earthquakeDependency":  "strong_earthquake",
    "weak_earthquakeDependency":    "weak_earthquake",
}


# ---------------------------------------------------------------------------
# Field helpers
# ---------------------------------------------------------------------------

def func(old: str) -> int:
    return FUNC_MAP.get(str(old).lower(), 3)


def _nonempty_rules(raw) -> list[str]:
    if isinstance(raw, list):
        return [r for r in raw if r and str(r).strip()]
    return []


def build_vulnerability_levels(obj: dict) -> dict[str, int]:
    """
    Map old *Dependency integer fields to CASCADE vulnerability_levels.

    Old scale:  1 = practically immune, 2 = moderate, 3 = highly vulnerable.
    CASCADE:    0 = immune (omitted), 1 = moderate, 2 = highly vulnerable  (for N=3).

    Formula: level = old_value - 1.  Values that yield 0 are omitted (default).
    """
    levels: dict[str, int] = {}
    for field, event_id in EVENT_DEPENDENCY_FIELDS.items():
        raw = obj.get(field)
        if raw is None:
            continue
        level = int(raw) - 1  # 1→0, 2→1, 3→2
        if level > 0:
            levels[event_id] = level
    return levels


# ---------------------------------------------------------------------------
# category_dependency_profiles
# ---------------------------------------------------------------------------

def build_profiles(node: dict) -> dict[str, dict]:
    """
    Reconstruct category_dependency_profiles from the old node's scattered fields.

    Old format uses:
      {old_prefix}__dependency     → dependency_level
      {old_prefix}__Backup         → backup (bool)
      {old_prefix}__BackupTime     → backup_duration (hours)
      demand__{old_prefix}         → demand (SourceToDemands only)
      functionalityBackup          → backup for the node's primary category
      functionalityBackupTime      → backup_duration for the node's primary category

    Keys in the returned dict are NEW category names (after CAT_RENAME).
    Field lookups in the old JSON use OLD_FIELD_PREFIX to map back to old names.
    """
    old_primary_cat = node.get("node_category", "")
    new_primary_cat = CAT_RENAME.get(old_primary_cat, old_primary_cat)
    is_source = node.get("nodeType") == "Source"
    profiles: dict[str, dict] = {}

    for new_cat in MIGRATE_CATS:
        # Resolve the field-name prefix used in the old JSON for this category.
        old_field = OLD_FIELD_PREFIX.get(new_cat, new_cat)

        dep        = node.get(f"{old_field}__dependency")
        backup_raw = node.get(f"{old_field}__Backup")
        btime      = node.get(f"{old_field}__BackupTime") or 0
        demand_raw = node.get(f"demand__{old_field}") or 0

        # For the node's own primary category, fall back to the generic
        # functionalityBackup / functionalityBackupTime when no category-specific
        # backup field is present.
        if new_cat == new_primary_cat and not is_source:
            if backup_raw is None:
                backup_raw = node.get("functionalityBackup")
            if not btime:
                btime = node.get("functionalityBackupTime") or 0

        backup = bool(backup_raw) if backup_raw is not None else False
        demand = float(demand_raw) if demand_raw else 0.0

        # Decide whether to emit a profile for this category
        is_primary_non_source = (new_cat == new_primary_cat and not is_source)
        has_dep    = dep is not None and (new_cat == new_primary_cat or dep > 1)
        has_backup = backup or btime > 0
        has_demand = demand > 0

        if not (is_primary_non_source or has_dep or has_backup or has_demand):
            continue

        profile: dict = {
            # dependency_level is required by the CASCADE schema (ge=1).
            # When no explicit {cat}__dependency field exists in the old JSON, default
            # to N (full dependency) — the engine's documented default for an absent
            # profile is "worst-case / full dependency", and dep=1 would make the guard
            # neutralise every proposed drop, silently blocking cascade propagation.
            "dependency_level": int(dep) if dep is not None else N,
        }
        if backup:
            profile["backup"] = True
        if btime and int(btime) > 0:
            profile["backup_duration"] = int(btime)
        if demand > 0:
            profile["demand"] = demand

        profiles[new_cat] = profile

    return profiles


# ---------------------------------------------------------------------------
# Node conversion
# ---------------------------------------------------------------------------

def convert_node(old: dict) -> dict:
    old_cat   = old.get("node_category", "")
    new_cat   = CAT_RENAME.get(old_cat, old_cat)  # "electric" → "power"; others unchanged
    node_type = old.get("nodeType", "Infrastructure")
    is_source = node_type == "Source"

    node: dict = {
        "id":           old["id"],
        "functionality": func(old.get("functionality", "operational")),
        "label":        old.get("label"),
        "node_type":    node_type,
        "node_categories": [new_cat] if new_cat else [],
        "position": {
            "x": float(old.get("x", 0)),
            "y": float(old.get("y", 0)),
        },
    }

    # importance (keep even if 1 — it's meaningful for scoring)
    imp = old.get("importance")
    if imp is not None:
        node["importance"] = float(imp)

    # economic cost (omit if 0 — no cost is the default)
    cost = old.get("costOfDisservicePerDay") or 0
    if cost and float(cost) > 0:
        node["cost_of_disservice_per_day"] = float(cost)

    # rules
    rules = _nonempty_rules(old.get("rules", []))
    if rules:
        # NOTE: rules reference old normalizedNames, not IDs.
        # Review each rule after migration and update element references to IDs.
        node["rules"] = rules

    # supply capacity (Source nodes only) — keyed by NEW category name
    if is_source:
        cap = old.get("serviceCapacity")
        if cap is not None and float(cap) > 0:
            node["supply_capacity"] = {new_cat: float(cap)}

    # category dependency profiles (non-Source nodes, and Source nodes that
    # happen to declare inter-category dependencies via {cat}__dependency)
    profiles = build_profiles(old)
    if profiles:
        node["category_dependency_profiles"] = profiles

    # functionality_time (countdown hours — omit if 0)
    ft = old.get("functionalityTime") or 0
    if ft and int(ft) > 0:
        node["functionality_time"] = int(ft)

    # vulnerability_levels (flood / earthquakes)
    vuln = build_vulnerability_levels(old)
    if vuln:
        node["vulnerability_levels"] = vuln

    # Drop any None values for clean output
    return {k: v for k, v in node.items() if v is not None}


# ---------------------------------------------------------------------------
# Edge conversion
# ---------------------------------------------------------------------------

def convert_edge(old: dict) -> dict:
    edge: dict = {
        "id":          old["id"],
        "source":      old["from"],
        "target":      old["to"],
        "functionality": func(old.get("functionality", "operational")),
    }

    ft = old.get("functionalityTime") or 0
    if ft and int(ft) > 0:
        edge["functionality_time"] = int(ft)

    rules = _nonempty_rules(old.get("rules", []))
    if rules:
        edge["rules"] = rules

    # vulnerability_levels (flood / earthquakes)
    vuln = build_vulnerability_levels(old)
    if vuln:
        edge["vulnerability_levels"] = vuln

    return edge


# ---------------------------------------------------------------------------
# Canvas assembly
# ---------------------------------------------------------------------------

CANVAS_DEFS = [
    # graph_type must match an engine-known type (GET /api/engine/algorithms).
    # "power" is the engine's name for electricity grids; "electric" is the CASCADE
    # category name used on nodes (node_categories / supply_capacity / profiles).
    ("canvas-electrical", "Electrical", "#eab308", "power"),
    ("canvas-water",      "Water",      "#3b82f6", "water"),
    ("canvas-transport",  "Transport",  "#22c55e", "transport"),
]


def build_canvases(
    nodes: dict[str, dict],
    edges: dict[str, dict],
) -> list[dict]:
    # Map canvas_key → set of node IDs that belong there
    canvas_nodes: dict[str, set[str]] = {
        "electrical": set(),
        "water": set(),
        "transport": set(),
    }
    for nid, node in nodes.items():
        cats = node.get("node_categories", [])
        cat  = cats[0] if cats else ""
        for canvas_key in CANVAS_OF.get(cat, ["electrical", "water", "transport"]):
            canvas_nodes[canvas_key].add(nid)

    # An edge belongs to a canvas only when BOTH endpoints are in that canvas.
    canvas_edges: dict[str, set[str]] = {k: set() for k in canvas_nodes}
    for eid, edge in edges.items():
        src, tgt = edge["source"], edge["target"]
        for canvas_key, nids in canvas_nodes.items():
            if src in nids and tgt in nids:
                canvas_edges[canvas_key].add(eid)

    canvases = []
    for canvas_id, label, color, graph_type in CANVAS_DEFS:
        # canvas_key maps the graph_type to the internal canvas_nodes dict key.
        # "power" is the engine graph type for the electrical canvas; the dict key
        # was built as "electrical" (matching CANVAS_OF["electric"]).
        canvas_key = "electrical" if graph_type == "power" else graph_type
        canvases.append({
            "id":    canvas_id,
            "label": label,
            "color": color,
            "graph": {
                "graph_type": graph_type,
                "node_ids":   sorted(canvas_nodes[canvas_key]),
                "edge_ids":   sorted(canvas_edges[canvas_key]),
            },
        })

    return canvases


# ---------------------------------------------------------------------------
# Config generation
# ---------------------------------------------------------------------------

def build_config(raw: dict) -> dict:
    """
    Build a CASCADE ModelConfiguration from metadata embedded in the old format.

    Categories are derived from all unique node_category values found in the
    network data.  Events are derived from the *Dependency field names.
    Graph types are one per canvas with the appropriate heuristic pipeline.
    """
    # --- functionality scale (matches FUNC_MAP) ----------------------------
    functionality_scale = [
        {"level": 1, "label": "critical",             "color": "#ef4444"},
        {"level": 2, "label": "operational_warning",  "color": "#f97316"},
        {"level": 3, "label": "operational",          "color": "#22c55e"},
    ]

    # --- categories --------------------------------------------------------
    # SourceToDemands categories run the flow algorithm; the rest are Requisite
    # (pessimistic aggregation of upstream states).
    # Names here are NEW category names (after CAT_RENAME), matching the engine's
    # built-in type vocabulary: "power" for electricity, "water" for water, etc.
    CATEGORY_DEFS: list[dict] = [
        {"name": "power",      "category_type": "SourceToDemands", "color": "#eab308"},
        {"name": "water",      "category_type": "SourceToDemands", "color": "#3b82f6"},
        {"name": "transport",  "category_type": "Requisite",       "color": "#22c55e"},
        {"name": "manager",    "category_type": "Requisite",       "color": "#8b5cf6"},
        {"name": "city",       "category_type": "Requisite",       "color": "#ec4899"},
        {"name": "essentials", "category_type": "Requisite",       "color": "#f97316"},
        {"name": "relevants",  "category_type": "Requisite",       "color": "#14b8a6"},
    ]

    # Restrict to categories actually present in this network (using new names).
    present_old_cats: set[str] = {
        n.get("node_category", "")
        for n in raw["network_data"]["nodes"]
        if n.get("node_category")
    }
    present_new_cats: set[str] = {CAT_RENAME.get(c, c) for c in present_old_cats}
    categories = [c for c in CATEGORY_DEFS if c["name"] in present_new_cats]

    # --- events ------------------------------------------------------------
    # Each *Dependency field found on any node or edge becomes a hazard event.
    # frequency_per_10y is unknown from the old format; left at 0 for manual
    # population after migration.
    EVENT_META: dict[str, str] = {
        "flood":              "Flood",
        "strong_earthquake":  "Strong Earthquake",
        "weak_earthquake":    "Weak Earthquake",
    }

    used_event_ids: set[str] = set()
    for elem in (*raw["network_data"]["nodes"], *raw["network_data"]["edges"]):
        for field, event_id in EVENT_DEPENDENCY_FIELDS.items():
            val = elem.get(field)
            if val is not None and int(val) > 1:  # >1 means non-immune
                used_event_ids.add(event_id)

    events = [
        {
            "id":               eid,
            "label":            EVENT_META[eid],
            "type":             "hazard",
            "frequency_per_10y": 0,
        }
        for eid in ("flood", "strong_earthquake", "weak_earthquake")
        if eid in used_event_ids
    ]

    # --- graph types -------------------------------------------------------
    # Empty heuristics = use the engine's built-in default pipeline for each
    # named type.  The engine recognises "power" (source-to-demands-flow) and
    # "water" (source-to-demands-flow + requisite-pessimistic) as built-ins.
    # "transport" is listed so the engine knows this canvas exists; its built-in
    # default pipeline handles transport requisite logic.
    graph_types = [
        {"name": "power",     "heuristics": []},
        {"name": "water",     "heuristics": []},
        {"name": "transport", "heuristics": []},
    ]

    return {
        "version": "1.0",
        "meta": {
            "name":        raw.get("name", "Full Palmanova"),
            "description": "Configuration migrated from network_analysis_tool format.",
        },
        "functionality_scale": functionality_scale,
        "categories":          categories,
        "events":              events,
        "graph_types":         graph_types,
        "node_defaults":       {},
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def migrate(src: Path, dst_bundle: Path) -> None:
    raw  = json.loads(src.read_text(encoding="utf-8"))
    data = raw["network_data"]

    nodes = {n["id"]: convert_node(n) for n in data["nodes"]}
    edges = {e["id"]: convert_edge(e) for e in data["edges"]}

    canvases = build_canvases(nodes, edges)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    project = {
        "version": "2.0",
        "meta": {
            "name":        raw.get("name", "Full Palmanova"),
            "description": f"Migrated from {src.name}",
            "created_at":  now,
            "updated_at":  now,
        },
        "nodes":          nodes,
        "edges":          edges,
        "canvases":       canvases,
        "update_history": [],
        "scorecard":      [],
    }

    config = build_config(raw)

    # Bundle (project + config in one file) — the canonical output.
    # Event IDs in the config and vulnerability_levels in the project are guaranteed
    # to match each other. Category names match the engine's built-in type vocabulary.
    bundle = {"project": project, "config": config}
    dst_bundle.write_text(json.dumps(bundle, indent=2, ensure_ascii=False), encoding="utf-8")

    # Stats
    vuln_nodes = sum(1 for n in nodes.values() if n.get("vulnerability_levels"))
    vuln_edges = sum(1 for e in edges.values() if e.get("vulnerability_levels"))

    print(f"Bundle   → {dst_bundle}")
    print(f"  {len(nodes)} nodes ({vuln_nodes} with vulnerability_levels), {len(edges)} edges ({vuln_edges} with vulnerability_levels)")
    for c in canvases:
        g = c["graph"]
        print(f"  [{c['label']}]  {len(g['node_ids'])} nodes, {len(g['edge_ids'])} edges")
    print(f"  Config: {len(config['categories'])} categories, {len(config['events'])} events, {len(config['graph_types'])} graph types")
    print()
    print("Manual review checklist:")
    print("  1. Rules still reference old normalizedNames — update to node IDs.")
    print("  2. Set frequency_per_10y on events in the config (currently 0).")
    print("  3. Verify vulnerability_levels scaling matches your hazard intensity model.")


def main() -> None:
    default_src    = Path(__file__).parents[3] / "network_analysis_tool" / "backend" / "saved_networks" / "Full_Palmanova.json"
    default_bundle = Path(__file__).parents[2] / "CASCADE-app" / "samples" / "public" / "Full_Palmanova_bundle.json"

    parser = argparse.ArgumentParser(description="Migrate Palmanova network to CASCADE v2.0")
    parser.add_argument("--src",    type=Path, default=default_src,    help="Source JSON path")
    parser.add_argument("--bundle", type=Path, default=default_bundle, help="Output bundle (project+config) JSON path")
    args = parser.parse_args()

    migrate(args.src, args.bundle)


if __name__ == "__main__":
    main()
