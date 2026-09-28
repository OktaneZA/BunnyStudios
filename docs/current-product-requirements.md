# Current product and interface requirements

Updated 28 September 2026 after the code, architecture and documentation review. This
addendum records the accepted Create-screen direction and the user's tablet/desktop-only
scope. It is a requirements document, not a deployment or usability certification.

## Which documents govern

- This document governs the current interface, navigation and device scope.
- [Character Studio requirements](character-studio-requirements.md) govern approval,
  reference identity, generation, lineage, money and safety. Unresolved differences between
  those requirements and code are recorded in [the code review](review-2026-09-28.md).
- [Build-plan decisions](build-plan-v1.1.md) and [Director decisions](director-mode-plan-v1.md)
  remain applicable where later addenda do not supersede them.
- [Architecture](architecture.md) describes implementation. Historical reviews and original
  specifications record earlier decisions; they do not override these current requirements.

## Audience and supported devices

The primary creator is aged 10–15. Tablet and computer are the supported design targets;
landscape tablet checks use 1024×768 and desktop checks include 1440px width. Check portrait
tablet behaviour too, without making phone layout work a release requirement. Existing phone
CSS may remain, but phone-specific defects and improvements are deferred. The Fire HD 10
wrapper uses the same web application and remains in scope.

## Interface acceptance criteria

| ID | Requirement | Acceptance criteria |
|---|---|---|
| UI-01 | Two main steps | **1 Create → 2 Put it together**. Cartoon creation and cartoon cards open Create. Scene management is available through **View → Manage scenes**. |
| UI-02 | Write and make in one workspace | Add/select a scene, edit its name and action, choose characters/style/length, then request a clip without a mandatory trip to another screen. |
| UI-03 | Preserve drafts | Serial autosave retains typing during requests. Failed saves and conflicts keep the draft and offer recovery. Generation waits for saved text and refreshed shot instructions. |
| UI-04 | Hide optional scene detail | Time, mood and camera start inside closed **Scene details**, with selected vocabulary labels visible in its summary. Expanded choices support touch and keyboard operation. |
| UI-05 | One clear priced action | Use **Make preview · price** or **Make final clip · price** for the actual request purpose. On landscape tablet/desktop the action is above the player beside the editor, with allowance and blocked-state explanation nearby. No purchase starts on selection alone. |
| UI-06 | Progressive disclosure | Characters, selected style and length stay visible when using current settings. **Let AI help**, **More options**, price details and clip history expand on request. Starting/ending pictures, sound and direct-final choice remain available. |
| UI-07 | Review and select results | Show a newly completed clip promptly. The first allowed clip may fill an empty cartoon slot; subsequent takes require **Use this clip** to replace the chosen clip. Keep preview/final and in-cartoon states explicit. |
| UI-08 | Consistent appearance | Keep Film Strip and Scene Board, independent light/dark themes and optional movable panels. Characters and all core controls must remain legible in both themes. Theme changes do not change art style. |
| UI-09 | Tablet interaction | Detail chips use at least 44px height. Check focus, keyboard access, scrolling and real touch interaction; browser emulation alone cannot establish physical usability. |
| UI-10 | Finish the cartoon | Put it together provides playback and video download; missing scenes have repair links. Music, voice and timing are optional. Partial cartoons are allowed with omissions explained. |
| UI-11 | Honest generation language | A preview is a trial and a final is a separately priced render, not a guaranteed improvement or identical upscale. Do not promise a cheaper preview without evidence from compatible current quotes. |

## Implementation and remaining acceptance

UI-01–10 have implementation in the current working tree, with the limits in the code review.
The latest UI pass passed the web build and 14 targeted browser regressions using fake
generation on an insecure LAN origin. Updated tablet screenshots were inspected in light and
dark themes. This does not certify every criterion: real tablet/teen sessions, live visual
continuity, microphone permission behaviour and provider billing remain separate checks.
UI-11 still has misleading cheaper/better copy to resolve. DF-02's explicit choice before
switching from a preview recipe to current scene settings also remains a documented gap.

No deployment is implied by this document. See [the workspace guide](combined-scene-workspace.md)
for current behaviour and [the review](review-2026-09-28.md) for source evidence.
