# Sourced by run-daily.sh, collect.sh and task-poll.sh. Reports what is happening to the team room
# (the admin's dashboard on the site) through the agent_event() database function.
# It never blocks a run for long and never fails one: every error is swallowed.
#
#   fr_emit RUN KIND TASK_ID TITLE STAGE STATUS NOTE [META_JSON_OBJECT]
#
# Settings come from the app's own .env (FR_APP_ENV_FILE), read without executing the file. The
# secret travels in the request body and in this process's environment, never on a command line.
fr_emit_setting() {
  local file="${FR_APP_ENV_FILE:-/home/opc/apps/foundreach/.env}"
  [ -r "$file" ] || return 0
  grep -E "^$1=" "$file" | tail -n 1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" | tr -d '\r'
}

fr_emit() {
  [ "${FR_EMIT_OFF:-0}" = 1 ] && return 0
  command -v jq >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 || return 0
  if [ -z "${FR_EMIT_URL:-}" ]; then
    FR_EMIT_URL="$(fr_emit_setting VITE_SUPABASE_URL)"; FR_EMIT_KEY="$(fr_emit_setting VITE_SUPABASE_PUBLISHABLE_KEY)"
    FR_EMIT_SECRET="${CRON_SECRET:-$(fr_emit_setting CRON_SECRET)}"
  fi
  [ -n "$FR_EMIT_URL" ] && [ -n "$FR_EMIT_KEY" ] && [ -n "$FR_EMIT_SECRET" ] || return 0
  local meta="${8:-}"
  # jq 1.6 answers "true" for empty input, so an empty value is checked first.
  { [ -n "$meta" ] && printf '%s' "$meta" | jq -e 'type == "object"' >/dev/null 2>&1; } || meta='{}'
  FR_S="$FR_EMIT_SECRET" jq -cn --arg run "$1" --arg kind "$2" --arg task "$3" --arg title "$4" --arg stage "$5" --arg status "$6" \
      --arg note "$(printf '%s' "$7" | cut -c1-600)" --argjson meta "$meta" \
      '{p_secret: $ENV.FR_S, p_event: {run: $run, kind: $kind, task_id: $task, title: $title, stage: $stage, status: $status, note: $note, meta: $meta}}' 2>/dev/null \
    | curl -fsS -m 8 -o /dev/null -X POST "${FR_EMIT_URL%/}/rest/v1/rpc/agent_event" \
        -H "apikey: $FR_EMIT_KEY" -H "Authorization: Bearer $FR_EMIT_KEY" -H "Content-Type: application/json" --data-binary @- 2>/dev/null
  return 0
}
