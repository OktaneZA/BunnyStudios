# Director Mode — Requirements & Build Plan (v1.0)

_Drafted 21 September 2026. Clickable screen-flow mockup: https://claude.ai/artifact/12LvycH28LDtQTdZZjC28f (private). Extends [build-plan-v1.1.md](build-plan-v1.1.md) (D1–D18) and
[architecture.md](architecture.md) (D19–D26). New decisions here are D27 onwards. Where this
document and the original spec disagree, this document wins for Director Mode; nothing here
changes Phase 1 behaviour._

## 1. What we are building

Phase 1 lets a young creator plan a cartoon: scenes with a description, camera angle, time of
day and mood, an optional sketch, and text to copy into an external tool. Director Mode is the
next room in the studio. It takes those scenes and, inside the app, turns them into pictures,
then moving clips, then one finished cartoon with sound.

The reference is OpenArt's Director Mode (screenshots reviewed 21 September 2026). The parts
of it we are adopting:

| OpenArt feature | What we take from it | What we leave |
|---|---|---|
| **Model picker** with capability badges (Reference, Start/End, Audio, Multi-shots, resolution range, duration range) and provider/feature filters | The idea that models are *data* with declared capabilities, and the UI shows only what a model can do. | The 30-model catalogue. We ship the few we have keys and a budget for. |
| **Generate panel**: visual references, prompt, camera, output settings (aspect · resolution · duration), audio toggle, batch count, credit cost shown on the button | All of it, translated into kid language and pre-filled from the scene. | "Auto Polish" as a silent rewrite. Ours goes through a proposal the user reads. |
| **Character library** with uploaded drawings, several angles, an optional voice and a background story | Character reference images become first-class (this is what the spike was designed to discover), but the cast is found from the story rather than entered (D39). | A separate library screen. Voice cloning in v1; voice is a later decision (D33). |
| **Director project**: Shot / Scene / Timeline tabs, a preview player, media bin, music, voiceover and caption tracks, add shot, export | The whole shape, simplified: one Director tab that reads the storyboard, one timeline per cartoon in story order, music and voiceover tracks. | Captions, a separate media bin and hand-ordered timelines in v1. |
| **Chat to edit** with an agent that plans, generates and re-renders on request | Deferred to the last stage, on top of the proposal lifecycle, once manual Director works. | Free-form chat that spends money on the child's behalf without an accept step. |
| **World** (navigable 3D environment, "Take shots") | Nothing in v1. Noted as a candidate for a later phase. | |

