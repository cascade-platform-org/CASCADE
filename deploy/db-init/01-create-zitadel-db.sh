#!/bin/bash
# Runs ONCE, only when the Postgres data volume is first initialised.
# Creates the separate database Zitadel will use. The CASCADE app database is
# created by Postgres itself from POSTGRES_DB.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE zitadel;
EOSQL
