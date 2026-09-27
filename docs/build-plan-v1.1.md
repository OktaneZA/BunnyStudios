# Storyboard Studio — Requirements Review & Build Plan (v1.1)

> **Current production-media sequence (27 September 2026):** follow the
> [Character Studio build plan](character-studio-build-plan.md) and its
> [requirements](character-studio-requirements.md). Canonical character approval and visual
> versioning precede the new Seedance production workflows. Existing unrelated decisions remain.

## Context

`storyboard-app-requirements.md` v1.0 specifies a pre-production tool for planning animated
cartoons: a creator structures a story into Projects → Episodes → Scenes → Shots, and a
deterministic compiler turns each Shot into a natural-language prompt to paste into OpenArt.ai,
which does the actual image generation.

The domain model is sound, Shot-beneath-Scene is the right call, and the proposal lifecycle (§6.5)
is the piece most specs of this kind get wrong and this one gets right. Three things needed
resolving before build: **scope and sequencing**, **four places where the spec asserts something it
cannot deliver**, and — established late in review and the most consequential of all — **the real
audience.**

**The primary user is a 10–15 year old**, with an adult (you) as a second user. v1.0 was not written
for that person. It is full of film-school language (`dutch_tilt`, `rack_focus`, *shot on an 85mm
portrait lens, compressed perspective*), its Advanced mode is defined around lens and depth-of-field
controls, and it targets a 360 px one-handed phone. This plan keeps the spec's excellent bones and
rebuilds the surface a child actually touches. Target: Azure-hosted, tablet and desktop, two users
now, more later without a rewrite.

---

## Decisions taken in review

| # | Question | Decision |
|---|---|---|
| D1 | Audience | **Two users: you and a teenager (10–15).** The teenager is the primary design target. Public later. `account_id` on every row and all provider seams stay in from day one. |
| D2 | Validate first? | **Yes — manual spike before any build.** See Phase −1. |
| D3 | Azure stack | **Container Apps + Postgres Flexible Server + Blob Storage.** |
| D4 | Scope cuts | **Cut Android TWA/Play Store (§8)** and **cut the offline write queue + field-level merge (AN-8 writes, NF-10b).** PWA; offline read only. |
| D5 | AI provider | **Anthropic API direct** (Claude Opus 5 / Sonnet 5) behind the `AiProvider` interface. |
| D6 | Prompt modes | **One compiled prompt per shot.** No `outputMode`, no `compiled_prompt_video`, `camera_movement` and `motion_intent` out of v1. |
| D7 | Exports | **Text-only in v1** (Markdown, text bundle, JSON). **PDF deferred.** |
| D8 | Auth | **Two hardcoded credential pairs in Key Vault**, two account rows, separate projects. Real auth later is a login-screen swap. |
| D9 | Continuity Class A | **Structural rules in v1**, optional AI severity-downgrade pass later. |
| D10 | AI role | **Both modes matter equally** — the proposal lifecycle is built properly so Simple and Advanced both sit on it. |
| D11 | Prompt overflow | **Hard error — block export** until source fields are shortened. |
| D12 | Vocabulary presentation | **Plain-English labels + visual pickers.** Enum values and `prompt_phrase`s are unchanged; only the label/picker layer is new. |
| D13 | Editor modes | **Keep both**, but Simple is redesigned from scratch as the guided, kid-usable experience. Advanced is yours. |
| D14 | Form factor | **Tablet landscape and desktop equally first-class.** |
| D15 | Guidance | **Guided path + free navigation.** A persistent "what's next" rail; every screen always reachable. |
| D16 | Safety | **Age guard always on for the teen account**, regardless of `target_audience`. Conditional (per AI-8) on the adult account. |
| D17 | Pictures in the app | **Optional AI-generated scene thumbnails only.** Simple sketches help the user recognise scenes on the board. Finished artwork and video creation remain external. Thumbnails belong to scenes and are available in both editor modes. See the requirements below. |

---

## Scene thumbnails — scope clarification (8 September 2026)

The user wants a story-planning tool with simple visual reminders of each scene. A small, rough
AI-generated thumbnail is enough: recognisable characters, setting, and the main action, in a
consistent sketch style. Photographic detail, finished illustration, and exact character likeness
are not acceptance criteria. One thumbnail represents the scene; it does not represent every shot.

This is the explicit exception to v1.0 §1.2's ban on in-app image generation. It does not add a
general image editor or change the external production-prompt workflow. D7's text-only exports
remain in force. Imported finished results are an optional later workflow, not a prerequisite for
using or presenting the scene board.

