"""
core/rule_grammar.py — Python adapter for the shared Rule DSL grammar spec.

Loads CASCADE-app/shared/rule-grammar.json and re-exports its values as typed
Python constants.  rule_parser.py imports from here; the frontend imports the
same JSON directly.  A grammar change (new function, new operator, new
attribute) is made once in the JSON; both adapters pick it up on next load.

Path resolution supports two layouts (this file lives at CASCADE-backend/core/):
    * monorepo dev — parents[2] is the repo root, grammar at
      CASCADE-app/shared/rule-grammar.json
    * container image — the backend is copied to /app and a copy of the grammar
      is bundled at /app/shared/rule-grammar.json (parents[1]/shared)
"""
from __future__ import annotations

import json
from pathlib import Path

# The grammar is canonically authored in CASCADE-app/shared/ (schema-first,
# CLAUDE.md §6); the container image bundles a build-time copy. Use whichever
# path exists in the current layout.
_GRAMMAR_CANDIDATES = (
    Path(__file__).parents[1] / "shared" / "rule-grammar.json",
    Path(__file__).parents[2] / "CASCADE-app" / "shared" / "rule-grammar.json",
)
_GRAMMAR_FILE = next(
    (p for p in _GRAMMAR_CANDIDATES if p.exists()), _GRAMMAR_CANDIDATES[-1]
)

with _GRAMMAR_FILE.open(encoding="utf-8") as _f:
    _spec: dict = json.load(_f)

DISABLED_RULE_PREFIX: str = _spec["disabled_rule_prefix"]
RULE_KINDS: frozenset[str] = frozenset(_spec["rule_kinds"])
FUNCTION_NAMES: tuple[str, ...] = tuple(_spec["function_names"])
OPERATORS: frozenset[str] = frozenset(_spec["operators"])
NODE_ATTRIBUTES: tuple[str, ...] = tuple(_spec["node_attributes"])
