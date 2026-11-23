# FoundReach daily automation

Two jobs run on the server every day, started by systemd timers:

| Time (UTC) | Job | Script | What it does |
|---|---|---|---|
| 03:30 | Company collection | `automation/collect.sh` | Refreshes the portfolio sources and loads new companies into the catalog. No AI. |
| 04:30 | Agent run | `automation/run-daily.sh` | Research, plan, design, build, review, pull request, and an emailed report. |

## What you must add: two secrets

Both go in `/home/opc/apps/foundreach-agents/.env` (mode 600, never committed):

1. **`CLAUDE_CODE_OAUTH_TOKEN`**: run `claude setup-token` once and paste the token. This is the
   robust option: the token is long-lived and made for unattended use. Without it the AI stages
   fall back to the interactive Claude login of the `opc` user (`~/.claude/.credentials.json`) when
   there is one. That works, but an interactive login has already expired once on this server, and
   when it does the AI stages stop until someone logs in again. With neither, the AI stages refuse
   to run and the log says exactly that; the collection job still runs.
2. **SMTP account**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`. Without it the report stays
   on disk and the log says where. Port 25 is blocked on Oracle Cloud; use 587 or 465.

Everything else in `.env.example` has a working default.

## The agent run, step by step

Each AI stage is a separate headless `claude -p` call with its own role prompt
(`automation/prompts/<stage>.md`), tool list, turn limit and time limit. Every prompt starts with
`automation/GUARDRAILS.md`. Stages hand over through files in the day's work folder.

| # | Stage | Role | Writes | Default limits |
|---|---|---|---|---|
| 1 | research | CEO + market researcher | `research.md`, `reviewed.md` | 60 turns, 25 min |
| 2 | plan | product manager | `plan.md`, updates `automation/backlog.md` | 30 turns, 10 min |
| 3 | design | designer | `design.md` | 25 turns, 10 min |
| 4 | build | engineer (may use subagents) | commits on `daily/<date>`, `build.md` | 150 turns, 50 min |
| - | build check | script | `build-check.md` (`npm run build`, `npm test`) | |
| 5 | review | QA + PM | `review.md`, last line `VERDICT: PASS` or `VERDICT: FAIL` | 60 turns, 20 min |
| - | publish | script | pull request, `publish.md` | |
| 6 | report | writer | `report.html` | 30 turns, 12 min |
| - | email | script | sends `report.html` with `send_report.py` | |

A stage that fails or times out does not stop the run. Later stages are told what is missing
(`context.md`, rewritten by the script before every stage) and adapt: no research means planning
from the backlog; no plan means nothing is built; no report means the script writes a plain one
itself. The whole run stops starting new stages after `DAILY_MAX_MINUTES` (150).

### What gets published

- No commits: no pull request.
- Verdict PASS and the script's own build check passed: a pull request, labelled `daily-agent`.
- Anything else: a **draft** pull request, so the work is not lost.
- A change under `supabase/migrations/` adds the label `needs-migration`. With auto-merge on, new
  migration files are applied by the script before the merge (see below); otherwise you apply them
  in the Supabase SQL editor.
- Nothing is ever pushed to `main` directly.
- A branch is not pushed at all if the diff looks like it contains a secret, or if a commit does not
  follow the commit rules (one-line message, one author).

### Auto-merge

Off by default: every change waits for you. To turn it on, set `AUTO_MERGE=1` in `.env`.
A pull request is then squash-merged without you only when **all** of these hold:

- the review verdict is PASS,
- the script's own `npm run build` and `npm test` passed,
- every new migration file passed the safety check and was applied (see "Migrations" below),
- the diff does not touch the pipeline, deployment or package files (`automation/` other than the
  backlog, `.github/`, `.claude/`, `deploy/`, `docker/`, `Dockerfile`, `package.json`,
  `package-lock.json`).

### Migrations

`automation/apply_migration.py` sends a new migration file to the `run_migration()` database
function, which applies it once, in one transaction, and records it in `applied_migrations`. It
needs `MIGRATE_SECRET` in the agents `.env`; the hash of that secret sits in `app_secrets` under the
name `migrate`. Remove that row to switch the function off.

This is **off until you switch it on**, because it lets an unattended run change the production
database. To switch it on, run `supabase/migrations/202611250002_run_migration.sql` in the Supabase
SQL editor, then store the hash of the server's secret:

```sql
insert into public.app_secrets (name, sha256) values ('migrate', '<sha256 of MIGRATE_SECRET>')
on conflict (name) do update set sha256 = excluded.sha256;
```

Until then a pull request with a migration is reviewed by the CTO agent and then waits: the CEO
agent mails you the file name to apply and the pull request to merge.

A file is **held**, and the pull request stays open, when it drops a table, column, type, schema or
extension, truncates or deletes rows, turns row level security off, touches the secrets, the
migration records or the sign-in tables, or edits an existing migration file.

### Team memory

After publishing, a retrospective step reads the day's records (above all the CTO's review of the
plan and the build) and rewrites one skill file per agent in `automation/work/memory/skills/`:
what to do, what to avoid, and what the next agent needs. Each agent is given its own file at the
start of its next run, below the guardrails, which always outrank it. The files stay on the server,
are capped at 40 lines each, and a file with links, commands or wording that loosens a rule is not
saved.

### Who decides, and what reaches you

The CEO and PM agents decide the work; the CTO agent's PASS releases it. You get two kinds of mail:
the daily report (a one-minute read, with the previous and the new production release), and, only
when the team needs something it cannot get itself, a short request from the CEO agent
(`automation/request_mail.py`; the same request is repeated after three days at the earliest).

A merge to `main` deploys production on Vercel and builds the container image. The script then
waits for that image build and updates the container on this server
(`/home/opc/apps/foundreach` only). Turn that last step off with `UPDATE_CONTAINER=0`.

Recommendation: leave auto-merge off until the tests in `tests/` cover the directory pages
(backlog item B-012).

## The collection job

`collect.sh` runs `scraper/multi.py all --refresh` and then
`node scripts/ingest.mjs scraper/out/companies_multi.json --exclude $COLLECT_EXCLUDE --mark-new`.

- The scraper uses only the Python standard library. It runs in a `python:3.13-slim` container
  (as your user, only the `scraper/` folder mounted, 1 GB memory), so the server's Python 3.9 does
  not matter. If Docker is not usable it falls back to the machine's `python3` (3.9 or later).
- `COLLECT_EXCLUDE` (default `a16z,500-global`) keeps sources on hold out of the load.
- The database settings (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `CRON_SECRET`) are
  read from `/home/opc/apps/foundreach/.env`. They are not copied anywhere and not printed.
- One run at a time (lock), and a time limit (`COLLECT_MAX_MINUTES`, 50). Everything fetched is
  cached in `scraper/cache/`, so a run that hits the limit builds its output from the cache and the
  next day continues. The first run on a new server has an empty cache and will be partial.
- The result is written to `automation/work/collect-last.json` and `collect-last.txt`; the daily
  report reads it.
- YC and Launch HN are refreshed by the app's own cron, not by this job.

## Install

On the server, as `opc`:

```bash
curl -fsSL https://raw.githubusercontent.com/DabhiNavaghan/founder-crm/main/automation/install.sh -o /tmp/foundreach-install.sh
bash /tmp/foundreach-install.sh
nano /home/opc/apps/foundreach-agents/.env      # add the token and the SMTP account
bash /home/opc/apps/foundreach-agents/repo/automation/install.sh   # run again: prints what is still missing
```

The installer is safe to run again. It clones or updates the repository, creates `.env` from the
example if there is none, installs the four `foundreach-*` units, enables the two timers, and runs
the sandbox self-test.

## Run once by hand

```bash
sudo systemctl start foundreach-collect.service              # collection now
sudo systemctl start --no-block foundreach-agents.service    # agent run now
journalctl -u foundreach-agents -f                           # follow it

