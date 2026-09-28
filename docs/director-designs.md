# Director workspace options

24 September 2026. Choose **Film Strip** or **Scene Board** in Director, then independently
choose **White** or **Black**. Both preferences stay in this browser. The palette includes the
page header, controls and dialogs; it does not change the generated clip's art style.

| Design | Layout |
| --- | --- |
| Film Strip | Scene thumbnails in story order across the top, with transition controls between them. Select a scene to work in the split description/settings panel below. |
| Scene Board | A responsive grid with thumbnails, descriptions, clip status and direct links to write missing descriptions or open clip settings. |

These replace the four initial design experiments, following the user's preferred references.
The references guide the layout; they do not restore the removed extra-instructions field or
the old duration choices. No batch-generation action is introduced by this visual change.

**Movable panels** is available in both layouts. Float Scenes, Clip settings or Your clips,
then drag its title bar or use arrow keys. Dock returns it to the page; Reset windows docks all.

Panels wrap on narrow screens. Floating controls disappear below 761px; resizing docks windows
so controls cannot be left off-screen. Window positions reset on reload or when movement is disabled.

Five clip styles use the existing art vocabulary: 2D cartoon, Pixar-like 3D, soft anime,
watercolour and clay animation. Selection saves the scene's style override using its version;
the server recompiles the instructions. Existing clips are unchanged. The extra-instructions
input is removed; previously saved instructions remain preserved.

Every cost level offers 5, 10, 15 and 30 seconds. Providers still receive only their supported
native durations. The planner minimises generated seconds and then the number of parts.
The server joins parts and trims the end to the requested length. For example, Medium's
15-second option generates 10 + 6 seconds and charges for 16 seconds. The quote explains this.
Parts use the same scene instructions; motion can repeat or change at cuts. This is not a
guarantee of continuous motion or character consistency across parts.

Each provider part ID is saved on the job for retry/resume. Budget reservations include all
generated seconds. Safety review samples the start and middle of each visible part. Generated
parts are assembled with ffmpeg before being offered as one clip.

Verification uses fake providers and real ffmpeg; no paid generation was performed. Physical
tablet dragging and visual continuity with real providers still need hands-on validation.
Screenshots are in `screenshots/director-designs`.

Current previews: `film-strip-white.png`, `film-strip-black.png`, `scene-board-white.png`,
`scene-board-black.png`. Earlier screenshots in that folder show the initial design experiments.
Both palettes and layouts were checked at 390, 768, 1024 and 1440px, including persistence across
reload, scene selection, floating panels and the existing generation/assembly browser regressions.

Checks passed: full workspace build, vocabulary/model validation, 52 compiler tests, 100 API
tests and all 15 browser regressions. The five Director regressions passed again after final
contrast fixes and adding Medium to the development fake catalogue. Layouts were checked at
390, 768, 1024 and 1440px. Pointer dragging, arrow-key movement, reset and style persistence
were exercised. A downloaded joined cartoon was verified as exactly 15 seconds, 1280×720,
H.264/AAC. A transient failure on the second part was tested: the first part was not resubmitted.
