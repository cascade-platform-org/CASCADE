"""
core/importers/ — network format importers: parse an external file format,
map it to a CASCADE ProjectBundle. Pure transformation (no engine, no
persistence) — see CLAUDE.md §7 (engine boundary) and §2 (check before
writing existing patterns before adding a new format here).

Each supported format is its own subpackage (`core/importers/<format>/`)
producing the same `schemas.sync.ProjectBundle` envelope, so the API layer
(`api/import_routes.py`) and frontend UI treat every importer identically.

  inp/  — EPANET water-network `.inp` files (ADR-0012), the first format.

Adding a new format: create `core/importers/<format>/`, mirror the `inp/`
subpackage's shape (parse → domain-specific processing → map → place), and
register a new route in `api/import_routes.py`.
"""