cd /home/opc/apps/foundreach-agents/repo
automation/collect.sh --dry-run          # scrape, validate the file, send nothing
automation/run-daily.sh --dry-run        # all stages in a throwaway clone: no push, no PR, no email
automation/run-daily.sh --stage report   # one step again, in today's workspace (also: research plan design build review publish email)
automation/run-daily.sh --selftest       # check the stage sandbox, no AI call
```

`--model sonnet` (or `AGENT_MODEL` in `.env`) picks the model. A dry run uses small turn limits.

## Pause and resume

```bash
sudo systemctl disable --now foundreach-agents.timer foundreach-collect.timer   # pause
sudo systemctl enable --now foundreach-agents.timer foundreach-collect.timer    # resume
sudo systemctl stop foundreach-agents.service                                   # stop a run in progress
bash automation/install.sh --uninstall                                           # remove the units
```

## Where things are

| What | Where |
|---|---|
| Settings and secrets | `/home/opc/apps/foundreach-agents/.env` |
| Scripts, prompts, backlog (trusted clone) | `/home/opc/apps/foundreach-agents/repo` |
| Today's run: log, every stage's files, `report.html` | `repo/automation/work/<date>/` (30 days kept) |
| Per stage: the exact prompt, the CLI result with refused tool calls | `<stage>.prompt.md`, `<stage>.result.json` |
| What earlier runs reviewed and decided | `repo/automation/work/memory/` |
| Collection logs and last result | `repo/automation/work/collect/`, `collect-last.json` |
| systemd logs | `journalctl -u foundreach-agents`, `journalctl -u foundreach-collect` |
| The folder the AI stages work in (recreated every run) | `/home/opc/apps/foundreach-agents/workspace` |

## Security model

The risk is specific: the research stage reads the open web, and text on a web page can try to
give an agent instructions. The repository is public, pushes to `main` deploy production, and the
server runs other people's applications. The design keeps untrusted text away from anything that
can act.

**Separation between stages**

| Stage | Web | Shell | Can write |
|---|---|---|---|
| research | yes | no | its work folder |
| plan | no | no | work folder, `automation/backlog.md` |
| design | no | no | work folder |
| build | no | allowlist | the workspace, except pipeline and deployment files |
| review | no | read-only allowlist | work folder |
| report | no | no | work folder |

- **Research has no shell and cannot edit the repository.** Whatever a web page says, the stage can
  only produce a notes file.
- **Build has no web access.** Web text reaches it only as notes that passed through the plan
  stage, and every prompt says such text is data. It cannot fetch anything, so it cannot be told to
  download and run something, and it has nowhere to send what it reads.
- **The script publishes, not an agent.** No stage has `git push`, `gh`, `ssh`, `docker`, `sudo`,
  `curl` or package installs.

**How the tool limits are enforced**

Each stage runs with `--restricted` (file tools confined to the workspace, user and project
settings ignored), `--tools` (only the listed tools exist), `--permission-mode dontAsk` with
`--permission-prompts none` (anything not explicitly allowed is refused, nothing can prompt), and
explicit `--allowedTools` / `--disallowedTools`. `--dangerously-skip-permissions` is not used.
The shell allowlist is: `npm run build`, `npm test`, `node --check`, `node --test`,
`git status|diff|add|commit|log|restore` for build; `npm run build`, `npm test`, `node --check`,
`node --test`, `git status|diff|log|show` for review. Chained commands are refused. Every refused
call is recorded in `<stage>.result.json` and in `run.log`.

**What the allowlist cannot do, and what covers it**

`node --test` and `npm run build` run code that the build stage itself wrote. An allowlist cannot
make that safe: a stage that can write a test can run anything the test can. So on the server every
stage, and every command the script runs inside the workspace (npm, node, git), runs in a transient
systemd unit (`sandbox_exec` in `run-daily.sh`) with:

- no `sudo` (`NoNewPrivileges`), a read-only system, a private `/tmp`;
- `/home` hidden except the workspace and the state folder: the stages cannot see the app's `.env`,
  this automation's `.env`, the GitHub login, the trusted clone, or other applications' folders;
- an empty `/run`, so no Docker socket and no other service sockets;
- no secrets in the environment except the Claude credential, and that only for the AI call itself;
- memory, task and time limits.

Claude itself is the one thing from the home folder a stage can see: the folder holding the
`claude` program, read-only.

When there is no token and the interactive login is used instead, the stage gets a copy of the one
file `~/.claude/.credentials.json` in its own Claude config folder for the length of the AI call,
and nothing else from `~/.claude`. The copy is writable on purpose: Claude refreshes a login by
replacing that file, which a read-only mount or a mount of the single file would break. If the
login was refreshed during the call, the script puts the new file back in `~/.claude`; either way
the copy is deleted after the call.

In both modes the credential is present while an AI call runs, so during the build and review
stages code the agent runs could read it (the token from its environment, or the copied file).
Claude Code has a setting that strips credentials from the commands it runs
(`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`), but it also switches on Claude's own shell sandbox, which
needs `socat` and `bubblewrap`; those are not installed on this server, and with the setting on
every shell command of the build stage failed. It is therefore not set.

Two details of this server shaped the sandbox. SELinux does not allow hiding the Docker socket by
mounting over it, so the whole of `/run` is replaced by an empty folder instead. And SELinux does
not let systemd give a unit a file from a home folder as its input or output, so the script feeds
every stage through pipes.

The script itself runs outside that sandbox from the **trusted clone** (`repo/`), which no stage
can reach. The workspace is recreated for every run. To publish, the script fetches the branch from
the workspace as data, inspects it in the trusted clone, and pushes from there, so nothing a stage
left in the workspace (hooks, git config) is ever executed with the GitHub login.

`automation/run-daily.sh --selftest` checks these properties on the machine. If the sandbox cannot
start, the AI stages refuse to run. `AGENT_SANDBOX=none` turns it off; only do that knowingly.

**What remains**

- The sandboxed stages still run as your user and have network access. They cannot read other
  users' or hidden files, but a process running as `opc` can signal other `opc` processes.
- A pull request can contain anything the build stage wrote. With auto-merge off, your review is
  the gate. With auto-merge on, the gates are the review stage, the build and tests, and the list
  of files that are never merged automatically.
- The report email links to pages the research stage found. Treat those links like any other.
