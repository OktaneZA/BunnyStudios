/**
 * Video optimisation (docs/video-optimisation-plan.md): one look per cartoon, the same characters
 * in every scene, the video template, and the real catalogue's payloads. Real Postgres, fake
 * provider, in-memory store, fake reviewer. Nothing reaches fal or Claude.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { ALL_MODELS, type GenerationModel } from '@storyboard/models';
import { ART_STYLE, CAMERA_MOVEMENT, VIDEO_DIRECTION } from '@storyboard/vocabularies';
import { buildApp } from '../src/app.ts';
import { db, sql, schema } from '../src/db/client.ts';
import { createFakeProvider, FAKE_IMAGE_MODEL, FAKE_VIDEO_MODEL } from '../src/generation/fake.ts';
import { createMemoryStore } from '../src/storage/objectStore.ts';
import { shapeRequest, type GenerationRequest } from '../src/generation/provider.ts';
import type { ReviewProvider } from '../src/generation/review.ts';
import type { CastFinder } from '../src/cast/finder.ts';
import type { JobRequest } from '../src/jobs/runner.ts';

/** A reference endpoint shaped like Seedance's: @Image tokens, no negative field. */
const FAKE_REFS: GenerationModel = {
  id: 'seedance_25_refs', provider: 'fake', provider_model: 'fake/refs', kind: 'video', tier: 'high', label: 'Fake refs', friendlyLabel: 'Cast pictures', help: '', icon: 'model-video',
  capabilities: { reference_images: true, requires_reference_images: true, start_frame: false, end_frame: false, audio: true, multi_shot: false, image_to_video: false, text_to_video: false },
  aspect_ratios: ['16:9', '9:16'], resolutions: ['720p'], duration_seconds: { min: 4, max: 15, step: 1 }, max_reference_images: 6, max_prompt_length: 2000,
  unit: 'second', unit_cost_pence: 3, request_shape: { prompt: 'prompt', reference_images: 'image_urls', reference_token_prefix: '@Image', duration: 'duration', duration_format: 'string_seconds' },
  result_shape: { files: 'video' }, enabled: true, video: { family: 'fake_refs', categories: ['recommended', 'references'], documentation: 'test' },
};

const ids = [randomUUID(), randomUUID(), randomUUID()]; // 0 = teen (minor), 1 = adult, 2 = another family
const provider = createFakeProvider();
const review: ReviewProvider = {
  enabled: true, model: 'fake-review',
  async reviewPrompt() { return { allowed: true, reason: '' }; },
  async reviewImage() { return { allowed: true, reason: '' }; },
};
const finder: CastFinder = { enabled: true, model: 'fake', async find() { return { characters: [], inputTokens: 1, outputTokens: 1 }; } };
const app = await buildApp({ director: { providers: [provider], models: [FAKE_IMAGE_MODEL, FAKE_VIDEO_MODEL, FAKE_REFS], store: createMemoryStore(), review, finder, pollMs: 5 } });
const runner = app.director.runner;
const token = (n = 0) => ({ authorization: `Bearer ${app.jwt.sign({ sub: ids[n] })}` });
const phrase = (list: readonly { value: string; prompt_phrase: string }[], value: string) => list.find((o) => o.value === value)!.prompt_phrase;
let projectId = '';
let sceneIds: string[] = [];

