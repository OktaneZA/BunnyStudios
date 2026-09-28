# OpenArt, fal and character continuity

> Historical research note. The subsequent user-directed
> [Character Studio requirements](character-studio-requirements.md) and
> [build plan](character-studio-build-plan.md) now govern rollout order and the six-family scope.

Reviewed 27 September 2026. Recommendation only; no generation models enabled or paid generations run. Sources are public documentation and the supplied OpenArt screenshots. Availability here means a documented fal endpoint, not a successful test with our account.

Keep fal as the generation provider. Adopt OpenArt's frame/reference workflow inside our Film Strip and Scene Board layouts, with White/Black themes. Prioritise approved character references and a capability-aware model router before expanding the model menu.

## What the code currently does

- `packages/models/models.json` enables three video endpoints: Wan 2.2 5B text-to-video, Hailuo 02 Standard text-to-video and Veo 3 Fast. All three have `reference_images: false` and `start_frame: false`. The existing three image-to-video entries are disabled.
- `apps/api/src/routes/director.ts` exposes the first enabled text-to-video model for each cost tier. Adding a reference model to the JSON alone will not expose it through this route.
- `apps/api/src/db/schema.ts` already has character appearance, distinguishing features, costume variants, voice direction, reference assets and a main picture. `routes/cast.ts` supports portraits and additional angles. Extend this foundation.
- The catalogue has an end-frame field, but `generation/provider.ts` has no `endFrame` on `GenerationRequest` and does not map it in `shapeRequest`.
- `routes/director.ts` and `jobs/runner.ts` truncate character references to the model limit. For the enabled video models that limit is zero. There is no character-to-reference manifest.
- `jobs/runner.ts` creates longer clips by submitting the same prompt separately for each planned duration, then joining the results. This delivers the requested length but does not establish visual continuity between parts.
- Story cast re-discovery can update `promptToken` for existing story-derived characters. An approved identity needs protection against this overwrite.
- `docs/spike/results/findings.md` still contains an unfilled consistency experiment. The repository does not establish that text alone or any particular provider preserves these characters reliably.

## What to adopt from OpenArt

The screenshots show useful controls: start/end frame selection with history, model choice, audio, speed, output settings and a persistent generation cost/action. Bring these into a compact scene panel, retaining our story context and scene order.

