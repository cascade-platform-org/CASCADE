"""
scripts/create_admin.py — Promote an EXISTING user to admin.

Usage:
    python scripts/create_admin.py --email admin@yourorg.com

The user must have registered through the app once (first OIDC login creates
the row). This script only flips the role — it deliberately refuses to INSERT
a placeholder row: a pre-created row would carry a fake external_id, and the
user's real first login would then hit the email UNIQUE constraint and fail
with a 503, permanently locking that email out.

Requires DATABASE_URL in the environment (or .env).
"""
from __future__ import annotations

import argparse
import sys

import psycopg2

from config import get_settings


def promote_admin(email: str) -> None:
    settings = get_settings()
    if not settings.database_url:
        print("ERROR: DATABASE_URL is not set.", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(settings.database_url)
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE users
                       SET role_name = 'admin', updated_at = now()
                     WHERE email = %s
                    RETURNING id, email, role_name
                    """,
                    (email,),
                )
                row = cur.fetchone()
                if row is None:
                    print(
                        f"ERROR: no user with email '{email}'. Register through "
                        "the app first (first login creates the account), then "
                        "re-run this script.",
                        file=sys.stderr,
                    )
                    sys.exit(1)
                print(f"Admin user ready: id={row[0]} email={row[1]} role={row[2]}")
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Promote an existing (registered) user to admin."
    )
    parser.add_argument("--email", required=True, help="User email address")
    args = parser.parse_args()
    promote_admin(args.email)
