# Character Studio and production video — build plan

Version 1.0 · 27 September 2026. Implements [requirements](character-studio-requirements.md) against the [architecture contract](media-generation-architecture.md).

## Current status — 28 September 2026

The staged plan below records the original delivery order. Canonical candidate approval,
immutable look revisions, pinned shot bindings, frame/reference production planning,
creative snapshots, lineage and submission-aware recovery now exist. The shared Create UI
uses those contracts; see [current requirements](current-product-requirements.md),
[implementation status](character-studio-status.md) and [the code review](review-2026-09-28.md).

Remaining acceptance includes live model access/billing/continuity, physical tablet and teen
sessions, mixed-media input and native draft completion. DF-02 has a frontend recipe-selection
gap. Do not interpret an implemented stage or an older test count as completion of the full
acceptance matrix. Tablet/desktop is the current device scope; phone-specific work is deferred.

## 1. Baseline at the start of the 27 September plan (historical)

This plan reflects local source, not deployed availability. A design document, catalogue entry or passing adapter test is not a completed production integration.

| Area | Local baseline | Remaining target |
|---|---|---|
| Cast | Existing Character fields, discovery proposals, upload, portraits, angles and main-reference selection | Candidate approval lifecycle, immutable visual revisions, protected edits and explicit shot bindings |
| Models | JSON catalogue, typed video registry, capability filters | Task-aware production routing and complete multimodal constraints |
| Providers | fal queue transport, fake provider, flat payload mappings and a provider-neutral video input foundation | Complete frame/reference task contracts, normalized draft metadata and lineage |
| Jobs and spend | Persisted `generation_jobs`, claims, provider IDs, part IDs and `generation_ledger` reservation | Submission ambiguity reconciliation, durable poll scheduling, quote/version provenance and partial-charge handling audit |
| Six families | Working-tree catalogue additions for text-to-video plus Seedance/Wan cast-image references; grouped picker and configuration pricing | Character Studio gate, Advanced-only broad choice, live access/schema/billing verification; I2V, mixed-media references and draft/final completion are not yet complete |
| Verification | Last local run: 112 API tests passed; API/web builds passed before the final documentation pass | Full new acceptance matrix, physical tablet checks and bounded live quality benchmark. Browser runtime was unavailable in this session; new picker visual checks remain pending. |

The current catalogue's new prices use an explicit **100 pence per USD budget conversion policy**, not a verified live exchange rate. Replace/configure and snapshot this policy as part of MB-02 before production rollout. Do not equate estimated allowance deductions with actual provider billing.

## 2. Delivery order

Character Studio precedes the production rollout of the newly added video families. Existing quick clips can remain available. Draft previews remain clearly identified as drafts until the complete production reference contract is available.

### Stage 1 — Consolidate contracts and preserve current behaviour

Requirements: MG-01–04, MG-06–10, MB-01–03.

- Keep `models.json` as the only editable endpoint catalogue; extend generated types/validation rather than introduce an independent server model list.
- Define versioned creative snapshots, resolved-reference manifests, task requirements, model adapters and normalized generation results.
- Retain existing fal queue transport and image/video jobs. Audit leases, polling, restart recovery and the remote-submission ambiguity window.
- Separate price strategies from display metadata. Add dated quote/configuration/conversion snapshots and identical quote/reservation calculation.
- Gate unfinished endpoints/workflows. Do not route a continuity request to existing text-only generation as a fallback.

Exit: old image/clip tests pass unchanged in behaviour; fake adapters prove compatible selection, exact payloads, restart recovery and spend reservation. Unsupported settings fail before a paid call. No database replacement or additional queue service.

### Stage 2 — Character Studio and visual versioning

Requirements: CS-01–12, CR-01–04, CR-06, MB-05.

- Add visual revisions, candidate/reference associations and shot bindings through additive migrations.
- Extend Cast into the short “Make my character” flow. Provide structured optional traits, upload, comparison, per-image approval and approval of a chosen reference pack.
- Make candidate versus canonical status visible. Remove automatic promotion for new uploads/first portraits; retain old main images as legacy candidates pending explicit confirmation.
- Protect approved identity from story rediscovery. Approve a new revision with optimistic concurrency, then pin it when a shot/generation is accepted.

Exit: one character can have two approved historical versions; two shots can use different versions; stale approval and cross-account asset attempts fail; old assets/clips remain accessible to their owner. A candidate cannot alter a canonical look merely by finishing generation.

### Stage 3 — Reference-pack image generation

Requirements: CS-03–06, CS-11, MB-01–06.

- Reuse fal image-generation plumbing and the existing reference-capable image route before introducing a new provider abstraction.
- Generate a main character choice, then individual front/three-quarter/side/back/full-body/expression views conditioned on the approved anchor.
- Make “change this picture” a new candidate operation. Keep constrained input/output review, batch-total quotes and explicit user acceptance.
- Validate image model capabilities and view/prompt presets through existing vocabularies; the compiler remains pure.

