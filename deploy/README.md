# Running FoundReach on the server

One container, `foundreach`, serves the site, the `/api` routes and the daily refresh. GitHub Actions
(`.github/workflows/docker.yml`) builds the image on every push to `main` and pushes
`ghcr.io/dabhinavaghan/foundreach:latest` plus a tag named after the short commit SHA.

The app listens on port 3010 of the server. Point the reverse proxy (or open the firewall) there.

## First-time setup

On the server (Docker with the compose plugin installed, logged in as `opc`):

```bash
mkdir -p /home/opc/apps/foundreach && cd /home/opc/apps/foundreach
# copy deploy/docker-compose.yml, deploy/deploy.sh and deploy/.env.example from the repo into this folder
cp .env.example .env && chmod 600 .env
nano .env                      # fill in the values
chmod +x deploy.sh
```

The GHCR package is private until you change it. Either make it public (GitHub > Packages >
foundreach > Package settings > Change visibility) or log the server in once with a personal access
token (classic) that has only the `read:packages` scope:

```bash
docker login ghcr.io -u DabhiNavaghan      # paste the token as the password
```

Then start it:

```bash
./deploy.sh
curl -s http://127.0.0.1:3010/healthz      # {"status":"ok",...}
```

## Update

After a push to `main` has finished building:

```bash
cd /home/opc/apps/foundreach && ./deploy.sh
```

Changing `.env` also needs `./deploy.sh` (or `docker compose up -d`) so the container is recreated.

## Roll back

Every build is also tagged with its short commit SHA (first 7 characters, see the Actions run or
the package page).

```bash
./deploy.sh 1a2b3c4            # run that build
./deploy.sh latest             # back to the newest build
```

To keep a version pinned across later runs of `./deploy.sh`, set `IMAGE_TAG=1a2b3c4` in `.env`.

## Logs and status

```bash
docker compose logs -f --tail 100 foundreach
docker compose logs foundreach | grep ' cron '      # daily refresh runs and their results
docker compose ps
docker inspect -f '{{.State.Health.Status}}' foundreach
```

Each request is one line: time, method, path, status, duration, bytes, client address. Logs rotate at
10 MB and three files are kept.

## Daily refresh (cron)

The container runs the `crons` from `vercel.json` itself (times are UTC) whenever `CRON_SECRET` is set.
Nothing goes into the server's crontab. If Vercel is still deployed and still running its own cron,
set `ENABLE_CRON=0` here or remove the Vercel deployment, so the refresh does not run twice.

Run it by hand:

```bash
set -a; . ./.env; set +a
curl -s -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3010/api/cron/refresh
```
