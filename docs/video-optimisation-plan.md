# Video optimisation: models, prompts and continuity (proposal v1, draft)

28 September 2026 · branch `feature/video-optimisation` · **proposal only, nothing built.**

Builds on [openart-fal-continuity-review-2026-09-27.md](openart-fal-continuity-review-2026-09-27.md),
[media-generation-architecture.md](media-generation-architecture.md) and
[spike/continuity-benchmark.md](spike/continuity-benchmark.md). Those documents chose the direction:
approved looks, reference manifests and a benchmark gate. This one checks what the code does
today, end to end, and proposes the work that gets good, consistent clips to the child.

Evidence used: the code on `main` at `dca8b5f`, `packages/models/models.json`, and fal's public
OpenAPI input schemas for 36 endpoints, fetched on 28 Sep. Fetching a schema is free and runs no
generation. **No paid generation was run.** Every quality claim below is a hypothesis for the
benchmark, not a result.

---

## 1. Summary

**What a child gets today (Simple mode, the default):**

1. **No character pictures reach the video model.** Every model that accepts reference pictures is
   gated to Advanced (`video.rollout: 'advanced'`). In Simple mode "use my characters" fails with
   "No clip maker that uses character pictures can make this yet", and the child falls back to
   words only. Continuity between scenes then rests on the words alone.
2. **Character pictures are drawn with no art style.** Character Studio compiles its sheets from
   the series bible's `art_style`. The bible is created empty and no screen edits it, so the style
   phrase is `''`. Scenes fall back to `2d_flat_vector`, or to whatever style the child picked for
   that scene. The approved look and the clip can disagree about the style from the start.