Everything below sits on the existing rules in [CLAUDE.md](../CLAUDE.md): kid-facing language,
vocabularies as the single authority, a pure compiler with the server as the only compilation
authority, AI proposes and the user disposes, `account_id` everywhere, nothing hard-deleted.

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| D27 | How do we talk to many image and video APIs? | **One `GenerationProvider` interface (spec GP-1), several adapters, and a data-driven model catalogue.** The catalogue (`packages/models/models.json`) lists every model we offer with its provider, kind, capabilities, limits and unit cost, exactly like `vocabularies.json` lists vocabulary. Routes, validators and the picker all read it. Adding a model is a JSON edit plus, at most, one adapter. |
| D28 | Which adapters first? | **fal.ai first (confirmed 21 September 2026), one direct API second.** fal.ai's queue API (submit to a model endpoint, poll a status URL, fetch the result, cancel) maps one-to-one onto the `GenerationProvider` interface, hosts both image and video models behind a single server-side key, and bills on one line. A second, direct adapter (Google's Gemini API for Imagen and Veo, or OpenAI for image and Sora) proves the interface is not aggregator-shaped. Anthropic stays for text, review and the Director agent. Exact model names live in the catalogue, not in code, because the market changes monthly. |
| D29 | Where do generated files live? | **A mounted volume on the NAS (confirmed 21 September 2026), behind an `ObjectStore` interface.** SVG sketches stay in Postgres. Images and video go to disk under `storage_key`, served by the API with ownership checks. Azure Blob is a second `ObjectStore` implementation later. Nothing in a route touches the filesystem directly. |
| D30 | Long-running jobs | **The table-backed queue from architecture change D becomes mandatory now.** Video generation takes minutes and survives a release. `generation_jobs` is the queue; a runner claims rows with `UPDATE … RETURNING`, polls the provider, and writes results. Webhooks are an optimisation, not a requirement. |
| D31 | Money | **Real cost is tracked per generation in a ledger and capped per account per day and per month.** The teen account's cap is set by the adult account and cannot be raised by the teen. The estimated cost is always shown in plain words beside the button before anything is spent. Runaway retries are impossible by construction: a job retries at most twice and only on a provider error, never on a content rejection. |
| D32 | Safety for generated pictures and video | **Three gates.** (1) The compiled prompt is reviewed by Claude against the account policy before submission. (2) The provider's own safety setting is set to its strictest available level for the teen account. (3) Every returned image and every video's poster frames are reviewed by Claude vision before the child sees them; a rejected take is stored, hidden, and visible only to the adult account. The teen policy is always on for the teen account (D16). |
| D33 | Voice and sound | **Music and voiceover are uploads and a small licensed library in v1.** AI voice generation for characters is a separate decision after Director ships; the data model leaves room (`characters.voice_asset_id`, `voiceDirection` already exists). |
| D34 | Scene to shot | **Simple mode: one shot per scene, made automatically and kept in sync.** The child never sees the word "shot". Advanced mode can split a scene into several shots, which the spec already models. The compiler compiles shots; Simple mode's one-shot-per-scene is what makes that invisible. |
| D35 | Takes and heroes | **Every generation produces takes; picking one is the accept.** A take is an Asset of kind `generated_output` attached to the shot. Nothing becomes "the picture" or "the clip" for a shot until the user taps **Use this one**. This is the proposal lifecycle (AI-1) applied to media: the takes are the payload, the hero choice is the accept. |
| D36 | Final film | **Assembled on the server with ffmpeg.** Timeline order, per-clip trims, one music track, one voiceover track, fades. Output is an MP4 the user can download or play in the app. No browser-side rendering. |
| D38 | Structure | **Two tabs on a cartoon: Story and Director. Nothing else.** Story is the storyboard exactly as today; the place and the people are part of each scene's text. Director reads the storyboard and never edits it. There is no separate Cast or Places screen and no guided rail: the cast is found from the scene text (D39) and shown inside Director, and the only sequence the child sees is per scene, "picture, then make it move", followed by "put it together". |
| D39 | Where the cast comes from | **Found from the story, not entered.** The Director tab asks Claude to list the characters named across the cartoon's scenes with a one-line description drawn from the text, as a proposal the user can trim. Each found character can then be given reference pictures. Editing how someone looks means editing the scenes in Story, which re-runs the cast proposal and marks pictures as possibly out of date. |
| D40 | Joining scenes | **Exactly three transitions: Cut, Fade, Slide.** Chosen per join between two scenes, default Fade, with a "use this for every scene" shortcut. Each maps to one ffmpeg filter. No other transitions, no durations to set, no per-clip trims in Simple mode. |
| D41 | Straight to clip (21 September 2026) | **No picture step.** A scene goes from its text straight to a clip with a text-to-video model. The child picks a cost level, **Low cost, Medium or High**, and a length; the catalogue maps each level to one model (`tier`). The finished clip drops into the story order by itself; the child can still make another and pick between them. Image models stay for drawing the cast. Image-to-video models stay in the catalogue, off, for a later Advanced path. Supersedes DM-14/15's picture step and DM-18's start frame for Simple mode. |
| D42 | Switching between writing and making (24 September 2026) | **Three numbered steps, one header, two verbs.** Every cartoon screen, a scene's own page included, starts with the title and **1 Write · 2 Make clips · 3 Put it together** on the same row; the current step is lit. Supersedes D38's Story and Director tab names. A scene looks the same in both steps: its clip, else its sketch, else an empty slot, with one state word (In the cartoon, Making…, No clip yet, Needs a description). A scene opened from Make clips returns there ("Back to making clips"); a scene page keeps "Scene 2 of 4", the arrows and "Make this scene's clip" in a bar that never scrolls away. The sketch is an optional, closed section. |
| D37 | What the Director agent may do | **Plan and propose, never spend without an accept.** The agent (Claude) can propose shot lists, prompts, model choices and timeline changes as tree-scope proposals. Generation is always triggered by the user tapping a button that shows the cost. |

## 3. Requirements

IDs are `DM-*`. Acceptance criteria are what the tests and the manual runtime check must show.

### 3.1 Model catalogue and providers