Exit: the teen can describe, refine and approve a reference pack; generating one view neither approves it nor replaces another. A fake-provider contract confirms the approved anchor reaches the provider. Live image quality is recorded separately.

### Stage 4 — Seedance production tasks, after Studio

Requirements: CR-01–07, MG-01–10.

Implement **Seedance 2.5 image-to-video with start/end frames first**, then **Seedance reference-to-video**, sharing the approved-character contract from Stage 2. This retains the requested endpoint order without putting production video ahead of canonical characters.

- Add starting/ending frame selection/history to the shared scene/shot editor. Select owned production pictures, not automatically promoted SVG sketches.
- Use pinned cast looks to generate/approve a starting composition. I2V conditions on that composition; reference-to-video supplies its own compatible manifest.
- Bind approved reference images by character/view with stable provider token ordering. Reject missing/overflow packs before spending.
- Implement mixed video/audio references only after upload, validation, moderation, storage and pricing support exist for those modalities. Initially image-only support must be labelled honestly.
- Preserve provider result metadata, including seed and native draft ID where applicable. Do not expose a promotion control until its completion endpoint and price are implemented.

Exit: two selected characters and optional end frame reach their respective compatible endpoint; 5/10/15/30-second configurations use native support when available; invalid media/aspects cannot reach submission. Account-scoped snapshot/asset tests pass. Benchmark quality is satisfactory under the experiment's release gate.

### Stage 5 — LTX Fast draft mode and final lineage

Requirements: DF-01–05, MB-03–06.

- Add Quick preview via a compatible LTX Fast workflow and Make final video using compatible Seedance or LTX Pro settings.
- Persist generation groups, parent links, immutable creative snapshots and candidate results. Reuse the approved reference-conditioned starting frame for I2V drafts when a model lacks independent character-reference input.
- Label cross-model finals as new renders. Implement true native draft completion separately when verified, with expiry and account binding.
- Resolve incompatible durations/references before quoting; Fast's longer duration support does not imply Pro can take the same request unchanged.

Exit: a draft-to-final chain uses the intended character versions; expired draft handling is explicit; a failed final retains the usable draft; clicking twice creates one local paid job; both operations have their own quotes and ledger records.

### Stage 6 — Wan, then MiniMax, then Advanced alternatives

Requirements: MG-02–04, DF-01, MB-01–06.

1. Wan 3.0/Prime: native duration routing, I2V start/end frames and reference tasks with verified per-task limits.
2. MiniMax H3/H3 Max: task-specific references, sound semantics and resolution tiers. Mark refinements/upscales accurately; do not copy H3 capabilities onto H3 Max.
3. Hailuo 2.3 and FLUX 3 Video: Advanced alternatives after adapter/pricing contracts pass. Add FLUX keyframes only as its own tested task.
4. Advanced category picker: Recommended, Fast, Cinematic, Character / References, More models. Simple mode sees compatible purpose choices and price, not the model catalogue.

Exit: each enabled endpoint has a documentation source/date, contract fixture, verified price calculation and compatible UI path. Rank defaults using accepted-result cost/latency and continuity evidence, not provider marketing tags. Existing low-cost paths remain explicitly available.

## 3. Acceptance and regression matrix

| Test | Required evidence |
|---|---|
| Candidate lifecycle | Generate/upload/refine/reject leaves approved identity unchanged; explicit approval creates one revision |
| Version conflicts | Two concurrent approvals cannot overwrite; old generations retain the original assets/hash/traits |
| Story rediscovery | Accepted discovery can propose a change but cannot rewrite an approved look |
| References | Two characters, several views, stable order; overflow/missing/rejected/foreign assets fail without provider call |
| Frames | Correct start/end mapping; unsupported end frame rejected; sketch roles are not auto-promoted |
| Routing | Model fallback preserves every required capability; no silent text-only fallback |
| Money | Resolution/token/reference/batch costs; quote equals reservation; concurrent budget requests; one settlement; uncertain actual cost retained |
| Recovery | Restart before submission, after ID persistence, ambiguous acceptance, stale worker and cancelled late result |
| Draft/final | Immutable parent snapshot; separate quotes; expiry; incompatible Fast/Pro settings; failed final preserves draft |
| Safety | Teen policy persists across all models; unapproved/rejected pack cannot be used; final payload bindings included in checks |
| UI | Film Strip/Scene Board, White/Black, narrow/wide layouts, keyboard/touch, accessible approval comparison and visible prices |
| Visual continuity | Recorded [benchmark](spike/continuity-benchmark.md), with costs and failures; no fabricated pass from unit tests |

## 4. Release boundaries

Documentation completion does not authorize an automatic paid benchmark or deployment. Implementation follows the user's authorized work scope; paid trials need a concrete bounded spend allowance before running. No training/LoRA workflow, public sharing, cross-account character sharing or universal voice cloning is in this release.

Retain migrations and old job readers until versioned snapshots are established. Do not delete the experimental six-family working-tree changes; bring them behind the staged capability/Advanced gates and test them against the canonical character contract. This plan supersedes the earlier recommendation to broadly enable models before completing Character Studio.
