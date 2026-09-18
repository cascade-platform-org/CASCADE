#!/bin/bash
# Runs ONCE, only when the Postgres data volume is first initialised.
# Creates the separate database and a DEDICATED runtime role for GlitchTip
# (self-hosted error/performance tracking — see docs/project/deployment.md).
# Same least-privilege reasoning as 01-create-zitadel-db.sh: GlitchTip's
# runtime connection must not share the Postgres superuser with the app DB.
#
# GLITCHTIP_DB_PASSWORD comes from deploy/.env. For an EXISTING data volume
# this script does not re-run — create the role manually:
#   docker compose exec db psql -U "$POSTGRES_USER" -d postgres \
#     -c "CREATE ROLE glitchtip_user LOGIN PASSWORD '<pw>'; ALTER DATABASE glitchtip OWNER TO glitchtip_user;"
set -e

: "${GLITCHTIP_DB_PASSWORD:?GLITCHTIP_DB_PASSWORD not set (add it to deploy/.env)}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE glitchtip_user LOGIN PASSWORD '${GLITCHTIP_DB_PASSWORD}';
    CREATE DATABASE glitchtip OWNER glitchtip_user;
EOSQL
