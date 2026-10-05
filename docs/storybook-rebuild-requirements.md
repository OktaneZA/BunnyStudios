# Bunny Studio: Storybook rebuild requirements

Version 1.0 · 3 October 2026 · Handoff specification

## 1. Assignment and authority

Rebuild the Bunny Studio creation interface around **Build the story as pages**. The user has selected the Storybook direction. Deliver a working application connected to the existing backend, not a static mockup or an alternative editor alongside the current one.

This document defines the target rebuild; it does not assert that these features are already implemented. It is self-contained for product/design handoff. A coding tool also needs access to the repository and its existing API contracts. Do not invent endpoints or replace persistence with browser-only sample data.

For this rebuild, replace the earlier requirements for mandatory **Create → Put it together** navigation, Film Strip/Scene Board modes and movable panels with the Storybook structure below. Preserve existing character approval, generation, safety, ownership, budget and historical-reference contracts. No deployment, paid generation or automatic content migration is authorised by this document.

The [HTML concept](prototypes/ui-alternatives.html), option A, illustrates the direction, not a pixel-perfect specification. Its illustrations, sample states and explanatory popups are placeholders. The implementation must use real scene media and functional controls. Do not build option B, Screening Room.

## 2. Product outcome

A creator aged 10–15 can write a short cartoon, choose consistent character looks, make and review scene clips, and download the assembled cartoon without moving through disconnected scene, character and video workspaces.

The central mental model is:

```text
My cartoons
  Cartoon
    Cover: title, story summary, shared characters and cartoon style
    Page 1 = scene 1: action, characters, selected media, alternative takes
    Page 2 = scene 2
    ...
    Watch: whole-cartoon playback, optional sound/timing, download
```

Characters are shared within a cartoon. Takes belong to scenes through the existing shot/job model. An assembled video belongs to the cartoon. Keep internal terms such as project, endpoint, manifest and generation ledger out of the normal creator interface.

## 3. Scope

**Required for the rebuild:** cartoon library, Storybook workspace, scene editing and ordering, character review/approval, existing reference-based generation, take selection, playback/assembly/download, autosave recovery, responsive tablet/desktop layouts and light/dark themes.

**Preserve through progressive disclosure:** advanced shot editing, model/settings choices where supported, start/end pictures, optional sound, camera/mood/time, character reference views, generation history and existing account/adult controls. Preserve their functionality without retaining the old top-level navigation.

**Separate continuity extension:** shared style-reference images, a stored cartoon generation recipe and additional prop/location references. These need verified backend support; do not simulate them in the frontend or claim that the interface rebuild implements them. Section 10 defines the boundary.

**Out of scope:** phone-specific refinement, social feeds, public sharing, collaboration, new authentication, a new media-generation service, automatic paid retries, a new character database and the Screening Room alternative.

## 4. Information architecture and navigation

| ID | Requirement |
|---|---|
| SB-01 | My cartoons is the home. Each cartoon card shows a real cover/selected-scene image or honest empty placeholder, title, one useful edited-time label and Continue. New cartoon is visible. Preserve soft-delete and restore. |
| SB-02 | Continue opens the Storybook at its last selected scene when available. Direct scene links select and reveal that page. A new cartoon opens an editable cover and an obvious Add first scene action. No character-setup wizard blocks writing. |
| SB-03 | The cartoon has one document workspace. Character editing uses a sheet; takes belong inside the selected page; Watch is a focused review view. Do not require trips to separate scene-management or character-library screens for common tasks. |
| SB-04 | Keep a compact persistent toolbar with My cartoons, cartoon title, save state and Watch cartoon. Put account/theme/advanced preferences in a secondary menu. Do not repeat progress summaries in several headers. |
| SB-05 | Provide a numbered scene index with names and meaningful media states. Selecting an item reveals and selects its page. The index must not push the editor below a large board. Add scene remains easy to reach. |
| SB-06 | Watch and character sheets return to the same page, scroll position and unsaved draft. Browser back/forward and refresh preserve meaningful navigation state. Old saved links continue to resolve to equivalent content. |

## 5. Cover and shared cartoon look

The cover contains an editable title, a short optional story summary, shared character portraits and **Cartoon style**. Reuse existing story fields where semantics match; do not store the summary only in local UI state. Make the cover compact or collapsible once editing begins.

