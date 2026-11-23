#!/usr/bin/env bash
# FoundReach daily company collection. See automation/README.md.
#
#   automation/collect.sh                refresh the portfolio sources, then load them into the catalog
#   automation/collect.sh --dry-run      same, but the load only validates the file; nothing is sent
#   automation/collect.sh --skip-scrape  load the file from the last scrape without scraping again
#
# What it does: scraper/multi.py all --refresh  ->  scraper/out/companies_multi.json
#               node scripts/ingest.mjs <that file> --exclude $COLLECT_EXCLUDE --mark-new
# and writes automation/work/collect-last.json and collect-last.txt for the daily report.
# (YC and Launch HN are refreshed by the app's own cron, not here.)
#
# Settings (environment, all optional):
#   COLLECT_EXCLUDE      source slugs left out of the load          (default a16z,500-global)
#   COLLECT_MAX_MINUTES  time limit for the whole job               (default 50)
#   COLLECT_RUNNER       docker | native | auto                     (default auto: Docker when usable)
#   COLLECT_ARGS         arguments for multi.py                     (default "all --refresh")
#   APP_ENV_FILE         where the database settings are read from  (default /home/opc/apps/foundreach/.env)
set -uo pipefail

DRY_RUN=0; SKIP_SCRAPE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-scrape) SKIP_SCRAPE=1 ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
# For a run by hand: take the COLLECT_* settings from the .env next to the clone (systemd passes them itself).
if [ -f "$(dirname "$REPO")/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in COLLECT_EXCLUDE=*|COLLECT_MAX_MINUTES=*|COLLECT_RUNNER=*)
      key="${line%%=*}"; if [ -z "$(eval "printf '%s' \"\${$key+set}\"")" ]; then export "$key=${line#*=}"; fi ;;
    esac
  done < "$(dirname "$REPO")/.env"
fi
WORK="$REPO/automation/work"
DATE="$(date -u +%Y-%m-%d)"
LOG_DIR="$WORK/collect"; LOG="$LOG_DIR/$DATE.log"
OUT_FILE="$REPO/scraper/out/companies_multi.json"
EXCLUDE="${COLLECT_EXCLUDE-a16z,500-global}"
MAX_MINUTES="${COLLECT_MAX_MINUTES:-50}"
RUNNER="${COLLECT_RUNNER:-auto}"
ARGS="${COLLECT_ARGS:-all --refresh}"
APP_ENV_FILE="${APP_ENV_FILE:-/home/opc/apps/foundreach/.env}"
CONTAINER=foundreach-collect
IMAGE="${COLLECT_IMAGE:-python:3.13-slim}"
STARTED="$(date +%s)"; DEADLINE=$((STARTED + MAX_MINUTES * 60))
mkdir -p "$LOG_DIR" "$REPO/scraper/out" "$REPO/scraper/cache"

log() { local line; line="$(date -u +%H:%M:%S) $*"; echo "$line"; echo "$line" >> "$LOG"; }

with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout --signal=TERM --kill-after=30 "$secs" "$@"
  else perl -e 'my $s = shift; my $pid = fork(); if (!$pid) { setpgrp(0, 0); exec @ARGV; exit 127 }
      $SIG{ALRM} = sub { kill "TERM", -$pid; sleep 5; kill "KILL", -$pid; exit 124 };
      alarm $s; waitpid($pid, 0); exit(($? & 127) ? 128 + ($? & 127) : $? >> 8)' "$secs" "$@"
  fi
}

# ---- the team room (see emit.sh)
FR_APP_ENV_FILE="$APP_ENV_FILE"
# shellcheck source=/dev/null
if [ -f "$REPO/automation/emit.sh" ]; then . "$REPO/automation/emit.sh"; else fr_emit() { return 0; }; fi
cemit() { [ "$DRY_RUN" = 1 ] || fr_emit "collect-$DATE" collect "" "Company collection" collect "$1" "$2" "${3:-}"; }

# ---- one FoundReach job at a time: shared with the agent runs (see wait_turn in run-daily.sh).
# A collection that starts while agents are working waits for them, and the other way round.
if [ "$DRY_RUN" != 1 ] && command -v flock >/dev/null 2>&1 && exec 8> "$(dirname "$REPO")/queue.lock"; then
  if ! flock -n 8; then log "another FoundReach job is running; waiting for it to finish"; [ "$DRY_RUN" = 1 ] || fr_emit queue collect "" "" queue waiting "The company collection is waiting for the running job to finish"; flock 8; log "the other job is done; starting"; fi
fi
STARTED="$(date +%s)"; DEADLINE=$((STARTED + MAX_MINUTES * 60))   # the time limit starts after the wait
cemit running "Collecting from the sources, up to $MAX_MINUTES minutes"

# ---- one run at a time
LOCK="$WORK/.collect.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then log "another collection is running (pid $pid); stopping"; exit 0; fi
  log "removing a stale lock"; rm -rf "$LOCK"; mkdir "$LOCK" || exit 1
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

# ---- which Python runs the scraper
DOCKER=""
if [ "$RUNNER" != native ]; then
  if docker info >/dev/null 2>&1; then DOCKER="docker"
  elif sudo -n docker info >/dev/null 2>&1; then DOCKER="sudo -n docker"; fi
fi
if [ "$RUNNER" = docker ] && [ -z "$DOCKER" ]; then log "COLLECT_RUNNER=docker but Docker is not usable"; fi
if [ -n "$DOCKER" ]; then RUNNER=docker
elif [ "$RUNNER" = docker ]; then RUNNER=unavailable
else RUNNER=native; fi

# run_scraper SECONDS args...   runs scraper/multi.py; exit 124 on timeout
run_scraper() {
  local secs="$1" rc began; shift
  began="$(date +%s)"
  if [ "$RUNNER" = docker ]; then
    $DOCKER rm -f "$CONTAINER" >/dev/null 2>&1
    # The scraper needs nothing but the standard library, so the stock image runs it as it is.
    # It runs as this user, sees only the scraper folder, and is limited in memory and CPU.
    # --init: without it Python is process 1 in the container and ignores the stop signal.
    with_timeout "$secs" $DOCKER run --rm --init --name "$CONTAINER" --user "$(id -u):$(id -g)" \
      --memory 1g --cpus 1 --pids-limit 256 --ulimit nofile=16384:16384 --security-opt no-new-privileges --security-opt label=disable \
      --cap-drop ALL -e HOME=/tmp -e PYTHONUNBUFFERED=1 -e PYTHONDONTWRITEBYTECODE=1 \
      -v "$REPO/scraper:/scraper" -w /scraper "$IMAGE" python multi.py "$@" >> "$LOG" 2>&1
    rc=$?
    # Whatever happened, no container of ours is left running.
    if [ "$rc" != 0 ]; then $DOCKER rm -f "$CONTAINER" >/dev/null 2>&1; fi
    if [ "$rc" != 0 ] && [ $(( $(date +%s) - began )) -ge "$secs" ]; then rc=124; fi
    return "$rc"
  fi
  ( cd "$REPO/scraper" && PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 with_timeout "$secs" python3 multi.py "$@" ) >> "$LOG" 2>&1
}

log "collection $DATE  runner=$RUNNER  exclude=${EXCLUDE:-none}  limit=${MAX_MINUTES}m  dry-run=$DRY_RUN"

# ---- 1. scrape
SCRAPE_STATUS=skipped; SCRAPE_NOTE=""
if [ "$SKIP_SCRAPE" = 1 ]; then
  SCRAPE_NOTE="--skip-scrape: using the file from the last scrape"
elif [ "$RUNNER" = unavailable ]; then
  SCRAPE_STATUS=failed; SCRAPE_NOTE="Docker is not usable and COLLECT_RUNNER=docker"
elif [ "$RUNNER" = native ] && ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
  SCRAPE_STATUS=failed; SCRAPE_NOTE="no Docker and no Python 3.9+ on this machine"
else
  left=$((DEADLINE - $(date +%s) - 420)); [ "$left" -lt 60 ] && left=60
  # shellcheck disable=SC2086
  run_scraper "$left" $ARGS; rc=$?
  if [ "$rc" = 0 ]; then SCRAPE_STATUS=ok
  elif [ "$rc" = 124 ]; then
    # Everything fetched so far is cached. Build the output from what is there; tomorrow continues.
    log "the scrape hit its time limit; building the output from what is cached"
    if run_scraper 300 build; then SCRAPE_STATUS=partial; SCRAPE_NOTE="time limit reached; output built from the cache, the rest continues tomorrow"
    else SCRAPE_STATUS=failed; SCRAPE_NOTE="time limit reached and the output could not be built"; fi
  else SCRAPE_STATUS=failed; SCRAPE_NOTE="multi.py exit $rc (see $LOG)"; fi
fi
log "scrape: $SCRAPE_STATUS $SCRAPE_NOTE"

# ---- 2. load into the catalog
# The three database settings are read from the app's own .env. Only those names are taken, the file
# is not executed, and the values are never printed.
read_setting() {
  [ -r "$APP_ENV_FILE" ] || return 0
  grep -E "^$1=" "$APP_ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" | tr -d '\r'
}
INGEST_STATUS=skipped; INGEST_NOTE=""; INGEST_OUT="$LOG_DIR/$DATE.ingest.txt"; : > "$INGEST_OUT"
if [ ! -s "$OUT_FILE" ]; then
  INGEST_NOTE="there is no $OUT_FILE to load"
  [ "$SCRAPE_STATUS" = failed ] || INGEST_STATUS=failed
elif [ "$SCRAPE_STATUS" = failed ]; then
  INGEST_NOTE="the scrape failed, so the old file was not loaded again"
elif ! command -v node >/dev/null 2>&1; then
  INGEST_STATUS=failed; INGEST_NOTE="node is not installed"
else
  set -- "$OUT_FILE" --mark-new
  [ -n "$EXCLUDE" ] && set -- "$@" --exclude "$EXCLUDE"
  [ "$DRY_RUN" = 1 ] && set -- "$@" --dry-run
  if [ "$DRY_RUN" != 1 ]; then
    VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-$(read_setting VITE_SUPABASE_URL)}"
    VITE_SUPABASE_PUBLISHABLE_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-$(read_setting VITE_SUPABASE_PUBLISHABLE_KEY)}"
    CRON_SECRET="${CRON_SECRET:-$(read_setting CRON_SECRET)}"
    export VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY CRON_SECRET
  fi
  left=$((DEADLINE - $(date +%s))); [ "$left" -lt 120 ] && left=120
  with_timeout "$left" node "$REPO/scripts/ingest.mjs" "$@" > "$INGEST_OUT" 2>&1; rc=$?
  cat "$INGEST_OUT" >> "$LOG"
  if [ "$rc" = 0 ]; then INGEST_STATUS=ok; [ "$DRY_RUN" = 1 ] && INGEST_NOTE="dry run: validated only, nothing was sent"
  elif [ "$rc" = 124 ]; then INGEST_STATUS=failed; INGEST_NOTE="the load hit the time limit (it is safe to run again)"
  else INGEST_STATUS=failed; INGEST_NOTE="ingest.mjs exit $rc: $(tail -n 1 "$INGEST_OUT" | cut -c1-200)"; fi
