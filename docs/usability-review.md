# Teen and tablet usability review

> Historical review of the 21 September interface. Its Story/Director split, cost levels and
> 1100px layout recommendation are superseded by the [current requirements](current-product-requirements.md)
> and [Create workspace](combined-scene-workspace.md). Test counts below remain dated evidence.

Reviewed 21 September 2026 against the original requirements, build-plan decisions D1–D18,
Director decisions D38–D41, the web implementation and screenshots in `docs/screenshots`.
The primary audience remains ages 10–15 on desktop and tablet. The Android tablet wrapper
loads the same web app, so these improvements belong in the web code.

## Requirements and process

The original specification describes an external prompt-export tool. The later Director plan
adds in-app generation and assembly. D41 supersedes the picture-first flow with direct clips;
D38 retains just Story and Director tabs. Older screenshots are useful history, but the v2
screenshots are the current flow reference. Do not reintroduce separate compulsory Cast,
Places or picture stages from older plans.

The revised flow is:

1. Create a cartoon with a name and optional premise.
2. Add scene names in Story. A contextual next action opens the first scene without a description.
3. Describe who, where and what happens. Camera, mood, writing help and sketches remain optional.
   **Save and make a clip** waits for all scene edits to save, then opens that scene in Director.
   A failed save keeps the editor and the user's text open.
4. Read your scene, edit it through a direct Story link, choose cost and length, then make a clip.
   Technical instructions are expandable. Extra instructions save before generation starts.
   Generation waits for the current price and existing jobs to load; an active clip prevents
   another request for that scene. Another scene remains available while it runs.
5. Review the clips and choose alternatives. The existing first-clip selection behaviour stays.
   The cartoon strip opens each scene directly and clearly marks scenes with no playable media.
6. Put it together. Missing scenes have direct repair links, while intentional partial cartoons
   remain possible. Music and voice are optional. Make, play, and download the finished cartoon.

This uses contextual next actions within the existing two-tab structure, not a compulsory wizard.
Existing account isolation, safety review, budgets, soft deletion and server compilation stay intact.

## Findings and changes

| Evidence | Usability problem | Change |
|---|---|---|
| `v2-01-director.png`, `v2-02-director-making.png` | Film terminology and a long compiled prompt dominate the creative screen. | Lead with the saved scene description; expand instructions only on request; link directly to the scene editor. |
| Story and scene editor code | The user has to work out what to write next and how to reach the selected scene in Director. | First unfinished description gets a next action; the editor saves before continuing to that scene. |
| Director code and making screenshot | Extra instructions save on blur while generation can start independently; the primary button allows another active request. | Save extra instructions as part of starting a clip; prevent repeated starts and wait for the current quote. Failed quote lookup has a retry button. |
| `v2-04-together.png`, cartoon strip code | Empty scenes are silently omitted or weakly labelled; strip tiles cannot open their scene. | Clickable tiles, explicit missing-scene notice and links before assembly. Partial assembly is still supported. |
| 1024px making screenshot and CSS | Three columns squeeze the controls; several controls are below the intended 44px touch size. | Stack clip previews beneath controls at 1100px and below; enlarge tabs, duration choices, transitions, cast controls and sound switch. Portrait scene choices scroll horizontally. |
| Cast and transition sheets | Dialogs announce modality but do not manage keyboard focus or background scrolling. | Focus on opening, contain Tab/Shift+Tab, Escape closes, restore focus to the opener and lock background scrolling. |
| `v2-05-cast.png`, D41 | Cast pictures promise the same appearance in every scene, although direct clips use text. | Explain that pictures are optional planning references and consistent written descriptions guide clips. |
| Scene delete confirmation | Says deletion cannot be undone, although deletion goes to the bin. | Explain where the scene can be restored. |

## Verification

- Full workspace build passes, including web production build and API TypeScript checks.
- Vocabulary and model catalogue validation passes; all 52 compiler tests pass.
- On 21 September, the full Playwright regression suite passed: **14/14**, including saved
  scene handoff, missing-scene navigation, modal keyboard focus, extra-instruction saving,
  generation and assembly. The final run after the browser-driven fixes took 19.6 seconds.
- Playwright MCP also exercised the built app on `http://192.168.1.107:3999`, an insecure LAN
  origin matching the NAS deployment. Tests used a separate scratch database, disposable accounts,
  fake generation and real ffmpeg assembly. No real provider calls or AI charges were made.
- Director had no page-level horizontal overflow at 1440×900, 1024×768, 768×1024 or 390×844.
  Assembly was checked at the latter three sizes. Screenshots are in
  [screenshots/usability](screenshots/usability/); the tablet images were visually inspected.
- MCP verified price changes with duration and cost level, an injected price lookup failure
  and successful retry, saving extra instructions before generation, blocking another generation
  while a clip is active, transition-dialog Tab wrapping and focus restoration, missing-scene
  warnings and partial assembly. The downloaded MP4 was verified with ffprobe: 5 seconds,
  1280×720, H.264 video and AAC audio. The final MCP browser session had no console errors.
- Browser inspection found and fixed a 21px transition shortcut (now 44px) and removed a duplicate
  assembly notice with obsolete “Make a picture” wording. Rebuilding requires restarting the
  static test server so its registered asset routes match the new bundle; the final suite ran
  after that restart.
- Physical tablet touch/keyboard feel, real AI visual quality, microphone recording and
  failed-save recovery still need separate validation. No deployment was performed.

## Remaining product checks

Try the revised flow with a teenager: can they make and download a two-scene cartoon without
being told what to tap next? Check whether “Director” and “cast” need short introductory hints.
Validate finger scrolling and the on-screen keyboard on the Fire tablet; browser emulation alone
does not prove that these interactions feel right. Long, densely packed assembly timelines still
need hands-on review, particularly voice recording removal and transitions between short scenes.