| ID | Requirement |
|---|---|
| SB-07 | Show each character's name, approved portrait if available, and whether a look is still needed. A placeholder must not imply approval. Selecting the portrait opens that character's sheet. Include Add character. |
| SB-08 | Show cartoon-wide style with its scope before selection. Use friendly names from the existing vocabulary/catalogue. Explain that changing it does not regenerate existing clips or automatically change approved character pictures. |
| SB-09 | Scenes inherit the cartoon style unless explicitly overridden. An override is visible on the page, with Use cartoon style to remove it. Keep theme and generated-art style independent. |
| SB-10 | Shared settings describe inputs for new work. Do not label existing footage as visually consistent merely because current cartoon settings match. Historical assets with missing provenance show References unknown where relevant. |

## 6. Scene pages and editing

Each scene is a vertically arranged page. Inactive pages show a media preview, number/name, concise action, characters and status. The selected page expands its editor **in place**. This must feel like editing a document, not navigating a grid of cards into another screen.

| ID | Requirement |
|---|---|
| SB-11 | Show the actual selected video or picture, or a clearly labelled empty placeholder. A rough storyboard sketch is distinct from selected production media. Use the backend's existing selection/fallback rules; do not infer selection from the most recent job. |
| SB-12 | The active page exposes scene name, What happens?, characters and length. Keep the priced make action and blocking explanation close to those fields. On entering Edit at 1024×768, the action and action field must be visible without scrolling past a full-height cover/player. |
| SB-13 | Scene details begins collapsed and contains time, mood and camera. More options contains compatible advanced controls, including start/end pictures, sound and direct-final choice. Summaries show meaningful current selections. No mandatory film terminology. |
| SB-14 | Support adding at the end and between scenes, renaming, reordering and removing scenes. Provide Move earlier/later as alternatives to dragging. Removing uses existing soft-delete semantics; restore returns a usable page. Renumbering never changes stable scene identity. |
| SB-15 | Keep each page's draft when another is selected or collapsed. Autosave is serial and version-aware. Show Saving, Saved or a useful recovery message. Failed writes retain text. Conflicts offer deliberate recovery without overwriting either version blindly. |
| SB-16 | Generation waits for saved edits and refreshed authoritative shot inputs. Navigation, typing and reviewing existing media remain available while a job runs. Reload reconnects to persisted jobs instead of submitting them again. |
| SB-17 | Optional AI writing help produces a proposed change with explicit acceptance. A suggestion cannot overwrite the story or bind characters silently. |
| SB-18 | Preserve multiple existing shots within a scene. Simple use need not expose the hierarchy, but advanced users can access the shots and their takes within the page. Never flatten or discard multi-shot data during the redesign. |

### State language

Keep media selection, generation progress and reference readiness separate. One ambiguous Ready badge cannot represent all three.

| Concern | Example labels and behaviour |
|---|---|
| Selected media | Video selected / Picture selected / Empty |
| Selected take purpose | Preview / Final, only when known from saved data; legacy purpose may be unknown |
| Generation | Queued / Making preview / Reviewing / Ready to review / Could not finish; reflect actual server states |
| References | Needs Timmy's look / References ready / Uses an older look / References unknown |
| Story freshness | Made from an earlier version, only when supported by saved revisions; do not guess for legacy jobs |

Completing a new take must not change Picture selected or Video selected until the selection actually changes. A failed new take must leave the selected take usable.

## 7. Character sheet and identity

| ID | Requirement |
|---|---|
| SB-19 | Open the same character sheet from the cover or a scene. Name and short description are enough to begin. Optional visual traits, outfits and reference views are progressively disclosed. Preserve existing story/appearance data. |
| SB-20 | Offer supported upload, generation and refinement actions. Show the quote before each paid action. Generated/uploaded candidates remain candidates until explicit This looks like [name] or Use these pictures approval. Content review and user approval are separate gates. |
| SB-21 | Show approved pictures separately from candidates. One compatible approved main picture can be sufficient; extra reference views are optional. New views use the approved anchor where supported and still require review. |
| SB-22 | A changed approved identity creates a proposed/new immutable revision. Show the scenes using the character and require an explicit choice before changing other scene bindings. Existing job inputs and rendered clips remain unchanged. |
| SB-23 | A scene's selected characters bind to approved look revisions for reference-based generation. If required looks are missing, identify the characters and link directly to their sheets. Writing and existing playback remain available. |
| SB-24 | Preserve an explicitly chosen words-only draft path where supported, explaining it does not use character pictures. Never silently drop reference inputs to fit a generator or claim a draft preserves identity. |

## 8. Generation and take review

