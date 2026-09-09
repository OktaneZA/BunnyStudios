# Deploying to a Synology DiskStation (Container Manager)

One container runs everything: the Fastify API serves the built web app from the same origin,
so there is a single port and no CORS to configure. Postgres is the existing server on the
DiskStation, reachable as `homenas.lan` (192.168.1.73) on port 5400; it is not part of the compose project.

```
Browser ──► NAS:3001 ──► storyboard-studio container ──► homenas.lan:5400 (postgres)
                         ├─ /            static web app (apps/web/dist)
                         └─ /api/v1/...  API
```

## 1. Provision the database (once)

Run [provision.sql](provision.sql) as the Postgres admin. It creates two roles and the
database, and is safe to re-run (it re-applies passwords and grants):

| Role | Used by | Can |
|---|---|---|
| `storyboard` | the migration step only (`MIGRATION_DATABASE_URL`) | own the database, create and alter tables |
| `storyboard_app` | the running API (`DATABASE_URL`) | read and write rows in the app tables, nothing else: no DDL, no migration ledger, max 20 connections |

```bash
psql -h homenas.lan -p 5400 -U postgres      -v owner_password='...' -v app_password='...' -f deploy/synology/provision.sql
```

Default privileges are set so tables added by future migrations are automatically readable
and writable by `storyboard_app`. The script leaves the server's shared `postgres`
maintenance database alone; a comment inside shows the optional `REVOKE CONNECT` if you
want to close that too.

Tables are **not** created here. The container applies the Drizzle migrations in
`apps/api/drizzle` every time it starts (`RUN_MIGRATIONS=true`, the default). Migrations are
idempotent and recorded in `drizzle.__drizzle_migrations`, so restarts and upgrades are safe.

The container runs migrations as `MIGRATION_DATABASE_URL` and then drops that variable
before starting the API, so the API process only ever holds the data-only credentials.

To apply migrations by hand instead, from a machine with the repo checked out (the migration
script loads the same validated config as the API, so `apps/api/.env` must be complete):

```bash
DATABASE_URL=postgres://storyboard:...@192.168.1.73:5400/storyboard npm run db:migrate
```

The DiskStation Postgres listens on **port 5400** (Postgres 18 in a container) and does not offer SSL. Its `pg_hba.conf`
must allow password connections from both the LAN (to provision from a PC) and the Docker
bridge network the app container will use. Add these lines and reload:

```
# LAN clients (provisioning, psql, migrations from a PC)
host  all  all  192.168.1.0/24  scram-sha-256
# Containers on the NAS's Docker bridge
host  all  all  172.16.0.0/12   scram-sha-256
```

Reload without a restart: `SELECT pg_reload_conf();` as an admin, or `pg_ctl reload`. If
Postgres is a Container Manager project, `pg_hba.conf` is inside its data volume (usually
`/volume1/docker/<postgres>/data/pg_hba.conf`), and you can run the provisioning script
from inside that container without touching `pg_hba.conf` at all:

```bash
docker cp deploy/synology/provision.sql <postgres-container>:/tmp/provision.sql
docker exec -it <postgres-container> psql -U postgres -d postgres -v app_password='...' -f /tmp/provision.sql
```

The app container still needs the bridge-network line above to reach the database.
A connection refused by `pg_hba.conf` fails with
`FATAL: no pg_hba.conf entry for host "...", user "...", database "...", no encryption`.

## 2. Build the image

