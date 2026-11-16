#!/usr/bin/env bash
# Deploys the checked-out branch of THIS directory. Run it on the server, from the clone of one environment:
#
#   bandha-dev  (clone of branch "development")  ->  ./deploy/deploy.sh
#   bandha      (clone of branch "main")         ->  ./deploy/deploy.sh
#
# What it does: pull the latest commit of the branch (fast-forward only), build the images, start the stack (the
# database migration runs first, automatically), wait until every service is healthy, and if the new version does not
# come up, put the previous version back. Safe to run again at any time.
#
# Configuration is read from deploy/.env (see deploy/env.example), or from the file named in ENV_FILE.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/deploy/compose.yml")

log() { printf '\n[deploy %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '\n[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "missing $ENV_FILE (copy deploy/env.example and fill it in)"
set -a; . "$ENV_FILE"; set +a
for v in POSTGRES_PASSWORD JWT_SECRET WEB_ORIGIN APP_URL; do [ -n "${!v:-}" ] || die "$v is empty in $ENV_FILE"; done
[ "${#JWT_SECRET}" -ge 32 ] || die "JWT_SECRET must be at least 32 characters"
if [ "${APP_ENV:-production}" = "production" ] && [ "${MAIL_TRANSPORT:-console}" = "console" ]; then
  die "APP_ENV=production needs MAIL_TRANSPORT=smtp (and SMTP_URL); console mail would print reset links into the logs"
fi

# 1. get the code (the clone is the deployment copy: it only ever fast-forwards)
if [ "${SKIP_PULL:-0}" != "1" ]; then
  BRANCH="${DEPLOY_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
  log "updating branch $BRANCH"
  git fetch --prune origin "$BRANCH"
  git checkout "$BRANCH"
  git merge --ff-only "origin/$BRANCH"
fi
NEW_TAG="$(git rev-parse --short=12 HEAD)"
PREV_TAG="$(docker inspect --format '{{ index .Config.Image }}' "$("${COMPOSE[@]}" ps -q api 2>/dev/null | head -n1)" 2>/dev/null | sed 's/.*://' || true)"
log "deploying $NEW_TAG (currently running: ${PREV_TAG:-nothing})"

# 2. back the database up first, if asked (and if it is already running)
if [ "${BACKUP_BEFORE_DEPLOY:-0}" = "1" ] && [ -n "$("${COMPOSE[@]}" ps -q db 2>/dev/null)" ]; then
  log "backing up the database"
  "$ROOT/deploy/backup.sh"
fi

# 3. build and start. `up --wait` returns only when every service is healthy; migrate runs before the API starts.
wait_healthy() {
  local tag="$1"
  TAG="$tag" "${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 180
}

log "building images"
TAG="$NEW_TAG" "${COMPOSE[@]}" build

log "starting"
if wait_healthy "$NEW_TAG"; then
  log "healthy: $NEW_TAG is live"
  TAG="$NEW_TAG" "${COMPOSE[@]}" ps
  # keep the disk tidy: drop images older than the last few builds
  docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true
  exit 0
fi

# 4. the new version did not come up: show why, and put the previous one back
log "NEW VERSION DID NOT BECOME HEALTHY. Recent logs:"
TAG="$NEW_TAG" "${COMPOSE[@]}" logs --tail 60 migrate api web || true
if [ -n "${PREV_TAG:-}" ] && [ "$PREV_TAG" != "$NEW_TAG" ] && [ "$PREV_TAG" != "local" ]; then
  log "rolling back to $PREV_TAG (images are still on this machine)"
  TAG="$PREV_TAG" "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 120 || log "rollback also failed, check the logs above"
  log "NOTE: database migrations are forward only. If the failed version added a migration, the old code now runs against the newer schema (additive changes are fine)."
fi
exit 1
