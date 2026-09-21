#!/usr/bin/env python3
"""Fail when a detect-secrets scan turns up a finding nobody has audited.

Run AFTER `git ls-files | xargs detect-secrets scan --baseline .secrets.baseline`,
which rewrites the baseline in place with whatever the scan found.

Why not `git diff --exit-code .secrets.baseline`:

  - The baseline carries a `generated_at` timestamp that changes on every run,
    so a whole-file diff fails on every pull request regardless of findings.
  - A finding legitimately disappearing (the file was deleted, the literal was
    replaced) also moves the file, and that is not a reason to fail.

So only additions count. A finding is keyed by file plus `hashed_secret`, never
by line number, because unrelated edits above it shift the line and would
otherwise look like something new.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

BASELINE = Path(".secrets.baseline")


def findings(blob: str) -> set[tuple[str, str]]:
    """{(filename, hashed_secret)} — the identity of a finding across runs."""
    results = json.loads(blob).get("results", {})
    return {
        (filename, entry["hashed_secret"])
        for filename, entries in results.items()
        for entry in entries
    }


def main() -> int:
    scanned = findings(BASELINE.read_text())

    committed = subprocess.run(
        ["git", "show", f"HEAD:{BASELINE}"],
        capture_output=True,
        text=True,
    )
    if committed.returncode != 0:
        print(f"::error::No committed {BASELINE} to compare against.")
        return 1

    added = scanned - findings(committed.stdout)
    if not added:
        print(f"No new findings ({len(scanned)} known, all audited).")
        return 0

    print(f"::error::{len(added)} unaudited secret finding(s):")
    for filename, digest in sorted(added):
        print(f"  {filename}  ({digest[:12]}…)")
    print("\nClassify them, then commit the updated baseline:")
    print("  git ls-files | xargs detect-secrets scan --baseline .secrets.baseline")
    print("  detect-secrets audit .secrets.baseline")
    return 1


if __name__ == "__main__":
    sys.exit(main())
