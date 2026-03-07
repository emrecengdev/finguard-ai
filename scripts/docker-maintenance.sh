#!/usr/bin/env bash

set -euo pipefail

RETENTION_HOURS="${RETENTION_HOURS:-72}"
MIN_FREE_GB="${MIN_FREE_GB:-20}"
LOG_PREFIX="[docker-maintenance]"

log() {
  printf '%s %s\n' "$LOG_PREFIX" "$*"
}

free_gb() {
  df -BG / | awk 'NR==2 {gsub(/G/, "", $4); print $4}'
}

run_prune_cycle() {
  local retention_hours="$1"

  docker container prune -f --filter "until=${retention_hours}h" >/dev/null
  docker image prune -af >/dev/null
  docker builder prune -af --filter "until=${retention_hours}h" >/dev/null
  docker network prune -f --filter "until=${retention_hours}h" >/dev/null
}

if ! command -v docker >/dev/null 2>&1; then
  log "docker not found"
  exit 1
fi

before_free_gb="$(free_gb)"
log "free space before cleanup: ${before_free_gb}G"

run_prune_cycle "$RETENTION_HOURS"

after_free_gb="$(free_gb)"
log "free space after standard cleanup: ${after_free_gb}G"

if (( after_free_gb < MIN_FREE_GB )); then
  log "free space below ${MIN_FREE_GB}G, running aggressive builder/image cleanup"
  docker image prune -af >/dev/null
  docker builder prune -af >/dev/null
  after_free_gb="$(free_gb)"
  log "free space after aggressive cleanup: ${after_free_gb}G"
fi

log "docker disk usage summary:"
docker system df
