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
# CVE-2026-85394 (python-jose, alias CVE-2024-33663): NO fix version exists (3.5.0
# is the latest release). It is an algorithm-confusion forgery of HS256 tokens
# using the public key as the HMAC secret, and only works when the verifier does
# not restrict the accepted algorithms. auth/oauth2.py::decode passes
# `algorithms=[settings.jwt_algorithm]` (RS256) on the only jwt.decode call, so an
# HS256 token is rejected before any key is tried. Re-check if that call changes.
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
