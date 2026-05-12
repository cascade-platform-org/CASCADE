# Makefile — schema pipeline helpers
#
# This Makefile lives in cascade-app (public frontend repo).
# The backend repo (cascade-backend) must be cloned at BACKEND_DIR.
#
# Default layout assumes sibling directories:
#   ~/projects/cascade-app/     ← this repo (Makefile is here)
#   ~/projects/cascade-backend/ ← backend repo
#
# Override BACKEND_DIR if your layout differs:
#   BACKEND_DIR=/path/to/backend make schemas
#
# Targets:
#   make schemas        — export Pydantic → JSON Schema files
#   make check-schemas  — fail if committed JSON Schemas differ from Pydantic
#                         (use in CI to catch forgotten regeneration)
#   make zod            — draft Zod schemas from JSON Schema via json-schema-to-zod
#                         (requires npx; always review before using the output)

.PHONY: schemas check-schemas zod

PYTHON      ?= python3
NPX         ?= npx
SCHEMA_DIR   = shared/schemas
BACKEND_DIR ?= ../CASCADE-backend
EXPORT       = $(BACKEND_DIR)/scripts/export_json_schema.py

# ---------------------------------------------------------------------------
# Export Pydantic models → JSON Schema
# ---------------------------------------------------------------------------

schemas:
	@echo "→ Exporting Pydantic models to $(SCHEMA_DIR)/"
	@mkdir -p $(SCHEMA_DIR)
	$(PYTHON) $(EXPORT)
	@echo "✓ Done. Review diffs in $(SCHEMA_DIR)/ then update app/lib/schemas/."

# ---------------------------------------------------------------------------
# CI drift check — regenerate and compare against what is committed
# ---------------------------------------------------------------------------

check-schemas: schemas
	@echo "→ Checking for schema drift..."
	@git diff --exit-code $(SCHEMA_DIR)/ \
		|| (echo ""; \
		    echo "✗ Schema drift detected. The files above differ from Pydantic."; \
		    echo "  Run 'make schemas', review the diff, update app/lib/schemas/,"; \
		    echo "  then commit everything together."; \
		    exit 1)
	@echo "✓ Schemas are in sync with the Pydantic models."

# ---------------------------------------------------------------------------
# Draft Zod schemas from JSON Schema (requires npx + json-schema-to-zod)
# Treat output as a starting point — always review before copying to app/.
# ---------------------------------------------------------------------------

zod:
	@echo "→ Drafting Zod schemas from $(SCHEMA_DIR)/ (review before using)..."
	@for f in $(SCHEMA_DIR)/*.schema.json; do \
		name=$$(basename $$f .schema.json); \
		out=/tmp/zod_draft_$${name}.ts; \
		$(NPX) --yes json-schema-to-zod -i $$f -o $$out; \
		echo "  Draft written: $$out"; \
	done
	@echo "✓ Drafts in /tmp/. Review, adjust, then copy to app/lib/schemas/."
