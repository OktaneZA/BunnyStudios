# Character Studio — implementation status

27 September 2026. Records what was built against [the requirements](character-studio-requirements.md)
and [build plan](character-studio-build-plan.md), and what is **verified** versus **pending**. A
passing test here proves a contract (which pictures, in which order, for what price), not that a
real model keeps a character consistent.

## How it was checked

- API: 131 tests against a real Postgres with a fake provider (`npm test -w @storyboard/api`),
  including `test/character-studio.test.ts` (10 acceptance tests) and
  `test/generation-recovery.test.ts` (9 money/recovery tests).
- Compiler: 56 tests, 100% coverage, including `compileCharacterSheet`.
- Browser: 17 Playwright tests at 1024×768 over the LAN address (insecure origin, like the NAS),
  with fake generation, including `e2e/character-studio.spec.ts` (make a character → choices →
  "This looks like Bunny" → side view → "Use these pictures" → scene cast → preview → final).
  Screenshots: `docs/screenshots/studio/`.

## Definition of done (§8)

| Item | Status | Evidence |
|---|---|---|
| Teen creates and refines a character | Verified (fake provider) | API + browser tests |
| Generated/uploaded candidates do not auto-approve | Verified | `a teen creates and refines…`, upload test |
| Approved views create a visual revision | Verified | `approval creates one immutable revision…` |
| Two shots receive the selected revision and ordered references | Verified | `two shots receive the chosen looks…` |
| Changing the character creates a new revision without modifying the older job | Verified | same test, look 3 after job A |
| Draft and separately accepted final retain lineage | Verified | `a draft and a separately accepted final…` |
| Start/end conditioning respects capability limits | Verified | frames test; registry test |
| A restart resumes paid work | Verified | `a shutdown hands a job back…` |
| Concurrent jobs respect the budget | Verified | `MB-03: concurrent requests…` |
| Unauthorized or rejected references cannot be used | Verified | `rejected, foreign and never-offered…`, hash test |
| Live fal access for Seedance/Wan/MiniMax/LTX/Hailuo/FLUX 3 | **Pending** | Not called. Schemas for Seedance I2V and reference-to-video were read from fal's published OpenAPI (free) |
| Real billing matches quotes | **Pending** | Quotes use catalogue prices and a 100 pence/USD budget policy |
| Visual continuity benchmark | **Pending** | Not run: needs a bounded spend allowance ([benchmark](spike/continuity-benchmark.md)) |
| Physical tablet usability | **Pending** | Only desktop Chromium at 1024×768 |

## What is gated

- The six new families (and Seedance image-to-video) carry `video.rollout: "advanced"` and
  `verified_live: false` in `models.json`: Advanced accounts can pick them (labelled "Not tried by
  us yet"); Simple-mode routing never uses them. After a recorded live check, set
  `verified_live: true` + `rollout: "production"` per model, or `VIDEO_FAMILY_ROLLOUT=all`.
- Until then, "Clip with your characters" in Simple mode has no production endpoint that takes
  character pictures on the real catalogue; the screen says so and offers a clip from the words.
- Native provider draft completion (Seedance `draft_id`) is recorded on the job but not offered;
  a final from a preview is always a new, separately quoted render (DF-03).
- Mixed video/audio references are not supported: image references only.

## Decisions taken while building

- Money: submitted-but-failed or cancelled-after-submission work keeps its estimate, marked
  `unknown`, instead of being refunded (MB-04). An ambiguous submit is never retried
  automatically (MG-07); the adult sees it in the clip log.
- Existing character pictures became legacy candidates (migration 0009); no look was invented.
- Production requires the scene's cast to be saved ("Yes, these are in this scene"); the story's
  guess is only a proposal (CR-01).
- The quick text clip ("Quick clip from the words", cost levels) is kept beside the new
  "Clip with your characters" card. Whether one card is clearer for a 10–15 year old is a
  question for a real tablet session.
