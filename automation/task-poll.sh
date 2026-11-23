#!/usr/bin/env bash
# FoundReach founder tasks: turns GitHub issues into agent runs, one at a time, oldest first.
#
#   automation/task-poll.sh             take the open tasks and run them
#   automation/task-poll.sh --list      show what is waiting, run nothing
#
# A task is an open issue in this repository with the label `agent-task`, opened by the repository
# owner. Issues from anyone else are ignored: the repository is public. The issue's title and body
# are the brief; comments are not read.
#
# Labels show the state: agent-running, then agent-done (closed), agent-partial (started, the rest
# continues in the nightly runs) or agent-failed. Remove the state label to queue an issue again.
#
# Each task is one run of run-daily.sh --task-file. That script waits for whatever FoundReach job
# is running (nightly agents, collection, another task), so nothing ever runs in parallel.
set -u
export LC_ALL=C

# A task run updates the clone this script lives in. So it runs from a private copy of itself:
# bash reads a script as it goes, and a file that changes underneath it would be read half old, half new.
if [ -z "${FOUNDREACH_POLL_HOME:-}" ]; then
  FOUNDREACH_POLL_HOME="$(cd "$(dirname "$0")" && pwd -P)"; copy="$(mktemp)"; cp "$0" "$copy"
  FOUNDREACH_POLL_HOME="$FOUNDREACH_POLL_HOME" FOUNDREACH_POLL_COPY="$copy" exec bash "$copy" "$@"
fi
SCRIPT_DIR="$FOUNDREACH_POLL_HOME"
REPO="$(cd "$SCRIPT_DIR/.." && pwd -P)"
BASE="$(dirname "$REPO")"
LIST_ONLY=0; [ "${1:-}" = "--list" ] && LIST_ONLY=1
MAX_PER_CALL="${TASKS_PER_POLL:-5}"
STATE_LABELS="agent-running agent-done agent-partial agent-failed"

say() { echo "$(date -u +%H:%M:%S) $*"; }
command -v gh >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 || { say "gh and jq are needed"; exit 1; }

# One poller at a time (systemd already guarantees it; this covers a run by hand).
if command -v flock >/dev/null 2>&1; then
  exec 7> "$BASE/poll.lock" && flock -n 7 || { say "another poller is running"; exit 0; }
fi

SLUG="$(git -C "$REPO" remote get-url origin 2>/dev/null | sed -e 's#^git@github.com:##' -e 's#^https://github.com/##' -e 's#\.git$##')"
[ -n "$SLUG" ] || { say "cannot tell which repository this is"; exit 1; }
OWNER="${TASK_OWNER:-${SLUG%%/*}}"

# The oldest open task of the owner that has no state label. Prints its number, or nothing.
next_task() {
  gh issue list --repo "$SLUG" --state open --label agent-task --limit 100 --json number,createdAt,author,labels 2>/dev/null \
    | jq -r --arg owner "$OWNER" --arg states "$STATE_LABELS" '
        ($states | split(" ")) as $st
        | [ .[] | select(.author.login == $owner)
                | select(([.labels[].name] | map(select(. as $l | $st | index($l))) | length) == 0) ]
        | sort_by(.createdAt) | .[].number'
}

if [ "$LIST_ONLY" = 1 ]; then
  n="$(next_task | tr '\n' ' ')"; say "waiting tasks of $OWNER in $SLUG, oldest first: ${n:-none}"; exit 0
fi

label() { gh issue edit "$1" --repo "$SLUG" "${@:2}" >/dev/null 2>&1; }
comment() { gh issue comment "$1" --repo "$SLUG" --body-file "$2" >/dev/null 2>&1; }

ensure_labels() {
  gh label create agent-task    --repo "$SLUG" --color c9f15a --description "A task for the FoundReach agent team (owner only)" --force >/dev/null 2>&1
  gh label create agent-running --repo "$SLUG" --color fdf0d9 --description "The agents are working on it, or it is next in line" --force >/dev/null 2>&1
  gh label create agent-done    --repo "$SLUG" --color 202a31 --description "Finished and released by the agents" --force >/dev/null 2>&1
  gh label create agent-partial --repo "$SLUG" --color 59645a --description "Started; the rest continues in the nightly runs" --force >/dev/null 2>&1
  gh label create agent-failed  --repo "$SLUG" --color b3261e --description "The agents could not do it; see the comment" --force >/dev/null 2>&1
}

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp" "${FOUNDREACH_POLL_COPY:-}"' EXIT