| ID | Requirement |
|---|---|
| SB-25 | Show one prominent action for the selected purpose: Make preview · [quoted price] or Make final clip · [quoted price]. Show allowance and a specific blocked-state explanation nearby. Never hard-code demo prices or assert a preview is cheaper without a compatible quote. |
| SB-26 | Requote when relevant inputs change. Submit the accepted quote fingerprint and an idempotency key using existing contracts. Handle changed/expired quotes explicitly; double clicks must not create duplicate paid requests. Settings selection alone never purchases work. |
| SB-27 | Make completion visible on its scene without taking the creator away from their current edit. Open the completed candidate for review on request. The first allowed result may fill an empty slot under existing server rules; alternatives require Use this clip. |
| SB-28 | Keep Previous takes within the page. Clearly mark the selected take and candidate purpose. Compare a candidate with the selected take and approved references; allow checking the adjacent scene. Only one video plays at a time. |
| SB-29 | Selecting a take preserves older takes/history. Requesting a final from a preview preserves its recorded creative inputs by default. If current scene settings differ, offer an explicit Use latest settings choice. Explain that a separately rendered final can change appearance or motion. |
| SB-30 | Progress, errors, cancellation and retry reflect server truth. Cancellation does not promise a refund. An ambiguous provider submission is not automatically resubmitted. Any new billable retry requires a fresh deliberate action and quote. |

## 9. Watch, assemble and download

Watch is a focused full-cartoon review within the Storybook experience, not a second creation workspace. It may be implemented as a route-backed overlay/full view so refresh and back navigation work reliably.

| ID | Requirement |
|---|---|
| SB-31 | Resolve selected scene media in story order using existing timeline semantics. Distinguish videos, held pictures and omitted empty scenes. Show repair links that return to the relevant page. Partial cartoons remain allowed with omissions explained. |
| SB-32 | If no media exists, explain how to make or choose scene content. Opening Watch must not trigger paid generation. Distinguish a local/sequence preview from a completed assembled file. |
| SB-33 | Keep music, recorded/uploaded voice, timing and transitions optional. Preserve existing capability and permission/error handling. Finishing without audio changes remains straightforward. |
| SB-34 | When a current render exists, Download video is the primary result action. If output-affecting inputs change, show Update cartoon and label any previous download as an older version. Never imply that an old rendered file includes newly selected takes. |
| SB-35 | Track assembly freshness using the actual render inputs: scene selection/order, relevant durations, transitions, sound and omissions. A title/action edit alone need not invalidate identical media assembly; it may instead make a scene's creative inputs newer than its take. Keep those states distinct. |
| SB-36 | Assembly progress/errors retain the last usable output. Close Watch returns to the same page. Assembly or generation requiring payment follows the same explicit quote rules. |

## 10. Continuity: required foundation and separate extension

The motivating example is Sunny Beach Catch: the reviewed first scene was visually strong, while the next selected scene used a markedly different-looking still image between videos. Named characters lacked approved looks. Rebuilding navigation must make this problem understandable without claiming that layout alone fixes it.

**Required in this rebuild:** expose and use the existing approved-character reference workflow; show current versus historical input status honestly; make reference selection explicit; support visual comparison of adjacent scenes and takes. Never silently approve the first scene as a canonical reference, overwrite older look revisions or regenerate existing media.

**Separate backend extension, not a prerequisite for shipping the UI rebuild:**

| Extension | Required contract before exposing it as functional |
|---|---|
| Shared style-reference picture | Owned, reviewed asset with an explicit style role, approved scope and versioned job snapshot; compatible adapter mapping alongside character references |
| Stored cartoon generation recipe | Persisted compatible family/output settings, honest preview/final lineage, explicit overrides and fresh quotes; do not assume one family supports every task |
| Recurring props and locations | Distinct owned reference roles, capability validation and versioned binding; do not pass them as character identity pictures |
| Continue action from a previous scene | Deliberately chosen reviewed start frame and supported endpoint; preserve character reference requirements or explain unsupported combinations before spending |

The implementation inventory at handoff records shared style pictures and the stored cartoon recipe as unbuilt. Verify source before extending them. If another tool is only rebuilding the frontend, omit unsupported controls and record the dependency in its delivery notes. No fake Enabled/Locked indicators.

Approved references improve consistency but do not guarantee identical outputs. Do not automatically chain every scene from the previous final frame: it can propagate errors and obstruct deliberate scene changes.

## 11. Visual and interaction requirements

