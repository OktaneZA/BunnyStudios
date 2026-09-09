#!/bin/sh
# Applies pending migrations (unless RUN_MIGRATIONS=false), then starts the API.
# Migrations are idempotent, so restarting the container is always safe.
#
# Least privilege: migrations use MIGRATION_DATABASE_URL (the schema-owning role) when it is
# set, and the API itself only ever sees DATABASE_URL (the data-only role). Falls back to
# DATABASE_URL for both when MIGRATION_DATABASE_URL is absent.
set -e
cd /app/apps/api

if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
  echo "storyboard: applying migrations"
  DATABASE_URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}" node --experimental-strip-types src/db/migrate.ts
fi
unset MIGRATION_DATABASE_URL

echo "storyboard: starting API on ${HOST:-0.0.0.0}:${PORT:-3001}"
exec node --experimental-strip-types src/server.ts
