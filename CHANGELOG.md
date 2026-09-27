# Changelog

One heading per released version, newest first. The version is the root `package.json`
version; bump it with `npm version <patch|minor|major>` (which also commits and tags), push
with `git push --follow-tags`, then `npm run release`. Written for the maintainer, not the
teen; the app itself explains changes in its own words.

## Unreleased

- Clip log: every clip, picture and render keeps a step trail (sending, waiting, fetching,
  joining, checking), shown to the child as a live step and to the adult on Grown-ups → Clip log
  with raw errors; also written to `logs/generation.log`. Long clips no longer stall: running
  jobs heartbeat every 10 s, a dead server's job is picked up within a minute and resumes from
  the parts already made, and every provider call has its own time limit.

- Clearer switching between writing and making: every cartoon screen shows the same three
  steps (Write · Make clips · Put it together) beside the title; scenes show the same clip state
  and words in both steps; a scene opened from Make clips goes back there; a scene page keeps
  "Scene 2 of 4", arrows and "Make this scene's clip" in a bar that stays on screen; the sketch
  is now an optional closed section.

- Director layout refinement: Film Strip and Scene Board replace the initial four designs.
  Both have independent White/Black modes, remembered per browser, with matching header and
  dialog colours. Scene thumbnails and status lead the workspace; movable panels remain optional.

- Director: five saved clip styles; 5/10/15/30-second clips at every cost level using
  supported shorter parts and exact-length assembly, with full generated-time pricing.
  Removed the extra-instructions field. Added Studio, Cinema, Storyboard and Floating Desk
  layouts, responsive panels, draggable/keyboard-movable windows and a reset action.

- Teen and tablet usability: contextual Story handoffs, save before opening Director,
  scene text ahead of expandable generation instructions, price retry and duplicate-generation
  protection, links to missing scenes before assembly, wider tablet controls, and keyboard focus
  handling in sheets. See `docs/usability-review.md` for findings and verification limits.
- Playwright MCP verification: enlarged the apply-to-all transition shortcut to 44px and
  removed duplicate, outdated picture-step guidance from assembly. All 14 browser regressions
  pass against the built app with fake generation; desktop/tablet screenshots are recorded.

- Director Mode (docs/director-mode-plan-v1.md, docs/director-mode.md): a second tab on every
  cartoon. The cast is found from the scene text by a Claude proposal; each scene gets one
  compiled shot; "Make a picture" and "Make it move" run through fal.ai picture makers listed in
  a data-driven catalogue (`packages/models`), queued in a `generation_jobs` table, budgeted in
  real pence with adult-set daily and monthly caps, and passed through three safety gates;
  "Put it together" renders the scenes with music, voice and cut/fade/slide transitions to one
  MP4 with ffmpeg. New packages `@storyboard/models` and `@storyboard/compiler` (the pure prompt
  compiler, 100% covered). Migration `0006_director_mode`. The image now installs ffmpeg and
  mounts a storage folder at `/data/storage` (`STORAGE_DIR` in the NAS `.env`).
- Director makes clips straight from the scene text: a cost level (Low cost, Medium, High) and
  a length instead of a picture step; the finished clip joins the story order by itself.

## v0.3.2 — 2026-09-09

- Release verification compares the served web bundle to the one inside the image it just built, not to a possibly stale local `apps/web/dist`.

## v0.3.1 — 2026-09-09

- Sign-in page: the tablet-app link has its own style class so it never collides with the version tag.

## v0.3.0 — 2026-09-09

- Fire HD 10 tablet app (`apps/android`): a landscape WebView around the studio with an
  icon, splash, native confirm dialogs, back navigation, an offline screen and an in-app
  server address. Built and signed by the release and served at `/downloads/bunny-studios.apk`;
  the sign-in page links to it.
- Browser test suite (`apps/web/e2e`, Playwright) run by the release against the built image on
  the PC's LAN address before anything ships. `--dry-run` builds and tests without shipping.
- `/downloads/*` returns a real 404 instead of the app shell when a file is missing.

## v0.2.0 — 2026-09-09

- Versioning: one semantic version stamped into the image and reported by `/health` and the
  sign-in page. Image tags are `v<version>-<commit>`; `--rollback v0.1.0` works by version.
- The release refuses to ship an uncommitted tree unless `--allow-dirty`, and warns when
  `HEAD` is not the tagged version commit.
- GitHub Actions runs the tests and builds the image on every pull request.

## v0.1.0 — 2026-09-09

First release to the Synology NAS.

- Cartoons and scenes with drag reordering, server-side numbering and optimistic concurrency.
- "Improve for me" and "Make a thumbnail" behind a proposal/accept lifecycle with daily
  limits and an independent content review; the teen account is always on the child policy.
- Logical delete with a bin and "put back" for cartoons and scenes.
- Single image serving the API and the web app from one origin.
- Two least-privilege database roles; migrations applied at container start.
- `npm run release`: test, build, back up, ship over SSH, verify the live build.
- `pg_dump` backups before every release and nightly on the NAS.
