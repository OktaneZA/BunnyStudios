# Two alternative interfaces

3 October 2026. Design proposals for tablet and computer, not accepted requirements or implemented product changes.

Open [the interactive concept comparison](prototypes/ui-alternatives.html). It uses illustrative content and simulated actions, with no API calls or paid generation.

## What can become simpler

The current application exposes a cartoon library, Create, scene management/detail, Characters/Studio and Put it together. These are valid capabilities, but they make the creator reconstruct the relationship between a character, a scene, its alternative takes and the finished cartoon.

Use one visible hierarchy in either alternative: **My cartoons > cartoon > scenes > takes**. Characters belong to the cartoon and are selected in scenes. A video is either a take for a scene or the assembled cartoon; it does not need a separate top-level library. Advanced shots remain available inside a scene, without adding another compulsory level for a beginner.

Keep writing immediately available. Approved character pictures are needed for reference-based generation, not for starting a story. Show one clear next action and the actual quote before every paid request. A completed alternative never silently replaces an existing selected take.

## Option A: Storybook

**Mental model: make an illustrated story, one page at a time.**

The cartoon opens as a vertically scrolling document. A cover contains its title, a short story summary and a compact shared-look area: character portraits and cartoon style. Below it, each scene is a numbered page containing a picture/video, a short editable action and the characters appearing there. There is no permanent player/editor split and no separate assembly screen.

Selecting a page opens its editing controls in place. Selecting a character opens their look editor in a side sheet and returns to the same page. Advanced options and previous takes stay inside that scene. A sticky Watch button opens the assembled-cartoon review; sound, timing and download live there. On a wide desktop, a compact page index accompanies the document. Tablet uses a collapsible index; portrait tablet stacks scene media and text. Text keeps a readable measure while imagery can expand.

Example, Sunny Beach Catch:

1. Open the cartoon and see three numbered pages, with **Video selected**, **Picture selected**, and **Video selected** statuses. An empty fourth scene remains an explicit blank page.
2. The cover shows that Timmy and Sister still need approved pictures. Existing media remains playable.
3. Open page 2, edit its action and choose the characters. Open a character portrait to review and explicitly approve a suitable look.
4. Request a separately quoted preview, compare it with the shared reference and scene 1, then choose **Use this clip**.
5. Watch the cartoon, adjust optional sound/timing and download the completed render. Edits after rendering show **Update cartoon** before offering the changed version for download.

Strengths: story order is obvious; writing and media stay together; few concepts to learn; easy to spot missing scenes. This is my preferred default for the 10–15 audience, as a design hypothesis to test.

Tradeoffs: long cartoons create a long document, and precise timing is less immediate. Use a scene index, collapsed inactive pages and lazy media loading. Do not autoplay every page. This is a document interaction model, not the existing Scene Board with larger cards.

## Option B: Screening Room

**Mental model: watch your cartoon and change what you see.**

The cartoon opens in a large player. Scene boundaries appear as labelled chapter markers below it, not as a permanent board or film strip. Selecting a marker or pausing playback selects the corresponding scene. **Change this scene** opens a compact editing drawer with its action, characters, chosen take and priced generation action. Alternative takes are compared against the selected clip at this location.

**People & look** opens a cartoon-wide drawer. Selecting a character shows their approved look and the scenes that use it, with an explicit choice before applying a new revision to other scenes. **Add next scene** opens a short action editor and inserts a labelled empty chapter; blank scenes are navigable even though they have no playback duration. Sound and timing are editing tools on the same player. Download is prominent when a current rendered version exists.

On desktop the player and drawer sit side by side. On tablet, opening the drawer reduces the player or replaces it with a compact still; it must not leave the action button below a tall player. Portrait tablet stacks the compact player and editor. No hover-only controls, precision scrubbing requirement or drag-only scene ordering: chapter buttons and Move earlier/later are alternatives.

Example, Sunny Beach Catch:

1. Play the cartoon and pause when scene 2 changes appearance. The chapter label identifies **Sister wants a go · Picture selected**.
2. Choose **Change this scene**. The drawer shows the actual selected picture and character-look status, rather than assuming every chapter is a video.
3. Review shared looks in **People & look**. Compare scene 1 with the proposed references before approving anything.
4. Make a quoted preview, compare takes, explicitly select the replacement and watch across the scene boundary.
5. Update the assembled cartoon when needed and download it. Playback before export can use selected scene assets without triggering another generation.

Strengths: the finished result dominates; visual discontinuity is easy to locate; reviewing alternatives and finishing a cartoon feel direct.

Tradeoffs: an empty cartoon gives the player nothing to show, writing a long story is less comfortable, and playback-position/scene synchronisation is more complex. Start empty cartoons with **Describe your first scene**, a visible chapter list and optional accepted story suggestions. Preserve edits when playback moves; never let it switch an actively edited scene without resolving the draft.