before(async () => {
  await db.insert(schema.accounts).values(ids.map((id, i) => ({ id, email: `continuity-${id}@example.com`, displayName: `Account ${i}`, isMinor: i === 0, defaultEditorMode: i === 1 ? 'advanced' as const : 'simple' as const, dailyBudgetPence: 5000, monthlyBudgetPence: 50_000 })));
});
beforeEach(async () => {
  provider.submitted.length = 0;
  const project = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: token(), payload: { title: 'Pond Party', target_audience: 'kids_6_11' } });
  projectId = project.json().id;
  sceneIds = [];
  for (const description of ['Bunny hops onto the log.', 'Bunny waves at the frog.', 'Bunny falls in the pond.']) {
    const scene = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/scenes`, headers: token(), payload: { title: 'Scene', description } });
    sceneIds.push(scene.json().id);
  }
});
after(async () => {
  await app.close();
  await db.delete(schema.accounts).where(inArray(schema.accounts.id, ids));
  await sql.end();
});

// ── helpers ────────────────────────────────────────────────────────────────
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown, headers: Record<string, string> = {}, n = 0) {
  return app.inject({ method, url: `/api/v1${url}`, headers: { ...token(n), ...headers }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
}
const get = async (url: string, n = 0) => { const r = await call('GET', url, undefined, {}, n); assert.equal(r.statusCode, 200, r.body); return r.json(); };
const shotOf = async (i: number) => (await get(`/scenes/${sceneIds[i]}/shots`)).data[0];
async function patchScene(i: number, payload: Record<string, unknown>) {
  const scene = await get(`/scenes/${sceneIds[i]}`);
  const r = await call('PATCH', `/scenes/${sceneIds[i]}`, payload, { 'if-match': String(scene.version) });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
/** A character in every scene, with an approved look made of one generated picture. */
async function bunnyWithLook() {
  const created = await call('POST', `/projects/${projectId}/cast`, { name: 'Bunny', description: 'a small white rabbit' });
  assert.equal(created.statusCode, 201, created.body);
  const bunny = created.json();
  await db.update(schema.characters).set({ foundInSceneIds: sceneIds }).where(eq(schema.characters.id, bunny.id));
  return { id: bunny.id as string, look: await newLook(bunny.id) };
}
async function newLook(characterId: string) {
  const drawn = await call('POST', `/characters/${characterId}/jobs`, { intent: 'portrait', count: 1 }, { 'idempotency-key': randomUUID() });
  assert.equal(drawn.statusCode, 202, drawn.body);
  await runner.drain();
  const job = await get(`/jobs/${drawn.json().id}`);
  const character = await get(`/characters/${characterId}`);
  const approved = await call('POST', `/characters/${characterId}/looks`, { main_asset_id: job.results[0].id, pictures: [{ asset_id: job.results[0].id, role: 'main' }] }, { 'if-match': String(character.version) });
  assert.equal(approved.statusCode, 201, approved.body);
  return approved.json().look.id as string;
}
async function makeClip(i: number, payload: Record<string, unknown>) {
  const shot = await shotOf(i);
  const r = await call('POST', `/shots/${shot.id}/videos`, payload, { 'idempotency-key': randomUUID() });
  assert.equal(r.statusCode, 202, r.body);
  await runner.drain();
  return r.json();
}
/**
 * "Use this clip": put the clip in the cartoon. The fake clip has no real video for the teen's
 * safety check to look at, so it is held back (fail closed); the test marks it as passed first.
 */
async function useClip(i: number, jobId: string) {
  const [asset] = await db.update(schema.assets).set({ reviewStatus: 'allowed' }).where(eq(schema.assets.generationJobId, jobId)).returning();
  assert.ok(asset, 'the clip was stored');
  const r = await call('POST', `/shots/${(await shotOf(i)).id}/hero`, { asset_id: asset.id });
  assert.equal(r.statusCode, 200, r.body);
}
const jobRow = async (id: string) => (await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, id)))[0]!;

// ── §7.1 One look per cartoon ──────────────────────────────────────────────
test('the cartoon look is inferred until chosen, then applies to every scene and to character pictures', async () => {
  // Nothing chosen and no scene styles: the default.
  let style = await get(`/projects/${projectId}/style`);
  assert.deepEqual([style.art_style, style.chosen], ['2d_flat_vector', false]);
  // An existing cartoon keeps the look most of its scenes already use.
  await patchScene(0, { art_style: 'claymation_look' });
  await patchScene(1, { art_style: 'claymation_look' });
  style = await get(`/projects/${projectId}/style`);
  assert.deepEqual([style.art_style, style.chosen], ['claymation_look', false]);
  assert.ok((await shotOf(2)).compiled_prompt.startsWith(phrase(ART_STYLE, 'claymation_look')), 'a scene with no style of its own follows the cartoon');

  // Choosing the look for the whole cartoon clears every scene's own style and recompiles.
  const chosen = await call('PUT', `/projects/${projectId}/style`, { art_style: 'watercolour_storybook' });
  assert.equal(chosen.statusCode, 200, chosen.body);
  assert.deepEqual([chosen.json().art_style, chosen.json().chosen, chosen.json().scenes_with_own_style], ['watercolour_storybook', true, []]);
  for (const i of [0, 1, 2]) {
    assert.equal((await get(`/scenes/${sceneIds[i]}`)).art_style, null);
    assert.ok((await shotOf(i)).compiled_prompt.startsWith(phrase(ART_STYLE, 'watercolour_storybook')));
  }

  // Character pictures are drawn in the cartoon's look (F3).
  const created = await call('POST', `/projects/${projectId}/cast`, { name: 'Frog', description: 'a green frog' });
  const drawn = await call('POST', `/characters/${created.json().id}/jobs`, { intent: 'portrait', count: 1 }, { 'idempotency-key': randomUUID() });
  assert.equal(drawn.statusCode, 202, drawn.body);
  assert.ok(((await jobRow(drawn.json().id)).request as JobRequest).prompt.startsWith(phrase(ART_STYLE, 'watercolour_storybook')));
  await runner.drain();

  // Advanced may keep a scene's own look; it is reported, not hidden.
  await patchScene(1, { art_style: 'anime_ghibli_soft' });
  const kept = await call('PUT', `/projects/${projectId}/style`, { art_style: 'watercolour_storybook', keep_scene_styles: true });
  assert.deepEqual(kept.json().scenes_with_own_style.map((s: { art_style: string }) => s.art_style), ['anime_ghibli_soft']);

  // Someone else's cartoon is a 404, never a 403.
  assert.equal((await call('GET', `/projects/${projectId}/style`, undefined, {}, 2)).statusCode, 404);
  assert.equal((await call('PUT', `/projects/${projectId}/style`, { art_style: 'claymation_look' }, {}, 2)).statusCode, 404);
  assert.equal((await call('PUT', `/projects/${projectId}/style`, { art_style: 'not_a_style' })).statusCode, 422);
});

// ── §6 The same characters in every scene ──────────────────────────────────
test('every scene sends the same pinned pictures of a character, in the same place, with tokens inline', async () => {
  const bunny = await bunnyWithLook();
  // No scene's cast is saved: each uses the proposal with Bunny's current look, and saves it.
  const jobs = [];
  for (const i of [0, 1, 2]) jobs.push(await makeClip(i, { purpose: 'final', duration_seconds: 5 }));
  const creatives = await Promise.all(jobs.map(async (j) => ((await jobRow(j.id)).request as JobRequest).creative!));
  for (const creative of creatives) {
    assert.deepEqual(creative.references.map((r) => [r.characterName, r.characterVisualVersionId, r.contentHash]), creatives[0]!.references.map((r) => [r.characterName, r.characterVisualVersionId, r.contentHash]));
    assert.equal(creative.references[0]!.characterVisualVersionId, bunny.look);
    assert.match(creative.prompt, /^Bunny \(@Image1\): a small white rabbit/);
    assert.equal(creative.compilerVersion, 'video-v1');
  }
  for (const i of [0, 1, 2]) assert.equal((await get(`/shots/${(await shotOf(i)).id}/cast`)).saved, true);
  // Each payload names Bunny next to the picture, and appends nothing.
  for (const sent of provider.submitted.filter((r) => r.model.kind === 'video')) {
    const body = shapeRequest(sent, () => 'u');
    assert.match(String(body.prompt), /^Bunny \(@Image1\)/);
    assert.doesNotMatch(String(body.prompt), /\n@Image1: Bunny/);
  }
});

test('a new look asks before it changes scenes; scenes with a chosen clip keep theirs', async () => {
  const bunny = await bunnyWithLook();
  // Scene 1's clip is in the cartoon; scenes 2 and 3 are saved without clips.
  await useClip(0, (await makeClip(0, { purpose: 'final', duration_seconds: 5 })).id);
  for (const i of [1, 2]) {
    const shot = await shotOf(i);
    const r = await call('PUT', `/shots/${shot.id}/cast`, { characters: [{ character_id: bunny.id }] }, { 'if-match': String(shot.version) });
    assert.equal(r.statusCode, 200, r.body);
  }
  const newer = await newLook(bunny.id);
  // Approving changed nothing yet.
  for (const i of [0, 1, 2]) assert.equal((await get(`/shots/${(await shotOf(i)).id}/cast`)).characters[0].look_id, bunny.look);
  let report = await get(`/projects/${projectId}/continuity`);
  assert.equal(report.warnings.some((w: { kind: string }) => w.kind === 'mixed_looks'), false, 'every scene still agrees');

  const preview = await get(`/characters/${bunny.id}/looks/${newer}/use-everywhere`);
  assert.deepEqual(preview, { scenes_to_update: 2, scenes_kept: 1 });
  const done = await call('POST', `/characters/${bunny.id}/looks/${newer}/use-everywhere`);
  assert.equal(done.statusCode, 200, done.body);
  assert.deepEqual(done.json(), { scenes_updated: 2, scenes_kept: 1 });
  assert.equal((await get(`/shots/${(await shotOf(0)).id}/cast`)).characters[0].look_id, bunny.look, 'the finished clip keeps its look');
  for (const i of [1, 2]) assert.equal((await get(`/shots/${(await shotOf(i)).id}/cast`)).characters[0].look_id, newer);

  report = await get(`/projects/${projectId}/continuity`);
  const mixed = report.warnings.find((w: { kind: string }) => w.kind === 'mixed_looks');
  assert.ok(mixed, 'the scene that kept its clip is named');
  assert.deepEqual(mixed.scene_ids, [sceneIds[0]]);
  assert.match(mixed.detail, /Bunny uses an earlier look in scene 1/);

  // Another account cannot see or move the look.
  assert.equal((await call('GET', `/characters/${bunny.id}/looks/${newer}/use-everywhere`, undefined, {}, 2)).statusCode, 404);
  assert.equal((await call('POST', `/characters/${bunny.id}/looks/${newer}/use-everywhere`, undefined, {}, 2)).statusCode, 404);
  assert.equal((await call('GET', `/projects/${projectId}/continuity`, undefined, {}, 2)).statusCode, 404);
});

test('the continuity report names scenes with their own look and clips made from words only', async () => {
  await bunnyWithLook();
  await call('PUT', `/projects/${projectId}/style`, { art_style: '2d_flat_vector' });
  await patchScene(2, { art_style: 'claymation_look' });
  const quoted = await call('POST', `/shots/${(await shotOf(1)).id}/videos/quote`, { purpose: 'final', continuity: false, duration_seconds: 5 });
  assert.equal(quoted.statusCode, 200, quoted.body);
  assert.equal(quoted.json().words_only, true);
  const job = await makeClip(1, { purpose: 'final', continuity: false, duration_seconds: 5 });
  assert.equal(job.words_only, true, 'the clip itself says it was made from the words only');
  await useClip(1, job.id);

  const report = await get(`/projects/${projectId}/continuity`);
  const kinds = report.warnings.map((w: { kind: string }) => w.kind).sort();
  assert.deepEqual(kinds, ['scene_style', 'words_only']);
  assert.match(report.warnings.find((w: { kind: string }) => w.kind === 'scene_style').detail, /^Scene 3 has its own look/);
  assert.match(report.warnings.find((w: { kind: string }) => w.kind === 'words_only').detail, /scene 2 was made from the words only/);
  const scene2 = report.scenes.find((s: { scene_id: string }) => s.scene_id === sceneIds[1]);
  assert.equal(scene2.clip.words_only, true);
  assert.equal('model_id' in scene2.clip, false, 'the teen never sees maker names');
});

// ── §5.1 The video template ────────────────────────────────────────────────
test('camera movement reaches the clip instructions but never the still picture prompt', async () => {
  const scene = await patchScene(0, { camera_movement: 'dolly_in' });
  assert.equal(scene.camera_movement, 'dolly_in');
  const shot = await shotOf(0);
  assert.ok(!shot.compiled_prompt.includes(phrase(CAMERA_MOVEMENT, 'dolly_in')), 'PC-2c: the still prompt has no movement');
  const quote = await call('POST', `/shots/${shot.id}/videos/quote`, { purpose: 'final', continuity: false, duration_seconds: 5 });
  assert.equal(quote.statusCode, 200, quote.body);
  assert.ok(quote.json().prompt.includes(phrase(CAMERA_MOVEMENT, 'dolly_in')));
  // This maker has no negative field, so the keep-outs are said in the words (F9).
  assert.ok(quote.json().prompt.includes(phrase(VIDEO_DIRECTION, 'keep_out')));
  assert.equal((await call('PATCH', `/scenes/${sceneIds[0]}`, { camera_movement: 'wobble' }, { 'if-match': String(scene.version) })).statusCode, 422);
  const cleared = await patchScene(0, { camera_movement: null });
  assert.equal(cleared.camera_movement, null);
});

// ── The real catalogue's payloads (no network) ─────────────────────────────
function request(id: string, overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  const model = ALL_MODELS.find((m) => m.id === id)!;
  return {
    model, prompt: 'Bunny hops.', negativePrompt: 'text', referenceImages: [], startFrame: null, aspectRatio: '16:9', count: 1,
    durationSeconds: model.duration_seconds?.min ?? null, audio: false, resolution: model.resolutions[0]!, strictSafety: true, ...overrides,
  };
}
const png = { bytes: Buffer.from('x'), mimeType: 'image/png' };

test('live makers never let the provider rewrite the reviewed prompt (F10)', () => {
  assert.equal(shapeRequest(request('clip_medium'), () => 'u').prompt_optimizer, false);
  const veo = shapeRequest(request('clip_high'), () => 'u');
  assert.equal(veo.auto_fix, false);
  assert.equal(veo.safety_tolerance, '2');
  assert.equal(shapeRequest(request('clip_low'), () => 'u').enable_prompt_expansion, false);
  assert.equal(shapeRequest(request('minimax_h3_max'), () => 'u').prompt_expansion_mode, 'disabled');
});

test('seeds, camera moves and picture tokens map per maker', () => {
  assert.equal(shapeRequest(request('clip_high', { seed: 7 }), () => 'u').seed, 7);
  assert.equal('seed' in shapeRequest(request('clip_medium', { seed: 7 }), () => 'u'), false, 'a maker without a seed field gets none');
  assert.equal(shapeRequest(request('ltx_25_fast', { cameraMovement: 'dolly_in' }), () => 'u').camera_motion, 'dolly_in');
  assert.equal(shapeRequest(request('ltx_25_fast', { cameraMovement: 'truck_left' }), () => 'u').camera_motion, 'dolly_left');
  assert.equal('camera_motion' in shapeRequest(request('ltx_25_fast', { cameraMovement: 'handheld' }), () => 'u'), false, 'an unmapped move stays in the words');
  assert.equal('camera_motion' in shapeRequest(request('clip_high', { cameraMovement: 'dolly_in' }), () => 'u'), false);
  // H3 Max with pictures: "Image 1" wording, positional; inline tokens are not appended twice.
  const h3 = shapeRequest(request('h3_max_refs', { referenceImages: [png], referenceNames: ['Bunny'], prompt: 'Bunny (Image 1) hops.', tokensInline: true }), () => 'u');
  assert.deepEqual(h3.reference_image_urls, ['u']);
  assert.equal(h3.prompt, 'Bunny (Image 1) hops.');
  // An older recipe (still template) keeps the appended name lines.
  const older = shapeRequest(request('h3_max_refs', { referenceImages: [png], referenceNames: ['Bunny'] }), () => 'u');
  assert.equal(older.prompt, 'Bunny hops.\nImage 1: Bunny');
  // Wan 3.0 from a starting and an ending picture.
  const wan = shapeRequest(request('wan_30_i2v', { startFrame: png, endFrame: png }), () => 'u');
  assert.deepEqual([wan.start_image_url, wan.end_image_url, wan.enable_prompt_expansion], ['u', 'u', false]);
});
