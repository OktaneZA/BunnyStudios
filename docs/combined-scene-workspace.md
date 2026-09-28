# Combined scene writing and clip workspace

Updated 28 September 2026 against current local source. Main navigation is **1 Create ->
2 Put it together**. Cartoon cards and new cartoons open Create; **View -> Manage scenes**
opens the existing ordering/bin tools outside the numbered workflow. See the
[current requirements](current-product-requirements.md).

## Current behaviour

- Add/select a scene in Film Strip or Scene Board. Edit **Scene name** and **What happens?**
  directly; **Let AI help** opens writing suggestions which apply only when accepted.
- Time, mood and camera live inside closed **Scene details**. Its summary uses selected
  vocabulary labels. Expanded detail chips have 44px minimum height.
- Characters, Style and Length are short rows when editing current settings. More options
  contains sound, direct-final choice, words-only generation, frame uploads, the scene-sketch
  link and clip instructions. Advanced mode also exposes model and resolution choices.
- The priced **Make preview** / **Make final clip** action, remaining allowance and job state
  sit above the player. Editor and action/player panels sit side by side from 1000px and
  stack below that breakpoint. Tablet and desktop are the supported design targets; phone
  refinements are deferred.
- Both themes apply to Characters and other controls. View holds layout/theme settings,
  scene management and optional movable panels. Display preferences are not art-style choices.

## Saving and generation

`useSceneText` saves after 650ms of inactivity or on blur. Requests are serialised and further
input remains in the local draft. Session storage retains drafts across scene switches and
reloads on a best-effort basis; this is not a full offline editing/synchronisation system.
Failed saves expose Retry save. Conflicts expose Save my changes or Use saved version.
Generation and style changes wait for pending text saves and shot refresh. The old editor is
inert while a new scene is being created, preventing typing into the scene being left.

One priced action uses the production quote API and supplies its fingerprint on submission.
Selecting settings does not start paid generation. Changing inputs invalidates/reloads the
quote, and a stale supplied fingerprint is rejected before reservation.

With an unchanged preview selected, **Make final clip** uses its recorded recipe. Current
scene text stays editable; saving a later scene revision switches the final to current settings
and displays a notice. This differs from DF-02's explicit use-latest requirement. The return
link only clears `fresh` and cannot restore the recipe after a newer scene revision: both
issues are tracked in [the code review](review-2026-09-28.md).

A newly completed take is shown immediately. The first allowed clip may fill an empty cartoon
slot; subsequent results do not replace the chosen clip until **Use this clip**. A clip with
older source-scene metadata gets a notice. **Make another version** uses the displayed take's
recipe plus an optional note; legacy jobs may need the current scene fallback. Other versions
remain expandable. A final is a new render and can differ from its preview.

## Verification and limits

The latest UI pass passed the web build and 14 targeted browser regressions on an insecure
LAN origin with an isolated usability database and fake generation. Coverage includes continued
typing during saves, scene switches, save failure/conflicts, reload persistence, optional
choices and summary, AI proposal acceptance, Studio, preview/final and assembly. Updated
Studio/design screenshots were generated and tablet light/dark views inspected.

Earlier implementation runs recorded full builds, 134 API tests, 56 compiler tests and 22
browser tests; those counts describe those runs, not a fresh full-suite execution here.
Physical tablet touch/keyboard behaviour, teen sessions and real-model quality remain pending.
Scene reordering stays in Manage scenes. No deployment is implied.