## Requirement coverage and intentional changes

| Requirement | Storybook | Screening Room |
|---|---|---|
| UI-02–07: write/make together, autosave, folded detail, priced action, take selection | Inline page editor and scene-local take tray | Current-scene drawer and comparison view |
| UI-01: Create → Put it together | Proposes replacing fixed steps with document + Watch | Proposes replacing fixed steps with player + editing tools |
| UI-08: Film Strip, Scene Board, optional movable panels | Proposes replacing them with pages and an index | Proposes replacing them with chapters and fixed drawers |
| UI-08–09: themes, keyboard/touch, tablet/computer | Preserve; 44px controls, visible focus, reordering buttons | Preserve; same targets and keyboard chapter navigation |
| UI-10: playback, download, partial cartoons, optional audio/timing | Watch review with explicit omissions | Main player with explicit omissions and output freshness |
| UI-11 and DF-01–05: honest previews/finals and paid actions | Quote beside the page action; history preserves recipe choice | Quote in drawer; take comparison preserves recipe choice |
| CS-01–12 / CR-01–07: approved identities, versions and reference roles | Shared cover portraits, scene bindings and look sheet | People & look drawer, scene bindings and affected-scene list |
| MG / MB: capability routing, lineage, money and safety | Existing server contracts remain authoritative | Existing server contracts remain authoritative |

Both alternatives intentionally challenge the existing navigation/layout mandates. They preserve the underlying product contracts; adopting either requires a deliberate update to UI-01/UI-08 and the corresponding interface section of Character Studio requirements. This proposal does not silently supersede them.

## Continuity is shared infrastructure

Neither layout alone fixes the Sunny Beach Catch mismatch. The previous live inspection found a selected still in scene 2 between videos, no approved looks for its named characters, and different generators across the legacy assets. A shared style label is insufficient evidence that media shares visual inputs.

Both concepts should expose **Cartoon look**: approved character pictures, selected style and, when implemented, a shared style reference. Scene overrides must be visible. Distinguish **References ready**, **Needs a look**, **Uses an older look**, and **Picture selected** from any claim that an output visually matches. Show those labels only when saved metadata supports them; historical assets may have unknown reference provenance.

The style-reference picture and stored cartoon render recipe remain unbuilt in the optimisation plan's implementation inventory. These are separate backend work, not capabilities gained by moving controls. Props/location references and using a chosen frame from scene 1 require explicit roles and review. Chaining each scene from the previous frame should be optional for continuous action, not the universal identity source: it can propagate errors and constrain scene changes. Reference inputs improve consistency; output comparison is still required.

## Implementation boundary and selection

Reuse Projects, Scenes, Shots, Characters, approved visual revisions, Assets, GenerationJobs and the ledger. A new frontend composition should reuse the scene composer, character review, quote and take-selection contracts. Preserve deep links, unsaved drafts, conflict recovery, reference snapshots and explicit use-latest decisions. Do not introduce a second media library or a second character store.

Storybook has lower expected frontend complexity: reuse the scene editor inside a paged document and open assembly as Watch. Screening Room has higher expected complexity: it requires reliable chapter/playhead mapping, empty-scene navigation, take comparison and output-freshness handling. Neither is a CSS-only change; these are relative estimates, not delivery commitments.

Prototype both against the same five tasks: create a two-scene story, approve a character, replace scene 2 while retaining its previous take, diagnose a look mismatch, and download a current cartoon. Record wrong turns, help requests, task completion and whether the creator understands what the next paid click buys. Check 1024×768, portrait tablet and wide desktop; follow with physical-tablet and teen sessions.

Recommend **Storybook as the primary creation experience**, with a focused Watch review. Choose Screening Room instead if observed use is mainly watching, comparing and repairing existing media. Do not combine both into two competing permanent editors before testing them.

## Sources and prototype scope

- [Current product requirements](current-product-requirements.md)
- [Character Studio requirements](character-studio-requirements.md)
- [Video optimisation plan and implementation inventory](video-optimisation-plan.md)
- [Local application usability review](visual-usage-review-2026-10-02.md)
- [Current routes](../apps/web/src/App.tsx)

The HTML prototype demonstrates switching concepts, selecting a scene, opening character information and previewing an editing drawer. It does not implement editing, generation, reference approval, real video playback, sound, export, autosave or the full library. Displayed media is labelled illustration; it is not footage or an approved visual reference. Production UI, requirements and user content are unchanged.

Prototype checks: Playwright/Edge at 768, 1024, 1440 and 2560px found no page-level horizontal overflow in either concept. Concept switching, chapter selection and dialog opening/Escape dismissal worked without page errors. Desktop screenshots were visually inspected; these checks do not establish teen usability or physical tablet behaviour. [Storybook screenshot](prototypes/storybook.png) · [Screening Room screenshot](prototypes/screening-room.png).
