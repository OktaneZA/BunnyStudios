# Teen UI and flow review

Date: 27 September 2026. Status: implemented 27 September 2026, except where noted below. Not yet
checked with teens or on a physical tablet.

## Implementation status

| Priority | Done | Not done / differs |
| --- | --- | --- |
| P0 one flow | `SceneComposer` replaces the text-only panel and the characters card: one costed action, Preview/Final choice, "Make final clip" from a selected preview, direct final still available ("Start a new final instead"). The old cost-level buttons are gone from Simple mode; the server routes previews to the cheapest fit and finals to a recommended or highest-level maker. | — |
| P0 retry | "Make another version" reuses the selected clip's recorded recipe (characters, look versions, frames, length) plus an optional note, with a fresh quote; older clips without a recipe are remade from the current scene and say so. The chosen clip stays until another is picked. | — |
| P0 settings | Length, Preview/Final, sound, frames, words-only and (Advanced) maker/size all go into the same request and its quote; a changed price is refused (409) and requoted. | — |
| P1 Studio | Describe → Choose a picture → Ready; making pictures saves edited words first and stops if that fails; "Use this look"; Ready shows the portrait, "Return to the scene", folded "Add more angles" and "Earlier looks". | — |
| P1 characters | Portraits with "Using your chosen look" / "Using an earlier look" / "Choose X's look"; first-time "Are these the characters in this scene?"; "Edit characters"; words-only is an explicit option under More options. | Returning restores focus to the button that opened Studio (Sheet behaviour), not a scroll position. |
| P1 controls | Characters button first; layout, colour, movable panels and reset under a remembered View menu; movable panels hidden on narrow screens. | — |
| P1 prices | The main action carries the quoted total; per-part and generated seconds sit in Price details; "Preview" is never labelled cheaper. | — |
| P2 style | Each scene shows its style with Change, and warns that a new style can differ from chosen pictures. | No cartoon-wide default style with representative thumbnails yet. |
| P2 Together | Watch and "Save video" first, with left-out scenes listed; music, voice and the timeline under "Music, voice and timing (optional)". Microphone switches off when leaving. | — |
| Language | "Characters" replaces "Cast" in Director and the sheet; "Generation isn't connected yet. Ask the account owner to set it up." replaces the add-a-key messages. | Some older server messages still say "Ask a grown-up" (safety checker, budget). |
| Usability sessions | — | Not run. The proposed tasks and success criteria below still need teens and a real tablet. |

## Evidence and limits

Reviewed the current Director, SceneProduction, CharacterStudio, CastSheet, ProjectTabs, NewProject, ProjectDetail, SceneDetail and Together components, plus the screenshots supplied in the conversation. The browser runtime reported no available browser. Findings about controls and navigation are source-based; current rendered spacing, contrast, touch behaviour and responsive layouts still require browser/device checks. These are design hypotheses for the product's 10–15 audience, not findings from teen usability sessions.

## Recommendation

Keep the existing three steps: **Write → Make clips → Put it together**. Keep both Film Strip and Scene Board, with light/dark appearance. Make the default experience centre on a scene, its characters, and one next action. Preserve advanced controls through progressive disclosure.

## Priorities

| Priority | Current evidence | Recommended change |
| --- | --- | --- |
| P0 | Director renders a text-only generation panel and a separate SceneProduction panel. These offer Make it move, Quick preview, Make final video and, after a draft, another final action. | One scene composer and one generation flow. Use approved character references automatically. Offer Preview/Final as a compact choice, with one costed action reflecting that choice. After a preview, make the next action Make final clip. Keep direct final generation available. |
| P0 | Director's Try again invokes the text-only start function, independently of the selected result's production workflow. | Retry the selected clip using its recorded characters, look versions, frames and output settings. Offer a short change instruction. Requote before spending. Never silently drop character conditioning. |
| P0 | Duration and audio are passed from the upper panel into SceneProduction, but model/tier selection is not passed with them. | Put shared clip settings in one place. Every visible setting must apply to the action next to it. Advanced model choices must constrain that same request and its quote. |
| P1 | Character Studio shows description/save, generation, image approval, extra views and look history together as they become available. | Use Describe → Choose a picture → Ready. Save edited text as part of the explicit Generate action, stopping if saving fails. Keep image approval explicit. Collapse extra views and previous looks after approval. |
| P1 | Chosen pictures are controlled by a visible continuity switch; cast confirmation and missing-look recovery add extra decisions. | Show character portraits with a status such as Using your chosen look. Keep first-time cast confirmation, then persist it. Put changes behind Edit characters. When a look is missing, offer a direct Choose Fox's look action and return to the same scene afterward. Text-only generation remains an explicitly labelled alternative. |
| P1 | Layout, colour mode, movable panels and cast all occupy Director's top controls. | Keep Characters easy to find. Put layout and theme in View, remember the choices, and put floating panels in Advanced on desktop. Use docked content on small screens and retain Reset layout. |
| P1 | Per-second prices, spend tiers, duration, provider selection and purpose all compete for attention. | Lead with the quoted total on the action, e.g. Make preview · [quoted price], with duration and budget remaining nearby. Hide per-second calculations in Price details. Never advertise a preview as cheaper unless the current quote confirms it. |
| P2 | Five art styles appear on each scene; existing swatches are coloured dots. | Choose a cartoon-wide default with representative thumbnails, then show the chosen style and Change in each scene. Scene overrides remain possible. Explain when a new style may differ from existing character pictures; do not silently replace approved looks. |
| P2 | Together exposes recording start times and several timeline lanes. | Lead with Watch cartoon and Save video. Put music, narration and detailed timing under optional controls. Clearly list omitted scenes before export. Keep the detailed timeline accessible. |

