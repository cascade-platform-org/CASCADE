"""
core/rule_grammar.py — Python adapter for the shared Rule DSL grammar spec.

Loads CASCADE-app/shared/rule-grammar.json and re-exports its values as typed
Python constants.  rule_parser.py imports from here; the frontend imports the
same JSON directly.  A grammar change (new function, new operator, new
attribute) is made once in the JSON; both adapters pick it up on next load.

Path resolution: this file lives at CASCADE-backend/core/, so:
    parents[0] = core/
    parents[1] = CASCADE-backend/
    parents[2] = repo root (CASCADE-v2/)
"""
from __future__ import annotations

import json
from pathlib import Path

_GRAMMAR_FILE = (
    Path(__file__).parents[2] / "CASCADE-app" / "shared" / "rule-grammar.json"
)

with _GRAMMAR_FILE.open(encoding="utf-8") as _f:
    _spec: dict = json.load(_f)

DISABLED_RULE_PREFIX: str = _spec["disabled_rule_prefix"]
RULE_KINDS: frozenset[str] = frozenset(_spec["rule_kinds"])
FUNCTION_NAMES: tuple[str, ...] = tuple(_spec["function_names"])
OPERATORS: frozenset[str] = frozenset(_spec["operators"])
NODE_ATTRIBUTES: tuple[str, ...] = tuple(_spec["node_attributes"])
