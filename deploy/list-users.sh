#!/usr/bin/env bash
#
# list-users.sh — print the CASCADE users table (people who have logged in).
#
# Identity accounts that never opened the app live only in Zitadel's console.
# Run from anywhere on the VM; extra args go to psql (e.g. -c "<other query>").
set -euo pipefail

cd "$(dirname "$0")"  # the deploy/ directory (compose project root)

set -a
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
set +a

: "${POSTGRES_USER:?POSTGRES_USER not set (check deploy/.env)}"
: "${POSTGRES_DB:?POSTGRES_DB not set (check deploy/.env)}"

if [ "$#" -eq 0 ]; then
  set -- -c "SELECT email, name, role_name, created_at FROM users ORDER BY created_at;"
fi

docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
