#!/usr/bin/env bash
# Dumps the database of THIS environment to deploy/backups/<project>-<timestamp>.sql.gz and keeps the newest BACKUP_KEEP.
# Run it by hand, before deploys (BACKUP_BEFORE_DEPLOY=1), and from cron, e.g. every night at 02:30:
#   30 2 * * *  cd /srv/bandha && ./deploy/backup.sh >> deploy/backups/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/deploy/compose.yml")
DIR="$ROOT/deploy/backups"
mkdir -p "$DIR"
chmod 700 "$DIR"

FILE="$DIR/${COMPOSE_PROJECT_NAME:-bandha}-$(date +%Y%m%d-%H%M%S).sql.gz"
# Plain SQL, no owner/ACL noise, so it restores cleanly into a fresh database. Written to a temp name first, so a
# failed dump never leaves a half file that looks like a good backup.
"${COMPOSE[@]}" exec -T db pg_dump -U "${POSTGRES_USER:-bandha}" -d "${POSTGRES_DB:-bandha}" --no-owner --no-privileges | gzip > "$FILE.part"
mv "$FILE.part" "$FILE"
chmod 600 "$FILE"
echo "backup written: $FILE ($(du -h "$FILE" | cut -f1))"

# keep the newest N
ls -1t "$DIR"/"${COMPOSE_PROJECT_NAME:-bandha}"-*.sql.gz 2>/dev/null | tail -n +"$(( ${BACKUP_KEEP:-14} + 1 ))" | xargs -r rm -f --
