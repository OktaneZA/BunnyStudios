# Storyboard Studio — Requirements Specification

**Version:** 1.0
**Date:** 7 September 2026
**Audience:** Development agent / engineering team
**Status:** Ready for build

> **27 September 2026 addendum:** [Character Studio requirements](character-studio-requirements.md)
> govern canonical character approval/versioning, production references, provider-neutral video,
> draft/final and spending controls. See the [delivery plan](character-studio-build-plan.md).
> This v1.0 document is historical; its external-generation-only statements are superseded.

> **Current scope:** [build-plan-v1.1.md](build-plan-v1.1.md) decisions D1–D17 override this
> original specification. D17 permits optional AI-generated rough thumbnails on scenes. Finished
> artwork/video generation stays external, and importing finished pictures is optional. See
> the plan's TH-1–TH-6 for the thumbnail workflow and revised first visual milestone.

> **Later scope:** [Director Mode decisions](director-mode-plan-v1.md), especially D38–D41,
> supersede the original external-generation-only workflow below: Story → Director clips →
> Put it together → download. [The usability review](usability-review.md) records the current
> teen/tablet screen flow and acceptance checks. This document remains the historical specification.

---

## 1. Product Summary

Storyboard Studio is a web application (with an Android wrapper) for planning animated cartoons scene by scene. A single creator writes and structures their story — script, characters, scenery, action, camera, lighting, style, and music — and the app compiles each shot into a generation-ready prompt package for **OpenArt.ai**, which produces the actual imagery and video.

The app is a **pre-production tool**, not a rendering tool. Its value is: structure, continuity, and prompt quality. It does not generate cartoons itself.

### 1.1 Core principles

| # | Principle | Implication for build |
|---|---|---|
| P1 | Structure over free text | Every creative decision lives in a typed field, not a paragraph. Free text is always a *field*, never the whole record. |
| P2 | Continuity is the product | The same character, location and style must serialise identically into every prompt across the whole series. |
| P3 | AI tightens, it does not own | Every AI output affecting a user-visible field is a *proposal* requiring an explicit accept (see §6.4, AI-1). |
| P4 | The prompt is a compiled artefact | Prompts are deterministically derived from structured fields by a versioned compiler. A user may explicitly override a single shot's prompt (`prompt_locked`, §3.12) — this is a flagged, visible exception, never the default path, and AI may never write to it. |
| P5 | Provider-agnostic core | OpenArt is the first target, not a hard dependency. All outbound generation goes through a provider adapter interface. |

### 1.2 Explicit non-goals (v1)

- No multi-user collaboration, teams, sharing, or organisations. One account owns its projects, full stop.
- No video editing, timeline scrubbing, or audio mixing.
- No image generation inside the app in Phase 1.
- No real-time co-editing / presence.
- No public gallery, social features, or marketplace.

---

## 2. Critical External Constraint — OpenArt.ai

**Verified as of 7 September 2026: OpenArt does not offer a public API.** Their help centre states plainly, "No public API is available currently."

This drives the phased approach the product must follow:

### Phase 1 — Export-first (build this now)

The app produces **copy-ready prompt packs** the user pastes into OpenArt's web UI. This is the entire v1 delivery path and must be excellent on its own terms — it is not a stopgap to be treated carelessly.

### Phase 2 — Direct integration (build the seam now, the adapter later)

All generation calls go through a `GenerationProvider` interface from day one. Phase 1 ships exactly one implementation: `ManualExportProvider`. When OpenArt publishes an API — or if the user chooses a different backend — a new adapter is dropped in with **zero changes to the scene/prompt domain model**.

> **Requirement to the dev agent:** Do not write OpenArt HTTP calls in Phase 1. Do not scrape, automate, or reverse-engineer OpenArt's private endpoints — it is against their terms and will break. Build the seam and the export.

### 2.1 What OpenArt actually consumes (drives prompt compiler design)

OpenArt's storyboard and Smart Shot tools accept **descriptive natural-language prompts per panel**, plus references from their **Character Builder** library. Their own guidance: shot type belongs in the prompt text (`"wide establishing shot"`, `"close-up"`, `"over-the-shoulder"`), and specificity beats brevity — `"Wide shot, two people at a kitchen table, morning light from left window"` outperforms `"kitchen scene"`. Panels can be regenerated individually.

**Therefore the prompt compiler must emit a single dense, ordered, natural-language paragraph per shot** — not JSON, not key-value pairs, not a bulleted list. Structured data is how the *app* stores the work; flowing descriptive prose is how it *ships* to OpenArt.

---

## 3. Domain Model

```
Account
 └── Project            (one cartoon / series)
      ├── SeriesBible   (1:1 — style, palette, format, rules)
      ├── Character[]   (cast, reusable across all episodes)
      ├── Location[]    (reusable settings)
      ├── Prop[]        (reusable objects)
      ├── MusicCue[]    (reusable audio direction)
      └── Episode[]
           └── Scene[]      (a continuous unit of place + time)
                └── Shot[]  (ONE generated panel/clip — the unit sent to OpenArt)
```

### 3.1 Why Shot exists beneath Scene

Camera, framing and duration are properties of a **shot**, not a scene. A scene ("Milo argues with the postman on the porch") normally contains several shots (wide establishing, close on Milo, over-shoulder reverse, cutaway to the dog). OpenArt generates **one panel per prompt**, so Shot is the natural export unit.

**This must not burden the user.** Handling:

- **Simple mode:** Every scene holds **N AI-derived shots** (N ≥ 1, typically 2–5). The full shot *editor* is hidden — no camera/lens/DoF controls — but shots are still addressable: the scene view shows a row of numbered panel tiles, each with a thumbnail slot and a regenerate control. That tile row is the Simple-mode target selector for "regenerate this shot".
- **Advanced mode:** Shots are first-class — the full editor is exposed, and shots can be added, edited, reordered and duplicated.

Same schema and same records in both modes. Switching modes changes which controls are rendered; it never migrates, transforms or destroys data.

---

### 3.2 Entity: `Account`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `email` | string, unique | |
| `display_name` | string | |
| `auth_provider` | enum | `email_password`, `google`, `apple` |
| `default_editor_mode` | enum | `simple` \| `advanced`, default `simple` |
| `created_at`, `last_login_at` | timestamp | |
| `ai_credit_balance` | int | See §9 |
| `deleted_at` | timestamp, null | Soft delete, 30-day purge |

### 3.3 Entity: `Project`

One cartoon story/series. **An account may hold unlimited projects** (soft plan cap configurable).

| Field | Type | Notes |
|---|---|---|
| `id`, `account_id` | uuid | |
| `title` | string, req | |
| `logline` | text | One-sentence premise |
| `synopsis` | text | |
| `genre` | string[] | Tag list |
| `target_audience` | enum | `preschool`, `kids_6_11`, `tween`, `teen`, `adult`, `all_ages` |
| `tone` | string[] | e.g. `slapstick`, `warm`, `deadpan` |
| `editor_mode` | enum | `simple` \| `advanced` — per project, overrides account default. Gates **both** AI operations (§6.1) and UI control density (§3.1, SC-7). |
| `status` | enum | `draft`, `in_progress`, `complete`, `archived` |
| `cover_image_asset_id` | uuid, null | |
| `created_at`, `updated_at` | timestamp | |

### 3.4 Entity: `SeriesBible` (1:1 with Project)

The single source of visual and sonic truth. **Every compiled prompt inherits from this.**

| Field | Type | Notes |
|---|---|---|
| `art_style` | text, req | Canonical style sentence, e.g. `"2D flat vector cartoon, thick uniform outlines, cel shading, saturated primaries"` |
| `style_reference_asset_ids` | uuid[] | Uploaded reference images |
| `colour_palette` | object[] | `{name, hex, role}` — role ∈ `primary`, `secondary`, `accent`, `shadow`, `highlight` |
| `line_treatment` | string | e.g. `"2px black outline, no line weight variation"` |
| `render_quality_tokens` | string | Appended to every prompt, e.g. `"clean, high detail, no text artifacts"` |
| `negative_prompt` | text | Appended to every prompt as exclusions |
| `aspect_ratio` | enum | `16:9`, `9:16`, `1:1`, `4:3`, `2.39:1` |
| `resolution_target` | string | |
| `frame_rate_intent` | enum | `12fps_limited`, `24fps`, `30fps` |
| `default_lighting` | text | Scene-level default, overridable |
| `music_genre` | string | Series-wide sonic identity |
| `music_instrumentation` | string | |
| `sound_design_notes` | text | |
| `narration_style` | enum | `none`, `character_vo`, `omniscient_narrator` |
| `continuity_rules` | text[] | Free rules the AI continuity checker enforces, e.g. `"Milo never appears without his red scarf"` |

