#!/usr/bin/env bash
# Restores a backup made by backup.sh into THIS environment's database. It REPLACES everything in that database.
#   ./deploy/restore.sh deploy/backups/bandha-prod-20261116-023000.sql.gz
# The stack should be running (the db service is what receives the data). The API is stopped while restoring, and a
# safety backup of the current data is taken first.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"
FILE="${1:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "usage: $0 <backup.sql.gz>" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/deploy/compose.yml")

echo "This will REPLACE the database of project '${COMPOSE_PROJECT_NAME:-bandha}' with: $FILE"
read -r -p "Type the project name to continue: " ANSWER
[ "$ANSWER" = "${COMPOSE_PROJECT_NAME:-bandha}" ] || { echo "cancelled"; exit 1; }

"$ROOT/deploy/backup.sh"
"${COMPOSE[@]}" stop api web
DB=(  "${COMPOSE[@]}" exec -T db psql -U "${POSTGRES_USER:-bandha}" -v ON_ERROR_STOP=1 )
"${DB[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB:-bandha}\" WITH (FORCE)" -c "CREATE DATABASE \"${POSTGRES_DB:-bandha}\""
gunzip -c "$FILE" | "${DB[@]}" -d "${POSTGRES_DB:-bandha}" >/dev/null
"${COMPOSE[@]}" up -d --wait --wait-timeout 180
echo "restored."
