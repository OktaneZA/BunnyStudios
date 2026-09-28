# Create workspace layouts and appearance

Updated 28 September 2026. **View** chooses **Film Strip** or **Scene Board** and independent
**White** or **Black** appearance. Preferences stay in the browser; they do not change the
clip's art style. See [current requirements](current-product-requirements.md).

| Design | Layout |
|---|---|
| Film Strip | Scene thumbnails in story order with transition shortcuts and Add scene at the end. Selecting a tile opens its editor. |
| Scene Board | Scene cards in a responsive grid, with descriptions/status and direct access to the selected scene's workspace. |

The supported targets are tablet and computer. From 1000px the scene editor and action/player
panel sit side by side; below that they stack. Phone-specific work is deferred. The top area
contains the cartoon title, two-step navigation, progress, Characters and View. Characters
uses theme colours so its text remains legible in light mode.

The editor contains scene text and optional Let AI help. **Scene details** starts folded,
summarises selected time/mood/camera labels and opens 44px touch chips. Characters, Style and
Length use short rows. The priced **Make preview** / **Make final clip** action is above the
player rather than below the complete form. Allowance and price details stay with that action.

More options holds sound, words-only, start/end frames, direct-final generation, instructions
and the scene-sketch link; model/size selection is Advanced-only. This uses one production
request path, not the former competing cards or visible cost-level choices.

Movable panels can float Scenes, Clip settings or Your clips. Drag a title bar or use its
arrow keys; Dock and Reset layout restore normal flow. Resizing docks panels. Floating
controls remain hidden on narrow widths. This does not establish real-tablet drag quality.

Five clip styles use the existing vocabulary. A scene style change saves with its version
and recompiles instructions; it does not regenerate an existing clip or approve a new look.
Desired lengths are 5/10/15/30 seconds, subject to compatible routing. Text-video assembly may
join/trim parts; reference/frame requests require compatible native lengths. Price details
show generated seconds and potential cuts. No continuous motion or identity guarantee is made.

## Evidence

The latest local UI pass passed the web build and 14 targeted browser tests. Updated
`docs/screenshots/director-designs/` and `docs/screenshots/studio/` captures show the new layout;
light/dark tablet views were inspected. The existing Director regression also exercises
multiple widths, theme/layout persistence and floating controls. Historical phone checks do
not make phones a current acceptance target. Physical tablet, teen and real-model validation
remain pending. The code review records remaining recipe-selection and helper-copy issues.
