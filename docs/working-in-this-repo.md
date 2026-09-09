# Working in this repo

Read [build-plan-v1.1.md](build-plan-v1.1.md) first. Decisions D1–D18 there override the original
spec wherever they disagree, and several are deliberate deviations rather than oversights.
[architecture.md](architecture.md) records the current shape, a review, and the target design.

## The rules that matter most

**The audience is a 10–15 year old.** Every user-facing string is written for them. Film vocabulary
goes in `friendlyLabel`, never in the interface directly. Error messages say what to do next, not
what went wrong internally.

**Never hard-code a prompt phrase.** `packages/vocabularies/vocabularies.json` is the single
authority (CV-1). The compiler, API validators, DB enums and UI pickers all read from it. Editing a
`value` or `prompt_phrase` is a spec change; editing a `label`, `friendlyLabel`, `help` or `icon` is
free. `npm test -w @storyboard/vocabularies` enforces this and fails the release.

**The prompt compiler must stay pure** (Phase 2, PC-1). No clock, no locale, no randomness, no I/O,
no framework or DB imports. Same inputs, byte-identical output, in Node and in the browser.

**The server is the sole compilation authority.** The client compiles only for live preview and
never sends a compiled prompt back. This deliberately replaces PC-2b's client/server equality
assertion, which would 409 on every save for anyone holding a stale JS bundle after a deploy.

**AI never writes to a domain record directly** (§6.5, AI-1). Every operation produces an
`AiProposal` that the user accepts. Scene thumbnails and "Improve for me" implement the
field-scope lifecycle; the broader writing operations are still planned. The model API key
lives only in the API environment.

**`account_id` on every table, checked on every query** (NF-13). Never trust a client-supplied
account id. Cross-account access returns 404, not 403; a 403 confirms the record exists.

**Nothing the user makes is hard-deleted.** `DELETE /projects/:id` and `DELETE /scenes/:id` set
`deleted_at`; every read filters it out (`isNull(projects.deletedAt)` on project queries,
`sceneIsLive` from `routes/scenes.ts` on scene-by-id lookups, which also checks the parent
cartoon). `POST /projects/:id/restore` and `POST /scenes/:id/restore` put them back, the latter
at the end of the board; `?deleted=true` on either list shows the bin. Numbering, counts and
"next slot" queries must exclude deleted rows. Any new route that loads a scene or project
by id must apply the same filter.

## Gotchas discovered the hard way

**Node runs the API from TypeScript source** (`node src/server.ts`), using strip-only type removal.
That means **no TypeScript parameter properties** (`constructor(private readonly x: T)`), no `enum`,
no `namespace`, and no decorators. Write fields out longhand; see `apps/api/src/errors.ts`.
Imports must carry explicit `.ts` extensions.

**Shell heredocs mangle backslashes.** Writing regexes or Bicep interpolation through a heredoc
has corrupted files here more than once. Write such files with an editor or a script that
reads from a file, never through an inline heredoc.

**Local Postgres runs on :5433**, not 5432, so it never collides with a local install. The NAS
database is on :5400.

**Never build a PATCH schema with `createBody.partial()`.** Zod's `.partial()` makes keys
optional but does NOT strip `.default()`, so a PATCH of one field parses into an object holding
every other defaulted field as `''`, and the handler writes those blanks over the user's work.
Saving one scene field silently erased all the others. Write update schemas out explicitly with
`.optional()` and no defaults, so an absent key stays absent. See `src/routes/scenes.ts`.

**Drizzle renders interpolated columns UNQUALIFIED inside a raw subquery.** Writing
``sql`SELECT COUNT(*) FROM ${schema.scenes} WHERE ${schema.scenes.projectId} = ${schema.projects.id}` ``
produces `WHERE "project_id" = "id"`, where `"id"` binds to the *inner* table. It returns 0
rather than erroring, so it looks like real data. Write table and column names out longhand in
correlated subqueries; see the counts in `src/routes/projects.ts`.

**Playwright's `dragTo` does not work with dnd-kit.** It issues one mouse move, and the
sensors deliberately ignore that (a 6px distance constraint for pointer, a 180ms hold for
touch) so a click or a scroll is never mistaken for a drag. To exercise drag in a browser,
dispatch real `PointerEvent`s with a dozen intermediate `pointermove`s. Automated drag is
still not proof it feels right; check reordering on an actual tablet.

**API tests share the development database** but create disposable test accounts and delete only
those exact account IDs in the `after` hook. Never clean up by timestamp or by a real user's account.
Thumbnail tests inject a controlled provider; they must never call the model with a real key.

**Production serves the web app from the API.** When `WEB_ROOT` is set (the Docker image sets
it), `@fastify/static` serves `apps/web/dist` and the not-found handler falls back to
`index.html` for GET requests outside `/api`. API 404s stay `problem+json`. Unset in dev, where
Vite proxies `/api`. The NAS deployment lives in `deploy/synology/`; the image is built from the
root `Dockerfile` and runs migrations on start.

**`crypto.randomUUID()` does not exist on plain-http LAN addresses.** Browsers only expose it in
secure contexts (https or localhost). The NAS deployment is `http://192.168.1.73`, where it is
`undefined` and any call throws, surfacing as the generic "Something went wrong" box. Use
`apps/web/src/uuid.ts`, which falls back to `getRandomValues`. Testing on `localhost` will never
catch this; test on the machine's LAN IP.

**Container Manager is Docker, with two quirks.** Its engine lives at `/usr/local/bin/docker`,
which is not on PATH in a non-interactive SSH session, and it stores a project's file as
`compose.yaml` under the project name chosen in the DSM UI, not the folder name. DSM's sshd has
no SFTP unless enabled, so `scp` fails; `deploy/release.mjs` uploads through plain SSH.

## Conventions

- API is `snake_case` on the wire, `camelCase` in TypeScript. Presenter functions do the mapping.
- All errors are RFC 7807 `application/problem+json` with a stable `type`; see `src/errors.ts`.
- Scene and Shot writes use `If-Match: <version>`; a stale write is a 409 carrying `current_state`
  so the client can diff per field without a second round trip (NF-10, NF-10b).
- Migrations: edit `src/db/schema.ts`, then `npx drizzle-kit generate --name <what-changed>`.
  Never hand-edit a generated migration. The container applies pending migrations on start.
- Secrets never enter the repository: `.env` files, `release.env`, dumps and image tarballs are
  all ignored. Rotate anything that is ever pasted into a chat or a ticket.

## Validate at runtime, not just at compile time

A phase is not done because it typechecks. Start the app, hit the endpoints, drive the UI in a
browser at 1024×768 on the machine's LAN IP, and confirm response shapes. For anything touching
drag-and-drop, test on a real tablet; a desktop browser's device emulator does not reproduce
touch behaviour. `npm run release` refuses to ship if the tests fail and refuses to report
success until the NAS serves the new build.
