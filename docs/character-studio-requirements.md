# Character Studio and story-aware video — requirements

Version 1.0 · 27 September 2026 · Product direction requested by the user; implementation acceptance remains pending.

This is the current requirements addendum for Character Studio, canonical visual references and production video. It supersedes conflicting parts of D38/D39 (cast only discovered from story), D41 (text-to-video as the only Simple workflow), DM-1 (flat pricing) and the original external-generation-only scope. Other existing requirements remain in force. See [build plan](character-studio-build-plan.md), [architecture](media-generation-architecture.md) and [continuity experiment](spike/continuity-benchmark.md).

## 1. Product outcome and boundaries

Bunny Studios understands the story, characters and shots, then chooses and supplies a suitable generator. A teenager can make a character, choose the pictures that look right, and reuse that approved look throughout a cartoon without learning provider terminology.

The six initial video families are Seedance 2.5, Wan 3.0/Prime, MiniMax H3/H3 Max, LTX 2.5 Fast/Pro, Hailuo 2.3 and FLUX 3 Video. Family membership does not imply that every variant or endpoint is production-ready. Core workflows ship before exposing broad model choice.

This work extends the existing Character, Asset, Shot, GenerationJob and GenerationLedger domains. It does not introduce a parallel character library, replace writing proposals with video jobs, or require Redis, RabbitMQ or a second worker service. Optional rough SVG storyboard thumbnails remain separate from production character art.

References improve consistency but cannot guarantee that generated characters never change. “Lock” means approved inputs are immutable and supplied consistently; outputs still need review. The UI must not claim perfect identity or deterministic reproduction.

## 2. Character Studio

Simple flow: **Make my character → describe them → make choices → This looks like Bunny → make reference views → approve the pack**. Start with one usable main picture; additional views are optional. Access Studio from Cast and from a shot's character selector without creating a compulsory setup wizard for writing or quick drafts.

| ID | Requirement | Acceptance criteria |
|---|---|---|
| CS-01 | Extend existing characters. | Existing character IDs, story appearances and reference assets survive migration. Manual creation and accepted story-discovery proposals use the same Character domain. |
| CS-02 | Provide a short, friendly character form. | Name and a short description are sufficient to begin. Optional structured fields cover species/person type, build, clothing, colours and distinguishing features. Personality/story details remain separate from visual traits. |
| CS-03 | Offer generation, upload and refinement. | The teen can generate alternatives, upload a picture, or request a change to a selected candidate. Each paid action shows its total quote. Text or generated suggestions never silently overwrite the character. |
| CS-04 | Separate candidate pictures from canonical pictures. | A generated or uploaded image has a visible candidate/review state. Only **This looks like [name]** or **Use these pictures** promotes reviewed pictures. Completion, first upload and first portrait generation do not automatically approve identity. |
| CS-05 | Support a small reference pack. | Available roles include front, three-quarter, side, back, full body and expressions. The user can request individual views, compare alternatives, approve a subset and remove a candidate. At least one approved main image is enough for compatible workflows. |
| CS-06 | Generate additional views from an approved visual anchor. | Reference-capable image generation receives the chosen anchor and consistent traits/style. A text-only image model must not be presented as preserving identity. Generated views remain candidates. |
| CS-07 | Keep identity, outfit and performance separate. | Identity records stable anatomy/colours/markings; named outfits can vary per shot; expression/pose/action can change without changing the canonical identity. Optional voice identity is distinct from voice-direction text and the audio toggle. |
| CS-08 | Review changes to an approved look. | A trait edit, changed outfit design or style conversion creates a proposed new look. Story rediscovery cannot overwrite an approved look. Existing approved references stay active until a replacement is explicitly approved. |
| CS-09 | Version approved visual identity. | Approval atomically creates an immutable visual revision and selects it as current. Concurrent approval with a stale character version returns a conflict without losing either candidate. Reverting selects or creates a recorded revision; it does not rewrite history. |
| CS-10 | Preserve historical references. | Each generation pins the visual revision, ordered asset IDs and asset content hashes it used. Later edits or soft deletion do not replace referenced bytes in historical generations. Access still requires ownership. |
| CS-11 | Treat approval and content review as separate gates. | A user cannot promote an unreviewed/rejected asset for a constrained account. Generation failure, cancelled candidates and policy rejection preserve the previous approved look. |
| CS-12 | Make legacy migration explicit. | Existing main pictures become legacy candidates awaiting identity confirmation; migration must not infer that previous selection meant approval of a versioned pack. Existing clips remain usable. No paid reference generation runs during migration. |

## 3. Characters in shots and compilation

