"""
scripts/purge_expired.py — enforce the retention windows in
docs/project/privacy-and-data-protection.md.

GDPR Art. 5(1)(e) (storage limitation) is the reason this exists: rows that are
kept "until someone remembers to delete them" are kept indefinitely, which is
exactly what the principle forbids. Run it from cron (deployment.md).

Usage:
    python scripts/purge_expired.py            # show what would be deleted
    python scripts/purge_expired.py --apply    # actually delete

Windows can be overridden per table; the defaults are the documented ones. The
`users` and `projects` tables are deliberately absent: an account and the
project versions its owner chose to sync are kept until the user deletes them,
which is a user decision, not a timer.

Requires DATABASE_URL in the environment (or .env).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow `python scripts/purge_expired.py`: run as a file, sys.path[0] is
# scripts/, not the backend root where config lives.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2

from config import get_settings

# table -> (timestamp column, default retention in days, why it is kept at all)
RETENTION = {
    "analysis_logs": (
        "occurred_at",
        365,
        "engine capacity planning (ADR-0007: shape and timing only, no content)",
    ),
    "activity_log_uploads": (
        "uploaded_at",
        180,
        "user-initiated support/debugging uploads",
    ),
    "audit_logs": (
        "occurred_at",
        730,
        "security/integrity record of role changes and deletions",
    ),
}


def purge(apply_changes: bool, overrides: dict[str, int]) -> None:
    settings = get_settings()
    if not settings.database_url:
        print("ERROR: DATABASE_URL is not set.", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(settings.database_url)
    try:
        with conn:
            with conn.cursor() as cur:
                for table, (column, default_days, reason) in RETENTION.items():
                    days = overrides.get(table, default_days)
                    # Table/column names are module constants, never user input;
                    # the interval is a bound parameter.
                    cur.execute(
                        f"SELECT count(*) FROM {table} "  # nosec B608
                        f"WHERE {column} < now() - (%s::int * INTERVAL '1 day')",
                        (days,),
                    )
                    (count,) = cur.fetchone()
                    verb = "Deleting" if apply_changes else "Would delete"
                    print(f"{verb} {count:>7} rows from {table} older than {days}d — {reason}")
                    if apply_changes and count:
                        cur.execute(
                            f"DELETE FROM {table} "  # nosec B608
                            f"WHERE {column} < now() - (%s::int * INTERVAL '1 day')",
                            (days,),
                        )
        if not apply_changes:
            print("\nDry run — nothing was deleted. Re-run with --apply to enforce.")
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Delete records past their retention window.")
    parser.add_argument(
        "--apply", action="store_true", help="Actually delete (default is a dry run)."
    )
    for _table, (_col, _days, _why) in RETENTION.items():
        parser.add_argument(
            f"--{_table.replace('_', '-')}-days",
            type=int,
            default=None,
            help=f"Override retention for {_table} (default {_days}).",
        )
    args = parser.parse_args()
    chosen = {
        table: getattr(args, f"{table}_days")
        for table in RETENTION
        if getattr(args, f"{table}_days") is not None
    }
    purge(args.apply, chosen)
