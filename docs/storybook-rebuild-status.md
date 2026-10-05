# Storybook rebuild: delivery notes

3 October 2026 · branch `feature/video-optimisation` · implements [storybook-rebuild-requirements.md](storybook-rebuild-requirements.md).

Status words used below: **built** (in the code), **fake-verified** (exercised by the Playwright
suite against the fake provider), **live-verified** (a real provider call was made), **not built**.

## What the creator sees now

```text
My cartoons                      /                         library: cover placeholder, summary, "Edited 2 hours ago", Continue
  Cartoon (the storybook)        /projects/:id/director    toolbar · cover · page index · pages (editor opens in place)
    Characters                   ?sheet=characters         a sheet over the storybook: cast board + the character studio
    Watch                        /projects/:id/watch       full-cartoon review, sound and timing, Download / Update cartoon
    Manage scenes and the bin    /projects/:id/scenes      the older scene manager (drag order, the bin), from the ⋯ menu
```

Old links keep working (SB-06): `/projects/:id` → the storybook; `/projects/:id/together` → Watch;
`/projects/:id/characters` → the storybook with the character sheet open; `?scene=` and
`?character=` are carried across. A scene's own page (`/projects/:id/scenes/:sceneId`) still
exists for the sketch and comes back to its storybook page.

## Requirements, by section

| Section | Status | Notes |
|---|---|---|
| 4 Navigation (SB-01–06) | built, fake-verified | One toolbar (My cartoons, title, save state, Watch, ⋯ menu with colour mode, scene manager, Grown-ups). Numbered index: chips under the toolbar on a tablet, a sticky rail at ≥1200px. Selecting a page scrolls it into view. Browser refresh keeps the page (`?scene=`) and the sheet (`?sheet=`). |
| 5 Cover (SB-07–10) | built, fake-verified | Title and summary (the project's `logline`) save on blur. Characters with Look chosen / Needs a look; a placeholder initial never implies approval. Cartoon look and Where are cartoon-wide; the explanation says existing clips and character pictures do not change. A page shows "this page only" and "Use the cartoon look" when it has an override. Historical provenance: "References unknown" is not shown for old jobs; the page simply shows what it has (SB-10 partially: nothing is claimed either way). |
| 6 Pages (SB-11–18) | built, fake-verified | Folded pages: media (the shot's selected video or picture, never the latest job), number, name, words, faces, pills "Video selected / Picture selected / Empty" plus a separate generation pill and a "Needs X's look" pill. The selected page opens the existing composer in place: name, words, Who's in it, length, the priced action, Scene details (collapsed), More options. Add at the end or between, Move earlier/later, Move to the bin (soft delete; restore from the scene manager). Autosave is the existing serial, version-aware hook; drafts survive page switches (a stale-closure bug found and fixed on the way). Multi-shot scenes: the composer still works on the scene's first shot, as before; other shots are untouched but not shown (SB-18 preserved, not surfaced). |
| 7 Characters (SB-19–24) | built, fake-verified | The same sheet from the cover (a character's chip, "+ Add a character") or a page ("Choose X's look"). Cast board at the top of the sheet. Candidates stay candidates until "Use this look"; a new look offers "Use this look in every scene" and never rebinds silently. Missing looks link to the sheet; words-only is an explicit choice under More options. |
| 8 Generation (SB-25–30) | built, fake-verified | Unchanged from the existing composer: one priced action, quote fingerprint + idempotency key, 409 on a changed quote, previews and finals with the recorded recipe or "Use my current scene settings instead", Other versions, Use this clip. |
| 9 Watch (SB-31–36) | built, fake-verified | Route-backed (`/watch?scene=`), Back to your story returns to the page. **New server field `render_current`** (a fingerprint of the render inputs recorded on the render job: scenes in order, asset ids, durations, transitions, music, voiceovers). Download video leads when current; "Update cartoon" and "Download the older version" when not; an older file that recorded no inputs says so rather than guessing. |
| 10 Continuity | built, fake-verified (5 Oct) | The approved-reference workflow, the continuity report in Watch, and the "words only" label are in place. **Style picture** (cover row, §7.2) and **Start where the last page ended** (Advanced, §7.4) added 5 Oct. Stored recipe and props/locations: not built ([video-optimisation-plan.md](video-optimisation-plan.md) §11). No fake Enabled/Locked indicators are shown. |
| 11 Visual | built, fake-verified | Screenshots in `docs/screenshots/validation/` at 1024×768, 768×1024, 1440×900, 1920×1080 and 2560×1440; white theme at 1024 and 1440. No horizontal overflow is asserted at 1024. Inactive pages render a poster image only; one `<video>` is mounted (the open page's). Reduced motion disables smooth scrolling. |

## Removed

`screens/Director.tsx`, `components/DirectorScenes.tsx` (Film Strip / Scene Board / movable panels) and
`screens/Characters.tsx` (the separate characters page from 3 Oct). `components/DirectorPanel.tsx`
stays as the composer's two columns.

## Verified

- Web build, API typecheck.
- API tests: 151 (the timeline change is covered by the existing director/timeline tests; `render_current` has no dedicated test yet).
- Browser suite: 24 passed with the fake provider, plus the opt-in walkthrough that writes the screenshots. Run over the LAN address, not localhost.

## Not done, honestly

- **Physical tablet and teen sessions**: not run.
- **A 30-scene fixture**: checked on 5 Oct against the dev API. The storybook now loads every shot and cast in one call (`GET /projects/:id/shots`, ~60 ms for 30 pages, against ~670 ms for the sixty per-scene calls it replaced); `scenes`, `continuity` and `timeline` all answer under 50 ms. Only the open page mounts a video. Not measured on a tablet over the LAN.
- **`render_current` test**: add an API test that changes a selected take and asserts `false`.
- **SB-18 surfacing of extra shots** for advanced users: data preserved, no UI.
- **Legacy "References unknown" wording** (SB-10): not shown; old clips are simply not described.
- **The cover's cartoon cover picture** (SB-01): no cartoon has one; the library shows an honest page count.