### 3.5 Entity: `Character`

The most important entity for cartoon consistency. **`prompt_token` is the field that guarantees the same character across 200 shots.**

| Field | Type | Notes |
|---|---|---|
| `id`, `project_id` | uuid | |
| `name` | string, req | |
| `role` | enum | `protagonist`, `antagonist`, `supporting`, `background`, `narrator` |
| `prompt_token` | text, req | **The canonical visual description injected verbatim into every prompt this character appears in.** e.g. `"MILO: a scruffy 9-year-old boy, oversized round glasses, mop of brown hair, red knitted scarf, green dungarees, always barefoot"` |
| `reference_asset_ids` | uuid[] | Turnarounds / model sheets. Maps to OpenArt Character Builder references. |
| `openart_character_ref` | string, null | User pastes the name/ID of the matching character in their OpenArt Character Builder library. Emitted in the export pack. |
| `age_appearance` | string | |
| `physical_build` | string | |
| `distinguishing_features` | text | |
| `default_costume` | text | |
| `costume_variants` | object[] | `{label, description}` — selectable per scene |
| `personality` | text | Drives AI dialogue voice |
| `motivation` | text | |
| `speech_pattern` | text | e.g. `"short sentences, never uses contractions, ends questions with 'right?'"` — **critical for AI dialogue quality** |
| `voice_direction` | text | Casting/VO note |
| `character_arc` | text | |
| `relationships` | object[] | `{other_character_id, relationship}` |

### 3.6 Entity: `Location`

| Field | Type | Notes |
|---|---|---|
| `id`, `project_id`, `name` | | |
| `prompt_token` | text, req | Canonical description injected into every prompt set here |
| `interior_exterior` | enum | `INT`, `EXT`, `INT/EXT` |
| `reference_asset_ids` | uuid[] | |
| `default_time_of_day` | enum | |
| `default_lighting` | text | Overrides SeriesBible default |
| `ambient_sound` | text | |
| `set_dressing` | text | Persistent props/details that must recur |

### 3.7 Entity: `Prop`

`id`, `project_id`, `name`, `prompt_token`, `reference_asset_ids`, `significance` (`plot_critical` \| `running_gag` \| `set_dressing`).

### 3.8 Entity: `MusicCue`

`id`, `project_id`, `name`, `genre`, `tempo_bpm`, `mood`, `instrumentation`, `reference_track_note`, `loopable` (bool).

### 3.9 Entity: `Episode`

| Field | Type | Notes |
|---|---|---|
| `id`, `project_id` | uuid | |
| `episode_number` | int | |
| `title`, `logline`, `synopsis` | | |
| `target_duration_seconds` | int | Drives AI scene-count suggestions |
| `status` | enum | `outline`, `drafting`, `locked`, `exported` |
| `raw_script` | text, null | Optional paste-in source for AI scene breakdown |
| `sort_order` | int | |

### 3.10 Entity: `Scene`

A continuous unit of place and time. Holds context **shared by all its shots**.

| Field | Type | Notes |
|---|---|---|
| `id`, `episode_id` | uuid | |
| `scene_number` | int | Auto, resequences on reorder |
| `sort_order` | int | |
| `slugline` | string | Auto-generated, e.g. `INT. MILO'S TREEHOUSE — DAY` |
| `title` | string | Human label |
| `location_id` | uuid, req | FK → Location |
| `time_of_day` | enum | `dawn`, `morning`, `midday`, `afternoon`, `dusk`, `night`, `unspecified` |
| `weather` | string, null | |
| `character_ids` | uuid[] | Who is present. Drives prompt token injection + continuity checks. |
| `costume_overrides` | object[] | `{character_id, costume_variant_label}` |
| `scene_intent` | text, req | **What this scene must achieve for the story.** Single most useful field for AI assistance. |
| `emotional_beat` | string | e.g. `"dread → relief"` |
| `synopsis` | text | Prose summary of what happens |
| `action_description` | text, req | The physical action, blocking, staging |
| `scenery_description` | text, req | Environment as it appears *in this scene* (beyond the Location default) |
| `lighting` | text | Inherits Location → SeriesBible if blank |
| `lighting_preset` | enum, null | See §4.2 |
| `mood_atmosphere` | text | |
| `style_override` | text, null | Blank = inherit SeriesBible |
| `music_cue_id` | uuid, null | |
| `music_direction` | text | Scene-specific music note |
| `sfx` | string[] | Sound effects list |
| `script_lines` | ScriptLine[] | See §3.11 |
| `estimated_duration_seconds` | int | |
| `transition_in` / `transition_out` | enum | `cut`, `fade_in`, `fade_out`, `dissolve`, `wipe`, `match_cut`, `smash_cut` |
| `director_notes` | text | Never exported to prompts |
| `is_locked` | bool | Locked scenes are excluded from bulk AI operations |
| `version` | int | Incremented on every write. Drives optimistic concurrency (NF-10). |

*Continuity flags are **not** embedded on Scene — see §3.10b.*

### 3.10b Entity: `ContinuityFlag`

A first-class table, because flags are raised against scenes, shots **and** cross-scene pairs, and dismissals must survive regeneration.

| Field | Type | Notes |
|---|---|---|
| `id`, `project_id` | uuid | |
| `episode_id` | uuid, null | |
| `target_entity_type` | enum | `scene`, `shot`, `scene_pair`, `project` |
| `target_entity_id` | uuid | |
| `secondary_entity_id` | uuid, null | The other scene, for `scene_pair` flags (detector 5) |
| `detector` | enum | `absent_speaker`, `costume_contradiction`, `bible_rule_violation`, `unestablished_prop`, `time_discontinuity`, `location_contradiction`, `style_drift`, `voice_drift` |
| `severity` | enum | `info`, `warning`, `error` |
| `field` | string, null | Which field to jump to |
| `message` | text | |
| `suggested_fix` | text, null | |
| `dedupe_hash` | string | Hash of `detector + target ids + the offending field values`. **Dismissals key on this**, so a re-run raises nothing new while the content is unchanged, but does re-raise once the user edits the offending value back into violation. |
| `dismissed` | bool | |
| `dismissed_at` | timestamp, null | |
| `created_at` | timestamp | |

Endpoints: `POST /projects/:id/continuity-check` (scope in body), `GET /projects/:id/continuity-flags`, `POST /continuity-flags/:id/dismiss`, `POST /continuity-flags/:id/undismiss`.

### 3.11 Embedded: `ScriptLine`

Ordered list on Scene.

| Field | Type | Notes |
|---|---|---|
| `id`, `sort_order` | | |
| `type` | enum | `dialogue`, `action`, `parenthetical`, `voiceover`, `sfx_cue`, `on_screen_text` |
| `character_id` | uuid, null | Required for `dialogue`/`voiceover` |
| `text` | text | |
| `delivery_note` | string, null | e.g. `(whispered, terrified)` |
| `shot_id` | uuid, null | Optional binding to a specific shot |

### 3.12 Entity: `Shot` — **the export unit**

