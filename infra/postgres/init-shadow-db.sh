#!/bin/sh
# Runs once on first Postgres init. Creates the shadow database Prisma uses for
# `prisma migrate dev` (it needs a second, throwaway DB to diff migrations).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  SELECT 'CREATE DATABASE marinex360_shadow'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'marinex360_shadow')\gexec
SQL
