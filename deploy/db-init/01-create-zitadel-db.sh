#!/bin/bash
# Runs ONCE, only when the Postgres data volume is first initialised.
# Creates the separate database and a DEDICATED runtime role for Zitadel. The
# CASCADE app database is created by Postgres itself from POSTGRES_DB.
#
# Least privilege: Zitadel's runtime connection must NOT share the Postgres
# superuser with the app DB — a compromised IdP would otherwise have full
# access to the CASCADE database (and vice versa). The superuser is still
# passed to Zitadel as the ADMIN connection (used only during start-from-init
# to create its schemas), while day-to-day queries run as `zitadel_user`.
#
# ZITADEL_DB_PASSWORD comes from deploy/.env. For an EXISTING data volume this
# script does not re-run — create the role manually:
#   docker compose exec db psql -U "$POSTGRES_USER" -d postgres \
#     -c "CREATE ROLE zitadel_user LOGIN PASSWORD '<pw>'; ALTER DATABASE zitadel OWNER TO zitadel_user;"
set -e

: "${ZITADEL_DB_PASSWORD:?ZITADEL_DB_PASSWORD not set (add it to deploy/.env)}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE zitadel_user LOGIN PASSWORD '${ZITADEL_DB_PASSWORD}';
    CREATE DATABASE zitadel OWNER zitadel_user;
EOSQL