fi
log "load: $INGEST_STATUS $INGEST_NOTE"

# ---- 3. summary for the daily report
SECONDS_TAKEN=$(( $(date +%s) - STARTED ))
OVERALL=ok
[ "$SCRAPE_STATUS" = partial ] && OVERALL=partial
{ [ "$SCRAPE_STATUS" = failed ] || [ "$INGEST_STATUS" = failed ]; } && OVERALL=failed
TEXT="$WORK/collect-last.txt"
{
  echo "Company collection $DATE: $OVERALL (${SECONDS_TAKEN}s, runner $RUNNER$([ "$DRY_RUN" = 1 ] && echo ", dry run"))"
  echo "Sources left out of the load: ${EXCLUDE:-none}"
  echo "Scrape: $SCRAPE_STATUS${SCRAPE_NOTE:+ - $SCRAPE_NOTE}"
  echo "Load: $INGEST_STATUS${INGEST_NOTE:+ - $INGEST_NOTE}"
  if [ -s "$OUT_FILE" ] && command -v jq >/dev/null 2>&1; then
    jq -r '.summary // {} | "File generated \(.generated_at // "?"): \(.new_companies // "?") companies not yet in the catalog, \(.badge_adds // "?") badge additions",
      ((.per_source // {}) | to_entries[] | "  \(.key): listed \(.value.listed // "?"), new \(.value.new // "?")")' "$OUT_FILE" 2>/dev/null
  fi
  if [ -s "$INGEST_OUT" ]; then echo "Load output:"; tail -n 12 "$INGEST_OUT" | cut -c1-240 | sed 's/^/  /'; fi
} > "$TEXT"
if command -v jq >/dev/null 2>&1; then
  SUMMARY='{}'
  [ -s "$OUT_FILE" ] && SUMMARY="$(jq -c '(.summary // {}) | del(.sources, .skipped_sources)' "$OUT_FILE" 2>/dev/null || echo '{}')"
  jq -n --arg date "$DATE" --arg status "$OVERALL" --arg runner "$RUNNER" --arg exclude "$EXCLUDE" \
     --arg scrape "$SCRAPE_STATUS" --arg scrape_note "$SCRAPE_NOTE" --arg load "$INGEST_STATUS" --arg load_note "$INGEST_NOTE" \
     --arg finished "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson seconds "$SECONDS_TAKEN" --argjson dry "$DRY_RUN" \
     --argjson file "${SUMMARY:-{\}}" --rawfile load_output "$INGEST_OUT" --rawfile text "$TEXT" \
     '{date: $date, finished_at: $finished, status: $status, seconds: $seconds, dry_run: ($dry == 1), runner: $runner,
       excluded_sources: ($exclude | split(",") | map(select(length > 0))),
       scrape: {status: $scrape, note: $scrape_note}, load: {status: $load, note: $load_note, output: ($load_output | .[-3000:])},
       file_summary: $file, text: $text}' > "$WORK/collect-last.json.tmp" && mv "$WORK/collect-last.json.tmp" "$WORK/collect-last.json"
fi
cat "$TEXT"
cemit "$OVERALL" "$(grep -m1 'new companies' "$INGEST_OUT" 2>/dev/null | sed 's/^ *//' | cut -c1-300)${SCRAPE_NOTE:+ Scrape: $SCRAPE_NOTE.}${INGEST_NOTE:+ Load: $INGEST_NOTE.}" \
  "$(jq -c '{seconds: .seconds, excluded: .excluded_sources, new_in_file: (.file_summary.new_companies // null),
            sources: ((.file_summary.per_source // {}) | with_entries(.value |= {listed: (.listed // null), new: (.new // null)}))}' "$WORK/collect-last.json" 2>/dev/null)"

# Keep a month of logs.
ls -1 "$LOG_DIR"/*.log 2>/dev/null | sort -r | tail -n +31 | while IFS= read -r f; do rm -f "$f" "${f%.log}.ingest.txt"; done
[ "$OVERALL" = failed ] && exit 1
exit 0
