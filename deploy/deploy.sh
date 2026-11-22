#!/usr/bin/env bash
# Pulls and (re)starts FoundReach on the server. Safe to run as often as you like.
#
#   ./deploy.sh            run the tag from .env (IMAGE_TAG, "latest" when unset)
#   ./deploy.sh 1a2b3c4    run a specific short-SHA tag (roll back or pin)
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

SERVICE=foundreach
LABEL=dev.navaghandabhi.app=foundreach

if [ ! -f docker-compose.yml ]; then echo "docker-compose.yml is missing in $(pwd)" >&2; exit 1; fi
if [ ! -f .env ]; then echo ".env is missing in $(pwd): copy .env.example to .env and fill it in" >&2; exit 1; fi
if [ -n "${1:-}" ]; then export IMAGE_TAG="$1"; fi

docker compose pull "$SERVICE"
docker compose up -d --remove-orphans "$SERVICE"

# Wait for the container's health check (up to 90 seconds).
container="$(docker compose ps -q "$SERVICE")"
status=starting
for _ in $(seq 1 45); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo missing)"
  if [ "$status" = healthy ] || [ "$status" = unhealthy ] || [ "$status" = exited ] || [ "$status" = missing ]; then break; fi
  sleep 2
done

echo
docker compose ps "$SERVICE"
echo "image:  $(docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || echo unknown)"
echo "health: $status"

if [ "$status" != healthy ]; then
  echo "FoundReach is not healthy. Last log lines:" >&2
  docker compose logs --tail 40 "$SERVICE" >&2 || true
  exit 1
fi

# Remove superseded, now untagged FoundReach images only. Other images on the server are left alone.
docker image prune -f --filter "label=$LABEL"