3. **Style is chosen per scene.** The Create screen saves the style onto each scene ("Style saved
   for this scene"). Scene 3 can be claymation while scene 4 is flat 2D. Nothing in the cartoon
   holds one style.
4. **Preview and final come from different models.** A preview goes to the cheapest model that
   fits (Wan 2.2 5B, 580p) and a final to the highest tier (Veo 3 Fast). The final is a different
   model family from the preview the child approved. It is not a sharper copy of it.
5. **The prompt is written for a still picture.** `compileShot` deliberately leaves out camera
   movement (D6). It starts with style and lens words and ends with the palette. Video models
   respond best to subject, action and motion first. Nothing is tuned per model.
6. **Some providers rewrite our reviewed prompt.** Hailuo-02 (the Medium tier) runs with
   `prompt_optimizer` defaulting to **on**. Veo 3 Fast defaults `auto_fix` to **on**, which
   rewrites prompts that trip its filter. Either way the model can receive words that our Claude
   safety review never saw.

**What we propose** (details in §4–§7):

- **One cartoon look.** The style is chosen once per cartoon. Character pictures, scenes and clips
  all use it, and a style reference picture is sent with every clip. Changing the style is an
  explicit "restyle" that proposes new looks.
- **One cartoon recipe.** A cartoon keeps one model family, one resolution and one frame rate
  unless a grown-up changes it. A final is made by the preview's model, with the preview's seed
  where the model accepts one.
- **Characters by picture, in every mode.** Promote one reference-capable family to production
  after a spend-capped live check and the continuity benchmark. Until then, say plainly when a clip
  is "from words only".
- **A video prompt compiler (template v2).** Motion first, then camera movement, with reference
  tokens placed inline next to each character's name. A per-model *prompt profile* in
  `models.json` covers token style, length, negative support and rewriting switches.
- **Continuity is checked, not assumed.** Add a server-side continuity report per cartoon (who,
  which look, which style and which model in each scene), plus contract tests proving the same
  character carries the same pinned pictures into every scene.

---

## 2. What happens today: the path from scene to model

```
Scene (text, mood, time, style override)
  └─ syncSceneShots → compileInput (shots/sync.ts)
       ├─ bible: art_style ('' → 2d_flat_vector), line/palette/lighting/negative: all '' (never edited)
       ├─ scene.styleOverride: the per-scene style picked on the Create screen
       └─ characters: saved cast → pinned look traits (compileCharacter)
                      otherwise  → live character promptToken + default costume
  └─ compileShot (packages/compiler) → shots.compiled_prompt / compiled_negative_prompt
POST /shots/:id/videos (routes/production.ts plan())
  ├─ task: start frame → image-to-video; continuity → reference-to-video; else text-to-video
  ├─ manifest: buildManifest(cast, 8), then 1 view each if nothing fits (shots/cast.ts)
  ├─ model: preview → cheapest fit; final → 'recommended', else highest tier
  ├─ prompt: compiled_prompt + child's note; promptWithReferenceTokens appends "@Image1: Bunny" lines
  └─ CreativeVideoSnapshot (frozen recipe) → job → runner → buildVideoPayload (video/adapters/catalogue.ts)
```

### Verified findings

| # | Finding | Where | Effect |
|---|---|---|---|
| F1 | Every reference-capable model is `rollout: advanced`, `verified_live: false`. `VIDEO_FAMILY_ROLLOUT` defaults to `advanced`. | models.json, `generation/catalogue.ts:26` | Simple mode never sends character pictures; `continuity: true` ends as words-only. |
| F2 | The bible is inserted empty and has no edit route. `art_style`, `line_treatment`, `colour_palette`, `default_lighting`, `render_quality_tokens`, `negative_prompt` and `style_reference_asset_ids` stay empty for ever. | `routes/projects.ts:170` | Half of the compiler's style inputs are dead. The style reference pictures column is never read. |
| F3 | Character sheets use `projectStyle()`, which returns the bible's `''`. Scenes default to `2d_flat_vector`. | `routes/cast.ts:57`, `shots/sync.ts:51` | Looks are drawn in "no particular style"; the clips use a different one. |
| F4 | Style is a per-scene override (`PATCH /scenes { art_style }` → `style_override`). | `SceneComposer.tsx:203`, `routes/scenes.ts:263` | Style drifts scene to scene. `look.artStyle` is recorded but never compared with the scene style. |
| F5 | A preview picks the cheapest fit and a final picks "recommended", else the highest tier. | `routes/production.ts:276-283` | In Simple mode that is typically Wan 2.2 5B for the preview and Veo 3 Fast for the final. |
| F6 | The seed is captured (`providerResult.seed`) but never sent back. | `jobs/runner.ts:360` | A final cannot reproduce its preview even on the same model. |
| F7 | `compileShot` is a still-picture template (no motion step, D6); the order is style → lens → subjects → action → … → palette. | `packages/compiler/src/index.ts:168` | Action and motion come after lens jargon, and nothing says how the camera moves. |
| F8 | Reference tokens are appended as trailing lines (`@Image1: Bunny`). The subject sentence says only "Bunny: a small white rabbit…". | `video/adapters/catalogue.ts:11` | Seedance and Kling bind identity best when the token sits inline where the character acts. Wan and H3 expect "Image 1" positional wording, which we do send, but at the end, not in the action. |
| F9 | The negative prompt reaches only Wan 2.2 and Veo 3 Fast (plus the disabled Kling 2.1 and Wan i2v). None of the new families accept one. | `request_shape.negative_prompt` | "photorealistic, text, watermark" is silently dropped for 13 of 17 video models. |
| F10 | Hailuo-02 (`clip_medium`) does not set `prompt_optimizer: false` (default **true**). Veo 3 Fast does not set `auto_fix: false` (default **true**). Veo's `safety_tolerance` is left at 4 of 6. | models.json vs fal schema | The provider rewrites the reviewed prompt. The strictness is looser than we would choose for a teen. |
| F11 | Characters come from pinned looks **only when the cast is saved**. Otherwise the live `promptToken` is used, and it changes whenever the story or the Studio changes. | `shots/sync.ts:45-48` | Two scenes compiled a week apart can describe the same character differently. |
| F12 | A long text-to-video clip may be planned as **joined parts**, which are separate generations with no shared frame or seed. | `production.ts:258` | Visible jumps inside one clip. |
| F13 | Director Mode's still-picture jobs send **one** view per character; clips send up to 8. | `routes/director.ts:225`, `production.ts:240` | Fine for now; recorded so the benchmark tests both. |

What already works and should be kept: pinned looks (CS-10), ordered and hash-pinned manifests
(CR-03), refusing rather than truncating the cast (CR-04), the frozen `CreativeVideoSnapshot`, and
never silently falling back from references to text.

---

## 3. Model review

Prices are from `models.json` and the 27 Sep review. They are **not re-verified today**, so the
spend-capped check in §7 re-prices each one before use. "Rewrites" means a provider-side prompt
rewriter and whether we switch it off.

### 3.1 In the catalogue now

| Id | Endpoint | Status | Tasks | Refs | Length | Seed in | Negative | Rewrites | Audio | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| clip_low | Wan 2.2 5B t2v | **on, Simple Low** | t2v | – | 5 s | yes (unused) | yes | expansion off by default | – | Weak for cartoons (580/720p, 5 s). Keep only as the cheapest draft of **its own family**, or retire. |
| clip_medium | Hailuo-02 std t2v | **on, Simple Medium** | t2v | – | 6/10 s | no | no | **optimizer ON** | – | Set `prompt_optimizer: false` now (F10). Superseded by Hailuo 2.3 / H3. |
| clip_high | Veo 3 Fast t2v | **on, Simple High** | t2v | – | 4/6/8 s | yes (unused) | yes | **auto_fix ON** | yes | Good motion and sound. Set `auto_fix: false` and `safety_tolerance` ≤ 2 for the teen. No references on this endpoint. |
| move_maker | Kling 2.1 std i2v | off | i2v | – | 5/10 | no | yes | – | – | Retire; Kling O3 replaces it (§3.2). |
| sound_mover | Veo 3 Fast i2v | off | i2v | – | 4–8 | yes | yes | auto_fix off by default | yes | Keep off; Veo 3.1 reference replaces it. |
| budget_mover | Wan 2.2 5B i2v | off | i2v | – | 5 | yes | yes | – | – | Retire. |
| seedance_25 | Seedance 2.5 t2v | Advanced | t2v | – | 4–30 | **no** | no | – | yes | Premium; no seed on t2v. |
| seedance_25_refs | Seedance 2.5 ref | Advanced | refs | 30 | 4–30 | yes | no | – | yes | **Lead continuity candidate.** Wants `@ImageN` inline. Also offers `draft` (480p, `draft_id`, completes to 1080p within 7 days), which suits preview → final. `end_user_id` available. |
| seedance_25_i2v | Seedance 2.5 i2v | Advanced | start+end | – | 4–30 | no | no | – | yes | For "animate this approved picture". |
| wan_30 / wan_30_prime | Wan 3.0 t2v | Advanced | t2v | – | 2–30 | yes | no | expansion off ✓ | yes | Good native lengths at a simple per-second price. `enable_thinking` untested. |
| wan_30_refs | Wan 3.0 ref | Advanced | refs | 10 | 2–30 | yes | no | expansion off ✓ | yes | **Second continuity candidate.** Positional "Image 1" wording. |
| minimax_h3_max | H3 Max t2v | Advanced | t2v | – | 5–15 | yes | no | expansion off ✓ | always | Fast; returns `expanded_prompt` (store it for diagnosis). |
| ltx_25_fast / pro | LTX 2.5 t2v | Advanced | t2v | – | 6–20 even | no | no | – | yes | Has a native `camera_motion` enum (dolly, jib, static…), the only model with a camera control. Even lengths only. |
| hailuo_23 | Hailuo 2.3 std t2v | Advanced | t2v | – | 6/10 | no | no | optimizer off ✓ | – | Low priority. |
| flux_3_video | FLUX 3 t2v | Advanced | t2v | – | 5–20 | no | no | – | yes | `safety_tolerance: 0` ✓. Its keyframes sibling is interesting later. |

### 3.2 Siblings and new endpoints worth adding (schemas checked 28 Sep)

| Endpoint | Why | Notes from the schema |
|---|---|---|
| `minimax/h3-max/reference-to-video` | Continuity candidate named in the 27 Sep review but not yet in the catalogue. | Up to 9 images (12 media total), "Image 1" wording, seed, `prompt_expansion_mode` (set `disabled`), returns `expanded_prompt`. |
| `fal-ai/kling-video/o3/standard/reference-to-video` | **Named elements**: each character is its own `@Element1`, instead of pooled pictures. Start **and** end image. `multi_prompt` for multi-shot. | 3–15 s, max 2500 chars, `generate_audio` default off. At most 4 elements+images when a video is used. Needs a nested-payload adapter (`elements` is an array of objects). |
| `alibaba/wan-3.0/image-to-video` (+ prime) | Start and end picture on the same family as `wan_30_refs`, so a cartoon can stay on one family. | `start_image_url`, `end_image_url`, seed. |
| `minimax/h3-max/image-to-video`, `h3-max-turbo/image-to-video` | Start/end picture on the H3 family; Turbo as a fast preview. | Seed, end-only keyframe allowed. |
| `fal-ai/veo3.1/reference-to-video` | Adds references to the family that already makes our best High clips. | `image_urls` "for consistent subject appearance", no seed, `auto_fix` default off, 720p/1080p/4k. |
| `fal-ai/vidu/q2/reference-to-video` | Cheap reference option. | Up to 7 images, seed, `movement_amplitude`, 1–8 s. |
| `blackforestlabs/flux-3/keyframes-to-video` | Up to 10 approved pictures pinned to frame positions: a planned action between approved poses. | Later, after the benchmark. |
| `bytedance/seedance-2.0/mini/reference-to-video` | Cheaper Seedance for previews, **same prompt dialect** as 2.5. | 9 images, 480p/720p, 4–15 s. |

Not recommended now: `google/gemini-omni-flash/reference-to-video` (its own `<IMAGE_REF_0>`
dialect and an unclear version), and the Kling O1 reference endpoint (superseded by O3).

### 3.3 Recommended line-up (to confirm with the benchmark)

The rule is **one family per cartoon**. Preview and final should differ in size and effort, not in
model.

| Role | Primary (Seedance family) | Alternative (Wan 3.0 family) |
|---|---|---|
| Preview with characters | Seedance 2.5 ref with `draft: true` (480p, keeps `draft_id`); or Seedance 2.0 Mini ref | Wan 3.0 ref at 480p, same seed later |
| Final with characters | Complete the Seedance draft (native 1080p), or re-render with the same seed and references | Wan 3.0 ref at 720p/1080p, **same seed** |
| From an approved picture | Seedance 2.5 i2v (start + end) | Wan 3.0 i2v (start + end) |
| No characters (scenery) | Seedance 2.5 t2v | Wan 3.0 t2v |
| Specialist, benchmark only | Kling O3 reference (named elements) and H3 Max reference | |

Wan 3.0 is the cheaper, simpler-priced family; Seedance 2.5 is the premium one. Which becomes the
Simple-mode default is decision **V3**, settled by the benchmark's accepted-takes-per-pound figure.

---

## 4. Proposal A: switch on the new models, safely

1. **Contract tests first (free).** For every endpoint in §3.3, one test builds the payload from a
   fixed snapshot and compares it with a JSON fixture derived from the fal schema: field names,
   enums, rewriters off, audio flag, seed and token wording. Add a `npm run models:schema-check`
   script that refetches the public OpenAPI and fails on drift (a removed field, a changed enum or
   a new required field). It is run by hand or nightly and is never part of `npm test`, which
   must stay offline.
2. **Fix what's live now, zero cost:**
   - `clip_medium`: add `prompt_optimizer: false`.
   - `clip_high`: add `auto_fix: false`, plus `safety_tolerance: "2"` (the teen) or `"3"` (adults).
   - These change `request_shape.defaults`, which is catalogue data, not code.
3. **Catalogue additions:** H3 Max reference, Wan 3.0 i2v, Seedance draft support, and Kling O3
   (needs an `elements` adapter; see §5.4). Each is added as `rollout: advanced`,
   `verified_live: false`.
4. **Spend-capped live smoke test.** For each new endpoint: one 4–5 s 480p/720p clip with a fixed
   two-character fixture. Record the payload accepted, the seed and draft id returned, the real
   cost against the quote, and the wait. Then set `verified_live: true`. Budget: **ask before
   running; estimated $6–10 for ~12 endpoints**. It needs a grown-up-approved cap under
   `OPS_TRIAL_DAILY_USD` or an explicit one-off allowance.
5. **Continuity benchmark** ([spike/continuity-benchmark.md](spike/continuity-benchmark.md)) on the
   two candidate families plus Kling O3 and H3 Max. Its 80% accepted-take gate decides V3.
6. **Promote** the winning family: `rollout: production`, the Simple tiers repointed to it, and
   `VIDEO_FAMILY_ROLLOUT=all` for that family only. Keep the old Simple tiers enabled for one
   release as the fallback, then retire Wan 2.2, Hailuo-02 and Kling 2.1.

---

## 5. Proposal B: better prompts

### 5.1 A video template (compiler `TEMPLATE_VERSION = 'v2'`)

Add `compileVideoShot(input)` beside `compileShot`, equally **pure**. The still template stays for
thumbnails and start pictures. The proposed order, one short sentence per section:

1. **Who and what happens**: each character inline with its reference token, then the action.
   *"Bunny @Image1 hops onto the log and waves at Griggs @Image2, who jumps back in surprise."*
2. **Camera**: shot size + angle + **movement** ("wide shot at eye level, the camera slowly
   pushes in").
3. **Where and when**: location, scenery, time of day, weather.
4. **Light and mood**.
5. **Style**: the cartoon's art style phrase + line treatment + palette. It comes last because
   video models weigh the opening words most for content, and the style reference picture (§7.2)
   carries the look.
6. **Keep-outs**, written positively for models without a negative field: "clean frame, no
   on-screen text". This is at most one short sentence and only when `negative_prompt` is
   unsupported (F9).

Sound: when audio is on, add one sentence built from the scene ("birdsong and a soft splash") and
never dialogue (V6). When audio is off, send the model's audio flag as false; nothing about sound
goes in the words.

The compiler gains **one input it does not have today: `camera_movement`**. That is a new
vocabulary in `vocabularies.json` (static, slow push in, pull back, pan left/right, follow,
tilt up), which makes it a **spec change (CV-1)**; see V5. For LTX, the same value also maps to its
native `camera_motion` enum through the prompt profile.

### 5.2 Per-model prompt profile (catalogue data, not code)

Add to each video model in `models.json`, validated by `codegen.mjs`:

```jsonc
"prompt_profile": {
  "template": "video_v2",
  "reference_token": { "style": "inline", "format": "@Image{n}" },   // Wan/H3: "Image {n}"; Kling O3: "@Element{n}"
  "max_prompt_length": 2000,          // today's single 2000 stays the default; Kling 2500, LTX 5000
  "negative": "field" | "fold" | "none",
  "rewriters_off": { "prompt_optimizer": false },                     // asserted by a contract test
  "camera_motion_field": "camera_motion"                              // LTX only
}
```

`promptWithReferenceTokens` is replaced by the compiler placing tokens inline. The **manifest
order stays the single source of the numbering** (CR-03). The compiler receives the ordered
`(name, token)` pairs from the server and never numbers them itself.

### 5.3 Quality switches we currently leave on provider defaults

| Setting | Proposal |
|---|---|
| Rewriters (`prompt_optimizer`, `enable_prompt_expansion`, `prompt_expansion_mode`, `auto_fix`) | **Always off.** Enforced by a codegen rule: a model whose endpoint has a rewriter must name it in `rewriters_off`. |
| `expanded_prompt` / `actual_prompt` outputs | Store them in `providerResult` for diagnosis, adults only. |
| Seed | Send it where supported: a final reuses its preview's seed, and a retake gets a new one (V4). |
| Resolution / fps | Fixed per cartoon recipe (§7.3). LTX runs at 25 fps and the rest at their native rate. The recipe records it. |
| `duration: auto` | Never; we always send a number (the existing rule). |
| `end_user_id` (Seedance) | Send an opaque per-account hash, never the email. It helps the provider's abuse handling. |
| `safety_tolerance` / `enable_safety_checker` | Strictest usable value for the teen; recorded in the snapshot. |

### 5.4 Adapters

`catalogue-flat-2` covers flat schemas. Kling O3 needs `elements: [{ frontal_image_url,
reference_image_urls[] }]`, one element per character. That becomes adapter
`catalogue-elements-1`, recorded as `ADAPTER_VERSION` on the snapshot as today.

---

## 6. Proposal C: the same characters in every scene

### 6.1 What is guaranteed today, and what is not

- ✅ With a **saved** cast on a reference-capable model, the same look is pinned by id and hash
  (CS-10), and its pictures go in a fixed order (CR-03). Approving a newer look does not change
  shots already saved.
- ❌ In Simple mode no pictures are sent at all (F1).
- ❌ Unsaved casts use the live description (F11), and each scene's cast is saved separately. Two
  scenes can therefore pin **different looks** of the same character (for example scene 2 saved
  before a re-approval and scene 5 after it). Nothing warns about this.
- ❌ Pictures of the look were drawn without the cartoon's style (F3).

### 6.2 Changes

1. **Cartoon cast lock.** The first time a character's look is used in a cartoon, that look
   becomes the cartoon's look for that character: a `project_character_looks` row with
   (project, character, visual_version_id, outfit default). New scenes and unsaved casts bind to
   it automatically. Choosing a different look for one scene is an Advanced action with a clear
   "only this scene" label. Approving a new look asks: "Use Bunny's new look in all scenes?" and
   only then repoints the unmade scenes. Finished clips never change.
2. **Server auto-saves the proposed cast** when the child makes a clip, with every proposed
   character bound to the cartoon's look. This removes the "Check who is in this scene first"
   stop for the common case. Showing and editing the cast stays one tap away (CR-01's intent is
   kept: production still uses a saved list).
3. **Descriptions come from the look, always.** `compileInput` uses pinned-look traits whether
   or not the cast is saved, falling back to the live character only when there is no look.
4. **Pictures carry the style.** Character sheets compile with the cartoon style (§7.1). A look
   whose `art_style` differs from the cartoon's is flagged "drawn in a different style" and
   offered a restyle, never used silently in a clip of another style.
5. **Kling O3 (if chosen): one element per character**, frontal plus side views, so identity is
   bound per character rather than by picture position.

### 6.3 How we verify it (free, in CI)

- **Contract test:** a cartoon with three scenes and two characters. Saved, unsaved and new
  scenes all produce payloads whose reference URLs map to the **same asset hashes, in the same
  order**, and whose prompt names the same character next to the same token in every scene.
- **Look re-approval test:** approving a new look changes nothing until the "use in all scenes"
  choice, after which only scenes without a finished clip change.
- **Continuity report** (`GET /projects/:id/continuity`, adults and Advanced): for each scene, the
  characters, look version, reference hashes, style, model family, resolution, seed and whether
  the clip was "from words only". A report with mixed looks, mixed styles or words-only scenes
  shows a warning chip in Put it together.
- **Browser test:** make clips for two scenes with the fake provider. Both jobs' recorded
  `creative.references` match, and the words-only notice appears when no pictures were sent.

---

## 7. Proposal D: one style across the whole cartoon

### 7.1 Cartoon style, chosen once

- A **"Cartoon look"** choice in the cartoon's settings (and as the first question when a cartoon
  has no style yet). It writes the bible's `art_style` and `line_treatment`, and optionally a
  palette. It needs the bible PATCH route that does not exist today (F2).
- The per-scene style picker becomes Advanced-only and is labelled "Different look for this scene
  only". In Simple mode the Create screen shows the cartoon style read-only, with "Change for the
  whole cartoon".
- Character sheets, scene thumbnails, start pictures and clips all compile from the same bible
  style. `DEFAULT_ART_STYLE` moves to one shared helper, so `cast.ts` and `sync.ts` can no longer
  disagree (F3).
- Existing cartoons are migrated in a custom migration step: the bible's style becomes the most
  common scene style in the cartoon (or `2d_flat_vector`), and scene overrides that match it are
  cleared.

### 7.2 A style reference picture

- When the cartoon style is set (or the first look is approved), make or choose one **style
  frame**, an approved picture of the setting in that style. It is stored in the already-existing
  `style_reference_asset_ids`, hash-pinned like looks.
- Reference-capable models receive it as the **last** manifest entry, with role `style`, and the
  prompt says "match the art style of @ImageN". It counts against the reference limit and is
  never silently dropped: if it does not fit, the quote says so (CR-04).

### 7.3 One cartoon recipe

- A `render_recipe` on the bible: model family, preview size, final size, fps and audio default.
  It is set when the first final is made and shown in the continuity report. `plan()` prefers
  models from the recipe's family for every task. A scene that needs a task the family cannot do
  shows a notice before any money moves; it never switches silently.
- **Preview → final on the same family**:
  - Seedance: `draft: true` for the preview (480p), then native completion of the `draft_id`.
    Pricing for the completion is still unwired (DF-03); wire it here.
  - Others: re-render the preview's snapshot with its **seed** at the final size.
- **No joined parts for character scenes.** A long text-to-video clip is planned natively
  (Seedance and Wan reach 30 s). Joined parts remain only for scenery and are disclosed as today
  (F12).

### 7.4 Optional: carry the last frame forward (Advanced, later)

For a scene that continues the previous one, offer "start where the last scene ended". This uses
the previous final's last frame as the start picture **plus** the identity references, where the
endpoint takes both (Kling O3, Seedance ref with an image). Never chain only on generated frames,
because errors accumulate (27 Sep review).

---

## 8. Decisions to make

| # | Decision | Recommendation |
|---|---|---|
| V1 | Style per cartoon, not per scene, in Simple mode | **Yes.** The per-scene style stays as an Advanced override. |
| V2 | Cartoon cast lock with a server-side auto-saved cast | **Yes.** |
| V3 | Default family for Simple mode | **Decide after the benchmark.** Candidates are Seedance 2.5 (premium, native draft→final) and Wan 3.0 (cheaper, simpler pricing). |
| V4 | A final reuses its preview's seed and family | **Yes.** A retake uses a new seed. |
| V5 | Add a `camera_movement` vocabulary (a spec change under CV-1) | **Yes**, 7 values with kid-friendly labels ("Camera stays still", "Camera moves closer"…). |
| V6 | Sound: effects and ambience only, no generated speech | **Yes for v1.** Voices are a separate feature. |
| V7 | Spend for the live smoke test (~$6–10) and the benchmark (quoted before running) | **Needs your cap.** Nothing paid runs without it. |
| V8 | Retire Wan 2.2 5B, Hailuo-02 and Kling 2.1 after the new family is live | **Yes**, one release later. |
| V9 | Kling O3 elements adapter now, or only if it wins the benchmark | **Benchmark first**, with the adapter behind `rollout: advanced`. |

---

## 9. Staged work (each stage ships on its own; tests use the fake provider only)

| Stage | Contents | Done when |
|---|---|---|
| **0. Quick fixes** | `clip_medium` `prompt_optimizer: false`; `clip_high` `auto_fix: false` and `safety_tolerance`; the "from words only" notice when no pictures are sent; character sheets use the default style (F3). | Payload contract tests pass; the browser test shows the notice. |
| **1. Cartoon style** | Bible PATCH route; "Cartoon look" UI; per-scene style made Advanced; migration; shared default style. | A 3-scene fixture compiles one style everywhere; no scene override in Simple. |
| **2. Cast lock** | `project_character_looks`; auto-save cast; look-based descriptions always; "use new look in all scenes"; continuity report. | The §6.3 tests pass. |
| **3. Video template v2** | `camera_movement` vocabulary (after V5); `compileVideoShot`; prompt profiles; inline tokens; rewriters-off codegen rule; `expanded_prompt` stored. | Compiler at 100% coverage and byte-identical in Node and the browser; per-model payload fixtures. |
| **4. Models** | Catalogue additions (§3.2); `models:schema-check`; the Kling elements adapter behind Advanced. | Contract fixtures for every endpoint; schema check clean. |
| **5. Live check + benchmark** *(paid, capped)* | Smoke test, then the continuity benchmark. | `verified_live` set per endpoint; results in `docs/spike/results/continuity/`. |
| **6. Recipe and promotion** | Render recipe; same-family preview → final; seed reuse; Seedance draft completion priced; style frame reference; winning family to production; old tiers retired a release later. | A child in Simple mode makes a 3-scene cartoon where every character scene sent pictures, one style and one family, and the continuity report is clean. Checked on the tablet on the LAN IP. |

Stages 0–4 cost nothing to run. Stage 5 is the only paid step and waits for V7.

## 10. Risks

- **The benchmark picks nothing.** Then Simple mode keeps words-only clips with the honest notice,
  and stages 1–3 still improve style and prompts.
- **Provider schema drift** (we have been caught by Wan resolutions and Veo durations before):
  schema check plus contract fixtures.
- **Reference-capable models cost more.** Seedance is ~4–5× Wan per second. The recipe makes the
  cost visible per cartoon, and quotes stay the single authority.
- **Locking the cast feels restrictive.** A per-scene override stays in Advanced, and a
  re-approval asks before it changes anything.
- **Style frame counted against reference limits.** It never silently drops a character; the
  quote refuses instead (CR-04).