| ID | Requirement | Acceptance criteria |
|---|---|---|
| CR-01 | Explicit shot cast bindings. | “Characters in this shot” selects existing characters and approved look revisions/outfits. Story detection can propose selections, but explicit accepted bindings drive production requests. Background characters may be intentionally unbound. |
| CR-02 | Explain missing approved references. | A continuity-enabled request with an unapproved selected character identifies the missing look and links to Studio before quoting/submitting. A quick text draft remains available as an explicit choice without a continuity promise. |
| CR-03 | Preserve reference identity and ordering. | The request records a manifest of character ID, visual revision, asset ID/hash, view role and position. Adapters map those positions to provider tokens. Two characters must never swap identities because sorting or filtering changed. |
| CR-04 | Never silently truncate references. | Routing checks per-modality and combined limits, bytes, duration, format and endpoint prerequisites. It chooses a compatible endpoint or asks the user to reduce the pack. No selected character disappears to fit a limit. |
| CR-05 | Keep language and visual conditioning complementary. | The pure, versioned compiler describes action, composition, camera, lighting, mood, location and current costume. Canonical references carry visual identity. The server creates the authoritative request; the browser cannot submit a trusted compiled prompt. |
| CR-06 | Distinguish asset roles. | Character, style, location and prop references, storyboard sketches, start/end frames and generated videos have explicit usage roles. A rough SVG sketch is never automatically treated as canonical character art or a final starting frame. |
| CR-07 | Detect possible drift without asserting certainty. | Results can be compared with the approved pack. Automated checks, when introduced, flag suspected changes for review and are evaluated separately from mandatory content safety. User acceptance selects a take; rejected takes never update the canonical character. |

## 4. Generation domain and provider boundary

| ID | Requirement | Acceptance criteria |
|---|---|---|
| MG-01 | Provider-neutral creative request. | The domain stores asset IDs and structured creative intent, not fal URL fields. It includes prompt/compiler version, task, start/end assets, reference manifest, cast revisions, output preferences and audio intent. The adapter translates to the provider payload. |
| MG-02 | Registry is the model source of truth. | `packages/models/models.json` and generated `VideoModelDefinition` metadata define endpoint tasks, capabilities, limits, categories, pricing and adapter selection. React and the job runner contain no provider model IDs or family-specific branches. |
| MG-03 | Capability matching is mandatory. | Required start/end frames, visual references, sound, aspect and duration must survive routing and fallback. A reference request cannot silently become text-only. Unsupported combinations fail before spending. |
| MG-04 | Endpoint-specific adapters. | Seedance, Wan and other payloads are built through testable adapters. Flat schemas may share a mapping adapter; nested reference/shot structures use dedicated adapters. Queue transport, budgeting and character logic remain shared. |
| MG-05 | Immutable input snapshot and lineage. | A job records the creative snapshot, look/reference revisions, endpoint and adapter versions, provider settings, seed when supported and quote revision. Drafts and finals share a logical generation group with parent links. Re-running uses a recorded snapshot unless the user explicitly chooses current story settings. |
| MG-06 | Persistent jobs survive restarts. | Extend existing Postgres `generation_jobs`, including provider request IDs, claims/leases, attempt count and poll scheduling. Reload/redeploy resumes polling submitted work; stale claims are reclaimed. `ai_proposals` remains for proposed domain edits. |
| MG-07 | Avoid duplicate billable submissions. | Client idempotency keys prevent duplicate local jobs. Persist submission attempts and provider IDs. Where a crash occurs after provider acceptance but before ID persistence, reconcile if supported; otherwise mark the result uncertain and require deliberate retry rather than asserting exactly-once billing. |
| MG-08 | Safe completion, cancellation and retry. | Terminal updates and ledger settlement are idempotent. Handle provider timeouts, failed downloads, moderation rejection and late completion after cancellation. Cancelling locally does not imply that the provider refunded a submitted generation. |
| MG-09 | Honest durations and assembly. | Offer desired lengths 5/10/15/30s in Simple mode. Prefer native generation when supported. Otherwise disclose trimming/planned multi-shot assembly and all generated seconds; unsupported continuity workflows may require another model. Repeating independent prompts is not described as one continuous shot. |
| MG-10 | Account isolation and server credentials. | Every asset, character, look, shot, job and quote is ownership-checked. Provider keys remain server-only. Do not accept arbitrary client-provided remote URLs in place of owned assets. Signed delivery URLs are short-lived and not the permanent identity of an asset. |

## 5. Draft → Final

