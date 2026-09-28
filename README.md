# Bunny Studios

A cartoon studio for a young creator. Write scenes in Story, make moving clips in Director,
then put them together into a downloadable cartoon. Optional writing suggestions and scene
sketches are proposals the creator chooses to accept. Director starts generation only when
the creator asks, with a price shown first; finished clips join the cartoon in story order.

Designed for a 10–15 year old on a tablet, with an Advanced mode for an adult. Runs as one
container on a Synology NAS against an existing Postgres server.

## Documents

| Document | What it is |
|---|---|
| [docs/usability-review.md](docs/usability-review.md) | Teen and tablet review, revised screen flow, changes and verification limits |
| [docs/architecture.md](docs/architecture.md) | Current architecture, an honest review, and the target design |
| [docs/working-in-this-repo.md](docs/working-in-this-repo.md) | Rules, conventions and the gotchas found the hard way |
| [docs/build-plan-v1.1.md](docs/build-plan-v1.1.md) | Approved plan: decisions D1–D18, build sequence, spec defects fixed |
| [docs/director-mode-plan-v1.md](docs/director-mode-plan-v1.md) | Director Mode: requirements DM-1–DM-30, decisions D27–D37, build stages for pictures, clips and the finished cartoon |
| [docs/requirements-v1.0.md](docs/requirements-v1.0.md) | The original specification |
| [docs/scene-thumbnails.md](docs/scene-thumbnails.md) | How AI thumbnails and "Improve for me" work, and their limits |
| [docs/director-mode.md](docs/director-mode.md) | Director Mode as built: setup, shape, what is verified, limits |
| [deploy/synology/README.md](deploy/synology/README.md) | Deploying, releasing, backing up and restoring on the NAS |
| [docs/spike/](docs/spike/) | Phase −1: validates the core bet before the prompt compiler is written |

## What works today

- Two accounts: an adult (Advanced mode) and a teen (Simple mode, child content policy always on).
- Cartoons with a series number, drag-to-reorder, and a bin: deleting a cartoon or a scene is
  logical, and "Put back" restores it with everything intact.
- Scenes with a description, camera angle, time of day and mood; drag or arrow reordering with
  server-side numbering; optimistic concurrency so two devices cannot overwrite each other.
- "Improve for me" rewrites a scene description with story context; "Make a thumbnail" draws an
  SVG sketch. Both go through a proposal the user accepts or cancels, with per-day limits and an
  independent content review.
- Copy a scene, or the whole cartoon, as text.
- One-command release to the NAS with unit and browser tests, a pre-release database backup,
  and live verification. Nightly backups on the NAS.
- An Android app for the Amazon Fire HD 10 (`apps/android`): the same studio in a landscape
  WebView with an icon, splash and offline screen, downloadable from the sign-in page.

- **Director** (docs/director-mode.md): the cast is found from the story, each scene becomes a
  picture and then a clip through fal.ai picture makers chosen from a data-driven catalogue,
  every request is budgeted in real money and passed through three safety gates, and
  "Put it together" renders the scenes with music, a voice track and three transitions into
  one MP4 on the server.

Not yet built: exports, continuity checks, the Director chat agent, AI voices. See the build plan
and the Director Mode plan.

## Running it locally

Requires Node 22+ (24 recommended) and Docker.

```bash
npm install
npm run db:up                              # Postgres on :5433

cd apps/api
cp .env.example .env
node src/db/hash-password.ts 'a password'  # paste into AUTH_ADULT_PASSWORD_HASH
node src/db/hash-password.ts 'another'     # paste into AUTH_TEEN_PASSWORD_HASH
cd ../..

npm run db:migrate
npm run dev:api                            # http://localhost:3001
npm run dev:web                            # http://localhost:5173
```

The two accounts are seeded from `.env` at boot. Re-running updates names and password hashes
but never changes an account's id, so its cartoons stay attached.

Test on the machine's LAN IP as well as `localhost`: a plain-http LAN origin is an insecure
context in the browser, and the NAS is served that way.

## AI configuration

The API reads `apps/api/.env`; real environment variables take precedence. Leave the key blank
to disable AI while everything else keeps working.

```dotenv
ANTHROPIC_API_KEY=your-api-key
ANTHROPIC_MODEL=claude-sonnet-5
THUMBNAIL_DAILY_LIMIT=30
THUMBNAIL_REQUESTS_PER_MINUTE=3
FAL_KEY=your-fal-key           # Director Mode picture makers; blank hides them
STORAGE_ROOT=./storage         # generated pictures, clips and renders
FFMPEG_PATH=ffmpeg             # full paths on Windows
FFPROBE_PATH=ffprobe
```

The key stays on the server. Each request makes one generation call and one review call. The
daily limit counts attempts, including failed or cancelled ones, and resets at midnight UTC.

## Tests

```bash
npm test -w @storyboard/vocabularies   # vocabulary file is the single authority (CV-1)
npm test -w @storyboard/api            # 52 tests against the local Postgres
npm run release -- --dry-run           # plus the browser suite against the built image
```

The API tests hit a real database on purpose: row-level isolation, the 1:1 series-bible
transaction, logical delete and enum constraints are database-enforced properties, and a fake
would not catch a regression in any of them. Tests use disposable accounts and an injected AI
provider; they never spend model credits.

## Layout

```
packages/vocabularies/   vocabularies.json, the single authority for prompt phrases
apps/api/                Fastify + Drizzle + Postgres; serves the built web app in production
apps/web/                React + Vite; relative /api/v1 URLs; e2e/ holds the Playwright suite
apps/android/            Fire HD 10 app: a WebView shell around the web app
deploy/                  Dockerfile entrypoint, release script, Synology compose, backup and restore
infra/main.bicep         Azure shape from Phase 0; a design record, not a deployment
docs/                    plan, requirements, architecture, screenshots, spike pack
```

## Deploying and releasing

The NAS runs a single image built from the root `Dockerfile`. First-time install, database
provisioning with two least-privilege roles, and the one-time SSH setup are in
[deploy/synology/README.md](deploy/synology/README.md). After that:

```bash
npm run release                       # test, build, back up, ship, restart, verify
npm run release -- --list             # image tags on the NAS
npm run release -- --rollback <tag>   # back to an earlier build
sh deploy/synology/backup.sh          # ad-hoc database dump
```

The image is built and tested on the developer machine; the NAS only ever receives a finished
artefact and the release does not report success until `/health` shows the new build tag.
