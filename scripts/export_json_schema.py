#!/usr/bin/env python3
"""
Export Pydantic schemas to JSON Schema files.

These JSON Schema files are the bridge between the Python backend types and
the TypeScript frontend types. After modifying any Pydantic model in
backend/schemas/, run this script to regenerate the JSON Schema files, then
use them to regenerate or update the Zod schemas in app/lib/schemas/.

Usage
-----
    cd propagation-platform
    python backend/scripts/export_json_schema.py

Output
------
    shared/schemas/network.schema.json
    shared/schemas/config.schema.json
    shared/schemas/results.schema.json
    shared/schemas/auth.schema.json

Zod generation (automated, requires Node.js tooling)
------------------------------------------------------
After this script runs, you can pipe the JSON Schema files to a Zod generator:

    npx json-schema-to-zod -i shared/schemas/network.schema.json -o app/lib/schemas/_gen_network.ts

Review the generated output and integrate it into the hand-authored schema
files (app/lib/schemas/*.ts). Full automation is possible but the generated
output often needs minor adjustments for Zod idioms (e.g. .default(), .min()).

Manual workflow (current)
--------------------------
1. Change a Pydantic model.
2. Run this script — compare the old and new JSON Schema diffs.
3. Manually apply the equivalent change to the Zod schema in app/lib/schemas/.
4. TypeScript types update automatically via z.infer<>.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Ensure the backend package is importable when run from the project root.
ROOT = Path(__file__).resolve().parents[2]  # propagation-platform/
sys.path.insert(0, str(ROOT))

from backend.schemas.network import Canvas, Edge, InterCanvasEdge, Node, Project
from backend.schemas.config import HazardDefinition, ProjectConfig, RuleDefinition
from backend.schemas.results import (
    ElementUpdate,
    PropagationRequest,
    PropagationResult,
    SyncDownloadResponse,
    SyncUploadRequest,
)
from backend.schemas.auth import AuthUser, TokenPair

OUTPUT_DIR = ROOT / "shared" / "schemas"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def export(filename: str, *models: type) -> None:
    """Merge JSON Schemas from multiple Pydantic models into one file."""
    merged: dict = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$defs": {}}
    for model in models:
        schema = model.model_json_schema()
        # Hoist $defs from nested schemas into the top-level $defs block.
        merged["$defs"].update(schema.pop("$defs", {}))
        merged["$defs"][model.__name__] = schema

    path = OUTPUT_DIR / filename
    path.write_text(json.dumps(merged, indent=2))
    print(f"  wrote {path.relative_to(ROOT)}")


def main() -> None:
    print("Exporting JSON Schemas from Pydantic models...\n")

    export(
        "network.schema.json",
        Node, Edge, InterCanvasEdge, Canvas, Project,
    )
    export(
        "config.schema.json",
        HazardDefinition, RuleDefinition, ProjectConfig,
    )
    export(
        "results.schema.json",
        PropagationRequest, ElementUpdate, PropagationResult,
        SyncUploadRequest, SyncDownloadResponse,
    )
    export(
        "auth.schema.json",
        AuthUser, TokenPair,
    )

    print("\nDone. Review diffs in shared/schemas/ and update app/lib/schemas/ accordingly.")


if __name__ == "__main__":
    main()
