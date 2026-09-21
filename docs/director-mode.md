# Director Mode — how it is built, how to run it, and its limits

_Implemented 21 September 2026 against [director-mode-plan-v1.md](director-mode-plan-v1.md)
(decisions D27–D40, requirements DM-1–DM-28). The Director agent (DM-29/30) is not built._

## Setup

1. Get a fal.ai key from https://fal.ai/dashboard/keys and put it in `apps/api/.env` as
   `FAL_KEY`. Leave it blank and every picture maker is hidden; the rest of the app keeps working.
2. `ANTHROPIC_API_KEY` must also be set: the same key runs the safety checker (prompt and picture
   review) and the cast finder. On the teen account, generation refuses to run without it.
3. Install ffmpeg. On Windows `winget install Gyan.FFmpeg`, then put the full paths in `.env` as
   `FFMPEG_PATH` and `FFPROBE_PATH` (a shell started before the install will not see them on
   PATH). The Docker image installs ffmpeg itself.
4. `STORAGE_ROOT` is where pictures, clips and renders are written (`./storage` locally; a NAS
   folder mounted at `/data/storage` in production, see `deploy/synology/docker-compose.yml`
   and `STORAGE_DIR` in its `.env`).
5. `npm run db:migrate` applies `0006_director_mode`, then `npm run dev:api` and `npm run dev:web`.

The model catalogue is `packages/models/models.json`. The six entries there are the ones the
adult can switch on; their `provider_model` ids and `unit_cost_pence` are best-effort as of
September 2026 and should be checked against fal.ai's price list when a key is first added.
Editing the catalogue is a JSON change plus `npm run codegen -w @storyboard/models`; the test
fails if a model's capabilities do not make sense for its kind.

## Shape

```
packages/models        the catalogue and its validator (D27)
packages/compiler      the pure prompt compiler, 100% covered (DM-10)
apps/api/src/generation  provider interface, fal adapter, fake provider, catalogue, budget,
                         review (Claude), media (ffmpeg)
apps/api/src/storage     ObjectStore (disk, memory) and upload sniffing/stripping
apps/api/src/jobs        the runner (queue) and the timeline renderer
apps/api/src/shots       one shot per scene, compiled and kept in sync (D34)
apps/api/src/cast        the cast finder (Claude)
apps/api/src/routes      director.ts (models, shots, jobs, heroes, media, budgets),
                         cast.ts, timeline.ts
apps/api/src/director.ts composition root; tests inject fakes here
```

A generation request is one row in `generation_jobs`, created inside a transaction that locks
the account row and reserves its estimated cost in `generation_ledger`. The runner claims rows
with `UPDATE … RETURNING`, heartbeats while it polls the provider, downloads the results into the
object store, extracts a poster frame for clips, runs the picture review, and writes `assets`.
Picking a take (`POST /shots/:id/hero`) is the accept step; nothing becomes the scene's picture
until then. A job is retried at most twice and only on a provider outage; anything that ends
without a result refunds the reservation.

The three safety gates (D32): the prompt is reviewed before submission; the provider's strict
safety flag is requested for the teen account; every returned picture and two poster frames of
every clip are reviewed before the child can see them. A rejected take is stored with its reason,
hidden from the teen (the file route returns 404), and listed for the adult at
`GET /projects/:id/held-back`. On the teen account all three gates fail closed: no reviewer, no
generation.

## What is verified

- `apps/api/test/director.test.ts` (14 tests, real Postgres, fake provider, memory store, fake
  reviewer and finder): shot compilation and sync; picture jobs end to end with settlement;
  idempotent request keys; hero pick, media bin and timeline resolution; clip jobs with a real
  one-second MP4 when ffmpeg is present (poster extraction and frame review), and the held-back
  behaviour when it is not; the daily cap inside the reservation; gate 1 and gate 3; cancel with
  refund; outage retries then failure with refund; cross-account 404s; the cast proposal, accept,
  stale-story conflict, drawing a character and attaching its picture to scene jobs; upload
  sniffing; the render job (a real MP4 when ffmpeg is present); adult budget settings.
- `apps/api/test/generation-provider.test.ts` (31 tests): the provider contract against the fake
  and the fal adapter with a scripted `fetch`, including every error mapping and that no upstream
  body text reaches a message.
- `packages/compiler` (52 tests, 100% coverage): golden files, the five-level lighting fallback,
  dedupe, determinism over 100 runs, a source scan for impurity.
- `packages/models`: catalogue validation.

- **Real fal.ai runs (21 September 2026, adult account, reviewer off):** FLUX Schnell made two
  1024×576 pictures in 6 s; Nano Banana edit made a picture from a cast reference in 12 s; Wan 2.2
  made a 3.4 s clip with a poster in 18 s; Kling 2.1 made a 5.0 s clip with a poster in 3 m 43 s.
  Two catalogue mistakes were found and fixed by fal's validation detail (now logged server-side):
  Wan wants `580p`/`720p`, Veo 3 wants `4s`/`6s`/`8s` at `720p`/`1080p`. Nano Banana edit refuses
  a request with no reference pictures, so `requires_reference_images` is a capability and the
  route says "give someone a picture in Cast" instead of submitting.

- **Real Claude runs (21 September 2026, teen account):** gate 1 and gate 3 allowed two FLUX
  pictures and a Wan clip (poster frames reviewed); the cast finder read the three beach scenes
  and returned Timmy and Sister with the right scene numbers; "Draw Timmy" produced two reference
  sheets; a Cast Picture job for scene 3 then carried Timmy's main picture automatically. One
  fix: Anthropic's structured outputs reject `maxItems`, so the finder caps the list after parsing.

Not yet verified: Veo 3 and FLUX Dev end to end, and the browser flows on the Fire HD 10.

## Limits and decisions worth knowing

- **One shot per scene in Simple mode.** Advanced mode's multi-shot editing has routes for
  patching a shot but no UI for adding shots yet.
- **Places have no reference pictures** (DM-8). The scene text describes the place.
- **Renders need ffmpeg.** Without it the render job fails with a message that says so; picture
  and clip generation still work, but a clip for the teen account is held back because its frames
  cannot be checked.
- **The runner is in-process.** One container, one runner. A second container would also run a
  runner, and claims are safe across instances, but nothing has been tested at that scale.
- **The catalogue's fal model ids and prices are unverified until a key is added.** A wrong id
  surfaces as "The picture maker could not use this request" on the first job; fix the JSON.
- **Voice is upload or browser recording only** (D33). No AI voices.
