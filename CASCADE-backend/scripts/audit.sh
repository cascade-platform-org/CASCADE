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
# PYSEC-2026-1325 (ecdsa): NO fix version exists — it is ecdsa's documented lack
# of side-channel resistance, not a defect an upgrade closes. ecdsa arrives only
# as a transitive dep of python-jose ("ecdsa!=0.15") and is reachable only for
# ES* JWT algorithms; this service signs with RS256 (config.py::jwt_algorithm),
# which python-jose routes through the `cryptography` backend instead. Re-check
# this exception if jwt_algorithm ever moves to an ES* curve.
# CVE-2026-85394 (python-jose ≤ 3.5.0, the latest): HMAC accepts a DER public key,
# so a holder of the public key can forge HS256 tokens WHEN the algorithms are not
# restricted. No fixed release exists. auth/oauth2.py pins algorithms=[jwt_algorithm]
# and config.py allows only RS256/384/512, so the forged HS256 path is refused.
# Drop this ignore as soon as a fixed python-jose ships (upgrade, then re-run).
pip-audit -r requirements.txt --ignore-vuln PYSEC-2026-1325 --ignore-vuln CVE-2026-85394

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
