# Scene thumbnails — implementation and code review

> **Current entry points (28 September 2026):** Create contains **Let AI help** for writing.
> Its **More options -> Scene sketch -> Open the full scene page** link exposes the optional
> sketch workflow. Sketches remain separate from approved production references. See
> [the workspace guide](combined-scene-workspace.md); the implementation history below is retained.

Implemented 8 September 2026, scoped to D17 / TH-1–TH-6. The rest of the production prompt,
cast editing, shot editing, and AI-writing roadmap remains separate.

## Setup

1. Set `ANTHROPIC_API_KEY` in `apps/api/.env`. A template is in `apps/api/.env.example`.
2. Choose `ANTHROPIC_MODEL` (default `claude-sonnet-5`). The key's account must have access to it.
3. Run `npm run db:migrate`, then restart `npm run dev:api` and run `npm run dev:web`.
4. Open a scene, describe its action, and choose **Make a thumbnail**.

In Windows PowerShell with scripts disabled, use `npm.cmd` in place of `npm`.
No API key is stored in browser settings, returned by the settings endpoint, or committed to Git.
`GET /api/v1/settings/ai` exposes availability and the daily limit only.

Claude's [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
provide the drawing data. Authentication follows the [Claude API setup](https://platform.claude.com/docs/en/get-started).
Claude composes a rough vector sketch; this feature does not call an image-generation API.

## Behaviour and implementation boundaries

- Scene thumbnails are optional in both modes. The board and scene detail use the same selected image.
- A request reserves a daily/rate-limit slot and an `AiInteraction`, then creates an `AiProposal`.
  Generation runs outside a database transaction and the client polls for its preview.
- An account-row lock serializes quota reservations across instances. Client UUID request keys
  provide persistent idempotency; a lost response does not cause another generation.
- Claude supplies bounded JSON shapes. The server validates them and renders only ellipses,
  rectangles, lines, and paths. Model output cannot supply SVG markup, scripts, URLs, or HTML.
- The provider makes a separate policy-review call before showing a preview. Teen policy always
  applies regardless of project audience. Private director notes are excluded from both calls.
- Preview acceptance locks the scene and proposal, checks the source fingerprint, policy, and
  thumbnail revision, then atomically creates the Asset and selects it. Duplicate acceptance is safe.
- Source changes mark existing thumbnails stale. An old proposal cannot replace a newer selection.
  Updating unrelated private notes does not make a thumbnail stale.
- Cancellation preserves the selected image and clears preview data. Pending generation expires
  after three minutes if its worker is lost; completed previews expire after 24 hours. A minute timer
  and startup/request cleanup clear expired payloads. These short jobs have no automatic paid retries.
- Small SVG assets live in Postgres and travel in authenticated, non-cacheable scene responses as
  data URLs. External uploads remain a separate Blob feature. Removing/replacing a thumbnail deletes
  its old Asset; scene deletion clears thumbnail assets and pending previews.
- Every attempt counts toward the configured limits, including failures/cancellation. Known token
  usage is logged even when a completed drawing fails validation or policy review. Usage for a
  network-aborted call may be unavailable; the attempt still consumes a quota slot.

## Code-review findings addressed

1. API startup did not load the documented local `.env`. Configuration now resolves and loads
   `apps/api/.env` consistently; externally supplied environment variables retain precedence.
2. Scene PATCH treated `If-Match` as optional and checked the version separately from the write.
   It now requires a version and includes it in the UPDATE predicate, preventing concurrent overwrites.
3. Scene location IDs could reference another account/project. Create and update now verify ownership;
   sluglines also use the selected location.
4. Scene form refs could survive route changes. Each scene now gets its own editor instance.
   Saves also run every ten seconds, and thumbnail mutations wait for pending scene saves.
5. Save conflicts must not be retried into silent overwrites. The editor pauses saves until the user
   chooses **Save my changes** or **Use saved version**. Project mode controls friendly labels.
6. Existing API tests deleted real-account projects created after the test start time. All API tests
   now create disposable accounts and delete only their own account IDs.
7. The API had no local TypeScript configuration although its build script expected one. The API
   now has an explicit no-emit configuration; the root typecheck command validates all workspaces.

## Verification and limits

The migration has been applied locally. API tests exercise actual Postgres transactions, ownership,
idempotency across app instances, cancellation races, expiry, quotas, stale sources/selections,
asset cleanup, and a real HTTP listener with CORS. Provider tests exercise structured requests,
policy checks, invalid output, and sanitised error messages using controlled responses.

Live thumbnail generation has succeeded with the configured local Claude key.
The browser connection was unavailable during implementation; tablet/desktop visual and interaction
checks still need a browser. Automated route tests and TypeScript/build checks do not replace those.
No Azure deployment was performed. Existing offline draft recovery, full undo/version history,
and complete production storyboarding remain outside this thumbnail change.

Manual check once a key is configured: create a scene on a tablet, make and accept a sketch,
reopen the board, edit the action, confirm the stale notice, try/cancel a replacement, and remove
the thumbnail. Repeat in both modes and with a blank key. Check real touch reordering separately.


## Scene simplification (D18)

The editor now combines intent, action, and appearance in one description, with six camera angles
and no emotional-change input. **Improve for me** creates an optional Claude writing proposal;
**Use this description** accepts it. Both operations share the configured request allowances.
The board displays pending sketches as labelled previews; **Use on scene board** selects one.
Legacy text remains stored and is combined until the new description is edited.

The migration is applied locally. The 48 passing API tests cover legacy text preservation,
camera validation, board previews, writing proposals, acceptance, stale-source rejection,
cancellation, ownership, and provider/policy failures.
