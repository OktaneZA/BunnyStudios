# Combined scene writing and clip workspace

Implemented 28 September 2026. The main navigation is now **1 Create → 2 Put it together**. New cartoons and existing cartoon cards open the combined workspace. The former writing/ordering page remains available through **View → Manage scenes**, outside the numbered workflow.

## Behaviour

- Make clips includes **Add scene**, editable **Scene name** and **What happens?**, characters, style, length, preview/final selection and the priced generation action.
- Text saves after a short typing pause or on blur. Saves are serialised; further typing is retained while a request is in flight.
- Generation is disabled until text is saved and the compiled shot has refreshed. Style changes also wait for pending text saves.
- Failed saves keep the draft and expose Retry save. Version conflicts offer Save my changes or Use saved version. Session storage retains pending drafts across scene switches/reloads; a restored draft based on an older version requires a choice.
- Scene Board's Write this scene action selects the inline editor. **Camera, time and mood** expands camera angle, time of day and atmosphere controls directly in Create. These share the serial autosave, draft recovery and generation readiness checks with scene text. More writing tools links to the existing dedicated writing screen for remaining tools.
- Editor and clip player sit side by side on wider screens, and stack below 1100 pixels.
- New clips record the scene revision used. If that scene changes, the clip shows an older-scene notice and remains selected until explicitly replaced. Preview-based finals retain their original revision; older jobs without revision metadata cannot show this notice reliably.
- Creating a final from a preview still shows its read-only recorded recipe. Use my current scene settings instead returns to editable current content.

## Validation

Full build, 134 API tests, 56 package tests and 22 browser tests passed. The 13 Character Studio API tests were also rerun after adding scene-revision assertions. Browser coverage includes writing and generation together, saving during continued typing, switching scenes, save failure/conflict recovery, reload persistence and the older-clip notice, alongside existing character, layout, theme and export flows. Browser testing used an isolated database and fake providers; the temporary server/database were stopped/removed afterward. Local real-provider configuration was left unchanged.

## Subsequent work

After restoring camera, time and mood in Create, the build and all three targeted scene-composer browser tests passed. The main flow changes all three settings, reloads and verifies the selections persist; slow-save and conflict recovery checks also pass. These checks use isolated storage and fake generation, without paid provider calls.

Integrating the remaining writing tools and moving scene reordering into Create are subsequent consolidation steps. Physical tablet and real-model output testing remain separate from fake-provider browser tests.