| ID | Requirement | Acceptance criteria |
|---|---|---|
| TH-1 | Each scene has one optional selected thumbnail | The same thumbnail appears on its board card and scene detail. A scene without one shows a placeholder and remains fully editable. |
| TH-2 | Generate on request in both modes | **Make a thumbnail** uses the saved scene's action/summary, relevant cast descriptions, and setting. There is no automatic generation on typing, saving, or opening a scene. |
| TH-3 | Preview before replacing | Generation produces an `AiProposal`; **Use thumbnail**, **Try again**, and **Cancel** resolve the preview. Only acceptance changes the selected thumbnail. Failure or cancellation keeps the previous thumbnail. |
| TH-4 | Keep scene text and images independent | Generation never changes story fields or shot prompts. Relevant source edits mark the current thumbnail as potentially out of date; refreshing is optional and explicit. A stale proposal cannot silently replace a newer selection. |
| TH-5 | Keep the workflow optional | Users can remove a thumbnail or keep planning while generation is unavailable. Missing or stale thumbnails never block saving, board review, or prompt export. |
| TH-6 | Apply existing account and AI controls | Thumbnail generation carries D16's account content policy, cost/rate limits, and interaction logging. Assets remain private to the owning account. Retrying a request must not create duplicate billable work. |

**Implementation boundary:** add a nullable `Scene.thumbnail_asset_id`, an Asset kind
`scene_thumbnail`, and a source fingerprint covering the scene/cast/location inputs used to create
the image. Add `generate_scene_thumbnail` as a field-scope proposal operation in both modes.
Acceptance validates scene ownership and source/selection freshness before attaching the asset.
Generated previews are held temporarily in proposal payloads until accepted; cancelled or expired
previews are cleared. Acceptance creates the selected asset. Removing a thumbnail clears its scene
association and deletes that asset.

Thumbnail production uses a small provider boundary independent of the pure shot compiler and
`ManualExportProvider`. The implementation uses Claude structured drawing instructions and a
trusted SVG renderer. Small sketches are stored with their private Asset records in Postgres;
ordinary uploaded media can still use Blob. No raster-generation provider is required. The model
and API key are server configuration. Keep rendering settings out of the scene flow.

**First visual milestone:** a user can create, edit, reorder, save, and reopen scenes, optionally
make and accept a thumbnail for each, and review the ordered board without importing external
pictures. Bring the thumbnail proposal/asset support into Phase 3; the remaining AI operations
follow in Phase 5. The OpenArt spike validates production prompts, not these rough previews.

---

## Designing for a 10–15 year old

This is the section that most changes the build. Nothing below alters the data model — every
`prompt_phrase` in §4 stays byte-identical, because prompt quality is the product and OpenArt still
wants film language. What changes is everything between the child and those values.

### Vocabulary layer (D12)
`vocabularies.json` gains presentation fields alongside the normative ones:

```jsonc
{
  "value": "low_angle",
  "prompt_phrase": "low angle looking up at the subject",   // normative, unchanged
  "label": "Low angle",                                      // adult / Advanced mode
  "friendlyLabel": "Looking up at them",                     // Simple mode
  "help": "Makes a character feel big, powerful or scary.",  // why you'd pick it
  "icon": "angle-low"                                        // key into the diagram set
}
```

CV-1 and CV-2 still hold, and CI additionally fails if any option lacks a `friendlyLabel`, `help` or
`icon`. Simple mode renders `friendlyLabel` large with `label` small beneath it — so they absorb the
real term over time rather than being shielded from it.

Representative translations: `close_up` → "Just their face" · `establishing` → "Show the whole
place" · `over_the_shoulder` → "From behind someone's shoulder" · `shallow_bokeh` → "Background
blurry" · `dutch_tilt` → "Tilted, like something's wrong" · `high_key` → "Bright and cheerful".

### Visual pickers
Options are **tappable cards with a picture**, not dropdown rows. A grid of 14 shot types in film
language stops a 10 year old dead; a grid of 14 little diagrams does not. Asset requirement, roughly
**67 pieces of artwork**:

- `shot_type` (14), `camera_angle` (9), `lens`/`depth_of_field` (10), `lighting_preset` (17) —
  simple hand-authored **SVG diagrams**, a stick figure in a frame. Small, themeable, scale free.
- `art_style` (17) — needs **example images**, not diagrams. Generate these during Phase −1 by
  running each preset's `prompt_phrase` through OpenArt on one fixed subject. This turns the spike
  into an asset-production run and makes the style picker genuinely show what it means.
- `mood_atmosphere` (12) — colour/type treatment rather than illustration.

This is a real, separately-schedulable chunk of work; it is not "styling".

