"""
scripts/create_admin.py — Bootstrap the first admin user.

Usage:
    python scripts/create_admin.py --email admin@yourorg.com

Requires DATABASE_URL in the environment (or .env).
"""
from __future__ import annotations

import argparse
import sys
import uuid

import psycopg2

from config import get_settings


def create_admin(email: str) -> None:
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
                    INSERT INTO users (id, external_id, email, name, role_name)
                    VALUES (%s, %s, %s, %s, 'admin')
                    ON CONFLICT (email) DO UPDATE SET role_name = 'admin'
                    RETURNING id, email, role_name
                    """,
                    (str(uuid.uuid4()), f"bootstrap:{email}", email, "Admin"),
                )
                row = cur.fetchone()
                print(f"Admin user ready: id={row[0]} email={row[1]} role={row[2]}")
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create or promote a user to admin.")
    parser.add_argument("--email", required=True, help="User email address")
    args = parser.parse_args()
    create_admin(args.email)