OpenArt also describes reusable characters created from images, text or presets; its own FAQ acknowledges that variations can still occur. Treat character locking as locking approved inputs and references, with output review, rather than guaranteeing identical generated pixels. [OpenArt character workflow](https://openart.ai/features/ai-character/).

Recommended scene flow:

1. Choose the characters appearing in this scene.
2. Use their approved look, or make a quick draft without pictures.
3. Make/select the starting picture; optionally select an ending picture or reuse the previous approved ending frame.
4. Choose action/camera, style, length, sound and cost preference.
5. See the exact quote, generate, compare takes and accept a clip.

Keep camera and detailed model settings in an expandable panel. Present simple choices to younger users; retain named models for the adult/advanced view. Show only settings supported by the selected endpoint. Keep generation count at one by default; any batch must quote and reserve the total.

Preserve the five style presets and the removal of “Anything to add”. Store motion/camera controls as structured scene instructions. Use the vocabulary catalogue for prompt phrases. Float/dock panels on wide screens; stack them or use a bottom sheet on narrow screens. Use one shared scene editor for both layouts.

## Model comparison and shortlist

The following are integration candidates, not a measured quality ranking. Different task variants of the same model have different limits.

| OpenArt model/family | fal evidence | Recommendation |
|---|---|---|
| MiniMax H3 Max | [Reference-to-video API](https://fal.ai/models/minimax/h3-max/reference-to-video/api) accepts image/video/audio references, with 12 combined inputs. | First general-purpose reference-video candidate. Benchmark cartoon faces, bodies and two-character scenes. |
| MiniMax H3 Max Turbo | [Image-to-video API](https://fal.ai/models/minimax/h3-max-turbo/image-to-video/api) is available. | Trial as the fast-preview option; independently verify its limits and price. |
| Seedance 2.5 / Draft | [Reference API](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api) supports 4–30 seconds, multimodal references, draft generation and editing/extension tasks. Draft is an API option, not necessarily a separate model. | Premium longer clips and draft-to-final workflow. Preserve the returned draft ID. |
| Seedance 2.0 Mini | [Reference endpoint](https://fal.ai/models/bytedance/seedance-2.0/mini/reference-to-video); [frame endpoint](https://fal.ai/models/bytedance/seedance-2.0/mini/image-to-video) includes an end image. | Alternative fast candidate; avoid adding overlapping defaults before benchmarking. |
| Wan 3.0 | [Reference endpoint](https://fal.ai/models/alibaba/wan-3.0/reference-to-video) and [family duration documentation](https://fal.ai/wan-3). | Strong candidate for native 5/10/15/30-second choices and a simpler per-second price. |
| Kling family | [Kling O3 Standard reference API](https://fal.ai/models/fal-ai/kling-video/o3/standard/reference-to-video/api) supports named character/object elements, start/end frames, multi-shot input and 3–15 seconds. This is newer than the screenshot's O1. | First specialist candidate for character continuity. Map each character to an element, rather than pooling unnamed pictures. |
| LTX 2.5 | [Fast image-to-video API](https://fal.ai/models/lightricks/ltx-2.5/image-to-video/fast/api) has start/end frames, audio and camera controls. Fast durations are even values 6–20 seconds, with resolution/FPS restrictions. | Later preview alternative. It does not natively match all four requested duration buttons. |
| FLUX 3 Video | [Keyframes endpoint](https://fal.ai/models/blackforestlabs/flux-3/keyframes-to-video) accepts a sequence of frame anchors; [first/last endpoint](https://fal.ai/models/blackforestlabs/flux-3/first-last-frame-to-video) is also available. | Later specialist option for planned movement between approved pictures. |
| Gemini Omni Flash | [Reference endpoint](https://fal.ai/models/google/gemini-omni-flash/reference-to-video) exists. | Later comparison candidate. I could not verify the screenshot's exact **1.1 Flash** version on fal; do not silently map it to the unversioned endpoint. |
| Older Wan 2.5/2.6, Kling 2.5/O1, Hailuo 02/2.3 | Hailuo 02 is already in our catalogue; the others are not the priority of this expansion. | Retain working fallback paths. Do not spend the first integration phase adding every older screenshot entry. |

Start with Kling O3 and H3 Max for the continuity comparison, Wan 3.0 for native duration coverage, and Seedance 2.5 as an explicit premium choice. Select a fast model after measuring usable-output cost and latency. This avoids treating price tiers as quality guarantees.

## Cost implications

Illustrative provider USD prices checked on the review date, before currency conversion, tax, reference extras, retries and our operating costs:

| Model/configuration | 5s | 10s | 15s | 30s |
|---|---:|---:|---:|---:|
| H3 Max, 768P output | $0.40 | $0.80 | $1.20 | Not native |
| Kling O3 Standard, audio off | $0.42 | $0.84 | $1.26 | Not native |
| Wan 3.0, 720p | $0.50 | $1.00 | $1.50 | $3.00 |
| Seedance 2.5, 720p, 16:9 output | ~$2.31 | ~$4.62 | ~$6.93 | ~$13.87 |

H3 Max and Seedance figures come from [fal's pricing comparison](https://fal.ai/learn/devs/minimax-h3-max-vs-seedance-2-5). H3 Max reference inputs can incur token charges; Seedance pricing depends on frame area, duration and reference-video rules. The table is output-only for those two models. [Kling Standard](https://fal.ai/models/fal-ai/kling-video/o3/standard/reference-to-video) lists $0.084/second without audio and $0.112 with audio. [Wan 3.0](https://fal.ai/models/alibaba/wan-3.0/reference-to-video) lists $0.10/second at 720p.

Our fixed `unit_cost_pence` cannot represent all these configurations. Add a versioned pricing strategy per endpoint, reference charges, FX date and a quote breakdown. Reserve an upper bound before submitting; settle against supported usage data or the documented calculation. Avoid unconstrained auto duration. Do not equate OpenArt's displayed 400 credits to a fal dollar price.

## Character setup and continuity

Add **Keep this character** to the existing Cast sheet. A user describes or uploads a character, chooses an approved full-body picture, and optionally approves side/three-quarter/back views and expressions. Initial setup remains optional for quick drafts.

Separate identity from scene state:

- Identity: species, face, proportions, fur/skin colour, hair, eyes, distinctive markings and permanent accessories.
- Outfit: named approved costume variants, selected per shot.
- Performance: expression, pose, action and temporary props, editable per shot.
- Appearance style: approved reference packs per style revision; changing from flat 2D to 3D should propose a new look for approval.

Add versioned `character_looks` (names illustrative): account/character ID, revision, approval state, traits, style version, approved reference views and fingerprint. Shot cast bindings point to a look revision and outfit. Every generation snapshots those bindings and the ordered reference manifest, prompt/compiler version, model, settings and seed when supported. Existing clips retain their original identity version.

Story edits or cast re-discovery should propose identity changes rather than overwrite a locked look. Use optimistic concurrency on approval. Validate ownership and accepted asset state, and report insufficient reference capacity before charging instead of silently dropping a character.

For continuity, generate a scene composition from the character references, approve it, then animate it. When continuing a shot, combine the previous accepted ending frame with the original identity references where the endpoint supports both. Do not repeatedly anchor only to generated frames, because visual errors can accumulate. Keep voice identity separate; a sound toggle does not lock a voice.

Offer a side-by-side check of the result against the approved cast. Automated trait checks can flag possible drift but should not claim certainty. Seeds help record/reproduce a request; they are not character locks. Defer model training/LoRAs until the reference-based benchmark shows a need.

## Concrete implementation order

| Step | Files/areas | Deliverable |
|---|---|---|
| 1. Model contracts and quotes | `packages/models/models.json`, its schema/codegen, `packages/models/src/index.ts`, `generation/provider.ts`, `routes/director.ts` | Task-specific capabilities, constrained durations, end frames, typed references/elements, seed, speed/draft options and conditional pricing. Replace first-match tier selection with compatibility filtering and explicit defaults. |
| 2. Approved cast looks | `db/schema.ts` plus migration, `routes/cast.ts`, `shots/sync.ts`, `CastSheet.tsx` | Versioned looks and outfits, approval, protected identity edits and immutable job snapshots. Keep the compiler pure and server-authoritative. |
| 3. References reach video | Provider adapters, job request/runner, Director scene editor | Kling O3/H3 Max integrations, stable reference-token mapping, frame selection/history and visible continuity status. Preserve account isolation, budget reservation, safety gates and resumable provider IDs. |
| 4. Native long clips | Catalogue/router, `clipPlan`, runner | Wan 3.0/Seedance 2.5. Prefer native requested duration. Otherwise show a planned multi-shot assembly with individual prompts and anchors; do not imply repeated independent generations are one continuous take. |
| 5. Broader options | Advanced model picker and benchmark fixtures | Add fast/keyframe alternatives only when they improve measured results. Draft promotion is explicit and separately quoted. |

Disable provider prompt expansion initially where configurable, so it does not silently rewrite the compiled instructions. Preserve returned expanded prompts for diagnostics when later supported. Model fallbacks must retain required references/settings and quote limits; never silently fall back from a character-reference request to text-only generation.

## Validation before enabling defaults

Use the existing Milo/Griggs/Scraps spike and the Biscuit Robbery cast. Compare identical briefs with text only, references, and approved frames across several seeds and both 2D and 3D looks. Include two characters, a turn to profile/back, occlusion/re-entry, an outfit change and a follow-on shot. Record identity drift, action accuracy, scene continuity, usable takes, latency and total cost per accepted second. No paid benchmark has been performed in this review.

Contract tests should cover exact provider payloads, reference ordering, capacity rejection, end frames, pricing boundaries and unsupported combinations. Job tests should cover retries without duplicate submission, locked-look edits during a running job, partial failure/refunds and account isolation. UI checks should cover both layouts/themes, touch resizing, narrow screens and accessible frame/character selection.
