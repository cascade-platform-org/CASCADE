#!/usr/bin/env bash
# scripts/audit.sh — run every backend audit tool (see CLAUDE.md §5 / §7).
#
# Security: pip-audit (known CVEs), bandit (static security lint).
# Quality:  ruff (lint), pyright (types), vulture (dead code), deptry (deps).
# Architecture: import-linter (engine isolation, ADR-0009).
#
# Run from CASCADE-backend/ with the dev venv active:
#   pip install -r requirements.txt -r requirements-dev.txt
#   ./scripts/audit.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── ruff ─────────────────────────────────────────────"
ruff check .

echo "── pyright ──────────────────────────────────────────"
pyright

echo "── bandit (security) ────────────────────────────────"
bandit -c pyproject.toml -r .

echo "── pip-audit (known CVEs) ───────────────────────────"
pip-audit -r requirements.txt

echo "── vulture (dead code) ──────────────────────────────"
vulture . --config pyproject.toml

echo "── deptry (unused/missing deps) ─────────────────────"
deptry .

echo "── import-linter (engine isolation, ADR-0009) ───────"
lint-imports --config pyproject.toml

echo "── pytest ────────────────────────────────────────────"
python -m pytest test/ -q

echo
echo "All backend audits passed."
