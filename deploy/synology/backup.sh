#!/bin/sh
# Backs up the Storyboard Studio database with pg_dump, using the Postgres client image so
# nothing needs installing on the host. Runs on the NAS (DSM Task Scheduler) or on a PC with
# Docker (Git Bash on Windows works).
#
#   sh deploy/synology/backup.sh                # uses deploy/synology/.env next to this script
#   sh deploy/synology/backup.sh /volume1/docker/storyboard/backups
#
# Environment (all optional):
#   BACKUP_DIR   where dumps go        (default: <this folder>/backups)
#   KEEP         how many to keep      (default: 30; older dumps are deleted)
#   ENV_FILE     env file to read      (default: <this folder>/.env)
#   PG_IMAGE     client image          (default: postgres:18-alpine — must be >= the server major)
#
# The dump is pg_dump custom format (-Fc): compressed, and restorable table-by-table with
# pg_restore. It runs as the schema-owning role (MIGRATION_DATABASE_URL) so every object is
# included. Logically deleted cartoons are in the dump like everything else.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
BACKUP_DIR=${1:-${BACKUP_DIR:-$here/backups}}
KEEP=${KEEP:-30}
ENV_FILE=${ENV_FILE:-$here/.env}
PG_IMAGE=${PG_IMAGE:-postgres:18-alpine}

if [ ! -f "$ENV_FILE" ]; then
  echo "backup: env file not found: $ENV_FILE" >&2
  exit 1
fi

# Take the first matching line, strip the key and any surrounding quotes. Never echo it.
url=$(grep -E '^MIGRATION_DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')
[ -n "$url" ] || url=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')
if [ -z "$url" ]; then
  echo "backup: no MIGRATION_DATABASE_URL or DATABASE_URL in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
stamp=$(date +%Y%m%d-%H%M%S)
out="$BACKUP_DIR/storyboard-$stamp.dump"
tmp="$out.part"

# The client container must reach the NAS over the LAN, not a container-local "localhost".
# MSYS_NO_PATHCONV stops Git Bash on Windows rewriting the -f argument.
MSYS_NO_PATHCONV=1 docker run --rm -i -e PGURL="$url" "$PG_IMAGE" \
  sh -c 'pg_dump --format=custom --no-owner --no-privileges --dbname="$PGURL"' > "$tmp"

# A dump that is not at least a few KB did not contain the schema; do not keep it.
size=$(wc -c < "$tmp")
if [ "$size" -lt 4096 ]; then
  rm -f "$tmp"
  echo "backup: dump was only $size bytes, discarded" >&2
  exit 1
fi
mv "$tmp" "$out"
echo "backup: wrote $out ($size bytes)"

# Rotation: keep the newest $KEEP dumps.
count=0
for f in $(ls -1t "$BACKUP_DIR"/storyboard-*.dump 2>/dev/null); do
  count=$((count + 1))
  if [ "$count" -gt "$KEEP" ]; then
    rm -f "$f"
    echo "backup: removed old $f"
  fi
done