## Suggested default scene screen

```text
The Great Biscuit Robbery       Write | Make clips | Put it together

Scenes: [1 Ready] [2 Making] [3 Selected] [4 Write scene]

Scene 3 · Caught red-pawed
[Main picture / playable clip]
Mum finds Pip with his paw in the biscuit tin.       Edit scene

Characters  [Pip portrait] [Mum portrait]            Edit
Style       2D cartoon                             Change
Length      5s   10s   15s   30s

Preview / Final              More options
[ Make preview · quoted price ]
Budget remaining: …
```

This is a structural sketch, not a rendered design. Show unsupported durations with an explanation and a suitable alternative. If a duration needs joined clips, say so before generation and quote the actual work. Never imply every model natively supports every length.

After generation, the player gets Use this clip and Make another version. If a preview is selected, show Make final clip in the primary action area; explain that this creates a new video which may differ. Clip history stays behind Other versions. Making a new version must preserve the currently selected clip until the user chooses a replacement.

## Character flow

1. Enter a name and one description, or upload a picture. Optional detail fields stay collapsed.
2. Generate two options with the total price visible. Pick one, or choose Change this picture.
3. Approve with Use this look. Show the approved portrait and Return to scene.
4. Offer Add more angles as optional follow-up, with an explicit price and approval of each selected image. Previous looks live under History.

The UI may say that chosen pictures help keep a character consistent; it must not promise perfect consistency. Saving text and approving a visual identity remain separate operations. A new look must not silently change existing scenes pinned to an older version.

## Language and layout

- Prefer Characters over Cast, Earlier looks over numbered visual versions, and More options over technical configuration names.
- Use respectful, short language. Replace Ask a grown-up to add a key with Generation isn't connected yet. Ask the account owner to set it up.
- Keep Make final clip distinct from Save cartoon: one spends money on generation; the other exports the assembled result.
- Use a single-column scene editor on phones, with a compact scene selector. Use Film Strip or Scene Board on wider screens. Keep the selected scene and settings when switching views.
- Keep the costed action reachable, but ensure a sticky action bar cannot cover form fields, errors, or the mobile keyboard.
- Pair statuses with text, not colour alone. Explain disabled actions nearby. Restore focus to the originating scene after Character Studio closes.

Clear steps, explicit labels and proximity between a control and the content it changes follow [W3C guidance on step-by-step instructions](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p07-step-instructions/) and [control relationships](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p06-control-actions/). These principles support the recommendations; they do not establish teen preference for a particular layout.

## Implementation order and acceptance checks

1. Unify generation and retry behaviour in Director/SceneProduction. Verify there is one costed main action, every visible setting affects it, and retry preserves the selected result's references and settings.
2. Shorten CharacterStudio and CastSheet. Verify generation saves valid text first, approval remains deliberate, and returning restores the originating scene.
3. Move appearance and technical controls into optional menus. Verify both layouts and both themes retain all core actions at mobile widths and with keyboard navigation.
4. Simplify Together and run observed usability sessions before larger visual changes.

For usability sessions, ask teens to create a character, use it in two scenes, preview one scene, change something, make a final and save the cartoon. Observe wrong-path clicks, requests for help, understanding of the price, and whether they know which clip is in the cartoon. Ask them to explain preview versus final in their own words. Use fake providers for these tasks until paid-generation testing is explicitly planned.

Proposed success criteria: a participant can find the next action without coaching; identify the cost before each generation; retry without losing character choices; and distinguish the selected cartoon clip from other versions. Validate these with users rather than assuming fewer controls alone solves the flow.