| Field | Type | Notes |
|---|---|---|
| `id`, `scene_id`, `sort_order` | | |
| `shot_number` | string | **Derived, not user-set.** Auto-assigned as the 1-based position within the scene, resequenced on reorder. A user may optionally append a letter suffix for inserted shots (`4B`); the numeric part stays derived. |
| `export_key` | string, immutable | **Set once at creation, never changes.** First 6 hex chars of the shot's uuid. Used in export filenames and result re-import matching (EX-7, GR-2) so that scene reordering can never mis-route returning files. |
| `shot_type` | enum | See §4.1 |
| `camera_angle` | enum | See §4.1 |
| `camera_movement` | enum | See §4.1 |
| `lens_focal_length` | enum | `ultra_wide_14mm`, `wide_24mm`, `normal_50mm`, `portrait_85mm`, `telephoto_135mm`, `macro` |
| `depth_of_field` | enum | `deep_focus`, `shallow_bokeh`, `rack_focus`, `tilt_shift` |
| `subject_character_ids` | uuid[] | Who is *in frame* (subset of scene's characters) |
| `subject_placement` | text | e.g. `"Milo screen-left, third of frame; postman screen-right, back to camera"` |
| `action_beat` | text, req | The specific moment this panel captures |
| `expression_note` | text | Facial expression / body language |
| `visible_props` | uuid[] | FK → Prop |
| `lighting_override` | text, null | |
| `duration_seconds` | decimal | |
| `motion_intent` | text | For video generation: what moves and how |
| `compiled_prompt_still` | text, read-only | Compiler output, `outputMode: still` |
| `compiled_prompt_video` | text, read-only | Compiler output, `outputMode: video` |
| `compiled_negative_prompt` | text, read-only | |
| `prompt_template_version` | string | Which compiler version produced it |
| `generation_status` | enum | `not_started`, `exported`, `generated`, `approved`, `needs_rework` |
| `generated_asset_ids` | uuid[] | Ordered. User-uploaded results back from OpenArt — multiple takes. |
| `hero_asset_id` | uuid, null | The selected take (GR-3). Must be a member of `generated_asset_ids`. |
| `rework_note` | text, null | Why this shot is flagged `needs_rework` (GR-5) |
| `user_prompt_addendum` | text | Free text the user appends; compiler places it last, never overwrites |
| `prompt_locked` | bool | If true, the compiled prompts are frozen and hand-editable. See §5.1 for the consequences. |
| `ai_default_unreviewed` | bool | True when advanced fields were AI-populated while hidden in Simple mode (AI-1) |
| `version` | int | Optimistic concurrency |

### 3.13 Entity: `Asset`

`id`, `project_id`, `owner_entity_type`, `owner_entity_id`, `kind` (`style_ref`, `character_ref`, `location_ref`, `prop_ref`, `generated_output`, `cover`), `filename`, `mime_type`, `size_bytes`, `storage_key`, `width`, `height`, `duration_ms` (null for stills), `poster_asset_id` (uuid, null — extracted first frame for videos), `uploaded_at`.

**Media policy — two classes, different rules:**

| Class | Kinds | Allowed MIME | Max size |
|---|---|---|---|
| Reference images | `style_ref`, `character_ref`, `location_ref`, `prop_ref`, `cover` | `image/jpeg`, `image/png`, `image/webp` | 10 MB |
| Generated output | `generated_output` | `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/webm` | 10 MB images, **200 MB video** |

Video uploads generate a poster frame server-side (`poster_asset_id`), which is what GR-4 propagates to the scene board and what EX-6 places in the PDF. NF-19 magic-byte validation covers both classes; video containers are validated by header, not extension.

### 3.13b Entity: `UnmatchedUpload`

Backs the GR-2 manual-assignment tray. `id`, `project_id`, `episode_id`, `asset_id`, `original_filename`, `uploaded_at`, `assigned_shot_id` (null until resolved). Rows persist across sessions until assigned or deleted.

### 3.14 Entity: `AiInteraction` (audit + cost)

`id`, `account_id`, `project_id`, `operation` (see §6.2), `mode` (`simple`/`advanced`), `target_entity_type`, `target_entity_id`, `input_tokens`, `output_tokens`, `model`, `latency_ms`, `accepted` (bool/null), `created_at`.

### 3.15 Entity: `ExportPack`

`id`, `project_id`, `episode_id`, `scope` (`episode`/`scene`/`shot_selection`), `format` (`markdown`, `json`, `csv`, `pdf`, `txt_bundle`), `shot_count`, `template_version`, `storage_key`, `created_at`.

---

## 4. Controlled Vocabularies

Fields below **must be enums with a UI picker**, not free text. Every option carries a `prompt_phrase` — the exact wording injected into the compiled prompt. Storing the phrase alongside the enum is what makes prompts consistent.

> **Requirement CV-1:** Ship these as a **single machine-readable fixture** (`vocabularies.json`, schema-versioned) imported by the compiler, the API validator and the UI pickers. Do not hard-code phrases in three places, and **do not invent phrases for values listed here** — the table below is complete and normative.
>
> **Requirement CV-2:** Every enum value below has exactly one `prompt_phrase`. A build in which any option resolves to an empty or absent phrase fails CI.

### 4.1 `shot_type`

| Value | `prompt_phrase` |
|---|---|
| `extreme_wide` | extreme wide shot, subject small in frame |
| `establishing` | wide establishing shot |
| `wide` | wide shot |
| `full` | full shot, full body in frame |
| `medium_wide` | medium wide shot, knees up |
| `medium` | medium shot, waist up |
| `medium_close` | medium close-up, chest up |
| `close_up` | close-up on face |
| `extreme_close_up` | extreme close-up |
| `over_the_shoulder` | over-the-shoulder shot |
| `two_shot` | two shot, both subjects in frame |
| `point_of_view` | POV shot, first person perspective |
| `insert` | insert shot, tight detail |
| `cutaway` | cutaway shot to a secondary subject |

*(`wide` and `establishing` are two distinct values, not one.)*

### 4.2 `camera_angle`

| Value | `prompt_phrase` |
|---|---|
| `eye_level` | eye level angle |
| `low_angle` | low angle looking up at the subject |
| `high_angle` | high angle looking down at the subject |
| `birds_eye` | top-down bird's eye view |
| `worms_eye` | extreme low worm's eye view from ground level |
| `dutch_tilt` | dutch angle, tilted horizon |
| `overhead` | directly overhead flat lay angle |
| `profile` | side profile view |
| `three_quarter` | three-quarter view |

### 4.3 `camera_movement`

Emitted only in video output mode (§5.2 step 10).

| Value | `prompt_phrase` |
|---|---|
| `static` | locked-off static camera |
| `pan_left` | camera pans left |
| `pan_right` | camera pans right |
| `tilt_up` | camera tilts upward |
| `tilt_down` | camera tilts downward |
| `dolly_in` | slow dolly in toward the subject |
| `dolly_out` | slow dolly out away from the subject |
| `truck_left` | camera trucks left, moving laterally |
| `truck_right` | camera trucks right, moving laterally |
| `crane_up` | crane shot rising upward |
| `crane_down` | crane shot descending |
| `handheld` | handheld camera, subtle natural shake |
| `zoom_in` | zoom in, tightening on the subject |
| `zoom_out` | zoom out, widening from the subject |
| `tracking` | tracking shot following the subject |
| `orbit` | camera orbits around the subject |
| `whip_pan` | fast whip pan with motion blur |

### 4.4 `lens_focal_length` / `depth_of_field`

| Value | `prompt_phrase` |
|---|---|
| `ultra_wide_14mm` | shot on a 14mm ultra-wide lens, exaggerated perspective |
| `wide_24mm` | shot on a 24mm wide lens |
| `normal_50mm` | shot on a 50mm lens, natural perspective |
| `portrait_85mm` | shot on an 85mm portrait lens, compressed perspective |
| `telephoto_135mm` | shot on a 135mm telephoto lens, flattened depth |
| `macro` | macro lens, extreme close detail |
| `deep_focus` | deep focus, foreground and background both sharp |
| `shallow_bokeh` | shallow depth of field, soft bokeh background |
| `rack_focus` | rack focus shifting between planes |
| `tilt_shift` | tilt-shift effect, miniature look |

### 4.5 `lighting_preset`

Consumed by the compiler at §5.2 step 8, ahead of the free-text lighting fields.

| Value | `prompt_phrase` |
|---|---|
| `natural_daylight` | natural daylight, soft even illumination |
| `golden_hour` | warm golden hour light, long soft shadows |
| `blue_hour` | cool blue twilight light just after sunset |
| `harsh_noon` | harsh overhead midday sun, short hard shadows |
| `overcast_soft` | flat overcast light, soft diffused shadows |
| `moonlight` | pale blue moonlight, deep cool shadows |
| `candlelight` | flickering warm candlelight, small pool of light |
| `firelight` | orange firelight, dancing shadows |
| `neon_night` | saturated neon light at night, magenta and cyan spill |
| `single_key_dramatic` | single hard key light, deep shadows, high contrast |
| `high_key` | high key lighting, bright, minimal shadows |
| `low_key` | low key lighting, mostly shadow, small highlights |
| `backlit_silhouette` | strong backlight, subject in silhouette |
| `rim_light` | rim lighting outlining the subject's edge |
| `underlight_spooky` | lit from below, eerie upward shadows |
| `flat_cartoon` | flat even cartoon lighting, minimal shadow |
| `practical_source` | lit by a visible in-scene practical source |

### 4.6 `time_of_day`

Used by `Scene.time_of_day` and `Location.default_time_of_day`.

| Value | `prompt_phrase` |
|---|---|
| `dawn` | at dawn, first pale light |
| `morning` | in the morning |
| `midday` | at midday |
| `afternoon` | in the afternoon |
| `dusk` | at dusk |
| `night` | at night |
| `unspecified` | *(empty — emits nothing)* |

### 4.7 `art_style` presets

The user may always type their own; picking a preset writes its phrase into `SeriesBible.art_style`, where it remains editable.

| Value | `prompt_phrase` |
|---|---|
| `2d_flat_vector` | 2D flat vector cartoon, clean geometric shapes, uniform outlines |
| `classic_cel_animation` | classic hand-drawn cel animation, painted backgrounds |
| `saturday_morning_retro` | 1980s Saturday morning cartoon style, bold outlines, limited palette |
| `anime_shonen` | shonen anime style, dynamic angular linework, speed lines |
| `anime_ghibli_soft` | soft painterly anime style, watercolour backgrounds, gentle light |
| `chibi` | chibi style, oversized heads, tiny bodies, simplified features |
| `comic_book_ink` | comic book ink style, heavy black spotting, halftone shading |
| `newspaper_strip` | newspaper comic strip style, simple line art, flat colour |
| `watercolour_storybook` | children's storybook watercolour illustration, soft edges |
| `crayon_childlike` | crayon and coloured pencil childlike drawing style |
| `paper_cutout` | paper cutout collage animation style, layered flat shapes |
| `claymation_look` | claymation stop-motion look, visible fingerprints and clay texture |
| `3d_pixar_style` | stylised 3D animated film look, soft global illumination |
| `low_poly` | low poly 3D style, faceted geometry, flat shading |
| `pixel_art` | pixel art style, limited palette, visible pixel grid |
| `rubber_hose_1930s` | 1930s rubber hose animation, black and white, bouncing curves |
| `noir_high_contrast` | high contrast noir style, hard shadows, near-monochrome |

### 4.8 `mood_atmosphere`

| Value | `prompt_phrase` |
|---|---|
| `whimsical` | whimsical playful atmosphere |
| `tense` | tense, taut atmosphere |
| `melancholy` | melancholy, wistful atmosphere |
| `triumphant` | triumphant, uplifting atmosphere |
| `eerie` | eerie, unsettling atmosphere |
| `chaotic_comic` | chaotic slapstick comic energy |
| `cosy` | cosy, warm, safe atmosphere |
| `epic` | epic, grand scale atmosphere |
| `dreamlike` | dreamlike, hazy, surreal atmosphere |
| `mundane` | mundane, everyday, unremarkable atmosphere |
| `menacing` | menacing, threatening atmosphere |
| `bittersweet` | bittersweet atmosphere |

### 4.9 `MusicCue.genre`

Not injected into image prompts. Carried in exports as audio direction, and used by `suggest_music_cue`.

`orchestral`, `jazz`, `chiptune`, `synthwave`, `folk_acoustic`, `rock`, `hip_hop`, `ambient`, `circus_polka`, `lullaby`, `marching_band`, `silence`.

---

## 5. Prompt Compiler

The heart of the product. **Deterministic, versioned, testable.**

### 5.1 Contract

```
compile(shot, scene, seriesBible, characters[], location, props[],
        templateVersion, outputMode: 'still' | 'video')
  → { prompt: string, negativePrompt: string, metadata: {...} }
```

Rules:

- **Pure function.** Same inputs → byte-identical output. No AI call. No randomness. No clock, no locale, no I/O. Fully unit-testable.
- **One implementation, shared by client and server.** Ship the compiler as a standalone package with no framework or DB dependencies, imported by both the web client (for live preview, NF-3) and the API (for persistence). **Do not write it twice** — two copies will drift and break PC-1 and P2. On save, the server recompiles and asserts the persisted string equals what the client sent; a mismatch is a 409 and a logged alert.
- **Both output modes are compiled and stored.** `Shot.compiled_prompt_still` and `Shot.compiled_prompt_video` are separate columns; the export format selects which one ships. Video mode adds step 10 (camera movement + motion intent); still mode omits it entirely.
- If `Shot.prompt_locked` is true, compilation is skipped for that shot and the stored text is preserved verbatim. Locked shots are **excluded** from PC-6 bulk recompile, are badged as manually overridden in the UI and in every export, and are listed on a "manually overridden shots" line in the export handoff sheet.
- Output is **one flowing descriptive paragraph** (per §2.1), not structured data.

### 5.2 Assembly order (v1 template)

1. **Style prefix** — `SeriesBible.art_style` + `line_treatment`
2. **Shot grammar** — `shot_type.prompt_phrase` + `camera_angle.prompt_phrase` + lens + DoF
3. **Subjects** — for each `subject_character_ids`, the character's `prompt_token`, plus active costume variant, plus `expression_note`
4. **Action** — `Shot.action_beat`
5. **Placement** — `subject_placement`
6. **Setting** — `Location.prompt_token` + `Scene.scenery_description` + visible props' tokens
7. **Time & weather** — `time_of_day`, `weather`
8. **Lighting** — resolution order, first non-empty wins: `Shot.lighting_override` → `Scene.lighting_preset.prompt_phrase` → `Scene.lighting` (free text) → `Location.default_lighting` → `SeriesBible.default_lighting`
9. **Mood** — `mood_atmosphere`
10. **Camera movement / motion** — `camera_movement.prompt_phrase` + `motion_intent`. **Emitted only when `outputMode === 'video'`.**
11. **Palette** — colour palette hex/name summary
12. **Quality tokens** — `SeriesBible.render_quality_tokens`
13. **User addendum** — `Shot.user_prompt_addendum`, verbatim, last

Negative prompt = `SeriesBible.negative_prompt` + standard cartoon exclusions (`"text, watermark, signature, extra limbs, deformed hands, photorealistic, blurry"`).

### 5.3 Requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| PC-1 | Compilation is deterministic and pure | Unit test: same fixture compiled 100× yields identical strings, in both Node and browser environments |
| PC-2 | Inheritance chain resolves correctly | Test matrix covers **all five** lighting fallback levels (§5.2 step 8) and the style override |
| PC-2b | One shared compiler implementation | Compiler lives in its own package with zero framework/DB imports; client and server both import it; a server-side equality assertion on save guards against drift |
| PC-2c | Both output modes compile | Every shot yields a still prompt and a video prompt; the still prompt contains no camera-movement or motion-intent text |
| PC-3 | Every character in `subject_character_ids` contributes its `prompt_token` exactly once | Test: duplicate character IDs deduplicate |
| PC-4 | Live preview panel shows compiled prompt as user edits, updating within 300 ms | Manual + e2e test |
| PC-5 | Prompt length limits come from **one authority**: the active provider's `capabilities().max_prompt_length` (GP-3) | UI shows a char counter, amber at 75% of that limit, red at 100%. `ManualExportProvider` declares `max_prompt_length: 2500`. No hard-coded thresholds anywhere else in the codebase. |
| PC-6 | Template versions are immutable; existing shots retain their `prompt_template_version` until the user opts in to recompile | Upgrading the template does not silently mutate stored prompts; an explicit "Recompile with v2" action exists, with a diff preview. Shots with `prompt_locked = true` are skipped and reported as skipped. |
| PC-7 | Copy-to-clipboard on any prompt, single tap, with confirmation toast | Works on Android WebView/TWA |
| PC-8 | Diff view shows what changed between two compilations | Side-by-side or inline diff |

---

## 6. AI Assistance

### 6.1 Two modes — mandatory

Set per project (`Project.editor_mode`, §3.3), switchable at any time. **The underlying data schema is identical in both modes.** Switching is a UI-affordance change only — never a migration, never data loss.

> **Naming note for the dev agent:** the field is `editor_mode`, not `ai_mode`, because it gates two things at once: which AI operations are offered (this section) **and** which UI controls are rendered (SC-7, §3.1). Implement both. A build that gates only the AI behaviour is incomplete.

- **Simple mode:** AI drafts everything; the user curates. Advanced controls hidden.
- **Advanced mode:** the user authors; AI assists on request. All controls exposed.

#### Simple Mode — "AI co-writer"

For users who want a cartoon out of a premise. AI drafts everything; the user curates.

- **Premise → full episode.** User supplies a logline, audience, tone and target duration. AI generates: episode synopsis, character roster with full `prompt_token`s, locations, a full scene sequence, and for every scene all fields including script lines, action, scenery, lighting, music direction, plus a shot breakdown with camera choices.
- Shots are hidden by default; the user sees scenes and panel counts.
- **One-click regenerate** at any level: regenerate this scene / this shot / this dialogue exchange / this whole act.
- Guided wizard flow: *Premise → Cast → Look → Episode outline → Review scenes → Export*.
- Advanced fields (lens, DoF, transitions, focal length) are hidden but populated with sensible AI defaults, so nothing is lost if the user later switches to Advanced.

#### Advanced Mode — "AI assistant"

For users who direct their own work. **The governing rule: AI never generates unprompted, and never generates a whole episode.** Multi-record operations the user explicitly invokes (`breakdown_script_to_scenes`, `generate_shot_list`) *are* available — the user asked for them. What is unavailable is anything that authors story from a premise.

**§6.2 is the single normative source for which operations exist in which mode.** Where this prose and that table disagree, the table wins.

- Per-field **Tighten** action: rewrite the current field's text to be more specific, more visual, more prompt-ready — preserving intent, respecting field length norms.
- Per-field **Suggest** action: 3–5 options for camera, lighting, style, mood or music, each with a one-line rationale.
- **Continuity check** on demand across a scene, episode or project.
- **Dialogue polish** against `Character.speech_pattern` and `personality`.
- All AI output appears as a side-by-side proposal — never inline auto-replacement.

### 6.2 AI operation catalogue

| Operation | Simple | Advanced | Input | Output |
|---|:--:|:--:|---|---|
| `generate_episode_from_premise` | ✅ | ❌ | Project + logline + duration | Full Episode tree |
| `generate_scene_sequence` | ✅ | ❌ | Episode synopsis | Scene[] with all fields |
| `breakdown_script_to_scenes` | ✅ | ✅ | `Episode.raw_script` | Scene[] (parses sluglines, dialogue, action) |
| `generate_shot_list` | ✅ | ✅ | Scene | Shot[] with camera choices + rationale |
| `expand_scene_fields` | ✅ | ❌ | Scene stub | All scene fields populated |
| `tighten_field` | ✅ | ✅ | Field text + field type + context | Rewritten text |
| `suggest_options` | ✅ | ✅ | Field type + scene context | 3–5 options + rationale |
| `polish_dialogue` | ✅ | ✅ | ScriptLine[] + character voices | Revised lines |
| `generate_character` | ✅ | ✅ | Name + role + brief | Full Character record |
| `generate_prompt_token` | ✅ | ✅ | Character/Location fields | Canonical token string |
| `continuity_check` | ✅ | ✅ | Scope + SeriesBible rules | Flag[] |
| `critique_scene` | ❌ | ✅ | Scene | Structured notes on clarity/pacing/visual specificity |
| `suggest_music_cue` | ✅ | ✅ | Scene mood + beat | MusicCue proposal |
| `improve_prompt` | ✅ | ✅ | Compiled prompt | Suggested edits to **source fields**, not the prompt string |

> **`improve_prompt` design note:** AI must never write to `compiled_prompt_still` / `compiled_prompt_video` — that would break P4. It proposes changes to the underlying structured fields, which then recompile. This holds even for `prompt_locked` shots: on those, `improve_prompt` is offered read-only, as advice.

### 6.3 Continuity checker

Runs `continuity_check` and writes `ContinuityFlag` records (§3.10b). **Detectors split into two classes, and only the deterministic class counts toward the Definition of Done.**

**Class A — deterministic (pure code, no AI). Must be 100% precision and 100% recall against the labelled fixture project.**

| # | `detector` | Rule | Target |
|---|---|---|---|
| 1 | `absent_speaker` | A `ScriptLine` of type `dialogue`/`voiceover` names a character not in `Scene.character_ids` | scene |
| 2 | `costume_contradiction` | A character's active costume variant differs from the previous scene they appeared in, with no intervening scene or line establishing a change | scene |
| 4 | `unestablished_prop` | A prop in `Shot.visible_props` has no earlier scene where it appears, or appears after a scene whose action marks it destroyed | shot |
| 5 | `time_discontinuity` | Two consecutive scenes share a `location_id` but jump non-adjacent `time_of_day` values (e.g. `morning` → `night`) with no transition or elapsed-time note | scene_pair |

**Class B — AI-judged, advisory. Excluded from the DoD; surfaced as `info`/`warning` only, never `error`.**

| # | `detector` | Rule |
|---|---|---|
| 3 | `bible_rule_violation` | Natural-language match against `SeriesBible.continuity_rules` |
| 6 | `location_contradiction` | `Scene.scenery_description` contradicts the `Location.prompt_token` |
| 7 | `style_drift` | `Scene.style_override` diverges sharply from `SeriesBible.art_style` |
| 8 | `voice_drift` | Dialogue breaks a character's `speech_pattern` |

**Acceptance criteria**

| ID | Requirement | Acceptance criteria |
|---|---|---|
| CC-1 | Class A detectors are exact | Against a supplied fixture project seeded with 24 known violations and 24 near-miss decoys, all four Class A detectors return 100% precision and 100% recall |
| CC-2 | Class B detectors do not produce noise | On the same fixture, Class B raises no `error`-severity flags and no more than 6 false positives total |
| CC-3 | Dismissals are stable | Dismissing a flag and re-running the check does not re-raise it; editing the offending value to a *different* violating value does raise a new flag |
| CC-4 | Scope works at scene, episode and project level | Project-scope run on a 200-scene fixture completes in < 60 s |
| CC-5 | Every flag deep-links to its target field | Clicking a flag opens the scene or shot with that field focused |

### 6.4 AI interaction requirements — non-negotiable

| ID | Requirement | Acceptance criteria |
|---|---|---|
| AI-1 | No AI output touching a **user-visible** field is persisted without explicit acceptance, at the granularity defined in §6.5 | Every proposal renders with Accept / Reject / Regenerate at its defined granularity. Rejecting leaves the target byte-identical. Fields hidden by the current `editor_mode` (lens, DoF, transitions in Simple) are exempt and may be populated with AI defaults — they are shown for acceptance the moment the user switches to Advanced, flagged `ai_default_unreviewed`. |
| AI-2 | Bulk generation is applied in one transaction and undoable as one unit | Accepting a tree-scope proposal is a single atomic write returning a `revert_token`; `POST /ai/proposals/:id/revert` restores the prior state exactly |
| AI-3 | Streaming responses | Long generations stream token-by-token to the UI with a visible cancel control; cancelling discards the proposal and persists nothing |
| AI-4 | Every call is logged to `AiInteraction` with token counts and final accept/reject disposition | Query returns full history per project; `accepted` is set at accept/reject time, not at generation time |
| AI-5 | Field-level context, not whole-project dumps | The prompt for `tighten_field` includes only the field, its scene, the bible, and relevant character tokens — enforced by a context builder with a token budget |
| AI-6 | Graceful degradation | If the AI provider is down, all manual editing, compilation, and export continue to work fully. AI controls show a disabled state with a clear reason. |
| AI-7 | Rate limiting and cost guardrails | `GET /me/ai-budget` returns `{balance, daily_cap, used_today, resets_at}`; `POST /ai/:operation/estimate` returns a token and credit estimate without generating; the UI shows remaining budget and requires confirmation before any `tree`- or `collection`-scope operation. **Depends on §13 decision 2 — resolve before Phase 5.** |
| AI-8 | Age-appropriateness guard | If `target_audience` is `preschool` or `kids_6_11`, the system prompt constrains content accordingly and a post-generation check flags violations |
| AI-9 | Model-agnostic | AI calls go through an `AiProvider` interface; swapping model or vendor requires no domain changes |
| AI-10 | Regeneration variety | Previous outputs are passed to the model as things to avoid. Test bar: cosine similarity of embeddings between consecutive outputs for the same target ≤ 0.85 across a 20-case fixture |

### 6.5 Proposal lifecycle — required

AI output is **never written directly to domain records by the generating call.** Every operation produces an `AiProposal`, which the user then accepts or rejects. This is what makes AI-1, AI-2 and AI-4 implementable.

**Entity: `AiProposal`**

`id`, `account_id`, `project_id`, `operation`, `scope`, `target_entity_type`, `target_entity_id`, `payload` (jsonb — the proposed tree or value), `status` (`pending`, `accepted`, `rejected`, `cancelled`, `expired`), `revert_token`, `ai_interaction_id`, `created_at`, `resolved_at`, `expires_at` (24 h).

**Accept granularity by operation:**

| Operation | Proposal scope | Accept granularity |
|---|---|---|
| `generate_episode_from_premise` | `tree` | Whole tree, one accept. Review-and-edit happens *after* acceptance, on real records. |
| `generate_scene_sequence` | `collection` | Per scene — accept, reject or regenerate each proposed scene independently |
| `breakdown_script_to_scenes` | `collection` | Per scene |
| `generate_shot_list` | `collection` | Per shot |
| `expand_scene_fields` | `record` | Per field within the scene |
| `generate_character` | `record` | Per field |
| `tighten_field`, `generate_prompt_token` | `field` | Single accept |
| `suggest_options` | `field` | User picks one option, or none |
| `polish_dialogue` | `collection` | Per script line |
| `improve_prompt` | `record` | Per proposed source-field change |
| `continuity_check`, `critique_scene` | `advisory` | No accept — writes flags/notes only, never field values |

**Endpoints:** `POST /ai/:operation` returns a proposal id and streams the payload; `POST /ai/proposals/:id/accept` (optional `{selections: [...]}` for collection/record scopes) applies atomically and returns the created/updated records plus a `revert_token`; `POST /ai/proposals/:id/reject`; `POST /ai/proposals/:id/revert`. A tree-scope accept must be a single database transaction — **not a client-orchestrated sequence of REST calls.**

---

## 7. Functional Requirements

### 7.1 Accounts and auth

| ID | Requirement | Acceptance criteria |
|---|---|---|
| AU-1 | Email/password signup with verification | Unverified accounts cannot create projects |
| AU-2 | Google and Apple OAuth sign-in | Both complete successfully inside the Android wrapper |
| AU-3 | Password reset by emailed token, 1-hour expiry | |
| AU-4 | Sessions persist ≥30 days on mobile with silent refresh | User is not logged out of the Android app between sessions |
| AU-5 | Account deletion with 30-day soft-delete grace, then hard purge including assets | |
| AU-6 | Full data export (JSON + assets zip) on request | Downloadable archive contains every project |

### 7.2 Project management

| ID | Requirement | Acceptance criteria |
|---|---|---|
| PR-1 | Create, rename, duplicate, archive, delete projects | Duplicate deep-copies bible, cast, locations, episodes, scenes, shots with new IDs |
| PR-2 | Unlimited projects per account | Dashboard paginates and remains responsive at 100+ projects |
| PR-3 | Dashboard shows title, cover, episode count, scene count, last edited, status | |
| PR-4 | Search and filter projects by title, genre, status | |
| PR-5 | Project templates: `Blank`, `Comedy Short`, `Adventure Series`, `Educational Kids` | Each pre-populates bible defaults and a scene skeleton |
| PR-6 | Import a project from a previously exported JSON archive | Round-trip export→import produces an equivalent project |

### 7.3 Series bible and asset library

| ID | Requirement | Acceptance criteria |
|---|---|---|
| SB-1 | Full CRUD on bible, characters, locations, props, music cues | |
| SB-2 | Reference image upload — drag-drop on web, camera/gallery on Android, max 10 MB, JPEG/PNG/WebP | Thumbnails generate server-side |
| SB-3 | `prompt_token` shows a live preview of exactly how it will read inside a compiled prompt | |
| SB-4 | Deleting a character/location/prop referenced by scenes warns with a usage count and requires confirmation | Deletion nulls references rather than orphaning scenes |
| SB-5 | Character detail view lists every scene and shot the character appears in | |
| SB-6 | Colour palette editor with hex picker and named roles | |

### 7.4 Episode, scene and shot editing

| ID | Requirement | Acceptance criteria |
|---|---|---|
| SC-1 | Create, edit, duplicate, delete, reorder scenes by drag-and-drop | Reorder resequences `scene_number` and persists within 1 s |
| SC-2 | Scene board view — grid of scene cards showing thumbnail, number, slugline, character chips, duration, continuity-flag badge | p95 frame time < 16 ms while scrolling a 200-card board on a mid-range Android device; virtualised list required |
| SC-3 | Scene detail view organised into collapsible sections: Story, Cast & Wardrobe, Scenery, Look (camera/lighting/style), Sound, Script, Shots | Section state persists per user |
| SC-4 | Script editor supports typed lines with character attribution, delivery notes, and reordering | Dialogue lines can only reference characters present in the scene (with an override + warning) |
| SC-5 | Autosave on field blur and every 10 s while typing; explicit save-state indicator | No data loss on browser close mid-edit |
| SC-6 | Undo/redo, minimum 50 steps, scoped to the current editing session | |
| SC-7 | Shot strip within the scene view — horizontal, reorderable, with per-shot camera summary | Advanced mode only; hidden in Simple |
| SC-8 | Duplicate a shot including all camera settings | |
| SC-9 | Scene lock prevents edits and excludes the scene from bulk AI operations | |
| SC-10 | Split a scene into two at a chosen script line | Shots and lines distribute correctly |
| SC-11 | Global project timeline view — all episodes and scenes with cumulative duration | |
| SC-12 | Keyboard shortcuts on web for next/previous scene, save, new scene, AI tighten | Documented in an in-app shortcut sheet |

### 7.5 Export — the Phase 1 delivery path

| ID | Requirement | Acceptance criteria |
|---|---|---|
| EX-1 | Export scope: single shot, single scene, whole episode, whole project | |
| EX-2 | **Copy-single-prompt** — one tap copies the compiled prompt to clipboard | Works on web and Android |
| EX-3 | **Markdown export** — human-readable pack, one section per shot: heading, prompt block, negative prompt block, character reference names, aspect ratio, duration, motion intent | Opens cleanly in any editor |
| EX-4 | **JSON export** — machine-readable, schema-versioned, one object per shot with all compiled fields plus source field values | Validates against a published JSON Schema |
| EX-5 | **CSV export** — one row per shot, columns: episode, scene, shot, prompt, negative, aspect, duration, characters | Opens correctly in Excel and Sheets |
| EX-6 | **PDF storyboard** — printable, one panel per block: thumbnail slot, shot number, camera summary, action beat, dialogue, prompt | Paginates cleanly at A4 and Letter |
| EX-7 | **Text bundle** — a zip of one `.txt` per shot, named `E01_S04_SH02__a3f9c1.txt` where the trailing token is the shot's immutable `export_key` | Enables rapid sequential pasting into OpenArt. **The `export_key` is the matching authority on re-import**, because episode/scene/shot numbers change when the user reorders. |
| EX-8 | Export includes an **OpenArt handoff sheet**: which characters to load from Character Builder (`openart_character_ref`), the aspect ratio to set, the style reference images to upload, and the recommended panel order | Present in Markdown and PDF exports |
| EX-9 | Exports are recorded as `ExportPack` and re-downloadable for 30 days | |
| EX-10 | Filter exports by `generation_status` (e.g. export only `needs_rework` shots) | |

### 7.6 Generation results round-trip

Because Phase 1 has no API, the user brings results back manually. **This must not be an afterthought — it is what makes the storyboard a storyboard.**

| ID | Requirement | Acceptance criteria |
|---|---|---|
| GR-1 | Upload one or more generated images **or videos** against a shot | Multi-file drag-drop; accepts every MIME in the `generated_output` class (§3.13); videos get a poster frame |
| GR-2 | Bulk upload with filename-based auto-matching on `export_key` | **100% of files whose name contains a valid `export_key` are matched to the correct shot, with zero mis-assignments** — verified by an export→shuffle-scene-order→re-import test. Files with no recognisable key create `UnmatchedUpload` rows in the manual-assignment tray, which persists across sessions. Legacy `E01_S04_SH02` names without a key are matched by number only if the numbers still resolve unambiguously, otherwise they go to the tray. |
| GR-3 | Multiple takes per shot, one marked hero | `Shot.hero_asset_id` set; UI marks the hero; deleting the hero asset promotes the next take or nulls the field |
| GR-4 | Shot thumbnails propagate to the scene board, contact sheet and PDF export | Video shots use `poster_asset_id` |
| GR-5 | Mark a shot `approved` or `needs_rework` with a note | `rework_note` persists and appears in the EX-10 filtered export |
| GR-6 | Storyboard contact-sheet view — all shots with a hero take, in order, full-bleed | Read-only presentation mode; renders correctly at 360 px width |

### 7.7 Phase 2 — provider integration (seam required in v1)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| GP-1 | `GenerationProvider` interface defined with `submit(prompt, options) → jobId`, `poll(jobId) → status`, `fetchResult(jobId) → assets[]`, `capabilities() → {...}` | Interface exists and is unit-tested against `ManualExportProvider` |
| GP-2 | `ManualExportProvider` is the only v1 implementation; `submit` produces an ExportPack rather than a network call | All export paths route through it |
| GP-3 | Provider capability flags drive UI (`supports_video`, `supports_character_refs`, `max_prompt_length`, `supported_aspect_ratios`) | UI hides or warns on unsupported options |
| GP-4 | Per-account encrypted credential storage for future providers, never logged, never returned to the client | Secrets encrypted at rest; API returns only a masked hint |
| GP-5 | Job queue with retry/backoff and a visible per-shot job status | Design complete in v1, activated in Phase 2 |
| GP-6 | No scraping, headless automation, or use of undocumented OpenArt endpoints | Code review confirms |

---

## 8. Android Application

The Android app is a **wrapper around the web app**, per requirement.

| ID | Requirement | Acceptance criteria |
|---|---|---|
| AN-1 | Implement as a **Trusted Web Activity (TWA)** via Android Browser Helper, not a raw `WebView` | No browser chrome visible; app renders full-screen |
| AN-2 | The web app is a fully installable **PWA** | Explicit checklist, all items verified (Lighthouse dropped its PWA category in v12 — do not rely on it): valid `manifest.webmanifest` served with the correct MIME; `name`, `short_name`, `start_url`, `scope`, `display: standalone`, `theme_color`, `background_color`; 192px and 512px icons plus a `purpose: maskable` icon; a registered service worker controlling `start_url`; served over HTTPS; `beforeinstallprompt` fires in Chrome on Android |
| AN-3 | Digital Asset Links verified for the domain | TWA launches without an address bar |
| AN-4 | OAuth sign-in completes inside the TWA via Custom Tabs | Google and Apple sign-in both succeed on a physical device |
| AN-5 | Android back button maps to in-app navigation, not app exit; exits only from the top-level route | |
| AN-6 | Native camera and gallery access for reference-image upload via `<input type="file" accept="image/*" capture>` | Photo captured on device uploads successfully |
| AN-7 | Share-target intent: text shared from another app opens as a new project logline or scene note | Registered in the manifest |
| AN-8 | Offline behaviour: previously-loaded projects are readable offline; edits queue locally and sync on reconnect, with an explicit conflict prompt on divergence | Airplane-mode test: read works, edits queue, sync on restore |
| AN-9 | Clipboard copy works in the TWA context | EX-2 verified on device |
| AN-10 | File download (export packs) works in the TWA context | PDF and zip land in Downloads |
| AN-11 | Minimum SDK 26 (Android 8.0); target the current Play requirement | |
| AN-12 | Play Store package: signed AAB, privacy policy URL, data-safety declaration, adaptive icon, splash screen | Passes Play Console pre-launch review |
| AN-13 | Responsive layouts down to 360 px wide; scene detail is usable one-handed | Tested at 360×640 |
| AN-14 | Push-notification hook for long AI generations (Phase 2 ready) | Permission flow implemented, disabled by default |

**Do not build a parallel native UI.** All product logic lives in the web app; the wrapper adds only shell, intents, and platform affordances.

---

## 9. Non-Functional Requirements

### 9.1 Performance

| ID | Requirement | Target |
|---|---|---|
| NF-1 | Scene board interactive | < 2.0 s on 4G. Board is scoped to one episode; test at the 200-scene worst case, above the NF-6 nominal ceiling of 40 |
| NF-2 | Field autosave round-trip | < 500 ms p95 |
| NF-3 | Prompt recompilation on field change | < 300 ms, client-side |
| NF-4 | AI `tighten_field` first token | < 2.0 s p95 |
| NF-5 | Export of a 100-shot episode | < 10 s |
| NF-6 | Scales to 50 projects × 10 episodes × 40 scenes × 5 shots per account (nominal), and degrades gracefully to 200 scenes in a single episode (worst case, per NF-1/SC-2) | No query degradation; all list endpoints paginated; no N+1 on the scene board or export |

### 9.2 Reliability and data safety

| ID | Requirement |
|---|---|
| NF-7 | Autosave plus a local draft cache; a browser crash loses at most 10 s of work |
| NF-8 | Scene-level version history, last 20 versions, restorable |
| NF-9 | Nightly automated backups, 30-day retention, restore procedure documented and tested |
| NF-10 | Optimistic concurrency on `Scene` and `Shot` via their `version` field. Clients send `If-Match: <version>`; a stale write returns **409 with an RFC 7807 body containing the current server state**, never a silent overwrite |
| NF-10b | **Offline conflict resolution is field-level last-writer-wins with a prompt.** When a queued offline edit arrives stale, the client diffs its version against the server state per field. Fields the server did not change apply silently. Fields both sides changed raise a per-field "keep mine / keep theirs" prompt. Embedded `ScriptLine[]` is diffed per line by `id`. **Never present a whole-record merge dialog** — a 25-field scene makes that unusable |
| NF-10c | Queued offline edits always trigger server-side recompilation on apply; the client's cached `compiled_prompt_*` is treated as advisory and overwritten by the server's result |
| NF-11 | Idempotency keys on all AI generation, upload and export endpoints |

### 9.3 Security and privacy

| ID | Requirement |
|---|---|
| NF-12 | All traffic over TLS 1.2+; HSTS enabled |
| NF-13 | Strict per-account authorisation on every endpoint — **row-level checks, never client-supplied account IDs** |
| NF-14 | Assets served via short-lived signed URLs; no public bucket listing |
| NF-15 | Passwords hashed with Argon2id or bcrypt (cost ≥12) |
| NF-16 | Rate limiting: auth endpoints, AI endpoints, upload endpoints |
| NF-17 | User content is never used to train models; stated in the privacy policy and enforced in provider configuration |
| NF-18 | GDPR: export, deletion, and a clear record of what is sent to third-party AI providers |
| NF-19 | Uploads validated by magic bytes, not extension; images stripped of EXIF |
| NF-20 | Secrets in a managed secret store, never in source or client bundles |

### 9.4 Accessibility and quality

| ID | Requirement |
|---|---|
| NF-21 | WCAG 2.1 AA: keyboard navigation, focus order, labels, 4.5:1 contrast |
| NF-22 | Light and dark themes, respecting system preference |
| NF-23 | Screen-reader labels on all icon-only controls |
| NF-24 | Drag-and-drop reordering has a keyboard-accessible alternative |
| NF-25 | Test coverage: 100% of the prompt compiler, ≥80% of domain logic; e2e coverage of premise→export in Simple mode and manual-build→export in Advanced mode |

---

## 10. API Surface

REST, JSON, versioned at `/api/v1`. Bearer token auth. All list endpoints paginated (`?page`, `?per_page`, max 100).

```
POST   /auth/register                          POST   /auth/login
POST   /auth/refresh                           POST   /auth/logout
POST   /auth/password-reset/request            POST   /auth/password-reset/confirm
GET    /me                                     PATCH  /me
DELETE /me                                     POST   /me/export

GET    /projects                               POST   /projects
GET    /projects/:id                           PATCH  /projects/:id
DELETE /projects/:id                           POST   /projects/:id/duplicate
POST   /projects/import

GET    /projects/:id/bible                     PATCH  /projects/:id/bible
GET    /projects/:id/characters                POST   /projects/:id/characters
GET    /characters/:id                         PATCH  /characters/:id
DELETE /characters/:id                         GET    /characters/:id/usage
  (identical shapes for /locations, /props, /music-cues)

GET    /projects/:id/episodes                  POST   /projects/:id/episodes
GET    /episodes/:id                           PATCH  /episodes/:id
DELETE /episodes/:id                           POST   /episodes/:id/reorder-scenes

GET    /episodes/:id/scenes                    POST   /episodes/:id/scenes
GET    /scenes/:id                             PATCH  /scenes/:id
DELETE /scenes/:id                             POST   /scenes/:id/duplicate
POST   /scenes/:id/split                       GET    /scenes/:id/versions
POST   /scenes/:id/versions/:vid/restore

GET    /scenes/:id/shots                       POST   /scenes/:id/shots
GET    /shots/:id                              PATCH  /shots/:id
DELETE /shots/:id                              POST   /shots/:id/duplicate
POST   /shots/:id/recompile                    GET    /shots/:id/prompt-preview

POST   /ai/:operation                          # see §6.2; streams SSE, returns proposal id
POST   /ai/:operation/estimate                 # cost estimate, no generation
GET    /ai/proposals/:id
POST   /ai/proposals/:id/accept                # {selections?}; atomic; returns records + revert_token
POST   /ai/proposals/:id/reject
POST   /ai/proposals/:id/revert                # {revert_token}
GET    /projects/:id/ai/history
GET    /me/ai-budget

POST   /projects/:id/continuity-check          # {scope, target_id}
GET    /projects/:id/continuity-flags
POST   /continuity-flags/:id/dismiss           POST /continuity-flags/:id/undismiss

POST   /assets                                 # multipart
DELETE /assets/:id
POST   /shots/:id/results                      # attach generated output
PATCH  /shots/:id/hero                         # {asset_id}
POST   /episodes/:id/results/bulk              # export_key auto-match
GET    /episodes/:id/unmatched-uploads
POST   /unmatched-uploads/:id/assign           # {shot_id}
DELETE /unmatched-uploads/:id

POST   /exports                                # {scope, target_id, format, filters}
GET    /exports/:id                            GET /projects/:id/exports
```

**Conventions:**

- Errors are RFC 7807 problem+json with a stable `type`, `title`, `detail`, and a `field_errors` map on validation failures.
- `PATCH /scenes/:id` and `PATCH /shots/:id` require `If-Match: <version>`. A stale write returns **409** with `type: "https://.../conflict"` and a `current_state` member holding the full server-side record, so the client can run the NF-10b field-level diff without a second round trip.
- All AI, upload and export endpoints accept an `Idempotency-Key` header.

---

## 11. User Flows

### 11.1 Simple mode — premise to export

1. Create project → title, logline, audience, tone, target duration
2. **Generate cast** — AI proposes 3–6 characters with prompt tokens and reference-image slots; user edits and accepts
3. **Choose look** — pick an art-style preset or describe one; AI writes the `art_style` sentence, palette and negative prompt
4. **Generate episode** — AI produces the full scene sequence with every field and a shot breakdown; streamed with progress. The user accepts the tree once (§6.5); everything is then a real, editable record.
5. **Review** — scene board; regenerate any scene, or any individual panel via its tile in the panel row; edit anything by hand
6. **Continuity check** — resolve or dismiss flags
7. **Export** — pick format; receive the pack plus the OpenArt handoff sheet
8. **Bring results back** — bulk-upload generated panels; approve or flag for rework

### 11.2 Advanced mode — manual build

1. Create project → fill the series bible by hand (AI *Tighten* available on each field)
2. Build cast, locations, props; use *Generate prompt token* per record
3. Create episode; optionally paste a script and run `breakdown_script_to_scenes`
4. Create scenes; fill story, scenery, action; *Tighten* and *Suggest* on demand
5. Build shots; pick camera, angle, movement, lens; *Suggest* offers options with rationale
6. Watch the live prompt preview as fields change
7. `critique_scene` for structured notes
8. Continuity check → export → round-trip results

### 11.3 Mode switching

A single toggle in project settings. Switching Simple → Advanced reveals the already-populated advanced fields, with any field carrying `ai_default_unreviewed = true` badged for review (AI-1). Switching Advanced → Simple hides those controls but preserves every value. No confirmation dialog beyond a one-line explanation. **No data is ever transformed.**

---

## 12. Build Phases

| Phase | Scope | Definition of done |
|---|---|---|
| **0 — Foundation** | Auth, account, project CRUD, data model, migrations, deploy pipeline | A user can sign up and create an empty project |
| **1 — Bible & cast** | Series bible, characters, locations, props, music cues, asset upload, prompt tokens | A user can define a complete visual world |
| **2 — Scenes & shots** | Episode/scene/shot CRUD, scene board, scene detail, script editor, reordering, autosave, undo | A user can hand-build a full episode |
| **3 — Prompt compiler** | Shared isomorphic compiler package, `vocabularies.json` fixture, live preview, template versioning, diff, full test suite | Every shot yields correct still and video prompts. **Gated on decision 1 (§13).** |
| **4 — Export** | All six export formats, OpenArt handoff sheet, export history | A user can produce a pack and paste it into OpenArt |
| **5 — AI Advanced mode** | Proposal lifecycle (§6.5), tighten, suggest, polish, critique, continuity check (Class A + B), prompt-token generation, budget endpoints | Advanced mode is complete. **Gated on decision 2 (§13).** |
| **6 — AI Simple mode** | Premise→episode, scene sequence, script breakdown, shot lists, wizard flow, tree accept + revert | Simple mode is complete. **Gated on decision 4 (§13).** |
| **7 — Results round-trip** | Result upload, bulk filename matching, takes, approval states, contact sheet | Storyboards show real imagery |
| **8 — PWA & Android** | Service worker, manifest, offline, TWA build, Play submission | App is live on Play |
| **9 — Phase 2 seam** | Provider interface, credential storage, job queue (dormant) | An API adapter can be added without touching the domain |

---

## 13. Open Decisions for the Product Owner

**Three of these gate specific build phases. Do not start the gated phase until the decision is made.**

| # | Decision | Gates | Default if unanswered |
|---|---|---|---|
| 1 | **Video vs stills.** Should the video prompt variant and `motion_intent` ship in v1, or stills only? | **Phase 3** — the compiler signature and the two prompt columns depend on it | Ship both; stills is the primary export, video is available |
| 2 | **AI cost model.** Bring-your-own API key, bundled credits, or subscription tiers? | **Phase 5** — AI-7, `ai_credit_balance`, the budget endpoints | Bundled credits with a generous free daily cap; BYO key as an override |
| 4 | **Script import formats.** Plain text only, or Final Draft (.fdx) / Fountain parsing? | **Phase 6** — `breakdown_script_to_scenes` | Plain text and Fountain; .fdx deferred |
| 3 | **Storage limits.** Reference and generated-asset storage per account before a paid tier. Video results at 200 MB each make this material. | Phase 7 | 5 GB per account |
| 5 | **Character reference workflow.** Store our own turnarounds, only the OpenArt Character Builder name, or both? | Non-blocking | Both, as specified |
| 6 | **Series-level arcs.** Multi-episode arc tracking, or is episode-level structure enough for v1? | Non-blocking | Episode-level only |

---

## 14. Definition of Done (v1)

A new user can sign up on Android, create a cartoon project, define a cast and visual style, generate a complete episode from a one-line premise in Simple mode, review and correct every scene, resolve continuity flags, export a Markdown prompt pack with an OpenArt handoff sheet, paste those prompts into OpenArt to produce panels, upload the results back, and present a finished storyboard contact sheet — without leaving the app for anything except OpenArt itself.

---

## Sources

- [OpenArt Help Centre](https://openart.ai/help) — confirms no public API is currently available
- [OpenArt AI Storyboard Generator](https://openart.ai/features/ai-storyboard-generator/) — panel input format and prompt-specificity guidance
- [OpenArt What's New](https://openart.ai/whats-new) — Smart Shot, Character 2.0, multi-character consistency, video models
- [OpenArt Smart Shot](https://openart.ai/features/smart-shot/) — automated shot sequencing
