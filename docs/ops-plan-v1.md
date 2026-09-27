# Control Room — Monitoring, Self-Healing & Model Watch (plan v1.0, draft)

Status: **proposal, not built.** Mockup: see the Control Room artifact linked in the session.

## 1. What we are building

An adult-only **Control Room** and a small **ops agent** that runs beside the app on the NAS.

- **See it** — every request, job and browser error becomes an activity event, grouped by area
  (Write, Make clips, Put it together, Cast, Sign-in, Grown-ups).
- **Spot it** — repeated failures collapse into one **incident** by fingerprint.
- **Fix it** — a fixed playbook of safe remedies runs automatically, with exponential back-off
  and a circuit breaker. When the playbook runs out, the incident goes to GitHub.
- **Improve it** — Claude reads the incidents and the activity, writes a triage note and weekly
  improvement options, and drafts a fix PR for bugs in our own code.
- **Keep models fresh** — a daily watch of fal.ai's catalogue finds new text-to-video and
  text-to-image models, prices them, trial-runs them, and proposes swapping a cost tier.

## 2. Decisions (O1–O12)

| # | Decision | Why |
|---|---|---|
| O1 | **Record actions, never content.** Activity rows hold area, action, outcome, timing, error type, ids. No scene text, prompts, pictures or clip URLs. 90-day retention. | The main user is a minor. The adult already sees the content in the app; the log does not need a second copy. It also keeps GitHub issues clean. |
| O2 | **The ops agent is a second container from the same image** (`node src/ops/agent.ts`). It shares the database and code but not the process. | If the API hangs, the thing watching it must not hang with it. |
| O3 | **The API guards its own liveness.** A watchdog exits the process if the event loop stalls or the DB is unreachable for 2 minutes; Docker's `restart: unless-stopped` brings it back. No Docker socket for the agent. | Mounting the Docker socket is root on the NAS. Exit-and-restart gets the same result safely. |
| O4 | **Self-healing is a fixed playbook, not free-form AI.** Claude may *choose* a playbook action and explain it; it cannot run arbitrary commands, SQL or code. | A mis-read log must never become a destructive action. Mirrors AI-1: AI proposes, rules decide. |
| O5 | **Back-off per incident: 1, 2, 4, 8, 16 min, capped at 1 h.** Three failed remedies within 6 h stop auto-healing, mark the incident *escalated* and raise a GitHub issue. | "If things keep occurring" becomes a number you can see in the console. |
| O6 | **Safety gates are never healed open.** If the Claude reviewer is down, teen generation stays paused (D32) and the incident says so. The playbook has no action that bypasses review, budget or account checks. | Fail-closed is a promise to the parent; self-healing must not quietly break it. |
| O7 | **One GitHub issue per fingerprint**, labelled `incident` + area. Recurrences add a comment with the new count, not a new issue. Posted through a fine-grained token with *Issues: write* only. | The repo stays readable; the token cannot push code. |
| O8 | **Bug → draft PR, never auto-merge.** An issue labelled `ai-fix` (by the agent for code bugs with a stack trace in our files, or by you) triggers a GitHub Action running Claude Code, which opens a **draft** PR that must pass CI. You merge. | An automated change going live unreviewed in a kids' app is the one failure we cannot undo quietly. |
| O9 | **Models: auto-trial, one-click approve.** New fal models are priced, trialled on 3 fixed test scenes through the real review gates (from a separate ops budget, capped at $2/day), then proposed per tier. Approving writes a runtime override; no redeploy. | fal models differ in input schemas (we hit this with Wan resolution and Veo durations); a trial catches that before a child sees a failure. |
| O10 | **Automatic rollback of a swapped model.** If a newly approved model's failure rate in its first 20 jobs goes above 25 %, the tier reverts to the previous model and an incident is opened. | Makes approving cheap to undo. |
| O11 | **Runtime catalogue = models.json + DB overrides.** `models.json` stays the validated baseline; a `model_overrides` table adds models and re-points tiers. The picker and runner read the merged view. | Keeps CV-1-style single authority while allowing dynamic swaps. |
| O12 | **AI spend is capped.** Triage runs once per new fingerprint and on escalation; the improvement digest runs daily. `OPS_AI_DAILY_LIMIT` (default 40 calls). | Monitoring must not become the biggest bill. |

## 3. Requirements

### 3.1 Capture (in the API)
- **OPS-1** A Fastify `onResponse` hook writes one `activity_events` row per API call: account, area
  (from a route → area map), action (route id), status, duration, error `type`, request id.
- **OPS-2** The job runner writes an event on every job end (made / failed / refunded / held back),
  with model id, tier, seconds, cost and the error code.
- **OPS-3** The web app reports uncaught errors and error-boundary catches to
  `POST /api/ops/client-errors` (message, top stack frames, route, build tag; no page content).
- **OPS-4** Each failure gets a **fingerprint**: error type + route/job kind + first stack frame in
  our code, with ids, numbers and quoted strings stripped. Same bug → same fingerprint.
- **OPS-5** Writes are fire-and-forget through a bounded in-memory queue flushed every 2 s; a full
  queue drops events and counts the drops. Monitoring must never slow down or fail a request.

### 3.2 Incidents and healing (in the ops agent)
- **OPS-6** Every 30 s the agent groups new failures into incidents (open → healing → resolved /
  escalated), keeping count, first/last seen, areas and accounts affected.