| ID | Requirement | Acceptance criteria |
|---|---|---|
| DM-1 | `packages/models/models.json` is the single authority for generation models. Each entry has `id`, `provider`, `kind` (`image` or `video`), `label`, `friendlyLabel`, `help`, `capabilities` (`reference_images`, `start_frame`, `end_frame`, `audio`, `multi_shot`, `image_to_video`, `text_to_video`), `aspect_ratios`, `resolutions`, `duration_seconds` (min, max, step), `max_reference_images`, `max_prompt_length`, `unit_cost` (per image or per second of video, in the account's currency), `enabled`. | `npm test -w @storyboard/models` fails on a missing field, a duplicate id, an unknown provider, or a `kind` whose capabilities make no sense (an image model with `duration_seconds`). The API validators, the picker and the cost estimate all import the generated types. No model id is written in application code. |
| DM-2 | `GenerationProvider` interface: `capabilities(modelId)`, `submit(request) → providerJobId`, `poll(providerJobId) → status`, `fetchResult(providerJobId) → files[]`, `cancel(providerJobId)`. | Unit-tested against a fake provider. Every adapter passes the same contract test suite with recorded fixtures. No adapter reflects upstream response bodies into errors shown to the user. |
| DM-3 | At least two adapters ship: one aggregator and one direct API (D28). Keys are server environment only. | `GET /api/v1/settings/generation` returns which models are enabled and nothing about keys. An adapter with a blank key marks its models disabled and the picker hides them with a note the adult can read. |
| DM-4 | The picker shows only capabilities a model has, and the generate panel disables controls the chosen model lacks (spec GP-3). | Choosing a model without `end_frame` hides the end-frame slot; choosing one without `audio` hides the sound toggle; durations snap to the model's range. Tested in the browser suite. |

### 3.2 Cast found from the story

| ID | Requirement | Acceptance criteria |
|---|---|---|
| DM-5 | Opening Director on a cartoon shows **Your cast**: the characters found across its scenes (D39), each with the scenes they appear in and a description pulled from the text. Finding is a Claude proposal; the user can remove a wrongly found entry or add one that was missed. | Found cast is stored as `characters` rows flagged `source = story`, keyed to the cartoon, with the scene ids they were found in. A scene text change re-runs the proposal and only adds or updates entries; it never deletes a character that has pictures. |
| DM-6 | A found character can hold up to six reference pictures (`character_ref` assets): uploads or pictures the app made. One is the main picture. | Upload validates magic bytes, strips EXIF, limits to JPEG/PNG/WEBP and 10 MB (NF-19). The Director cast strip and the generate panel show the main picture. |
| DM-7 | **Draw <name>** makes reference pictures from the found description using an image model, as takes; **Use this one** sets the main picture. **More angles** makes side and back views from the main picture using a model with `reference_images`. | Same take/hero lifecycle as scenes (D35). Never edits the scene text the description came from. |
| DM-8 | Generation requests for a scene attach the main pictures of the characters found in that scene automatically, when the model supports references, up to its limit. The child is not shown which pictures were attached. Places are described in the prompt from the scene text; there are no place reference pictures in v1. | The request the fake provider receives lists the expected asset ids in the expected order. Over the limit, Advanced mode says which pictures were left out and why. |
| DM-9 | A found character keeps an optional background story (text) for the Director agent. Voice audio is out of scope (D33). | Field saves; the Director agent reads it; nothing else does. |

### 3.3 Shots and prompts

| ID | Requirement | Acceptance criteria |
|---|---|---|
| DM-10 | The Phase 2 prompt compiler is built as planned (pure, shared, golden-file tests) and compiles a shot to one paragraph plus a negative prompt. Model-specific phrasing is a small post-step keyed by catalogue `provider`, also pure. | Byte-identical output in Node and the browser for the fixture set. Coverage 100%. Vocabulary phrases are read from `vocabularies.json`, never retyped. |
| DM-11 | Simple mode keeps one shot per scene (D34), created and updated by the server when the scene changes. The Director scene screen shows the compiled prompt as **What the picture maker will be told**, read-only, with an **Anything to add?** field that maps to `user_prompt_addendum`. The Story tab never shows a prompt. | Saving a scene updates its shot's compiled prompt in the same transaction. A scene with no shot on load gets one. Advanced mode can add, reorder and delete shots. |
| DM-12 | **Help me write this** on a shot or the wording field goes through the existing writing proposal lifecycle. Nothing is rewritten silently (no "Auto Polish"). | Same fingerprint, expiry and accept rules as scene improvement. |
| DM-13 | Prompt overflow against the chosen model's `max_prompt_length` blocks generation with an error that names the field to shorten (D11). | Tested per model limit from the catalogue. |

### 3.4 Pictures

| ID | Requirement | Acceptance criteria |
|---|---|---|
| DM-14 | **Make a picture** on a shot submits an image job with the compiled prompt, the references (DM-8), aspect ratio from the project, and a batch count of 1 to 4. The estimated cost and the remaining budget are shown in words beside the button, never inside it. | Job row created, quota and budget reserved in one transaction with `FOR UPDATE` on the account, `Idempotency-Key` honoured. Retrying a lost response does not double-spend. |
| DM-15 | Results arrive as takes on the shot; the user picks a hero with **Use this one**, or **Try again** with an optional note that is appended to the prompt for that run only. | The hero appears on the scene board in place of the sketch (sketch stays as fallback). Unchosen takes remain in the media bin. |
| DM-16 | Every returned image passes content review (D32) before display. | A rejected image is stored with `review_status = rejected`, hidden from the teen account, listed for the adult with the reason. Tested with a fake provider returning a flagged fixture. |
| DM-17 | The media bin shows every take for the cartoon, filterable by scene, kind and status, with delete (logical) and restore. | Bin lists, restore and ownership tests as for scenes. |

### 3.5 Clips

| ID | Requirement | Acceptance criteria |
|---|---|---|
| DM-18 | **Make it move** on a shot with a hero picture submits a video job: image-to-video from the hero as the start frame, duration from the model's range (default 5 s), sound on or off, resolution from the catalogue. Simple mode shows only "how long" and "add sounds", each with a one-line hint. An end frame from another take is Advanced mode only. Text-to-video is available when the shot has no hero and the model supports it. | Same job, budget, idempotency and review rules as DM-14 and DM-16. Video review uses poster frames at 0 %, 50 % and 100 %. |
| DM-19 | Video takes get a server-extracted poster (`poster_asset_id`) and a duration. The board shows the poster with a play badge. | ffmpeg in the container. Tested with a small fixture video. |
| DM-20 | Job progress is visible per shot: waiting, making, checking, ready, failed with a plain reason and what to do next. Progress survives a page reload and a release. | Runner claims are re-entrant (D30). A job older than its timeout is marked failed and refunded from the budget. |

### 3.6 Timeline and finished cartoon

| ID | Requirement | Acceptance criteria |
|---|---|---|
| DM-21 | Each cartoon has one timeline, seeded from scene order with each scene's hero clip. Reordering scenes reorders the timeline unless the user has changed the timeline by hand (Advanced only), in which case the app says so and offers **Match the scene order**. The timeline shows the total running time, a ruler in seconds, and Video, Sounds, Voice and Music lanes drawn to time. | Timeline rows carry `scene_id`, `asset_id`, `sort_order`, trim in and out, and `transition_out` (one of `cut`, `fade`, `slide`, D40). Total time is computed from the rows and matches the rendered file within one second. Ordering tests as for scenes; touch drag with the arrow fallback. |
| DM-21b | The join between any two scenes is one of three transitions (D40): **Cut**, **Fade** (default), **Slide**. A per-join picker offers the three with a one-line description each and **Use this for every scene**. | Each value maps to one ffmpeg filter (`concat`, `xfade=fade`, `xfade=slideleft`) with a fixed 0.5 s duration. A cartoon with all three renders correctly in a fixture test. |
| DM-22 | Music track: upload (MP3, M4A, WAV, 20 MB) or pick from a small bundled library, with a volume level and fade in/out. Voiceover track: upload or record in the browser, placed at a timeline position. | Magic-byte validation. Bundled library files carry their licence in the repo. Recording uses `MediaRecorder`, saved through the same upload path. |
| DM-23 | **Make my cartoon** renders the timeline to one MP4 on the server (D36) as a job, with the same progress states as clips. The result is a `final_render` asset with a download and an in-app player. | Rendered file plays in the app on the tablet. Re-rendering after a change produces a new asset; old renders remain in the bin. |
| DM-24 | A shot with no hero clip appears on the timeline as its hero picture (held for the shot's duration) or its sketch, so a cartoon can be previewed and rendered at any stage. | Rendering a cartoon with mixed clips, stills and sketches succeeds. |

### 3.7 Money, limits and safety

| ID | Requirement | Acceptance criteria |
|---|---|---|
| DM-25 | Every job writes a `generation_ledger` row: account, project, shot, model, units, estimated cost, actual cost when the provider reports it, and status. | Ledger totals per day and per month drive the caps. Tested. |
| DM-26 | Per-account daily and monthly budget caps. The adult sets the teen's caps; the teen can see but not change them. The app says how much is left today in plain words ("You can make about 6 more pictures today"). | A request over the cap is a 402 problem with a message saying when it resets. Caps are checked inside the reservation transaction. |
| DM-27 | The three safety gates in D32 apply to every generation for the teen account and the prompt and output gates apply to the adult account when the project's audience requires it. | Tests with fake provider and fake reviewer for each gate. A gate failure counts against the daily attempt limit but refunds the cost. |
| DM-28 | Provider keys never reach the client, logs or error bodies. Upstream error text is never reflected. | Grep-level test on adapter code plus the existing error-sanitising pattern. |

### 3.8 Director agent (last)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| DM-29 | **Ask the Director** on a cartoon: a chat that can propose a shot list for a scene, rewrite prompts, suggest a model per shot, and suggest timeline changes, each as a proposal with an accept. It never submits a generation job. | Every agent action is an `AiProposal` (tree scope for shot lists). The agent has read access to the cartoon, cast, places and catalogue, and to nothing private (`director_notes` excluded). |
| DM-30 | The agent's suggestions carry a cost preview when accepting them would lead to generations. | Shown before accept; nothing is spent on accept. |

## 4. Data model changes

Additive migrations only (D25). Every new table carries `account_id` and follows the 404 rule.

```
generation_jobs
  id, account_id, project_id, shot_id (null for character/location/final jobs),
  target_entity_type, target_entity_id, kind (image | video | render),
  model_id, provider, provider_job_id, request jsonb (prompt, refs, options),
  status (queued | submitted | running | reviewing | ready | failed | cancelled),
  attempt, claimed_by, claimed_at, error_code, error_detail (user-safe),
  created_at, updated_at, finished_at

generation_ledger
  id, account_id, project_id, job_id, model_id, units, unit_cost, estimated_cost,
  actual_cost (null until known), currency, status (reserved | settled | refunded), created_at

timelines
  id, account_id, project_id, version, hand_edited boolean, music_asset_id,
  music_volume, music_fade_in_ms, music_fade_out_ms, updated_at

timeline_items
  id, account_id, timeline_id, scene_id, shot_id, asset_id (null → fallback rule DM-24),
  sort_order, trim_in_ms, trim_out_ms, transition_out (cut | fade | slide), deleted_at

timeline_voiceovers
  id, account_id, timeline_id, asset_id, start_ms, volume, deleted_at

assets (existing) + review_status (pending | allowed | rejected | not_required),
  review_reason, kind gains 'final_render', 'character_ref' already present,
  deleted_at

characters (existing) + main_reference_asset_id, background_story, source (story | manual),
           found_in_scene_ids uuid[], description_fingerprint
accounts   (existing) + daily_budget, monthly_budget, currency
shots      (existing) hero_asset_id already present; add hero_video_asset_id
```

`generation_jobs` is the queue (D30). `ai_proposals` stays for text and sketch proposals and
for the agent; media takes do not need it because the take/hero lifecycle already provides the
accept step (D35).

## 5. API surface

All under `/api/v1`, snake_case, problem+json errors, `If-Match` on shot and timeline writes.

```
GET    /settings/generation                      enabled models, caps, remaining budget in words
GET    /models                                   catalogue (enabled only for the teen account)

POST   /projects/:id/cast/proposals              find the cast from the story (D39); accept creates/updates characters
GET    /projects/:id/cast                        found characters with main pictures and scene ids
POST   /characters/:id/references                upload (multipart)
POST   /characters/:id/jobs                      { kind: 'image', intent: 'portrait' | 'angles', model_id }

GET    /scenes/:id/shots
POST   /scenes/:id/shots                         Advanced only
PATCH  /shots/:id                                explicit optional fields, no defaults
POST   /shots/:id/reorder

POST   /shots/:id/jobs                           { kind: 'image' | 'video', model_id, options, note?, Idempotency-Key }
GET    /jobs/:id                                 status for polling; SSE later if polling hurts
POST   /jobs/:id/cancel
POST   /shots/:id/hero                           { asset_id }   the accept
GET    /projects/:id/media?kind=&scene_id=&deleted=true
DELETE /assets/:id  ·  POST /assets/:id/restore
GET    /assets/:id/file                          ownership-checked stream; posters cached

GET    /projects/:id/timeline
PATCH  /projects/:id/timeline                    music, volume, fades, hand_edited
POST   /projects/:id/timeline/items/reorder
PATCH  /timeline-items/:id                       trims, transition_out, asset swap
POST   /projects/:id/timeline/transitions        { transition_out } applies one join style to every item
POST   /projects/:id/timeline/voiceovers         upload or recording
POST   /projects/:id/timeline/render             { Idempotency-Key }  → job
POST   /projects/:id/timeline/match-scenes

POST   /projects/:id/director/proposals          agent (DM-29)
```

## 6. Screens and styling

The dark studio theme in `apps/web/src/styles.css` stays: the same tokens, radius, 44 px tap
targets, no hover-only controls, 1024 × 768 tablet landscape as the design target. Director
Mode adds screens; it does not restyle Phase 1. Clickable mockup of every screen below:
https://claude.ai/artifact/12LvycH28LDtQTdZZjC28f (private).

**Navigation (D38).** A cartoon has two tabs: **Story** and **Director**. Story is today's scene
board and scene editor, unchanged except for the tab and a **Ready? Go to Director** button at
the bottom of the board. There is no rail and no Cast or Places screen.

**Director is one screen.** Down the left, a **Cast** button and then one button per scene,
each showing its number, title and state (nothing yet, sketch only, picture, moving). The
selected scene is highlighted, so it is always obvious which scene is being worked on. The
middle is the current step for that scene. Along the bottom, **Your cartoon**: the total
running time so far, the scenes in story order as thumbnails each with its seconds, a small
transition button between each pair (D40), and beneath them four thin lanes drawn to time,
Video, Sounds, Voice and Music, so the child can see where sound exists and where it does
not. **Put it together** sits at the end. No large picture is shown in the working area; the
scene's state is visible in the left buttons and the bottom strip.

**Step 1, Make a picture.** One card: the compiled prompt read-only as **What the picture
maker will be told**, an **Anything to add?** line, the model card (tap to change), shape and
how many, and the **Make a picture** button. The cost and the remaining budget sit beside the
button in plain words, never inside it. Cast pictures are attached automatically; the child
is not shown a "using these pictures" strip. On the right, **Your takes** with the checking
state and **Use this one**, which moves to step 2.

**Step 2, Make it move.** The picked picture is shown small with one sentence: the clip begins
with that picture and the picture maker works out what happens next from the scene. Then the
model card, **How long should it play?** with a hint that 5 seconds suits one thing happening
and that longer costs more, and **Add sounds?** with a hint that this means waves, footsteps
and bounces, with music coming later. No start and end frame control; an end picture is an
Advanced-mode option only. The **Make it move** button has the cost beside it. On the right,
**Your clips** with progress (waiting, making, checking, ready) and **Use this one**, which
returns to the scene list with the scene marked as moving.

**Cast sheet.** Opens over Director from the Cast button or a cast name: the found cast as
chips, and for the selected person the description found in the story and the scenes it came
from, the reference pictures (main first, add slot last), **Draw <name>**, **More angles**,
**Upload a drawing**, and new takes with **Use this one**. A line says how to change how they
look: edit the scenes in Story.

**Model picker.** A sheet over the scene screen listing enabled models as rows: icon,
`friendlyLabel`, one-line `help`, capability chips in kid words ("Uses your cast pictures",
"Start and end picture", "Has sound", "Up to 10 seconds"), and the cost per picture or per
second. Filters: Pictures, Clips, Uses my cast, Has sound, Cheapest first. Advanced mode
shows `label` and the provider name.

**Put it together.** Player, then a timeline drawn to time: a ruler in seconds, the total,
a Video lane with each scene sized by its length (a scene without a clip shows its picture or
sketch for 5 seconds, an empty one is skipped and said so), a transition button between each
pair of scenes, a Sounds lane showing which clips carry their own sound, a Voice lane with
recordings placed in time, and a Music lane with the chosen track. Tapping a transition button
opens a three-option sheet: Cut, Fade, Slide, each with one plain sentence and a "use this for
every scene" link. Then **Make my cartoon**. Order follows Story; hand reordering is an
Advanced-mode option, not a default.

**Your cartoon.** The finished film with play, download, "change music or voice", what is in
it, a nudge for any scene still empty, and earlier versions.

**Grown-ups.** Adult-only: budgets per account, which picture makers have keys and are on,
held-back takes with reasons, and NAS storage.

## 7. Build sequence

Each stage is a release on its own and leaves Phase 1 working.

**DM stage 0 — Foundations.** `packages/models` with the catalogue and its tests;
`GenerationProvider` with a fake adapter and the contract suite; `ObjectStore` with the disk
implementation and the NAS volume in the compose file; `generation_jobs` runner with claims,
timeouts and refunds; `generation_ledger` and budget caps; Claude image review helper; ffmpeg
in the image. *Done: a fake job runs end to end through the queue and the ledger, on the NAS,
with nothing user-facing.*

**DM stage 1 — Compiler and shots.** Phase 2 as planned: `packages/compiler`, golden files,
one-shot-per-scene sync, the compiled-prompt box and **Change the wording** in the scene
editor. This stage does not depend on the spike having been run manually, because stage 3
will run it for real inside the app. *Done: every scene shows the paragraph the picture maker
will be told.*

**DM stage 2 — Cast found from the story.** The Director tab and home screen, the cast-finding
proposal (D39), the cast sheet with reference uploads, the fal.ai adapter with image models only,
**Draw <name>**, **More angles**, content review on images. *Done: the child opens Director and
sees their cast with pictures without having typed anything new.*

**DM stage 3 — Pictures.** The scene screen (step 1) with the model picker, **Make a picture**,
takes, heroes, budgets shown in words. *This is where the Phase −1 questions get answered
with real data: does a hero picture with references hold the character across scenes?* Record
findings in `docs/spike/results/findings.md` and retune the compiler if needed.

**DM stage 4 — Clips.** Video models in the catalogue, the second (direct) adapter, **Make it
move**, poster extraction, video review, progress that survives a release.

**DM stage 5 — Timeline and cartoon.** Timeline, music and voiceover, render job, player and
download. *Done: the Definition of Done for Director Mode (§9).*

**DM stage 6 — Director agent.** **Ask the Director** on top of the proposal lifecycle.

**Later, not planned here.** AI voices (D33), captions, World-style environments, per-account
provider keys (GP-4), Azure Blob store, sharing a finished cartoon by link.

## 8. Risks and what we do about them

- **Provider churn.** Models are renamed or retired monthly. Mitigation: the catalogue is data,
  adapters are contract-tested against fixtures, and a disabled model hides rather than breaks.
- **Cost surprises.** Video is priced per second and varies tenfold between models. Mitigation:
  estimated cost on every button, caps checked inside the reservation transaction, at most two
  retries, refunds on gate failures, a ledger the adult can read.
- **Character drift.** The spike was never run. Mitigation: stage 3 is the spike, with
  references attached, on the real pipeline. If references do not hold the character, the
  compiler's character section is retuned before clips are built.
- **Unsafe output reaching a child.** Mitigation: three gates (D32), rejected takes hidden and
  logged, the teen policy not switchable by the teen.
- **Long jobs on a home NAS.** Mitigation: the queue is a table, the runner is re-entrant,
  releases do not lose jobs, ffmpeg renders are bounded by timeline length and resolution.
- **Storage growth.** Video takes are large. Mitigation: logical delete with a bin, a
  per-project storage total shown to the adult, and a nightly sweep of bin items older than
  30 days (the only hard delete, adult-visible in settings).

## 9. Definition of done and verification

Director Mode is done when the teen, on the tablet, without help, can: open a cartoon they
planned in Phase 1, give two characters pictures, make a picture for each scene and pick one,
make at least one scene move, add a music track, press **Make my cartoon**, and watch the
result in the app. Sit them in front of it at the end of stage 3 and again at stage 5.

Runtime checks, per the standing rule, before any stage is called done:

- Real jobs against each enabled adapter on the NAS, not just the fake; keys in the container
  environment only; `GET /settings/generation` shows nothing secret.
- Kill the container mid-job and confirm the job finishes or fails cleanly after restart with
  the ledger consistent.
- Spend to the daily cap on the teen account and confirm the 402 message and reset time.
- A flagged fixture through each of the three gates, checked as both accounts.
- Drag on the timeline on the real Fire HD 10, with the arrow fallback.
- The browser suite on the LAN address covers the picker's capability gating, the take/hero
  flow with the fake provider, and the timeline reorder.