# A marker names the task in progress. If one is left over when a poller starts, that run was cut
# off (a restart, a crash): the issue is marked failed, provided it really still says running.
MARK="$BASE/task-in-progress"
if [ -f "$MARK" ]; then
  n="$(tr -cd '0-9' < "$MARK" | cut -c1-9)"; rm -f "$MARK"
  if [ -n "$n" ] && gh api "repos/$SLUG/issues/$n" --jq '[.labels[].name] | index("agent-running") != null' 2>/dev/null | grep -qx true; then
    echo "The run for this task was interrupted before it finished. Remove the \`agent-failed\` label to queue it again." > "$tmp/c.md"
    comment "$n" "$tmp/c.md"; label "$n" --remove-label agent-running --add-label agent-failed
    say "#$n was cut off; marked failed"
  fi
fi

count=0; labels_ready=0
while [ "$count" -lt "$MAX_PER_CALL" ]; do
  n="$(next_task | head -n 1 | tr -cd '0-9')"
  [ -n "$n" ] || break
  [ "$labels_ready" = 1 ] || { ensure_labels; labels_ready=1; }

  # Checked again on the issue itself: the author must be the owner of the repository.
  gh api "repos/$SLUG/issues/$n" > "$tmp/issue.json" 2>/dev/null || { say "#$n could not be read"; break; }
  if [ "$(jq -r '.user.login' "$tmp/issue.json")" != "$OWNER" ] || [ "$(jq -r '.author_association' "$tmp/issue.json")" != OWNER ] || [ "$(jq -r 'has("pull_request")' "$tmp/issue.json")" = true ]; then
    say "#$n is not an issue by the owner; ignored"; label "$n" --add-label agent-failed; continue
  fi
  { jq -r '"Title: " + (.title // "")' "$tmp/issue.json"; echo; jq -r '.body // ""' "$tmp/issue.json"; } | head -c 8000 | tr -d '\000-\010\013-\037' > "$tmp/task.md"

  waiting="$(next_task | grep -vx "$n" | tr '\n' ' ')"
  {
    echo "The agent team has this task now. If another job is running (the nightly run, the collection or an earlier task) it starts as soon as that one is done."
    [ -n "$waiting" ] && echo && echo "Waiting behind it, in order: $(printf '%s' "$waiting" | sed 's/\([0-9][0-9]*\)/#\1/g')"
  } > "$tmp/c.md"
  label "$n" --add-label agent-running; comment "$n" "$tmp/c.md"
  say "#$n: starting"

  echo "$n" > "$MARK"
  bash "$REPO/automation/run-daily.sh" --task-file "$tmp/task.md" --task-id "$n"; rc=$?

  dir="$(ls -1dt "$REPO"/automation/work/task-"$n"-20* 2>/dev/null | head -n 1)"
  result="${dir:+$dir/task-result.md}"; outcome=failed
  if [ -n "$result" ] && [ -f "$result" ]; then
    case "$(head -n 1 "$result")" in "RESULT: done") outcome=done ;; "RESULT: partial") outcome=partial ;; esac
    tail -n +3 "$result" | head -c 9000 > "$tmp/c.md"
  else
    echo "The run ended without a result (exit status $rc). The log is on the server under automation/work/." > "$tmp/c.md"
  fi
  case "$outcome" in
    done)    echo >> "$tmp/c.md"; echo "Done. A report was emailed." >> "$tmp/c.md"
             comment "$n" "$tmp/c.md"; label "$n" --remove-label agent-running --add-label agent-done
             gh issue close "$n" --repo "$SLUG" >/dev/null 2>&1 ;;
    partial) echo >> "$tmp/c.md"; echo "Not finished in one run. What is left is in the backlog and continues in the nightly runs; each night's report says how far it is. Remove the \`agent-partial\` label to run the whole team on it again now." >> "$tmp/c.md"
             comment "$n" "$tmp/c.md"; label "$n" --remove-label agent-running --add-label agent-partial ;;
    *)       echo >> "$tmp/c.md"; echo "Failed. Remove the \`agent-failed\` label to queue it again." >> "$tmp/c.md"
             comment "$n" "$tmp/c.md"; label "$n" --remove-label agent-running --add-label agent-failed ;;
  esac
  rm -f "$MARK"
  say "#$n: $outcome"
  sleep 20   # the issue list lags a little behind a label change
  count=$((count + 1))
done
[ "$count" = 0 ] && say "no task is waiting"
exit 0
