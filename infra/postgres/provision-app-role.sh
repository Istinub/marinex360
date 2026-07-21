#!/bin/sh
# Runs once on first Postgres init (as the superuser POSTGRES_USER = marinex).
# Provisions the non-owner app role by invoking provision-app-role.sql with the app
# password from the environment. Local dev only; production uses RDS + Secrets Manager
# (deferred, D-001 / INFRA-1).
set -e
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="'${APP_DB_PASSWORD}'" \
  -f /opt/marinex/provision-app-role.sql
