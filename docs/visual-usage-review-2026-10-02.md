# Running application usage review - 2 October 2026

Reviewed the running application at **http://localhost:5173/** using Playwright with Edge,
signed in as Creator (Simple mode). This review concerns the local app, not the NAS build.
Checked the cartoon library, Sunny Beach Catch's Create workspace, character setup, style
choices and Put it together at 1024x768 and 1440x900. Checked light/dark appearance and Film
Strip/Scene Board. Existing cartoon playback started successfully and was paused afterward.

No scenes, characters, clip selections or paid generations were created or changed. Display
preferences were restored to dark Film Strip. This is desktop-browser viewport testing, not
a physical tablet or teen usability session. Generation completion, downloads and microphone
permission were not exercised; no full accessibility audit was performed.

## Confirmed findings

| Priority | Observed issue | Recommendation |
|---|---|---|
| P1 | Desktop Film Strip transition buttons are covered by the next card. At 1440px, both Fade buttons exist, but hit testing at their centres returns the following scene's image/placeholder. | Allocate width for the card, gap and transition control together, or put transitions in their own strip items. Verify pointer and keyboard access at desktop widths. |
| P1 | Light-theme character links are faint. Choose Timmy's look renders at 14.4px in `rgb(181,160,255)` on white: calculated contrast is about **2.23:1**. | Use a darker light-theme link colour and check links in cards and dialogs consistently. Preserve the visible focus indication. |
| P2 | The editor starts roughly 570px below the top at 1024x768. In Scene Board with only three scenes it starts around 831px, outside the first viewport. Header, duplicated readiness information and scene navigation take most of the initial screen. | Compact the top area; display progress once. Offer a compact or collapsible scene navigator while editing, keeping scene selection and Add scene visible. Avoid putting the full board before the editor for every edit. |
| P2 | Create says **2 of 3 scenes ready** and shows scene 2 as No clip yet, while Together says **3 scenes play**, comprising two clips and one picture. The fallback works but the status does not explain it. | Use explicit statuses such as Video selected, Picture selected and Empty. Separate having playable content from having a generated video. |
| P2 | A completed cartoon still makes **Make my cartoon again** the primary purple action; Save video is secondary. Both sit below the large player. | Make **Download video** primary after completion and **Update cartoon** secondary. Keep the download action near the player heading or in an immediately visible result toolbar. |
| P2 | Missing-look guidance says to use **Cast**, but the UI calls that area **Characters**. Existing clips play while the make panel shows a warning and a disabled Make preview button. | Say **Choose Timmy's look for your next clip**, matching the Characters label and making clear that the existing clip remains usable. |
| P3 | Style choices are abstract coloured dots. The control is in the scene form but defaults to changing the whole cartoon. | Label it **Cartoon style** and show the scope before selection. Replace dots with representative examples of the same subject in each style; explain that existing clips and approved pictures do not regenerate. |
| P3 | The library spends prominent space on drag instructions, series numbers and two timestamps per card, with no visual cover or obvious resume action. | Lead with a cover/scene image, title and Continue. Reduce ordering instructions to contextual help and show one useful edited-time label. |

## Evidence and implementation references

- [Desktop transition overlap](screenshots/usage-review-2026-10-02/desktop-transitions.png):
  `styles.css` gives the desktop wrapper a 250px basis while its card can occupy 240px,
  before the gap and transition button. Hit testing confirmed the overlap affects interaction.
- [Light-theme links](screenshots/usage-review-2026-10-02/light-scene-links.png):
  `.link-button` uses the accent colour; its ancestor composer background is white.
- [Tablet Create](screenshots/usage-review-2026-10-02/tablet-create.png) and
  [tablet Scene Board](screenshots/usage-review-2026-10-02/tablet-scene-board.png) show how much
  content precedes the scene editor.
- [Completed cartoon actions](screenshots/usage-review-2026-10-02/tablet-download.png) show
  the rebuild/download priority and the two-clips/one-picture summary.
- Relevant code: [styles](../apps/web/src/styles.css),
  [DirectorScenes](../apps/web/src/components/DirectorScenes.tsx),
  [Create header](../apps/web/src/screens/Director.tsx),
  [Together](../apps/web/src/screens/Together.tsx),
  [production guidance](../apps/api/src/routes/production.ts).

## What to preserve

### Follow-up: desktop scaling

The page width caps were removed after this review at the user's request. Film Strip items
also now size to their card and transition together, resolving the first finding above.
Live checks at 1024, 1440, 1920 and 2560px found no page-level horizontal overflow; both
transition buttons passed centre-point hit testing at every width. The web build passed.
The review browser's fixed viewport override was cleared to follow its window size again.
The screenshots above retain the original findings, before these fixes.

The two-step workflow is understandable. The editor/action split is useful once in view;
optional scene controls stay folded; paid actions show prices when available; missing-look
recovery links open the relevant Studio; both themes are coherent; existing cartoon playback
works. The next pass should fix the transition overlap and link contrast first, then reduce
scrolling and clarify completion/content states.

The earlier screenshot-only recommendation about prioritising newly generated clips remains
an untested hypothesis in this session: no paid generation was started to reproduce that state.
