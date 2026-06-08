#!/usr/bin/env python3
"""
Export Pydantic schemas to JSON Schema files.

These JSON Schema files are the bridge between the Python backend types and
the TypeScript frontend types. After modifying any Pydantic model in
CASCADE-backend/schemas/, run this script to regenerate the JSON Schema files,
then apply the equivalent change to the Zod schemas in CASCADE-app/lib/schemas/.

Usage
-----
    # From the project root (CASCADE-v2/)
    python CASCADE-backend/scripts/export_json_schema.py

Output
------
    CASCADE-app/shared/schemas/network.schema.json
    CASCADE-app/shared/schemas/config.schema.json
    CASCADE-app/shared/schemas/results.schema.json
    CASCADE-app/shared/schemas/auth.schema.json

Workflow for schema changes (CLAUDE.md §6)
------------------------------------------
1. Change the Pydantic model in CASCADE-backend/schemas/.
2. Run this script.
3. Diff the output in CASCADE-app/shared/schemas/ against the previous version.
4. Apply the equivalent change to the Zod schema in CASCADE-app/lib/schemas/.
5. TypeScript types update automatically via z.infer<>.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Insert CASCADE-backend/ so that `from schemas.*` resolves correctly.
ROOT = Path(__file__).resolve().parents[2]          # CASCADE-v2/
BACKEND = ROOT / "CASCADE-backend"
sys.path.insert(0, str(BACKEND))

from schemas.network import (                        # noqa: E402
    Node,
    Edge,
    Canvas,
    Graph,
    GraphSnapshot,
    AnyUpdateEntry,
    ScorecardEntry,
    Project,
)
from schemas.config import (                         # noqa: E402
    FunctionalityScaleLevel,
    CategoryDefinition,
    DirectDamageEffect,
    EventDefinition,
    HeuristicConfig,
    GraphTypeConfig,
    ModelConfiguration,
)
from schemas.results import (                        # noqa: E402
    PropagationRequest,
    ElementUpdate,
    PropagationResult,
    SyncUploadRequest,
    SyncDownloadResponse,
)
from schemas.auth import AuthUser, TokenPair         # noqa: E402

OUTPUT_DIR = ROOT / "CASCADE-app" / "shared" / "schemas"
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
        Node, Edge, Canvas, Graph, GraphSnapshot, AnyUpdateEntry, ScorecardEntry, Project,
    )
    export(
        "config.schema.json",
        FunctionalityScaleLevel, CategoryDefinition, DirectDamageEffect,
        EventDefinition, HeuristicConfig, GraphTypeConfig, ModelConfiguration,
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

    print("\nDone. Diff CASCADE-app/shared/schemas/ and update CASCADE-app/lib/schemas/ accordingly.")


if __name__ == "__main__":
    main()