- Design for ages 10–15 with a calm, capable creative-tool appearance. Avoid preschool styling, decorative clutter and technical model language in the primary workflow.
- Use clear page numbering, readable type, generous but purposeful spacing and restrained colour. Use real media as the visual focus. Never reuse the prototype's chess pieces as production character art.
- Provide light and dark themes with readable controls, links, status text and focus indicators in both. Target at least 4.5:1 contrast for normal text and 3:1 for large text and essential control boundaries.
- Controls must support keyboard and touch, with at least 44×44px primary touch targets. Do not rely on hover, colour alone, precision scrubbing or dragging.
- Sheets/dialogs have accessible names, contained focus, Escape dismissal where safe and focus return to their opener. Announce save/job status without repeatedly interrupting typing.
- At 1024×768 landscape tablet, use a compact/collapsible index and keep the active editing action visible. At 768×1024 portrait tablet, stack scene media/text and keep the index collapsed initially. Phone refinement is not a release requirement.
- At 1440, 1920 and 2560px desktop widths, scale media and useful workspace space with the window. Avoid a narrow fixed-width application shell; retain readable text lengths (roughly 60–75 characters) and sensible control grouping.
- Long cartoons must not mount/play every video eagerly. Lazy-load media and collapse inactive editing controls without losing drafts or breaking scene links. Check a 30-scene fixture.
- No page-level horizontal overflow. Persistent toolbars must not obscure focused fields, menus, captions or generation actions. Respect reduced-motion preferences.

## 12. Existing architecture and integration constraints

The current system is a React/TypeScript web app, a Fastify API with an in-process durable job runner, Postgres domain/job/budget storage and owned media storage. The Fire tablet wrapper uses the same web application. Preserve that architecture for this task.

| Area | Starting points in the repository |
|---|---|
| Routes and library | `apps/web/src/App.tsx`, `screens/ProjectList.tsx`, `screens/NewProject.tsx` |
| Current creation/editor | `screens/Director.tsx`, `components/SceneComposer.tsx`, `useSceneText.ts` |
| Character review | `components/CharacterStudio.tsx`, `CastSheet.tsx`, `apps/api/src/routes/cast.ts` |
| Takes and media | `components/ClipLog.tsx`, `AssetMedia.tsx`, `JobProgress.tsx` |
| Assembly | `screens/Together.tsx`, `apps/api/src/routes/timeline.ts`, `cartoon.ts` |
| API client and generation | `apps/web/src/api.ts`, `apps/api/src/routes/production.ts` |
| Reference binding and planning | `apps/api/src/shots/cast.ts`, `video/creativeVideoRequest.ts`, `packages/models` |
| Vocabulary and compilation | `packages/vocabularies`, `packages/compiler` |

Paths under `screens` and `components` above are relative to `apps/web/src` unless stated otherwise. Inspect current source before assuming a component's interface or an endpoint's behaviour. Existing components can be refactored; their data and safety contracts cannot be discarded.

Mandatory engineering constraints:

1. Reuse Project, Scene, Shot, Character, approved look, Asset, GenerationJob and ledger identities. Preserve selected media, soft-deleted data, takes, job history and reference hashes. No destructive migration or duplicate frontend-only character/media store.
2. Server compilation is authoritative. Use the shared vocabulary and model registry; never introduce hard-coded provider IDs, prompt phrases or client-authoritative compiled prompts.
3. Preserve account ownership checks, server-only provider credentials, safety review and teen-account constraints. Required review unavailable means the constrained operation stays blocked.
4. Reuse version-aware writes (`If-Match` where applicable), authoritative quotes, atomic budget reservation and persisted job polling. Do not move money or reference validation into React.
5. Keep existing route links functional, including cartoon, Director/Create, individual scene, Characters and Together links. Map them to Storybook pages/sheets/Watch without losing IDs, query context or history behaviour.
6. Use focused components/hooks for page navigation, scene drafts, character sheets, take review and Watch. Keep one source of truth for each selection and avoid multiplying polling loops for every page.
7. If a requirement needs an absent server capability, identify and implement the smallest compatible extension or record it as incomplete. Do not silently replace the requirement with a mock.

## 13. Delivery sequence

