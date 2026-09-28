# Teen UI follow-up

Reviewed commits `0689752` and `90b26bb`, the current components, and the committed Studio screenshots. The working tree was clean at the start. The fixes below are uncommitted.

## Resolved

- Finals made from a preview now show a read-only summary of the recorded recipe. Current scene/style/character controls are hidden in that mode; an explicit action switches to the current scene. The displayed instructions come from the recorded recipe, not the edited scene. API plans expose the actual output settings and prompt for this summary.
- Clip quote failures now offer **Check price again** instead of remaining at **Checking the price** indefinitely.
- Image-to-video price details correctly describe the starting picture. Character badges distinguish words-only and starting-picture generation from use of chosen character references.
- Character generation waits for a displayed price. Each angle uses its own quote, and refinement requests use a refinement quote rather than the side-view price. Failed price checks can be retried. A submission guard prevents overlapping save/generate sequences.
- Optional sections have visible disclosure arrows. Dialog focus traversal includes summary controls.
- Microphone cleanup covers leaving while permission is pending, recorder construction failure, and leaving after stop but before its callback runs. Repeated permission requests are guarded.

## Validation

- Full workspace build passed after changes.
- 134 API tests and 56 package tests passed. The lineage test now also asserts that the UI receives the saved audio, duration and instructions.
- Browser tests were extended for quote-failure recovery, generation disabled without a price, and the explicit switch between saved preview settings and current scene settings.
- Follow-up validation: **18 browser tests passed (39.4 seconds)** using the repository's Playwright suite against the freshly built app on an isolated local server and temporary PostgreSQL database. Fake generation was enabled and paid provider keys were blank. The server was stopped and the database removed afterward.
- Browser coverage includes character creation/approval, preview-to-final generation, quote failure/recovery, cartoon assembly and download, dialog focus, floating panels, and both layouts/themes at 390, 768, 1024 and 1440 pixel widths. Studio and design screenshots were refreshed. This run used localhost; it does not establish behaviour on an insecure LAN origin or physical tablet. Real microphone permission behaviour and teen usability sessions remain unverified.
- No paid generation, commit, push or deployment was performed.

## Further usability recommendations

1. Reduce space above the composer. In the supplied 1024-pixel-wide full-page composer screenshot, scene editing starts around 650 pixels down and the generation action around 1130. Consolidate the title/progress/Characters/View area; on small screens, use a compact scene selector. Confirm this with actual tablet scrolling before choosing a sticky action bar.
2. Show a newly finished result prominently with **Watch new version** and **Use this clip**, while leaving the current cartoon selection unchanged. The current selected preview can remain on screen after a final completes, with the final inside Other versions.
3. Replace large estimated counts of remaining pictures/clips with the actual available money and the current action's price. The supplied screenshot's thousands-of-clips estimate is test data, but the wording also assumes future jobs cost roughly the same.
4. Explain Preview and Final in one short line. Avoid implying a final is always better merely because its provider has a higher cost tier; routing should follow evaluated model suitability.
5. Add cartoon-wide style defaults and representative thumbnails as the next feature, after verifying the current flow with teens. Keep approved character looks and existing scene overrides explicit.

Before release, test real touch interaction and microphone permission followed by navigation on a physical tablet. Observe a teen changing a scene after a preview and choosing the new final without replacing the existing clip prematurely. Automated tests establish the covered flows; they do not establish visual continuity from real models or ease of use for teens.
