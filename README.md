# Bunny Studios

A cartoon studio for creators aged 10-15, designed for tablet and desktop with Advanced
controls for adults. **Create** combines scene writing, characters and clip generation;
**Put it together** assembles chosen clips into a downloadable cartoon. Phone-specific
refinements are outside the current product scope.

Runs as one application container on a Synology NAS with Postgres and persistent media
storage. The Android Fire tablet wrapper loads the same web app. This describes local source;
recent working-tree changes are not a claim about the deployed version.

## Start here

| Document | Purpose |
|---|---|
| [Current product requirements](docs/current-product-requirements.md) | Current interface, device scope and acceptance criteria |
| [Architecture](docs/architecture.md) | Current components/data flow, with the original review retained as history |
| [Latest code and requirements review](docs/review-2026-09-28.md) | Open findings, requirement gaps and verification limits |
| [Create workspace](docs/combined-scene-workspace.md) | Editing, autosave, preview/final and clip selection as implemented |
| [Director implementation](docs/director-mode.md) | Setup, production workflow, runtime boundaries and limits |
| [Character Studio requirements](docs/character-studio-requirements.md) | Canonical looks, reference contracts, lineage and money |
| [Character Studio status](docs/character-studio-status.md) | Implemented contracts versus live-provider/physical-device evidence |
| [Media architecture](docs/media-generation-architecture.md) | Implemented snapshot boundary and remaining target contracts |
| [Working in this repo](docs/working-in-this-repo.md) | Conventions and operational gotchas |
| [Deployment guide](deploy/synology/README.md) | Release, backup and restore |

Earlier [build decisions](docs/build-plan-v1.1.md), [Director plan](docs/director-mode-plan-v1.md)
and [original specification](docs/requirements-v1.0.md) remain historical decision records;
apply the precedence described in the current requirements.

## What works today

- Two configured accounts: adult and teen. Teen content policy stays enforced independently
  of project choices; Advanced UI does not bypass server policy.
- Cartoons and scenes with ordering, soft deletion and restoration. Create is the main entry;
  View -> Manage scenes retains the detailed ordering/bin tools.
- Inline scene writing with serial autosave, retained drafts, save/conflict recovery and
  optional AI suggestions that require acceptance. Time/mood/camera sit in Scene details.
- Film Strip/Scene Board and light/dark appearance. On landscape tablet/desktop, the priced
  Make preview / Make final clip action sits above the player beside the editor.
- Character Studio: generate/upload/refine candidates, approve immutable looks, pin selected
  references to scenes, and retain older revisions. Additional reference views are optional.
- Server-priced generation, durable jobs, safety review and allowance reservations. Frame and
  character-reference workflows depend on compatible available endpoints and rollout gates.
- New takes are shown promptly; the first allowed clip can fill an empty scene slot, while
  replacement clips require selection. Together renders an MP4 with optional music, voice and
  transitions, and exposes download. Scene/cartoon text copying is also implemented.
- Release tooling, NAS backups and the Android Fire HD 10 wrapper.

Remaining work includes export packs, automated continuity checking, the Director chat agent,
AI voices, mixed-media references and native provider draft completion. Live access/quality/
billing for newly registered model families and physical tablet/teen usability remain separate
acceptance work. See the latest review for current recipe-selection and copy issues.

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
npm test -w @storyboard/compiler       # pure compiler regressions
npm test -w @storyboard/models         # catalogue/codegen consistency
npm test -w @storyboard/api            # API tests against local Postgres
npm run release -- --dry-run           # plus the browser suite against the built image
```

The API tests hit a real database on purpose: row-level isolation, the 1:1 series-bible
transaction, logical delete and enum constraints are database-enforced properties, and a fake
would not catch a regression in any of them. Tests use disposable accounts and an injected AI
provider; they never spend model credits.

## Layout

```
packages/vocabularies/   vocabularies.json, the single authority for prompt phrases
packages/compiler/      pure scene and character-sheet prompt compilation
packages/models/        endpoint catalogue, capabilities and generated registry
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