1. Inventory existing routes, contracts and usable controls. Record baseline fixtures for empty, legacy and multi-shot cartoons. Confirm no production content is changed by the rebuild tooling.
2. Build the library, compact toolbar, cover, index and scene pages with real read data. Map old deep links to the new workspace.
3. Integrate scene editing, autosave/recovery, character sheets, style scope and scene ordering. Verify drafts survive page/sheet navigation.
4. Integrate quotes, generation, persisted progress, take comparison/selection and explicit saved-recipe versus latest-settings choices.
5. Integrate Watch, optional audio/timing, render freshness and download. Remove the old competing navigation only after equivalent capabilities work.
6. Validate the acceptance cases below and update implementation documentation. Keep continuity extensions separate and visibly reported. Do not leave prototype explanation popups as substitutes for required features.

## 14. Acceptance cases and evidence

| Test | Required result |
|---|---|
| Empty cartoon | A creator adds and writes two pages without first approving character pictures. Reload preserves content and order. |
| Draft survival | Typing during a delayed save, switching pages, opening a character sheet and returning loses no text. Failed saves and version conflicts retain recoverable drafts. |
| Generation ordering | Clicking Make during a pending save waits for the saved scene and refreshed shot instructions. A duplicate click produces no second billable request. |
| Character approval | Upload/generated candidate remains unapproved until explicit review. A new approved revision does not rewrite historical jobs or silently rebind every scene. |
| Missing references | Missing looks link to the right character. Writing and old playback still work. Words-only draft requires explicit selection. |
| Legacy mixed media | A cartoon with video, picture and empty scenes shows accurate states in both pages and Watch; unknown historical provenance is not guessed. |
| Replacement take | A completed alternative leaves the selected take unchanged. Use this clip changes the selection and retains the previous take. A failed alternative leaves existing media usable. |
| Preview to final | Recorded preview settings are used by default. Changes require an explicit latest-settings choice and a new quote. No guarantee of identical/better appearance is shown. |
| Continuity inspection | Creator can compare a candidate with approved pictures and the adjacent scene, and can see relevant look status without navigating out of the cartoon. |
| Reload during work | Existing jobs reconnect after refresh without duplicate submission. Their results appear on the correct pages. |
| Scene operations | Reorder/remove/restore preserves IDs, drafts and selected media. Keyboard/touch alternatives work. Multi-shot scenes retain all shots. |
| Output freshness | Changing a selected take or assembly timing marks the old render as older. Download of a current render is prominent; failed reassembly preserves the previous usable file. |
| Partial and empty playback | Partial cartoons explain omissions and link to repair. No-media cartoons have a clear next action. Opening Watch incurs no generation charge. |
| Navigation | Old links, browser back/forward, character-sheet close and Watch close return to correct content with draft/scroll preservation. |
| Access and review | Unowned media remains inaccessible. Rejected/unreviewed output cannot be approved or used contrary to existing policy. |
| Viewports and themes | Check 1024×768, 768×1024, 1440×900, 1920×1080 and 2560×1440 in both themes. No horizontal overflow, obscured actions or unreadable links. |
| Long cartoon | A 30-scene fixture remains navigable; media loads lazily, page links work and no simultaneous video playback occurs. |

Run the web build and applicable existing regressions. Use Playwright with fake providers for generation, quote, failure and selection scenarios; automated tests must not spend money. Validate screenshot layout and actual click/focus behaviour, not only DOM presence. Verify deployment-relevant LAN behaviour as well as localhost.

Physical-tablet interaction and teen usability require separate observed sessions; browser emulation does not certify them. Live-model visual continuity/billing require a separately authorised bounded test and must not be inferred from payload tests.

## 15. Required handoff from the rebuilding tool

Deliver working changes, updated usage/architecture notes, screenshots of tablet and desktop in both themes, test results, migration/deep-link notes and a short list of remaining gaps. Clearly distinguish implemented, verified with fake providers, verified live and not implemented. Do not mark the rebuild complete while required actions are explanatory mockups.

Suggested instruction to accompany this file:

> Implement the Storybook rebuild in `docs/storybook-rebuild-requirements.md`. Use option A of `docs/prototypes/ui-alternatives.html` as a direction reference. Inspect the existing repository and integrate its real backend contracts. Preserve content, character approval, quotes, reference history and safety. Replace the old navigation with pages, contextual character sheets and Watch. Complete the acceptance cases with fake providers and report any genuine backend dependencies. Do not deploy or run paid generations.

Repository references for deeper contracts: [current product requirements](current-product-requirements.md), [Character Studio requirements](character-studio-requirements.md), [architecture](architecture.md), [media architecture](media-generation-architecture.md), [video optimisation implementation status](video-optimisation-plan.md), and [working in this repo](working-in-this-repo.md). This specification changes the target interface; it does not weaken those documents' non-UI invariants.