Either build on the NAS (Container Manager can build from the compose file's `build:` block)
or build on a PC and push to a registry, then set `image:` in the compose file.

```bash
docker build -t storyboard-studio:latest .
# optional: docker tag storyboard-studio:latest ghcr.io/<you>/storyboard-studio:latest && docker push ...
```

To ship the image without a registry:

```bash
docker save storyboard-studio:latest | gzip > storyboard-studio.tar.gz
# copy to the NAS, then Container Manager > Image > Add > From file
```

## 3. Configure

Copy [.env.example](.env.example) to `deploy/synology/.env` and fill in:

| Variable | What |
|---|---|
| `DATABASE_URL` | `postgres://storyboard_app:<password>@192.168.1.73:5400/storyboard` (use the IP; `.lan` names resolve inconsistently inside containers) |
| `MIGRATION_DATABASE_URL` | Same, as `storyboard`. Optional; without it migrations run as `DATABASE_URL`, which then must own the database. |
| `JWT_SECRET` | 32+ random characters. Changing it signs everyone out. |
| `AUTH_*_PASSWORD_HASH` | scrypt hashes, never plaintext. See below. |
| `STORYBOARD_PORT` | Host port on the NAS (default 3001). |
| `ANTHROPIC_API_KEY` | Optional. Blank disables thumbnails and Improve. |

Make a password hash without a checkout, using the built image:

```bash
docker run --rm storyboard-studio:latest node --experimental-strip-types apps/api/src/db/hash-password.ts 'the password'
```

The `.env` file is read only by the container. Nothing secret is baked into the image.

## 4. Run

DSM click-through, assuming the image tarball from step 2:

1. **File Station**: create the shared folder `docker` if it does not exist, then a folder
   `docker/storyboard`. Upload `docker-compose.yml` and `.env` into it.
2. **Container Manager > Image > Add > Add from file**: pick `storyboard-studio.tar.gz`.
   Wait for `storyboard-studio:latest` to appear in the Image list.
3. **Container Manager > Project > Create**: name `storyboard`, path `/docker/storyboard`,
   source **Use existing docker-compose.yml**. It picks up the file from the folder.
4. Skip the web portal step (Next), review, and **Done**. The project builds and starts.
5. **Project > storyboard > Container > Log**: the lines below should appear.

The container logs show:

```
storyboard: applying migrations
migrations applied
storyboard: starting API on 0.0.0.0:3001
seed: created you@example.com
seed: created creator@storyboard.local
```

Then open `http://<nas-ip>:3001`. `GET /health` returns `{"status":"ok"}` and is what the
compose health check polls.

From a shell:

```bash
cd deploy/synology && docker compose up -d --build
```

## 5. Upgrade: `npm run release`

After the first manual install, every later release is one command from this PC:

```bash
npm run release
```

It runs the tests, builds the image tagged `<date>-<git sha>`, backs up the live database,
streams the image to the NAS over SSH (no tarball, no Container Manager clicks), uploads the
compose file and `.env`, recreates the container, and then polls `/health` until it reports
the new build tag and the served web bundle matches the local build. Pending migrations run
on start. The two accounts are re-seeded from `.env` on every boot (display name, hash and
minor flag are updated; account ids and their projects are untouched).

**One-time setup** (needs SSH enabled on the NAS: DSM Control Panel > Terminal & SNMP):

```bash
cp deploy/release.env.example deploy/release.env   # set NAS_USER to your DSM admin user
npm run release -- --setup                          # asks for the NAS password a few times
```

Setup creates an SSH key at `~/.ssh/storyboard_nas` and installs it on the NAS. The DSM user
should be in the `docker` group (DSM Control Panel > User & Group > Group > docker > Members)
so it can use Container Manager's engine directly; if it is not, setup falls back to a sudoers
rule limited to the `docker` binary. After that, releases are non-interactive. `NAS_USER` is
just the user name, without a host, and the name is case-sensitive on the NAS.

Container Manager keeps the project's compose file as `compose.yaml`; the release overwrites
that file, so a change to `deploy/synology/docker-compose.yml` reaches the NAS on the next
release. Anything the release loads or starts shows up in Container Manager's Image and
Project pages, because the script drives the same Docker engine that the UI does.

**Versions.** The root `package.json` version is the version. The usual flow:

```bash
npm version minor            # 0.1.0 -> 0.2.0; commits "v0.2.0" and tags it
git push --follow-tags
npm run release              # ships storyboard-studio:v0.2.0-<commit>
```

`/health` reports `version`, `commit` and `build`, and the sign-in page shows `v0.2.0`, so a
screenshot of a problem says which build it came from. The release refuses an uncommitted
tree (`--allow-dirty` ships it tagged `-dirty`) and warns if `HEAD` is not the tagged version
commit. Record what changed in [CHANGELOG.md](../../CHANGELOG.md) under the version heading.

Other commands:

| Command | What |
|---|---|
| `npm run release -- --skip-tests` | skip the test step |
| `npm run release -- --no-backup` | skip the pre-release dump |
| `npm run release -- --allow-dirty` | ship uncommitted work, tagged `-dirty` |
| `npm run release -- --list` | image tags present on the NAS (the newest 5 are kept) |
| `npm run release -- --rollback v0.1.0` | back to the newest build of that version (a full tag also works) |

Rolling back the app never rolls back the database. That is safe because migrations are
additive by rule: they add nullable columns, enums or tables and never rename, drop or
change meaning, so any released version runs against the newest schema.

If verification times out, the container log is the first place to look:
`ssh <user>@192.168.1.73 'sudo docker logs --tail 100 storyboard-studio'`.

## The Fire tablet app

`npm run release` also builds the Android app in `apps/android` when `JAVA_HOME` and
`ANDROID_HOME` are set in `release.env`, signs it with the keystore named there, and ships it
inside the image so the server offers it at `/downloads/bunny-studios.apk`. The sign-in page
shows a **Get the tablet app** link whenever that file is present.

On the Fire HD 10: Settings > Security & Privacy > Apps from Unknown Sources > allow Silk,
then open `http://192.168.1.73:3001/downloads/bunny-studios.apk` in Silk, download and
install. The app is a WebView around the studio, so every later release updates it without
a new APK; reinstall only when the wrapper itself changes (the APK version matches the
server version it was built with). Its server address is changeable in-app: long-press the
splash or use the offline screen's **Change address**. Details in
[apps/android/README.md](../../apps/android/README.md).

## Browser tests

The release runs the Playwright suite in `apps/web/e2e` against the freshly built image,
started on this PC against a scratch database and reached through the PC's LAN IP, so the
browser treats the origin as insecure exactly like the NAS. Sign-in, cartoons, scenes, drag
reordering, editing, both bins and account privacy are covered; a failure stops the release
before anything ships. `--skip-e2e` bypasses it; `--dry-run` runs everything and ships nothing.
To run the suite by hand against any server:

```bash
E2E_BASE_URL=http://192.168.1.107:3999 npx playwright test -c apps/web/e2e
```

## Backups

[backup.sh](backup.sh) dumps the whole database with `pg_dump` (custom format, compressed)
using the Postgres client image, so nothing is installed on the host. It reads the connection
string from `.env` next to it, writes `backups/storyboard-<date>-<time>.dump`, and keeps the
newest 30 (set `KEEP` to change). Cartoons in the bin are in the dump like everything else.

From this PC (Git Bash):

```bash
sh deploy/synology/backup.sh                      # -> deploy/synology/backups/
```

On the NAS, nightly, with DSM **Control Panel > Task Scheduler > Create > Scheduled Task >
User-defined script**, user `root`, schedule daily, script:

```bash
sh /volume1/docker/storyboard/backup.sh /volume1/docker/storyboard/backups
```

Copy `backup.sh` to `/volume1/docker/storyboard/` beside `.env` first. Point Hyper Backup or
Snapshot Replication at the `backups` folder if you want the dumps off the NAS as well.

Restore, after stopping the app container:

```bash
sh deploy/synology/restore.sh deploy/synology/backups/storyboard-20260909-120000.dump
```

It drops and recreates every table in the dump, so the database ends up exactly as it was.
To look at an old backup without touching the live data, restore it into a scratch database
by setting `TARGET_URL`. Tables recreated by a restore keep working for `storyboard_app`
because the default privileges from `provision.sql` apply to anything the owner role creates.

## Putting it behind HTTPS

Use DSM's **Login Portal > Advanced > Reverse Proxy** to map an HTTPS hostname to
`localhost:3001`. The API trusts `X-Forwarded-*` headers in production (`trustProxy`), so
client addresses in logs are correct. No other change is needed; the app uses relative URLs.

## Troubleshooting

- **`Invalid environment configuration`** at start: a required variable is missing or too short.
  The message lists each one.
- **`ECONNREFUSED homenas.lan:5400`**: Postgres is not reachable from the container network.
  Check the port and `pg_hba.conf`.
- **`permission denied for schema public`** during migrations: `MIGRATION_DATABASE_URL` is
  missing or points at `storyboard_app`. Migrations must run as `storyboard`.
- **`permission denied for table ...`** from the API: run `provision.sql` again to re-apply grants.
- **Blank page after upgrade**: `index.html` is served with `no-cache` and assets are hashed,
  so a plain reload picks up the new build. If a proxy caches `/`, purge it.
