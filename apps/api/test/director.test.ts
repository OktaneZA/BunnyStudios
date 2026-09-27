/**
 * Director Mode end to end against a real Postgres, with a fake provider, an in-memory
 * object store, a fake reviewer and a fake cast finder. Nothing here touches the network.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.ts';
import { db, sql, schema } from '../src/db/client.ts';
import { createFakeProvider, FAKE_IMAGE_MODEL, FAKE_VIDEO_MODEL, FAKE_VIDEO_HIGH_MODEL, FAKE_I2V_MODEL } from '../src/generation/fake.ts';
import { createMemoryStore } from '../src/storage/objectStore.ts';
import type { ReviewProvider } from '../src/generation/review.ts';
import type { CastFinder } from '../src/cast/finder.ts';
import { ffmpegAvailable, makeTestClip } from '../src/generation/media.ts';
import { providerError } from '../src/generation/provider.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/config.ts';
import { TINY_PNG } from '../src/generation/fake.ts';

const ids = [randomUUID(), randomUUID()]; // 0 = teen (minor), 1 = adult
let testVideo: Buffer | null = null;
const provider = createFakeProvider({ bytesFor: (file) => (file.mimeType.startsWith('video/') ? testVideo ?? Buffer.alloc(0) : TINY_PNG) });
const store = createMemoryStore();
let rejectPromptsContaining = '';
let rejectEveryImage = false;
let reviewCalls: string[] = [];
const review: ReviewProvider = {
  enabled: true, model: 'fake-review',
  async reviewPrompt(text) { reviewCalls.push('prompt'); return rejectPromptsContaining && text.includes(rejectPromptsContaining) ? { allowed: false, reason: 'too scary' } : { allowed: true, reason: '' }; },
  async reviewImage() { reviewCalls.push('image'); return rejectEveryImage ? { allowed: false, reason: 'not for children' } : { allowed: true, reason: '' }; },
};
let found = [{ name: 'Timmy', description: 'a skinny stick boy with a big round head', scene_numbers: [1, 2] }, { name: 'Sister', description: 'a girl with a red bow', scene_numbers: [2] }];
const finder: CastFinder = { enabled: true, model: 'fake-finder', async find() { return { characters: found, inputTokens: 10, outputTokens: 20 }; } };

const app = await buildApp({ director: { providers: [provider], models: [FAKE_IMAGE_MODEL, FAKE_VIDEO_MODEL, FAKE_VIDEO_HIGH_MODEL, FAKE_I2V_MODEL], store, review, finder, pollMs: 5 } });
const runner = app.director.runner;
const token = (n = 0) => ({ authorization: `Bearer ${app.jwt.sign({ sub: ids[n] })}` });
let projectId: string;
let sceneIds: string[];

before(async () => {
  if (await ffmpegAvailable()) {
    // A real one-second SILENT clip (like Wan's) so poster extraction, review and the render's
    // silent-track path all run for real.
    const dir = await mkdtemp(join(tmpdir(), 'clip-'));
    const out = join(dir, 'clip.mp4');
    await promisify(execFile)(config.FFMPEG_PATH, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1:r=25', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', out]);
    testVideo = await readFile(out);
    await rm(dir, { recursive: true, force: true });
  }
  await db.insert(schema.accounts).values(ids.map((id, i) => ({ id, email: `director-test-${id}@example.com`, displayName: i ? 'Adult' : 'Teen', isMinor: i === 0, defaultEditorMode: i ? 'advanced' as const : 'simple' as const, dailyBudgetPence: 1000, monthlyBudgetPence: 10_000 })));
});
beforeEach(async () => {
  rejectPromptsContaining = ''; rejectEveryImage = false; reviewCalls = []; provider.submitted.length = 0;
  const project = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: token(), payload: { title: 'Sunny Beach Catch', target_audience: 'kids_6_11' } });
  assert.equal(project.statusCode, 201); projectId = project.json().id;
  sceneIds = [];
  for (const [title, description] of [['Timmy finds the ball', 'Timmy, a skinny stick boy with a big round head, spots a red beach ball on the sand.'], ['Sister wants a go', 'Sister runs up and asks Timmy for a turn with the ball.']]) {
    const scene = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/scenes`, headers: token(), payload: { title, description, camera_angle: 'eye_level', time_of_day: 'morning', mood_atmosphere: 'whimsical' } });
    assert.equal(scene.statusCode, 201); sceneIds.push(scene.json().id);
  }
});
after(async () => {
  await app.close();
  await db.delete(schema.accounts).where(inArray(schema.accounts.id, ids));
  await sql.end();
});

async function shotFor(sceneId: string, account = 0) {
  const r = await app.inject({ method: 'GET', url: `/api/v1/scenes/${sceneId}/shots`, headers: token(account) });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().data[0];
}
async function startJob(shotId: string, payload: Record<string, unknown>, account = 0, key = randomUUID()) {
  const r = await app.inject({ method: 'POST', url: `/api/v1/shots/${shotId}/jobs`, headers: { ...token(account), 'idempotency-key': key }, payload });
  return r;
}
async function job(id: string, account = 0) {
  const r = await app.inject({ method: 'GET', url: `/api/v1/jobs/${id}`, headers: token(account) });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function ledger(jobId: string) {
  return db.select().from(schema.generationLedger).where(eq(schema.generationLedger.jobId, jobId));
}

test('a joined clip resumes after a transient second-part failure without buying the first part again', async (t) => {
  if (!(await ffmpegAvailable())) { t.skip('requires ffmpeg'); return; }
  const originalSubmit = provider.submit;
  const originalDownload = provider.download;
  let attempts = 0;
  provider.submit = async (...args) => {
    if (++attempts === 2) throw providerError('unavailable', 'Temporary test failure', true);
    return originalSubmit(...args);
  };
  provider.download = async (file) => (await makeTestClip((file.durationMs ?? 5000) / 1000))!;
  try {
    const shot = await shotFor(sceneIds[0]!);
    const started = await startJob(shot.id, { kind: 'video', model_id: 'clip_low', duration_seconds: 15 });
    assert.equal(started.statusCode, 202, started.body);
    await runner.drain();
    const done = await job(started.json().id);
    assert.equal(done.status, 'ready', JSON.stringify(done));
    assert.deepEqual(provider.submitted.map((request) => request.durationSeconds), [10, 5]);
    assert.equal(done.results.length, 1);
    assert.ok(Math.abs(done.results[0].duration_ms - 15000) < 100);
    const [bill] = await ledger(done.id);
    assert.equal(bill!.estimatedPence, 30);
    assert.equal(bill!.status, 'settled');
    assert.equal(reviewCalls.filter((call) => call === 'image').length, 4);
  } finally { provider.submit = originalSubmit; provider.download = originalDownload; }
});

test('settings list the enabled models, the allowance and plain words', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/v1/settings/generation', headers: token() });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.enabled, true);
  assert.deepEqual(body.models.map((m: { id: string }) => m.id), ['quick_picture', 'clip_low', 'clip_high', 'move_maker']);
  const tiers = (await app.inject({ method: 'GET', url: '/api/v1/models/tiers', headers: token() })).json().data;
  assert.deepEqual(tiers.map((m: { tier: string; id: string }) => [m.tier, m.id]), [['low', 'clip_low'], ['high', 'clip_high']], 'one clip maker per cost level, in order');
  assert.equal(body.models[0].label, null, 'the teen never sees the real model name');
  assert.match(body.allowance_words, /about \d+ more pictures/);
  const adult = (await app.inject({ method: 'GET', url: '/api/v1/settings/generation', headers: token(1) })).json();
  assert.equal(adult.models[0].label, 'Fake image');
});

test('a scene gets one shot with a compiled prompt made from the story (D34, DM-11)', async () => {
  const shot = await shotFor(sceneIds[0]!);
  assert.match(shot.compiled_prompt, /spots a red beach ball/);
  assert.match(shot.compiled_prompt, /eye level/);
  assert.match(shot.compiled_negative_prompt, /watermark/);
  const again = await shotFor(sceneIds[0]!);
  assert.equal(again.id, shot.id, 'the same shot is reused, never duplicated');
  const patched = await app.inject({ method: 'PATCH', url: `/api/v1/shots/${shot.id}`, headers: { ...token(), 'if-match': String(shot.version) }, payload: { user_prompt_addendum: 'Make the ball enormous' } });
  assert.equal(patched.statusCode, 200, patched.body);
  assert.match(patched.json().compiled_prompt, /Make the ball enormous\.$/);
});

test('make a picture: job runs through the queue, takes are stored and reviewed, money is settled (DM-14, DM-16, DM-25)', async () => {
  const shot = await shotFor(sceneIds[0]!);
  const key = randomUUID();
  const started = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture', count: 2 }, 0, key);
  assert.equal(started.statusCode, 202, started.body);
  const id = started.json().id;
  assert.equal(started.json().step, 'Waiting');
  const again = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture', count: 2 }, 0, key);
  assert.equal(again.statusCode, 200, 'a retried request key returns the same job');
  assert.equal(again.json().id, id);
  await runner.drain();
  const done = await job(id);
  assert.equal(done.status, 'ready', JSON.stringify(done));
  assert.equal(done.results.length, 2);
  assert.equal(done.results[0].review_status, 'allowed');
  assert.ok(store.objects.size >= 2, 'bytes landed in the object store');
  assert.deepEqual(reviewCalls.filter((c) => c === 'prompt').length, 1, 'gate 1 ran once');
  assert.equal(reviewCalls.filter((c) => c === 'image').length, 2, 'gate 3 ran per picture');
  const rows = await ledger(id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, 'settled');
  assert.equal(rows[0]!.estimatedPence, 10);
  assert.equal(provider.submitted.at(-1)?.strictSafety, true, 'the teen account asks for strict provider safety');
  const file = await app.inject({ method: 'GET', url: done.results[0].url.replace('/api/v1', '/api/v1'), headers: token() });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'image/png');
  const after = await shotFor(sceneIds[0]!);
  assert.equal(after.generated_asset_ids.length, 2);
});

test('the hero pick is the accept; the media bin lists takes; the timeline picks it up (D35, DM-15, DM-21)', async () => {
  const shot = await shotFor(sceneIds[0]!);
  const started = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture' });
  await runner.drain();
  const done = await job(started.json().id);
  const pick = await app.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/hero`, headers: token(), payload: { asset_id: done.results[0].id } });
  assert.equal(pick.statusCode, 200, pick.body);
  assert.equal(pick.json().hero_asset_id, done.results[0].id);
  const media = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/media?scene_id=${sceneIds[0]}`, headers: token() });
  assert.equal(media.json().data.length, 1);
  const timeline = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/timeline`, headers: token() });
  assert.equal(timeline.statusCode, 200, timeline.body);
  const t = timeline.json();
  assert.equal(t.items.length, 2);
  assert.equal(t.items[0].source, 'picture');
  assert.equal(t.items[0].duration_ms, 5000);
  assert.equal(t.items[1].source, 'empty');
  assert.equal(t.total_ms, 5000);
  assert.equal(t.items[0].transition_out, 'fade');
  const all = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/timeline/transitions`, headers: token(), payload: { transition_out: 'slide' } });
  assert.equal(all.json().items[0].transition_out, 'slide');
  const one = await app.inject({ method: 'PATCH', url: `/api/v1/timeline-items/${t.items[1].id}`, headers: token(), payload: { transition_out: 'cut' } });
  assert.equal(one.json().items[1].transition_out, 'cut');
});

test('a clip is made straight from the scene and drops into the story order by itself (DM-18, D35)', async () => {
  const shot = await shotFor(sceneIds[0]!);
  const badDuration = await startJob(shot.id, { kind: 'video', model_id: 'clip_low', duration_seconds: 7 });
  assert.equal(badDuration.statusCode, 422);
  const clip = await startJob(shot.id, { kind: 'video', model_id: 'clip_high', duration_seconds: 6, audio: true });
  assert.equal(clip.statusCode, 202, clip.body);
  await runner.drain();
  const done = await job(clip.json().id);
  const request = provider.submitted.at(-1)!;
  assert.equal(request.model.kind, 'video');
  assert.equal(request.startFrame, null, 'text to video: no picture needed');
  assert.equal(request.durationSeconds, 6);
  assert.equal(request.audio, true);
  assert.match(request.prompt, /spots a red beach ball/);
  const [row] = await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, clip.json().id));
  assert.equal(row!.status, 'ready', row!.errorDetail ?? '');
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, row!.resultAssetIds[0]!));
  assert.equal(asset!.mimeType, 'video/mp4');
  if (testVideo) {
    assert.ok(asset!.durationMs && asset!.durationMs >= 900 && asset!.durationMs <= 1200, `probed duration ${asset!.durationMs}`);
    assert.ok(asset!.posterAssetId, 'a poster frame was extracted');
    assert.equal(done.results.length, 1);
    assert.ok(reviewCalls.filter((c) => c === 'image').length >= 2, 'poster frames were reviewed');
    const after = await shotFor(sceneIds[0]!);
    assert.equal(after.hero_video_asset_id, asset!.id, 'the finished clip is in the cartoon without a tap');
    const timeline = (await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/timeline`, headers: token() })).json();
    assert.equal(timeline.items[0].source, 'video');
    assert.equal(timeline.items[0].asset.id, asset!.id);
    // A second clip does not replace the one already in the cartoon; the child picks.
    const again = await startJob(shot.id, { kind: 'video', model_id: 'clip_low', duration_seconds: 5 });
    await runner.drain();
    const second = await job(again.json().id);
    assert.equal((await shotFor(sceneIds[0]!)).hero_video_asset_id, asset!.id);
    const pick = await app.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/hero`, headers: token(), payload: { asset_id: second.results[0].id } });
    assert.equal(pick.json().hero_video_asset_id, second.results[0].id);
  } else {
    assert.equal(asset!.durationMs, 6000, 'without ffprobe the requested length stands in');
    assert.equal(asset!.reviewStatus, 'rejected', 'without ffmpeg a clip cannot be checked for a minor, so it is held back');
    assert.equal((await shotFor(sceneIds[0]!)).hero_video_asset_id, null, 'a held-back clip never enters the cartoon');
  }
  const rows = await ledger(clip.json().id);
  assert.equal(rows[0]!.estimatedPence, 120);
});

test('an image-to-video model (Advanced) still needs a picked picture and starts from it', async () => {
  const shot = await shotFor(sceneIds[1]!);
  const noHero = await startJob(shot.id, { kind: 'video', model_id: 'move_maker', duration_seconds: 5 });
  assert.equal(noHero.statusCode, 422);
  assert.match(noHero.json().detail, /needs a picture to start from/);
  const picture = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture' });
  await runner.drain();
  const takes = await job(picture.json().id);
  await app.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/hero`, headers: token(), payload: { asset_id: takes.results[0].id } });
  const clip = await startJob(shot.id, { kind: 'video', model_id: 'move_maker', duration_seconds: 5 });
  assert.equal(clip.statusCode, 202, clip.body);
  await runner.drain();
  assert.ok(provider.submitted.at(-1)!.startFrame, 'the clip starts from the picked picture');
});

test('the daily cap is checked inside the reservation and says when it resets (DM-26)', async () => {
  const spent = (await app.inject({ method: 'GET', url: '/api/v1/settings/generation', headers: token() })).json().allowance.spent_today_pence;
  await db.update(schema.accounts).set({ dailyBudgetPence: spent + 12 }).where(eq(schema.accounts.id, ids[0]!));
  try {
    const shot = await shotFor(sceneIds[0]!);
    const ok = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture', count: 2 });
    assert.equal(ok.statusCode, 202);
    const over = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture', count: 1 });
    assert.equal(over.statusCode, 402, over.body);
    assert.match(over.json().detail, /picture money/);
    assert.ok(over.json().current_state.resets_at);
    await runner.drain();
  } finally {
    await db.update(schema.accounts).set({ dailyBudgetPence: 1000 }).where(eq(schema.accounts.id, ids[0]!));
  }
});

test('gate 1 rejects the wording before any money is spent; gate 3 hides a rejected take from the teen (D32)', async () => {
  rejectPromptsContaining = 'beach ball';
  const shot = await shotFor(sceneIds[0]!);
  const started = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture' });
  await runner.drain();
  const failed = await job(started.json().id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /safety checker/);
  assert.equal(provider.submitted.length, 0, 'nothing was submitted to the provider');
  assert.equal((await ledger(started.json().id))[0]!.status, 'refunded');

  rejectPromptsContaining = ''; rejectEveryImage = true;
  const second = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture' });
  await runner.drain();
  const hidden = await job(second.json().id);
  assert.equal(hidden.status, 'ready');
  assert.equal(hidden.results.length, 0, 'the teen sees no rejected take');
  assert.equal(hidden.held_back, 1);
  const media = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/media`, headers: token() });
  assert.equal(media.json().data.length, 0);
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.generationJobId, second.json().id));
  const file = await app.inject({ method: 'GET', url: `/api/v1/assets/${asset!.id}/file`, headers: token() });
  assert.equal(file.statusCode, 404, 'the bytes are unreachable for the minor');
  const heldBack = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/held-back`, headers: token() });
  assert.equal(heldBack.statusCode, 404, 'the held-back page does not exist for the teen');
});

test('cancel refunds and stops the job', async () => {
  const shot = await shotFor(sceneIds[0]!);
  const started = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture' });
  const cancel = await app.inject({ method: 'POST', url: `/api/v1/jobs/${started.json().id}/cancel`, headers: token() });
  assert.equal(cancel.json().status, 'cancelled');
  await runner.drain();
  assert.equal((await job(started.json().id)).status, 'cancelled');
  assert.equal((await ledger(started.json().id))[0]!.status, 'refunded');
});

test('a provider outage retries and then fails with a refund; a content rejection never retries', async () => {
  const flaky = createFakeProvider({ onSubmit() { throw Object.assign(new Error('The picture maker is busy. Please try again in a minute.'), { name: 'ProviderError', code: 'unavailable', notAccepted: true }); } });
  const app2 = await buildApp({ director: { providers: [flaky], models: [FAKE_IMAGE_MODEL], store, review, finder, pollMs: 5 } });
  try {
    const shot = (await app2.inject({ method: 'GET', url: `/api/v1/scenes/${sceneIds[0]}/shots`, headers: { authorization: `Bearer ${app2.jwt.sign({ sub: ids[0] })}` } })).json().data[0];
    const started = await app2.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/jobs`, headers: { authorization: `Bearer ${app2.jwt.sign({ sub: ids[0] })}`, 'idempotency-key': randomUUID() }, payload: { kind: 'image', model_id: 'quick_picture' } });
    assert.equal(started.statusCode, 202, started.body);
    await app2.director.runner.drain();
    const [row] = await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, started.json().id));
    assert.equal(row!.status, 'failed');
    assert.equal(row!.attempt, 3, 'three attempts, then it gives up');
    assert.match(row!.errorDetail ?? '', /busy/);
    assert.equal((await ledger(started.json().id))[0]!.status, 'refunded');
  } finally {
    await app2.close();
  }
});

test('NF-13: jobs, shots, takes and timelines are not reachable across accounts', async () => {
  const shot = await shotFor(sceneIds[0]!);
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/scenes/${sceneIds[0]}/shots`, headers: token(1) })).statusCode, 404);
  assert.equal((await startJob(shot.id, { kind: 'image', model_id: 'quick_picture' }, 1)).statusCode, 404);
  const started = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture' });
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/jobs/${started.json().id}`, headers: token(1) })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/timeline`, headers: token(1) })).statusCode, 404);
  await runner.drain();
  const done = await job(started.json().id);
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/assets/${done.results[0].id}/file`, headers: token(1) })).statusCode, 404);
});

test('the cast is found from the story, accepted, drawn, and attached to scene pictures (D39, DM-5–DM-8)', async () => {
  const empty = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/cast`, headers: token() });
  assert.equal(empty.json().never_found, true);
  const proposal = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/cast/proposals`, headers: { ...token(), 'idempotency-key': randomUUID() } });
  assert.equal(proposal.statusCode, 201, proposal.body);
  assert.equal(proposal.json().characters.length, 2);
  const accept = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/cast/proposals/${proposal.json().id}/accept`, headers: token(), payload: {} });
  assert.equal(accept.json().status, 'accepted');
  const cast = (await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/cast`, headers: token() })).json();
  assert.deepEqual(cast.data.map((c: { name: string }) => c.name), ['Sister', 'Timmy']);
  const timmy = cast.data.find((c: { name: string }) => c.name === 'Timmy');
  assert.deepEqual(timmy.scene_numbers, [1, 2]);
  assert.equal(cast.story_changed, false);

  // The scene prompt now names Timmy from the cast.
  const shot = await shotFor(sceneIds[0]!);
  assert.match(shot.compiled_prompt, /Timmy: a skinny stick boy/);

  // Draw Timmy → a candidate picture → "This looks like Timmy" approves it as his look.
  const draw = await app.inject({ method: 'POST', url: `/api/v1/characters/${timmy.id}/jobs`, headers: { ...token(), 'idempotency-key': randomUUID() }, payload: { intent: 'portrait', model_id: 'quick_picture' } });
  assert.equal(draw.statusCode, 202, draw.body);
  await runner.drain();
  const drawn = await job(draw.json().id);
  assert.equal(drawn.status, 'ready', JSON.stringify(drawn));
  assert.equal(drawn.results[0].kind, 'character_ref');
  assert.match(provider.submitted.at(-1)!.prompt, /character design sheet/i);
  assert.match(provider.submitted.at(-1)!.prompt, /Timmy: a skinny stick boy/);
  const before = (await app.inject({ method: 'GET', url: `/api/v1/characters/${timmy.id}`, headers: token() })).json();
  assert.equal(before.main_reference, null, 'finishing a picture does not approve it');
  const main = await app.inject({ method: 'POST', url: `/api/v1/characters/${timmy.id}/looks`, headers: { ...token(), 'if-match': String(before.version) }, payload: { main_asset_id: drawn.results[0].id, pictures: [{ asset_id: drawn.results[0].id, role: 'main' }] } });
  assert.equal(main.statusCode, 201, main.body);
  assert.equal(main.json().main_reference.id, drawn.results[0].id);

  // A scene picture now carries Timmy's main picture as a reference, automatically.
  const scenePic = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture' });
  await runner.drain();
  assert.equal(provider.submitted.at(-1)!.referenceImages.length, 1);
  assert.equal((await job(scenePic.json().id)).status, 'ready');

  // Editing the story flags that the cast may have changed.
  const scene = (await app.inject({ method: 'GET', url: `/api/v1/scenes/${sceneIds[1]}`, headers: token() })).json();
  await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneIds[1]}`, headers: { ...token(), 'if-match': String(scene.version) }, payload: { description: 'Sister and Mum arrive with a picnic.' } });
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/cast`, headers: token() })).json().story_changed, true);

  // A stale proposal cannot be accepted once the story moved on.
  const stale = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/cast/proposals`, headers: { ...token(), 'idempotency-key': randomUUID() } });
  await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneIds[1]}`, headers: { ...token(), 'if-match': String(scene.version + 1) }, payload: { description: 'Sister, Mum and Dad arrive.' } });
  const conflict = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/cast/proposals/${stale.json().id}/accept`, headers: token(), payload: {} });
  assert.equal(conflict.statusCode, 409);
});

test('uploaded reference pictures are sniffed, stripped and reviewed (DM-6)', async () => {
  const added = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/cast`, headers: token(), payload: { name: 'Stickman', description: 'a plain black stick figure' } });
  assert.equal(added.statusCode, 201);
  const boundary = 'xxBOUNDARYxx';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.exe"\r\nContent-Type: application/octet-stream\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const upload = await app.inject({ method: 'POST', url: `/api/v1/characters/${added.json().id}/references`, headers: { ...token(), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
  assert.equal(upload.statusCode, 201, upload.body);
  assert.equal(upload.json().asset.mime_type, 'image/png', 'the type comes from the bytes, not the filename');
  const notImage = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from('not a picture at all'), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const rejected = await app.inject({ method: 'POST', url: `/api/v1/characters/${added.json().id}/references`, headers: { ...token(), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: notImage });
  assert.equal(rejected.statusCode, 422);
  const character = (await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/cast`, headers: token() })).json().data.find((c: { name: string }) => c.name === 'Stickman');
  // CS-04: even the first upload is only a candidate until someone says it looks right.
  assert.equal(character.main_reference, null);
  assert.equal(character.look_status, 'none');
  assert.equal(upload.json().source, 'upload');
});

test('make my cartoon: the render job runs, or explains that ffmpeg is missing (DM-23)', async () => {
  const shot = await shotFor(sceneIds[0]!);
  const started = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture' });
  await runner.drain();
  const done = await job(started.json().id);
  await app.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/hero`, headers: token(), payload: { asset_id: done.results[0].id } });
  // A silent clip on scene 2 joins a still on scene 1: both item kinds and the silent-audio path.
  const second = await shotFor(sceneIds[1]!);
  await startJob(second.id, { kind: 'video', model_id: 'clip_low', duration_seconds: 5 });
  await runner.drain();
  const render = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/timeline/render`, headers: { ...token(), 'idempotency-key': randomUUID() } });
  assert.equal(render.statusCode, 202, render.body);
  await runner.drain(60_000);
  const t = (await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/timeline`, headers: token() })).json();
  if (await ffmpegAvailable()) {
    assert.ok(t.render, JSON.stringify(t.render_job));
    assert.equal(t.render.mime_type, 'video/mp4');
    assert.ok(t.render.duration_ms >= 5000);
    if (testVideo) assert.equal(t.items[1].source, 'video', 'the silent clip made it into the render plan');
  } else {
    assert.equal(t.render_job.status, 'failed');
    assert.match(t.render_job.error, /video tools are missing/);
  }
});

test('adults can set the teen budget; the teen cannot see the page', async () => {
  const list = await app.inject({ method: 'GET', url: '/api/v1/accounts', headers: token(1) });
  assert.equal(list.statusCode, 200);
  const set = await app.inject({ method: 'PATCH', url: `/api/v1/accounts/${ids[0]}/budget`, headers: token(1), payload: { daily_budget_pence: 250 } });
  assert.equal(set.json().allowance.daily_budget_pence, 250);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/accounts', headers: token() })).statusCode, 404);
  await db.update(schema.accounts).set({ dailyBudgetPence: 1000 }).where(eq(schema.accounts.id, ids[0]!));
  await db.delete(schema.generationLedger).where(and(eq(schema.generationLedger.accountId, ids[0]!)));
});

test('every job keeps a step trail; the teen sees the current step, the adult sees everything', async () => {
  const shot = await shotFor(sceneIds[0]!);
  const started = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture' });
  await runner.drain();
  const teenView = await job(started.json().id);
  assert.equal(teenView.status, 'ready');
  assert.equal(teenView.progress.say, 'Ready');
  assert.equal(teenView.events, undefined, 'the teen never sees the raw trail');
  const log = await app.inject({ method: 'GET', url: `/api/v1/accounts/${ids[0]}/jobs`, headers: token(1) });
  assert.equal(log.statusCode, 200, log.body);
  const entry = log.json().data.find((j: { id: string }) => j.id === started.json().id);
  const says = entry.events.map((e: { say: string }) => e.say);
  for (const step of ['Started', 'Checking the words', 'Sending your picture to the picture maker', 'Made your picture', 'Fetched your picture', 'Checking your picture is OK', 'Ready']) {
    assert.ok(says.includes(step), `trail has "${step}": ${says.join(' → ')}`);
  }
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/accounts/${ids[0]}/jobs`, headers: token() })).statusCode, 404, 'the clip log is adult-only');
});

test('a job whose server died is picked up within a minute and carries on without paying again', async () => {
  const shot = await shotFor(sceneIds[0]!);
  const started = await startJob(shot.id, { kind: 'image', model_id: 'quick_picture' });
  const id = started.json().id;
  // Pretend another process sent it to the provider, then died without a heartbeat for two minutes.
  const submitted = await provider.submit({ model: FAKE_IMAGE_MODEL, prompt: 'x', negativePrompt: '', referenceImages: [], startFrame: null, aspectRatio: '16:9', count: 1, durationSeconds: null, audio: false, resolution: '1024', strictSafety: true }, AbortSignal.timeout(1000));
  const before = provider.submitted.length;
  await db.update(schema.generationJobs).set({ status: 'submitted', providerJobId: submitted.providerJobId, claimedBy: 'runner-dead', claimedAt: new Date(Date.now() - 120_000), attempt: 1 })
    .where(eq(schema.generationJobs.id, id));
  await runner.drain();
  const done = await job(id, 1 - 1);
  assert.equal(done.status, 'ready');
  assert.equal(provider.submitted.length, before, 'nothing was sent to the provider twice');
  const [row] = await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, id));
  const says = (row!.events as { say: string }[]).map((e) => e.say);
  assert.ok(says.includes('Picked up again'), says.join(' → '));
  assert.ok(says.includes('Carrying on with your picture'), says.join(' → '));
});