### Writing scaffolding
Every free-text field a child must fill needs more than a placeholder. Each gets: a one-line
plain-English explanation of what the field is *for*, a worked example from a running demo project,
and — where §6.2 already offers it — the `suggest_options` / `tighten_field` action presented as a
friendly **"Help me write this"** button rather than an AI jargon term. `scene_intent`, which §3.10
calls the single most useful field for AI assistance, is exactly the field a child will stare at
blankly; it gets the strongest scaffolding.

### Guided path (D15)
A persistent rail showing the §11.1 stages — **Premise → Cast → Look → Story → Panels → Export** —
with per-stage completion state and a clear "do this next". Every screen stays reachable at any time;
nothing is locked. Empty states explain purpose, not just absence.

### Safety (D16)
`AiProvider` calls carry an account-level `contentPolicy`. On the teen account it is always the
constrained system prompt plus the AI-8 post-generation check, independent of the project's
`target_audience`, which a 13 year old can flip to `adult` in two taps. The adult account keeps the
spec's conditional behaviour.

### Layout (D14)
Two first-class layouts from one component set:
- **Tablet landscape (~1024×768 design target):** scene board and detail panel side by side; ≥44 px
  touch targets; **no hover-dependent controls anywhere**; drag-and-drop with a tap-to-move fallback
  (which also discharges NF-24's keyboard-alternative requirement).
- **Desktop:** denser panels, keyboard shortcuts (SC-12), live prompt preview always visible.

Phone is *supported but not optimised* — the spec's AN-13 360 px requirement is relaxed, since a
scene editor at that width is cramped for anyone and hostile to a child.

### Simple mode is now a real design, not a subtraction
v1.0 defines Simple mode mostly by what it hides. Per D13 it is redesigned as its own experience:
the guided rail, visual pickers, writing scaffolding, the panel-tile row from §3.1 as the shot
surface, and "Help me write this" everywhere. Advanced mode remains close to the spec as written.
`editor_mode` continues to gate both AI operations and control density (§6.1's warning still
applies), and switching still never migrates or transforms data.

---

## Spec defects fixed by this plan

**1. §6.3 Class A is self-contradictory.** Detectors 2 and 4 are specified as pure deterministic code
at 100% precision *and* recall, but their rules contain clauses requiring language understanding —
`costume_contradiction`'s "no intervening scene **or line establishing a change**", and
`unestablished_prop`'s "a scene **whose action marks it destroyed**". Per D9, v1 narrows both:
- **2** fires when a character's active costume variant differs from their previous appearance, full stop.
- **4** fires when a prop in `Shot.visible_props` has no earlier scene appearance, full stop.

Both are then genuinely 100%/100% testable. Legitimate cases get dismissed, and CC-3's `dedupe_hash`
makes dismissal stick. A later AI pass may downgrade severity where it detects an in-story
explanation; it may never raise severity, and never blocks the DoD.

**2. PC-2b's client/server equality assertion is a footgun.** As written, a user on a stale JS bundle
after a deploy gets a 409 on every save. **Replace with: the server is the sole compilation
authority.** The client compiles only for live preview (PC-4, NF-3), never sends the compiled string,
and the server returns the authoritative prompt on save. Same shared-package guarantee — PC-2b's real
intent — with no skew failure mode. This also makes NF-10c redundant.

**3. `export_key` collision.** First-6-hex-of-uuid is ~16.7M values; birthday collisions become likely
in the low thousands of shots, and GR-2 demands *zero* mis-assignments. **Fix:** check uniqueness
within the project at insert and extend the key on collision.

**4. Prompt length has no defined behaviour at overflow.** PC-5 only reddens a counter. Per D11 the
compiler returns a `PromptBudgetResult` alongside the prompt; export refuses any over-budget shot
with an RFC 7807 error naming the offending shots, and the shot editor surfaces that state long
before export. For the teen account the message must say *which field to shorten*, not just "too
long".

> The 2500-char limit is **our own invention** — `ManualExportProvider` declares it and nothing
> external enforces it in Phase 1. Set the real number from what Phase −1 observes OpenArt actually
> accepts, and keep PC-5's single-authority rule so it remains one constant.

### Smaller corrections
- `Account.ai_credit_balance` cross-references "§9" (non-functional requirements); it belongs to §13
  decision 2. Field retained, unused while D1 holds.
- AI-10's cosine-similarity ≤ 0.85 CI bar adds an embedding-model dependency for a subjective
  property. Downgrade to a documented manual check; keep the "pass previous outputs as things to
  avoid" behaviour, which is the part that matters.
- SC-6 (50-step undo), NF-8 (20 scene versions) and AI-2 (revert tokens) are three overlapping undo
  systems. Keep NF-8 and AI-2; make SC-6 a cheap client-side field-level undo stack. A prominent,
  reliable undo matters more than usual for this audience.
- §13 numbers decisions 1,2,4,3,5,6 and §6.3 interleaves detectors 1,2,4,5 / 3,6,7,8. Renumber in v1.1.

---

## Architecture

**Monorepo, TypeScript throughout.** The shared-compiler requirement (PC-2b) effectively mandates one
language across client and server; naming that constraint now rather than discovering it later.

```
packages/
  vocabularies/   vocabularies.json (normative + presentation fields) + generated types + CI checks
  compiler/       pure, zero framework/DB imports. The only place prompts are assembled.
  schema/         shared zod schemas + generated types, source of truth for API validation
  ui/             design system: visual pickers, guided rail, touch-first primitives, SVG icon set
apps/
  api/            Node (Fastify), Postgres via Drizzle, SSE for AI streaming
  web/            React + Vite, PWA (installable; offline read only)
infra/            Bicep — Container Apps, Postgres Flexible, Blob, Key Vault
```

**Azure:** Container Apps (scales to zero when idle — right for a low-traffic creative tool),
Postgres Flexible Server (relational model + `jsonb` for `AiProposal.payload`), Blob Storage with
short-lived SAS URLs (NF-14), Key Vault for the Anthropic key and both v1 credential pairs (NF-20).

**Data model notes:**
- Every table carries `account_id` from day one, with row-level checks on every endpoint (NF-13) —
  exercised for real from day one because D8 gives us two accounts.
- `Scene.character_ids` / `Shot.subject_character_ids` as Postgres `uuid[]` with GIN indexes —
  supports SB-5's reverse lookup and the SC-2 board query without join tables.
- `Shot.compiled_prompt` (singular, per D6), `compiled_negative_prompt`, `prompt_template_version`.

---

## Build sequence

Restructured from the spec's 10 phases so a usable vertical slice arrives early. §14's Definition of
Done is a Simple-mode flow, yet the spec puts Simple mode at Phase 6 — nine phases before anything
matches the stated goal. This fixes that.

**Phase −1 — Validate the bet + produce style artwork (no app code).** *Blocking. Do this first.*
Hand-write ~10 prompts in §5.2 assembly order for a two-character scene. Run them through OpenArt
manually, with and without Character Builder references. Measure whether character and style
consistency actually holds, and observe the real prompt-length ceiling. **In the same pass, generate
the 17 `art_style` preset example images** for the picker. Outcome decides how central the compiler
is versus Character Builder ref management — if consistency comes overwhelmingly from Character
Builder, `openart_character_ref` is promoted from a handoff-sheet footnote to a first-class part of
the workflow and §5.2 is retuned before it is built.

**Phase 0 — Foundation.** Monorepo, Bicep infra, Postgres migrations for the full domain model, two
hardcoded accounts, project CRUD, deploy pipeline. *Done: a project can be created in a deployed app.*

**Phase 0b — Design system.** `packages/ui`: touch-first primitives, the visual-picker component, the
guided rail, the ~50 SVG diagrams, tablet and desktop layout shells. Runs alongside Phase 1.
*This phase does not exist in v1.0 and is a direct cost of the audience decision.*

**Phase 1 — Bible & cast.** SeriesBible, Character, Location, Prop, MusicCue, asset upload to Blob
with magic-byte validation and EXIF stripping (NF-19), prompt-token live preview (SB-3), art-style
picker using the Phase −1 imagery.

**Phase 2 — Compiler.** `vocabularies.json` with its CI checks, the pure compiler package, live
preview, template versioning + diff (PC-6/PC-8), budget result (D11), 100% test coverage (NF-25).
Retuned by Phase −1 findings.

**Phase 3 — Scenes & shots.** Episode/Scene/Shot CRUD, virtualised scene board (SC-2), scene detail
sections, script editor, touch drag reorder with tap-to-move fallback, autosave, client-side undo.
Include D17's optional scene thumbnails and the small proposal/asset/provider slice they need.
*Done: the first visual milestone above works on a tablet, including with thumbnails omitted.*

**Phase 4 — Export.** Markdown, text bundle with collision-safe `export_key`, JSON + published
schema, OpenArt handoff sheet, ExportPack history. *Done: a real pack can be pasted into OpenArt.*
**Production-prompt handoff milestone.** The scene board is already useful at Phase 3.

**Phase 5 — Proposal lifecycle + Advanced AI.** `AiProposal`, SSE streaming with cancel, accept at
each §6.5 granularity, atomic tree accept + revert, `AiInteraction` logging, tighten/suggest/polish/
critique/prompt-token, account-level content policy (D16).
Extend the proposal support introduced for thumbnails in Phase 3.

**Phase 6 — Simple mode.** The guided experience end to end: rail, scaffolded fields, "Help me write
this", premise→episode, scene sequence, shot lists, panel-tile row, tree accept. Sits on Phase 5's
machinery (D10).

**Phase 7 — Continuity.** Class A structural detectors against a labelled fixture (24 violations + 24
decoys), dedupe/dismissal, Class B advisory pass, deep-linking. Flag messages written in plain
English.

**Phase 8 — Optional production-results round-trip.** Result upload, `export_key` bulk matching
with the shuffle test, unmatched tray, takes + hero, shot contact sheet. The scene board already
uses D17 thumbnails; this phase adds externally produced shot imagery.

**Phase 9 — Deferred, revisited in light of real use.** PDF export (D7), provider-seam hardening,
real auth (D8), Android TWA (D4), offline writes (D4), phone-optimised layouts.

---

## Critical files to create first

- `packages/vocabularies/vocabularies.json` — normative content transcribed verbatim from §4 (no
  invented phrases, CV-1), minus `camera_movement` per D6, plus the D12 presentation fields.
- `packages/compiler/src/compile.ts` — the §5.2 assembly, pure, no I/O.
- `packages/compiler/test/fixtures/` — including the five-level lighting fallback matrix (PC-2).
- `packages/ui/src/VisualPicker.tsx` and `packages/ui/src/icons/`.
- `apps/api/src/db/schema.ts` — full domain model, `account_id` everywhere.
- `infra/main.bicep`.

---

## Verification

- **Scene thumbnails:** exercise TH-1–TH-6 on tablet and desktop. Accept, retry, cancel, remove,
  stale-source handling, and provider failure preserve scene text and the previous selection as
  specified. Save, reopen, reorder, and review the board with and without thumbnails.
- **Compiler:** 100% line coverage (NF-25). Determinism — one fixture compiled 100× is byte-identical
  in both Node and a browser (PC-1). Full lighting-fallback matrix. Duplicate-character dedupe (PC-3).
- **Vocabularies:** CI fails if any enum value resolves to an absent or empty `prompt_phrase` (CV-2),
  **or lacks a `friendlyLabel`, `help` or `icon`** (D12).
- **Export round-trip:** export an episode → shuffle scene order → re-import results. 100% of files
  carrying a valid `export_key` land on the correct shot, zero mis-assignments (GR-2).
- **Continuity:** the labelled 48-case fixture; Class A must hit 100% precision and recall (CC-1).
- **AI:** every operation produces a proposal and writes nothing until accepted; reject leaves the
  target byte-identical; tree accept is one transaction and `revert` restores exactly (AI-1/2).
  Teen-account generations carry the constrained policy even with `target_audience: adult` (D16).
- **Usability — the one that decides whether this worked:** sit the actual 10–15 year old in front of
  a deployed build at the end of Phase 4 and again at Phase 6, on a tablet, and watch them build a
  scene without help. Note every point they stall. That observation outranks any acceptance criterion
  in this document.
- **Runtime, per the standing project rule — not just compilation:** deploy to Azure, sign in as both
  accounts, build a scene by hand, watch live preview update, export a Markdown pack, paste a prompt
  into OpenArt for real. Confirm CORS, SAS URL construction, and that API response shapes match what
  the client expects before calling any phase done. Verify touch drag-and-drop on a real tablet, not
  a desktop browser's device emulator.


## D18 - Simpler scene editor (8 September 2026)

The user's latest direction replaces the three scene intent/action/appearance inputs with one
**Scene description**. Existing text is combined without discarding legacy values. Remove the
emotional-change input. Offer six camera angles from the controlled vocabulary: eye level,
low angle, high angle, bird's-eye, profile, and three-quarter.

**Improve for me** uses Claude to propose clearer environment, action, and character details
while preserving the premise. It shares the thumbnail proposal lifecycle, account policy, and
AI allowance; private notes are excluded. Only **Use this description** writes the proposal,
with a stale-source check. The rest of the Phase 5 writing roadmap remains separate.
Writing proposals include the story title and the other scenes in episode order as continuity
context, excluding private notes. Only the current scene is improved. Changes to that story
context invalidate an old suggestion before acceptance.

The board shows an unaccepted ready sketch as a labelled preview when no thumbnail is selected.
**Use on scene board** explicitly selects it. Accepted thumbnails remain preferred.