| ID | Requirement | Acceptance criteria |
|---|---|---|
| DF-01 | Simple mode offers purpose rather than model names. | “Quick preview” and “Make final video” show price and supported output choices. Detailed models, seeds and endpoint options are Advanced-only. Quick preview is optional; final production still requires approved references when continuity is requested. |
| DF-02 | Draft and final reuse creative intent. | A final request starts from the accepted draft's creative snapshot and reference versions. New story changes require an explicit “use latest” action. Neither a new take nor an upgrade silently replaces the selected clip. |
| DF-03 | Distinguish upgrade from regeneration. | Native draft completion is used only when the provider supports it and the saved draft ID is valid. Switching from LTX Fast to Pro, Seedance or Wan is labelled as a new render that may change composition, motion or identity. It is not promised to be an upscale. |
| DF-04 | Respect draft expiry and feature compatibility. | Persist provider draft IDs, ownership/account association and expiry. Expired drafts offer a newly quoted render. LTX Fast/Pro duration differences or lost reference support require explicit adjustment/model selection. |
| DF-05 | No invisible extra generation. | Every draft, reference-view batch, retry and final is separately quoted and explicitly triggered. Selecting a draft, opening Studio or switching a model never starts a paid request. |

## 6. Money and safety

| ID | Requirement | Acceptance criteria |
|---|---|---|
| MB-01 | Shared server quote calculation. | Quote and reservation use the same validated configuration, including duration/parts, resolution, audio, reference input costs and provider pricing method. Support per-clip, per-second and token-based charges; no UI credit multiplier. |
| MB-02 | Explicit pricing provenance. | Store source currency, dated provider price/version, conversion policy and estimated account-currency amount. Use decimal or integer-safe arithmetic. A budget conversion is labelled as policy, not a live exchange rate. Never present a cost estimate as a guaranteed provider bill. |
| MB-03 | Atomic allowance reservation. | Lock account allowance, validate available daily/monthly funds, create the job and reserve its bounded quote in one transaction. Concurrent requests cannot overspend. Reuse `generation_ledger`; do not create a parallel monetary ledger. |
| MB-04 | Reconcile charges honestly. | Record actual provider usage/cost when available and reconcile once. When unavailable, retain the estimate with an explicit unknown-actual state. Partial assemblies and cancelled/submitted work account for already incurred charges rather than automatically claiming zero cost. |
| MB-05 | Preserve the existing constrained-account gates. | Review inputs before spending, retain provider controls and review generated output before exposure/use. Teen policy cannot be disabled by project audience or model settings. Candidate uploads and all reference media follow the same account policy. |
| MB-06 | Prompt expansion is controlled. | Disable automatic rewriting initially where supported. If enabled later, capture expanded instructions and define how moderation covers them. Adapter-added reference bindings are included in validation/review and prompt-length checks. |

## 7. Director interface and model rollout

Keep Film Strip and Scene Board with independent White/Black themes. Responsive layouts and optional movable desktop panels remain. A shared scene/shot editor presents characters, starting picture, optional ending picture, action/camera, style, length, sound and the quote. Style choices remain 2D cartoon, Pixar-like 3D, soft anime, watercolour and clay animation. Changing style does not silently approve a new character look. Do not restore “Anything to add”.

Advanced categories are recommendations, not quality guarantees. Show only deployed, compatible endpoints; multiple task endpoints should appear as one family choice with the task resolved underneath where possible.

| Category | Initial intended choices |
|---|---|
| Recommended | Seedance 2.5 |
| Fast | LTX 2.5 Fast; MiniMax H3 Max after measured latency/cost comparison |
| Cinematic | Seedance 2.5; Wan 3.0 Prime; LTX 2.5 Pro |
| Character / References | Seedance 2.5; Wan 3.0, filtered by actual reference support |
| More models | Hailuo 2.3; FLUX 3 Video; compatible legacy options |

Model availability and supported configurations are versioned facts, not permanent UI assumptions. Preserve a low-cost explicit draft route; “Recommended” must not silently select a more expensive model without a fresh quote. No automatic purchasing of multiple alternatives.

## 8. Definition of done

The release must demonstrate: a teen creates and refines a character; generated/uploaded candidates do not auto-approve; approved views create a visual revision; two shots receive the selected revision and ordered references; changing the character creates a new revision without modifying the older job; a draft and separately accepted final retain lineage; start/end conditioning respects capability limits; a restart resumes paid work; concurrent jobs respect the budget; and unauthorized or rejected references cannot be used.

Use fake providers for automated tests and a bounded, separately recorded live-model benchmark for visual quality. Passing payload tests is not proof of character consistency. Physical tablet usability, live-provider access and billing must be recorded as verified or pending, not inferred from a successful build.
