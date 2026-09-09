# Changelog

One heading per released version, newest first. The version is the root `package.json`
version; bump it with `npm version <patch|minor|major>` (which also commits and tags), push
with `git push --follow-tags`, then `npm run release`. Written for the maintainer, not the
teen; the app itself explains changes in its own words.

## Unreleased

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