- **OPS-7** Playbook v1:
  | Signal | Remedy |
  |---|---|
  | A model fails ≥ 3 of its last 5 jobs | Circuit-break it for the back-off period; its tier uses the next model in the tier |
  | Job silent past the claim timeout | Re-queue (already in the runner; the agent confirms and records it) |
  | fal 429 / 5xx burst | Pause new submits to fal for the back-off period |
  | Claude reviewer failing | Pause generation for the teen account, show "Clips are taking a break" (fail closed) |
  | Storage volume > 90 % | Remove temp/partial files older than 24 h; escalate if still > 90 % |
  | `/health` failing 3 times | Record it; the API watchdog restarts itself (O3) |
- **OPS-8** Each remedy records what it did, when, and the next allowed attempt (back-off, O5).
- **OPS-9** Resolved = no new occurrence for 30 min after a remedy. Escalated = O5 limit reached.

### 3.3 AI triage and improvement
- **OPS-10** On a new fingerprint or an escalation, Claude receives the fingerprint, scrubbed
  stack, recent counts and the playbook, and returns structured output: severity, likely cause,
  area, "bug in our code?" yes/no, suggested playbook action (from the list only), issue text.
- **OPS-11** A daily digest proposes improvement options from the numbers, for example "Kling fails
  30 % of 10 s clips — default High to 5 s", each with *Make an issue* and *Dismiss*.

### 3.4 GitHub
- **OPS-12** Escalated incidents create or update one issue per fingerprint (O7); the incident links to it.
- **OPS-13** `.github/workflows/ai-fix.yml`: on `issues: labeled ai-fix`, run Claude Code with the
  issue body, CLAUDE.md and the failing area; open a draft PR `ai-fix/<issue>`; CI runs as normal.
- **OPS-14** Issue bodies pass through the scrubber: no emails, tokens, URLs with query strings,
  scene text or prompts. A test asserts a seeded secret never reaches the body.

### 3.5 Model watch
- **OPS-15** Daily: `GET api.fal.ai/v1/models?category=text-to-video` and `text-to-image`, diffed
  against the merged catalogue. New, active, commercially licensed models become candidates.
- **OPS-16** Price each candidate (`/v1/models/pricing`), estimate cost per 5 s clip, and place it
  against Low / Medium / High by cost and Claude's reading of its description.
- **OPS-17** Trial: 3 fixed test scenes, real review gates, ops budget; record success, time, cost
  and the reviewer's verdict. Proposals show old vs new side by side with the trial clips.
- **OPS-18** Approve → `model_overrides` row; Reject → never proposed again for that tier.
  Rollback per O10.

### 3.6 Control Room (adult-only, `/control-room`)
- **Overview**: health, requests/min, errors, clips made/failed, spend today, open incidents.
- **Activity**: timeline filterable by person, area and outcome.
- **Areas**: one card per area with traffic, failure rate, slowest step and trend.
- **Incidents**: list with status, count, back-off timer, remedy history, GitHub issue/PR links,
  *Retry remedy now*, *Resolve*, *Send to GitHub*.
- **Models**: current model per tier, candidates, trial results, *Approve* / *Reject* / *Roll back*.
- **Improvements**: the AI's daily options.
- The teen account gets 404 on every `/ops` route (same rule as the clip log).

## 4. Data model
- `activity_events` (id, account_id, at, area, action, outcome, status, duration_ms, error_type,
  fingerprint, request_id, job_id, meta jsonb) — indexed on (at), (fingerprint, at), (area, at).
- `incidents` (id, fingerprint unique, title, area, severity, status, count, first_seen,
  last_seen, affected_accounts, triage jsonb, github_issue, github_pr, next_attempt_at, attempts).
- `incident_actions` (id, incident_id, at, action, result, detail).
- `model_candidates`, `model_trials`, `model_overrides`.
- `ops_suggestions` (id, day, area, text, evidence jsonb, status).

## 5. New configuration
`OPS_AGENT=on|off`, `OPS_GITHUB_TOKEN` (fine-grained, Issues: write on BunnyStudios only),
`OPS_GITHUB_REPO=OktaneZA/BunnyStudios`, `OPS_AI_DAILY_LIMIT=40`, `OPS_TRIAL_DAILY_USD=2`,
`OPS_RETENTION_DAYS=90`. GitHub repo secret `ANTHROPIC_API_KEY` for the ai-fix workflow.

## 6. Build sequence
1. **Observe** — tables, capture hook, runner events, client errors, fingerprints, Control Room
   Overview / Activity / Areas / Incidents (read-only). No AI, no GitHub.
2. **Heal** — ops agent container, playbook, back-off, circuit breaker, API watchdog, GitHub issues.
3. **Think** — Claude triage, daily improvements, `ai-fix` workflow producing draft PRs.
4. **Models** — fal watch, pricing, trials, approve / rollback, runtime catalogue.

Each stage ships on its own and is tested against the fake provider; no test reaches fal, Claude
or GitHub.

## 7. Risks
- **Noise** → fingerprints plus one issue per fingerprint; AI triage only on new fingerprints.
- **Healing loops** → back-off, attempt cap, escalation (O5); every action is logged and visible.
- **A child's data leaving the NAS** → O1 plus the scrubber and its test (OPS-14); the repo is private.
- **A bad model swap** → trial first, one-click approve, automatic rollback (O9, O10).
- **An AI PR that looks right but isn't** → draft only, CI, human merge (O8).
