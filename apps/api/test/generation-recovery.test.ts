/**
 * Recovery and money (Character Studio build plan, Stage 1: MG-06–MG-08, MB-01–MB-04).
 * Real Postgres, fake provider, in-memory store. Nothing here touches the network.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.ts';
import { db, sql, schema } from '../src/db/client.ts';
import { createFakeProvider, FAKE_IMAGE_MODEL, FAKE_VIDEO_MODEL } from '../src/generation/fake.ts';
import { createMemoryStore } from '../src/storage/objectStore.ts';
import { providerError, type GenerationProvider } from '../src/generation/provider.ts';
import type { ReviewProvider } from '../src/generation/review.ts';
import type { CastFinder } from '../src/cast/finder.ts';

const ids = [randomUUID(), randomUUID()];
const store = createMemoryStore();
const review: ReviewProvider = { enabled: true, model: 'fake-review', async reviewPrompt() { return { allowed: true, reason: '' }; }, async reviewImage() { return { allowed: true, reason: '' }; } };
const finder: CastFinder = { enabled: false, model: 'none', async find() { throw new Error('unused'); } };

type Hooks = { submit?: GenerationProvider['submit'] | undefined; download?: GenerationProvider['download'] | undefined };
const hooks: Hooks = {};
const base = createFakeProvider({ pollsBeforeDone: 0 });
const provider: GenerationProvider & { submitted: typeof base.submitted } = {
  ...base, submitted: base.submitted,
  submit: (r, s) => (hooks.submit ?? base.submit)(r, s),
  download: (f, s) => (hooks.download ?? base.download)(f, s),
};
const app = await buildApp({ director: { providers: [provider], models: [FAKE_IMAGE_MODEL, FAKE_VIDEO_MODEL], store, review, finder, pollMs: 5 } });
const token = (n = 0) => ({ authorization: `Bearer ${app.jwt.sign({ sub: ids[n] })}` });
let projectId = '';
let shotId = '';

before(async () => {
  await db.insert(schema.accounts).values(ids.map((id, i) => ({ id, email: `recovery-${id}@example.com`, displayName: i ? 'Adult' : 'Teen', isMinor: i === 0, dailyBudgetPence: 1000, monthlyBudgetPence: 10_000 })));
});
beforeEach(async () => {
  hooks.submit = undefined; hooks.download = undefined; base.submitted.length = 0;
  await db.update(schema.accounts).set({ dailyBudgetPence: 1000 }).where(inArray(schema.accounts.id, ids));
  const project = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: token(), payload: { title: 'Recovery', target_audience: 'kids_6_11' } });
  projectId = project.json().id;
  const scene = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/scenes`, headers: token(), payload: { title: 'One', description: 'A rabbit hops across a garden.' } });
  const shots = await app.inject({ method: 'GET', url: `/api/v1/scenes/${scene.json().id}/shots`, headers: token() });
  shotId = shots.json().data[0].id;
});
after(async () => {
  await app.close();
  await db.delete(schema.accounts).where(inArray(schema.accounts.id, ids));
  await sql.end();
});

async function start(payload: Record<string, unknown> = { kind: 'image', model_id: 'quick_picture' }, key = randomUUID()) {
  return app.inject({ method: 'POST', url: `/api/v1/shots/${shotId}/jobs`, headers: { ...token(), 'idempotency-key': key }, payload });
}
const row = async (id: string) => (await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, id)))[0]!;
const ledgerOf = async (id: string) => (await db.select().from(schema.generationLedger).where(eq(schema.generationLedger.jobId, id)))[0]!;

test('MG-07: an ambiguous submit is never retried blind; the estimate stays, marked unknown', async () => {
  hooks.submit = async () => { throw providerError('unavailable', 'no answer'); }; // no notAccepted: it may have been taken
  const started = await start();
  assert.equal(started.statusCode, 202, started.body);
  await app.director.runner.drain();
  const job = await row(started.json().id);
  assert.equal(job.status, 'failed');
  assert.equal(job.errorCode, 'uncertain');
  assert.equal(job.submissionState, 'uncertain');
  assert.equal(job.attempt, 1, 'no automatic second submission');
  assert.match(job.errorDetail!, /grown-up/);
  const l = await ledgerOf(job.id);
  assert.equal(l.status, 'settled');
  assert.equal(l.costState, 'unknown');
});

test('MG-07: a job whose worker died inside the submit call is marked uncertain, not resubmitted', async () => {
  const started = await start();
  await db.update(schema.generationJobs).set({ submissionState: 'submitting' }).where(eq(schema.generationJobs.id, started.json().id));
  await app.director.runner.drain();
  const job = await row(started.json().id);
  assert.equal(job.status, 'failed');
  assert.equal(job.errorCode, 'uncertain');
  assert.equal(base.submitted.length, 0, 'the provider was not called again');
  assert.equal((await ledgerOf(job.id)).costState, 'unknown');
});

test('MG-08: a submit the provider refused is retried, then refunded as not incurred', async () => {
  hooks.submit = async () => { throw providerError('unavailable', 'busy', true); };
  const started = await start();
  await app.director.runner.drain();
  const job = await row(started.json().id);
  assert.equal(job.status, 'failed');
  assert.equal(job.attempt, 3);
  assert.equal(job.submissionState, 'not_submitted');
  const l = await ledgerOf(job.id);
  assert.equal(l.status, 'refunded');
  assert.equal(l.costState, 'not_incurred');
});

test('MG-08: cancelling before submission refunds; cancelling after submission keeps the charge as unknown', async () => {
  const early = await start();
  const cancelled = await app.inject({ method: 'POST', url: `/api/v1/jobs/${early.json().id}/cancel`, headers: token() });
  assert.equal(cancelled.statusCode, 200);
  assert.equal((await ledgerOf(early.json().id)).status, 'refunded');

  // Cancel lands while the result is downloading: after the provider accepted (and billed) it.
  const late = await start();
  hooks.download = async (file, signal) => {
    await app.inject({ method: 'POST', url: `/api/v1/jobs/${late.json().id}/cancel`, headers: token() });
    return base.download(file, signal);
  };
  await app.director.runner.drain();
  const job = await row(late.json().id);
  assert.equal(job.status, 'cancelled', 'a late result never turns a cancelled job into ready');
  assert.deepEqual(job.resultAssetIds, []);
  const l = await ledgerOf(job.id);
  assert.equal(l.status, 'settled');
  assert.equal(l.costState, 'unknown');
});

test('a stale worker cannot finish or refund a job another worker took over', async () => {
  const started = await start();
  hooks.download = async (file, signal) => {
    await db.update(schema.generationJobs).set({ claimedBy: 'someone-else', claimedAt: new Date() }).where(eq(schema.generationJobs.id, started.json().id));
    return base.download(file, signal);
  };
  // Earlier tests may still hold a runner slot, so tick until this job has been through download.
  for (let i = 0; i < 50 && (await row(started.json().id)).claimedBy !== 'someone-else'; i++) {
    await app.director.runner.tick();
    await Promise.allSettled([...app.director.runner.running.values()].map((r) => r.promise));
  }
  const job = await row(started.json().id);
  assert.notEqual(job.status, 'ready');
  assert.equal(job.claimedBy, 'someone-else');
  assert.equal((await ledgerOf(job.id)).status, 'reserved', 'the stale worker touched no money');
  await db.update(schema.generationJobs).set({ status: 'cancelled' }).where(eq(schema.generationJobs.id, job.id));
});

test('a shutdown hands a job back without using up an attempt, and the next runner resumes it without paying twice', async () => {
  const slow = createFakeProvider({ pollsBeforeDone: 1_000_000 });
  const first = await buildApp({ director: { providers: [slow], models: [FAKE_IMAGE_MODEL], store, review, finder, pollMs: 5 } });
  const started = await first.inject({ method: 'POST', url: `/api/v1/shots/${shotId}/jobs`, headers: { authorization: `Bearer ${first.jwt.sign({ sub: ids[0] })}`, 'idempotency-key': randomUUID() }, payload: { kind: 'image', model_id: 'quick_picture' } });
  await first.director.runner.tick();
  for (let i = 0; i < 100 && !(await row(started.json().id)).providerJobId; i++) await new Promise((r) => setTimeout(r, 10));
  await first.close();
  const handedBack = await row(started.json().id);
  assert.equal(handedBack.claimedBy, null);
  assert.equal(handedBack.attempt, 0, 'the shutdown did not count as a try');
  assert.equal(handedBack.submissionState, 'accepted');
  const providerJobId = handedBack.providerJobId!;
  // The job lives on at the provider; the next runner finishes the same request.
  slow.jobs.get(providerJobId)!.polls = 1_000_000;
  const second = await buildApp({ director: { providers: [slow], models: [FAKE_IMAGE_MODEL], store, review, finder, pollMs: 5 } });
  try {
    await second.director.runner.drain();
    const done = await row(started.json().id);
    assert.equal(done.status, 'ready');
    assert.equal(done.providerJobId, providerJobId);
    assert.equal(slow.submitted.length, 1, 'submitted exactly once');
  } finally { await second.close(); }
});

test('MB-01/MB-02: the quote shown is the amount reserved, with its pricing provenance', async () => {
  const quote = await app.inject({ method: 'GET', url: '/api/v1/settings/estimate?model_id=clip_low&duration_seconds=15', headers: token() });
  assert.equal(quote.statusCode, 200);
  const started = await start({ kind: 'video', model_id: 'clip_low', duration_seconds: 15 });
  assert.equal(started.statusCode, 202, started.body);
  const l = await ledgerOf(started.json().id);
  assert.equal(l.estimatedPence, quote.json().pence);
  const snapshot = l.pricingSnapshot as { strategy: string; parts: number[]; estimated_pence: number };
  assert.equal(snapshot.strategy, 'catalogue_unit');
  assert.deepEqual(snapshot.parts, [10, 5]);
  assert.equal(snapshot.estimated_pence, l.estimatedPence);
  await db.update(schema.generationJobs).set({ status: 'cancelled' }).where(eq(schema.generationJobs.id, started.json().id));
});

test('MB-03: concurrent requests cannot overspend the allowance', async () => {
  await db.update(schema.accounts).set({ dailyBudgetPence: 7 }).where(eq(schema.accounts.id, ids[0]!));
  const spentToday = await db.select().from(schema.generationLedger).where(eq(schema.generationLedger.accountId, ids[0]!));
  await db.update(schema.generationLedger).set({ status: 'refunded' }).where(inArray(schema.generationLedger.id, spentToday.map((l) => l.id)));
  const results = await Promise.all([start(), start(), start()]); // 5p each, 7p allowed: only one fits
  const codes = results.map((r) => r.statusCode).sort();
  assert.deepEqual(codes, [202, 402, 402]);
  for (const r of results) if (r.statusCode === 202) await db.update(schema.generationJobs).set({ status: 'cancelled' }).where(eq(schema.generationJobs.id, r.json().id));
});

test('timeline writes check the cartoon is yours and live', async () => {
  const other = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/timeline/transitions`, headers: token(1), payload: { transition_out: 'cut' } });
  assert.equal(other.statusCode, 404);
  const rows = await db.select().from(schema.timelines).where(eq(schema.timelines.projectId, projectId));
  assert.equal(rows.length, 0, 'no timeline row was created for another account');
  await app.inject({ method: 'DELETE', url: `/api/v1/projects/${projectId}`, headers: token() });
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/timeline`, headers: token() })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/timeline/transitions`, headers: token(), payload: { transition_out: 'fade' } })).statusCode, 404);
});
