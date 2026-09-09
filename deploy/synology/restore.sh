#!/bin/sh
# Restores a backup made by backup.sh into the storyboard database.
#
#   sh deploy/synology/restore.sh deploy/synology/backups/storyboard-20260909-120000.dump
#
# Stop the app container first (Container Manager > Project > storyboard > Stop) so nothing
# writes during the restore. The restore drops and recreates every table in the dump
# (--clean --if-exists), so the database ends up exactly as it was at backup time.
#
# To restore into a different database (e.g. to inspect an old backup without touching the
# live one), pass its URL as TARGET_URL.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
dump=${1:?usage: restore.sh <file.dump>}
ENV_FILE=${ENV_FILE:-$here/.env}
PG_IMAGE=${PG_IMAGE:-postgres:18-alpine}

if [ ! -f "$dump" ]; then
  echo "restore: file not found: $dump" >&2
  exit 1
fi

url=${TARGET_URL:-}
if [ -z "$url" ]; then
  url=$(grep -E '^MIGRATION_DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')
fi
if [ -z "$url" ]; then
  echo "restore: no MIGRATION_DATABASE_URL in $ENV_FILE and no TARGET_URL given" >&2
  exit 1
fi

echo "restore: $dump -> $(printf '%s' "$url" | sed -E 's#://([^:]+):[^@]*@#://\1:***@#')"
MSYS_NO_PATHCONV=1 docker run --rm -i -e PGURL="$url" "$PG_IMAGE" \
  sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$PGURL"' < "$dump"
echo "restore: done. Start the app container again; it re-applies any newer migrations on boot."
