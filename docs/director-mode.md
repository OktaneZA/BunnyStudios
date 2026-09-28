# Director / Create: implementation and operations

Updated 28 September 2026 against local code. **Director** remains an internal route/module
name; the main user-facing step is **Create**. See [current requirements](current-product-requirements.md),
[workspace behaviour](combined-scene-workspace.md) and [code review](review-2026-09-28.md).

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
5. `npm run db:migrate` applies all pending migrations, then `npm run dev:api` and `npm run dev:web`.

The model catalogue is `packages/models/models.json`. Edit the catalogue and run
`npm run codegen -w @storyboard/models`; validation checks generated definitions and
capabilities. Prices and availability are configured estimates, not independently verified
live facts. See [the registry guide](video-model-registry.md) for rollout gates.

## Current workflow

Create combines scene text, accepted characters, style and length. Optional scene details,
writing help and technical controls expand on request. The action explicitly says Make
preview or Make final clip and includes the quoted estimate. The adjacent panel shows the
result, selection state and other takes. Put it together assembles selected clips and offers
Save video, with missing scenes identified and optional music, voice and timing controls.

There is one primary production path in SceneComposer; the earlier competing text-only and
character-conditioned cards and cost-level controls are no longer the Simple-mode interface.
Words-only, starting/ending pictures and direct-final requests remain explicit options.
First-time cast confirmation and approval of character looks are separate from generation.

## Runtime ownership

| Code | Responsibility |
|---|---|
| `packages/compiler`, `packages/vocabularies` | Pure prompts and controlled vocabulary |
| `packages/models`, `generation/catalogue.ts` | Endpoint metadata, availability and capability matching |
| `routes/production.ts`, `shots/cast.ts`, `cast/looks.ts` | Quotes, snapshots, approved references and transactional submission |
| `video/creativeVideoRequest.ts`, `video/adapters/catalogue.ts` | Persisted creative inputs and resolved provider adaptation |
| `generation/fal.ts`, `generation/review.ts` | Shared queue transport and account-policy review |
| `jobs/runner.ts`, `generation/budget.ts` | Claims, resumable provider work and allowance settlement |
| `storage/`, `generation/media.ts`, `jobs/render.ts` | Owned media, posters and final assembly |
| `director.ts`, `app.ts` | Dependency composition, route registration and runner lifecycle |

A production submit replans the request and compares a supplied quote fingerprint before
reservation. The browser always supplies it; legacy callers may omit it. Account locking and
an idempotency key protect job creation and spending. Separate paid attempts have separate
reservations, even when linked through a preview/final generation group.

The runner persists provider/part IDs and uses claim fencing. Unsubmitted failures can refund;
submitted or ambiguous failures/cancellations retain estimated cost marked unknown. A result
settles at an actual cost when known, otherwise an estimate. Never promise every failure is free.
Character outputs become candidates; a successful job does not approve a canonical look.
An allowed video fills an empty hero slot, but never replaces an existing chosen clip.

## Limits and verification

- Simple mode edits one shot per scene. Multi-shot authoring is not a completed UI.
- Character-reference and image-to-video tasks are implemented, but depend on endpoint
  availability and rollout gates. New catalogue families remain Advanced-gated unless
  configuration explicitly overrides that gate. Registration is not live verification.
- A preview-based final is a new render. Native provider draft completion is unavailable;
  references are images only. Mixed video/audio conditioning is not implemented.
- Text-to-video may use planned parts and trimming; reference/frame workflows need compatible
  native lengths. Quote details disclose generated seconds and parts. Neither continuity
  nor a higher-quality final is guaranteed by the planner.
- The first allowed preview may already be in the cartoon. A later final still needs
  **Use this clip** to replace it. Recipe/current-scene selection gaps are in the review.
- Voice is uploaded or browser-recorded; no AI voices. ffmpeg is required for assembly and
  video review preparation. The runner remains in-process; multi-instance use is unverified.
- Current targeted UI evidence: web build plus 14 fake-provider browser regressions on a LAN
  origin. Earlier live checks on 21 September covered selected legacy FLUX, Nano Banana, Wan
  and Kling paths, not all newly registered families. See Character Studio status for pending
  access, billing and continuity work. Physical tablet and teen sessions remain pending.

MP4 download exists. Export-pack workflows, automated continuity checking and the Director
chat agent remain planned. No deployment or new paid-provider verification is implied here.
