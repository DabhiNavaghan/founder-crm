#!/usr/bin/env bash
# Installs or updates the FoundReach daily automation on the server. Safe to run again at any time.
#
#   bash install.sh              install or update, enable the timers, print what is still missing
#   bash install.sh --uninstall  stop and remove the timers and units (the folder is left in place)
#
# Layout it creates:
#   /home/opc/apps/foundreach-agents/.env        settings and the two secrets (mode 600)
#   /home/opc/apps/foundreach-agents/repo        this repository; the scripts run from here
#   /home/opc/apps/foundreach-agents/workspace   made fresh for each run; the AI stages work here
#   /home/opc/apps/foundreach-agents/state       tool state of the stages (Claude config, npm cache)
# Nothing outside this folder and the foundreach-* systemd units is touched.
set -euo pipefail

BASE="${FOUNDREACH_AGENTS_HOME:-/home/opc/apps/foundreach-agents}"
REPO_URL="${FOUNDREACH_REPO_URL:-https://github.com/DabhiNavaghan/founder-crm.git}"
UNIT_DIR=/etc/systemd/system
UNITS="foundreach-collect.service foundreach-collect.timer foundreach-agents.service foundreach-agents.timer foundreach-tasks.service foundreach-tasks.timer"
RUN_USER="$(id -un)"

if [ "$(id -u)" = 0 ]; then echo "Run this as the user that owns the apps (opc), not as root." >&2; exit 1; fi
for tool in git sudo systemctl; do command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 1; }; done

if [ "${1:-}" = "--uninstall" ]; then
  sudo systemctl disable --now foundreach-collect.timer foundreach-agents.timer 2>/dev/null || true
  for u in $UNITS; do sudo rm -f "$UNIT_DIR/$u"; done
  sudo systemctl daemon-reload
  echo "Timers and units removed. $BASE was left in place."
  exit 0
fi

echo "== Folder: $BASE"
mkdir -p "$BASE" "$BASE/state"
chmod 700 "$BASE"

echo "== Repository"
if [ -d "$BASE/repo/.git" ]; then
  git -C "$BASE/repo" fetch --quiet --prune origin
  if [ "$(git -C "$BASE/repo" rev-parse --abbrev-ref HEAD)" = main ] && git -C "$BASE/repo" merge --ff-only --quiet origin/main; then
    echo "updated to $(git -C "$BASE/repo" rev-parse --short HEAD)"
  else
    echo "WARNING: $BASE/repo is not a clean copy of main; left as it is."
  fi
else
  git clone --quiet "$REPO_URL" "$BASE/repo"
  echo "cloned $(git -C "$BASE/repo" rev-parse --short HEAD)"
fi
# Pushing the daily branch uses the GitHub login of gh, for this clone only.
if command -v gh >/dev/null 2>&1; then
  git -C "$BASE/repo" config --unset-all credential.https://github.com.helper 2>/dev/null || true
  git -C "$BASE/repo" config --add credential.https://github.com.helper ''
  git -C "$BASE/repo" config --add credential.https://github.com.helper '!gh auth git-credential'
fi
chmod +x "$BASE/repo/automation/"*.sh 2>/dev/null || true

echo "== Settings"
if [ -f "$BASE/.env" ]; then
  echo "$BASE/.env exists; not changed"
else
  ( umask 077; cp "$BASE/repo/automation/.env.example" "$BASE/.env" )
  echo "created $BASE/.env from the example (mode 600)"
fi
chmod 600 "$BASE/.env"

echo "== systemd units"
tmp="$(mktemp -d)"
for u in $UNITS; do
  sed -e "s#/home/opc/apps/foundreach-agents#$BASE#g" -e "s#^User=opc#User=$RUN_USER#" -e "s#^Group=opc#Group=$(id -gn)#" \
      -e "s#/home/opc/.local/bin#$HOME/.local/bin#" "$BASE/repo/automation/systemd/$u" > "$tmp/$u"
  sudo install -m 644 -o root -g root "$tmp/$u" "$UNIT_DIR/$u"
done
rm -rf "$tmp"
sudo systemctl daemon-reload
sudo systemctl enable --now foundreach-collect.timer foundreach-agents.timer foundreach-tasks.timer
systemctl list-timers 'foundreach-*' --no-pager || true

echo
echo "== Checks"
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
missing=0
ok()   { echo "  ok       $*"; }
need() { echo "  MISSING  $*"; missing=1; }
has_value() { grep -Eq "^$1=.+" "$BASE/.env"; }
for tool in claude node npm gh jq python3 curl; do
  if command -v "$tool" >/dev/null 2>&1; then ok "$tool ($(command -v "$tool"))"; else need "$tool is not on the PATH the units use ($PATH)"; fi
done
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then ok "gh is logged in"; else need "gh is not logged in (gh auth login)"; fi
if docker info >/dev/null 2>&1 || sudo -n docker info >/dev/null 2>&1; then ok "Docker is usable (the collection job runs the scraper in python:3.13-slim)"
else echo "  note     Docker is not usable; the collection job will use this machine's python3"; fi
if has_value CLAUDE_CODE_OAUTH_TOKEN; then ok "CLAUDE_CODE_OAUTH_TOKEN is set"
elif [ -f "$HOME/.claude/.credentials.json" ]; then echo "  note     no CLAUDE_CODE_OAUTH_TOKEN; the AI stages use this user's Claude login, which can expire. A token (claude setup-token) in $BASE/.env is the robust option."
else need "CLAUDE_CODE_OAUTH_TOKEN in $BASE/.env (run: claude setup-token), or a Claude login for this user. Until then the AI stages do not run."; fi
if has_value SMTP_HOST && has_value SMTP_USER && has_value SMTP_PASS; then ok "SMTP is set"; else need "SMTP_HOST, SMTP_USER and SMTP_PASS in $BASE/.env. Until then reports stay on disk."; fi
if has_value REPORT_TO; then ok "REPORT_TO is set"; else need "REPORT_TO in $BASE/.env"; fi
if [ -r /home/opc/apps/foundreach/.env ]; then ok "the app's .env is readable (database settings for the collection job)"; else need "/home/opc/apps/foundreach/.env is not readable; the collection job cannot load into the catalog"; fi

echo
echo "== Stage sandbox self-test"
if bash "$BASE/repo/automation/run-daily.sh" --selftest; then :; else
  missing=1
  echo "  The AI stages will refuse to run until this passes. See automation/README.md, \"Security model\"."
fi

echo
if [ "$missing" = 0 ]; then echo "Everything is in place. Next runs:"; else echo "Installed, with items still MISSING above. Next runs:"; fi
systemctl list-timers 'foundreach-*' --no-pager 2>/dev/null | sed -n '1,3p' || true
echo "Run once by hand:  sudo systemctl start foundreach-collect.service   |   sudo systemctl start --no-block foundreach-agents.service"
echo "Follow it:         journalctl -u foundreach-agents -f"
