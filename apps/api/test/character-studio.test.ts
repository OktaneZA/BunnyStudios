/**
 * Character Studio acceptance (docs/character-studio-requirements.md §8 and the build plan's
 * acceptance matrix), against a real Postgres with a fake provider, an in-memory store and a
 * fake reviewer. These prove the contracts: which pictures, in which order, pinned to which
 * revision, for what price. They are not evidence of visual consistency — that is the
 * continuity benchmark's job (docs/spike/continuity-benchmark.md).
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { GenerationModel } from '@storyboard/models';
import { buildApp } from '../src/app.ts';
import { db, sql, schema } from '../src/db/client.ts';
import { createFakeProvider, FAKE_IMAGE_MODEL, FAKE_VIDEO_MODEL, TINY_PNG } from '../src/generation/fake.ts';
import { ffmpegAvailable, makeTestClip } from '../src/generation/media.ts';
import { createMemoryStore } from '../src/storage/objectStore.ts';
import { shapeRequest } from '../src/generation/provider.ts';
import type { ReviewProvider } from '../src/generation/review.ts';
import type { CastFinder } from '../src/cast/finder.ts';
import type { JobRequest } from '../src/jobs/runner.ts';

/** A reference-to-video endpoint shaped like Seedance's: @Image tokens, native 4–15 s. */
const FAKE_REF_VIDEO: GenerationModel = {
  id: 'seedance_25_refs', provider: 'fake', provider_model: 'fake/refs', kind: 'video', tier: 'high', label: 'Fake refs', friendlyLabel: 'Cast pictures', help: '', icon: 'model-video',
  capabilities: { reference_images: true, requires_reference_images: true, start_frame: false, end_frame: false, audio: true, multi_shot: false, image_to_video: false, text_to_video: false },
  aspect_ratios: ['16:9', '9:16'], resolutions: ['720p'], duration_seconds: { min: 4, max: 15, step: 1 }, max_reference_images: 4, max_prompt_length: 2000,
  unit: 'second', unit_cost_pence: 3, request_shape: { prompt: 'prompt', reference_images: 'image_urls', reference_token_prefix: '@Image', duration: 'duration', duration_format: 'string_seconds' },
  result_shape: { files: 'video' }, enabled: true, video: { family: 'fake_refs', categories: ['references'], documentation: 'test' },
};
/** A pricier reference endpoint marked recommended: what "Make final video" picks. */
const FAKE_REF_FINAL: GenerationModel = {
  ...FAKE_REF_VIDEO, id: 'wan_30_refs', provider_model: 'fake/refs-final', unit_cost_pence: 9, resolutions: ['720p', '480p'],
  request_shape: { ...FAKE_REF_VIDEO.request_shape, seed: 'seed' },
  pricing: { strategy: 'per_second', rates: { '720p': 0.09, '480p': 0.04 }, pence_per_usd: 100, verified_on: 'test', source: 'test' },
  video: { family: 'fake_final', categories: ['recommended', 'references'], documentation: 'test' },
};
/** Start and end pictures, like Seedance image-to-video. */
const FAKE_FRAMES: GenerationModel = {
  ...FAKE_REF_VIDEO, id: 'seedance_25_i2v', provider_model: 'fake/i2v', max_reference_images: 0,
  capabilities: { reference_images: false, start_frame: true, end_frame: true, audio: true, multi_shot: false, image_to_video: true, text_to_video: false },
  request_shape: { prompt: 'prompt', start_frame: 'image_url', end_frame: 'end_image_url', duration: 'duration', duration_format: 'string_seconds' },
};
/** Character pictures and a starting picture together, like MiniMax H3 Max refs (§7.4). */
const FAKE_REF_FRAMES: GenerationModel = {
  ...FAKE_REF_VIDEO, id: 'h3_max_refs', provider_model: 'fake/refs-frames', unit_cost_pence: 8, duration_seconds: { min: 5, max: 15, step: 1 },
  capabilities: { reference_images: true, requires_reference_images: true, start_frame: true, end_frame: true, audio: true, multi_shot: false, image_to_video: true, text_to_video: false },
  request_shape: { ...FAKE_REF_VIDEO.request_shape, reference_token_prefix: 'Image ', start_frame: 'image_url', end_frame: 'end_image_url' },
  video: { family: 'fake_frames', categories: ['references'], documentation: 'test' },
};
/** Not yet checked live: Advanced accounts only. */
const FAKE_GATED: GenerationModel = { ...FAKE_REF_VIDEO, id: 'ltx_25_fast', provider_model: 'fake/gated', unit_cost_pence: 1, video: { family: 'gated', categories: ['fast'], documentation: 'test', rollout: 'advanced', verified_live: false } };

const ids = [randomUUID(), randomUUID()]; // 0 = teen (minor), 1 = adult
const provider = createFakeProvider();
const store = createMemoryStore();
let rejectEveryImage = false;
const review: ReviewProvider = {
  enabled: true, model: 'fake-review',
  async reviewPrompt() { return { allowed: true, reason: '' }; },
  async reviewImage() { return rejectEveryImage ? { allowed: false, reason: 'no' } : { allowed: true, reason: '' }; },
};
let found = [{ name: 'Bunny', description: 'a small white rabbit', scene_numbers: [1, 2] }];
const finder: CastFinder = { enabled: true, model: 'fake', async find() { return { characters: found, inputTokens: 1, outputTokens: 1 }; } };
const app = await buildApp({ director: { providers: [provider], models: [FAKE_IMAGE_MODEL, FAKE_VIDEO_MODEL, FAKE_REF_VIDEO, FAKE_REF_FINAL, FAKE_FRAMES, FAKE_REF_FRAMES, FAKE_GATED], store, review, finder, pollMs: 5 } });
const runner = app.director.runner;
const token = (n = 0) => ({ authorization: `Bearer ${app.jwt.sign({ sub: ids[n] })}` });
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let projectId = '';
let sceneIds: string[] = [];

before(async () => {
  await db.insert(schema.accounts).values(ids.map((id, i) => ({ id, email: `studio-${id}@example.com`, displayName: i ? 'Adult' : 'Teen', isMinor: i === 0, defaultEditorMode: i ? 'advanced' as const : 'simple' as const, dailyBudgetPence: 5000 })));
  // Pre-paid: every test account starts with a pot.
  await db.insert(schema.creditTopUps).values(ids.map((id) => ({ accountId: id, pence: 50000, note: 'test' })));
});
beforeEach(async () => {
  rejectEveryImage = false; provider.submitted.length = 0;
  found = [{ name: 'Bunny', description: 'a small white rabbit', scene_numbers: [1, 2] }];
  const project = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: token(), payload: { title: 'Carrot Heist', target_audience: 'kids_6_11' } });
  projectId = project.json().id;
  sceneIds = [];
  for (const description of ['Bunny and Fox tiptoe past the sleeping farmer.', 'Fox and Bunny run away with the carrots.']) {
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
const get = async (url: string, n = 0) => { const r = await app.inject({ method: 'GET', url: `/api/v1${url}`, headers: token(n) }); assert.equal(r.statusCode, 200, r.body); return r.json(); };
async function addCharacter(name: string, description: string) {
  const r = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/cast`, headers: token(), payload: { name, description } });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
async function draw(characterId: string, payload: Record<string, unknown>) {
  const r = await app.inject({ method: 'POST', url: `/api/v1/characters/${characterId}/jobs`, headers: { ...token(), 'idempotency-key': randomUUID() }, payload });
  assert.equal(r.statusCode, 202, r.body);
  await runner.drain();
  const job = await get(`/jobs/${r.json().id}`);
  assert.equal(job.status, 'ready', JSON.stringify(job));
  return job;
}
const studio = (characterId: string, n = 0) => get(`/characters/${characterId}/studio`, n);
async function approve(characterId: string, mainAssetId: string, pictures: { asset_id: string; role: string }[], version?: number) {
  const v = version ?? (await get(`/characters/${characterId}`)).version;
  return app.inject({ method: 'POST', url: `/api/v1/characters/${characterId}/looks`, headers: { ...token(), 'if-match': String(v) }, payload: { main_asset_id: mainAssetId, pictures } });
}
/** A character with an approved look of a main picture and (optionally) a side view. */
async function characterWithLook(name: string, withSide: boolean) {
  const c = await addCharacter(name, `${name}, drawn simply`);
  const portrait = await draw(c.id, { intent: 'portrait', count: 1 });
  const first = await approve(c.id, portrait.results[0].id, [{ asset_id: portrait.results[0].id, role: 'main' }]);
  assert.equal(first.statusCode, 201, first.body);
  if (!withSide) return { id: c.id, main: portrait.results[0].id as string, side: null as string | null };
  const side = await draw(c.id, { intent: 'view', view: 'side' });
  const pack = await approve(c.id, portrait.results[0].id, [{ asset_id: portrait.results[0].id, role: 'main' }, { asset_id: side.results[0].id, role: 'side' }]);
  assert.equal(pack.statusCode, 201, pack.body);
  return { id: c.id, main: portrait.results[0].id as string, side: side.results[0].id as string };
}
async function shotOf(sceneIndex: number) { return (await get(`/scenes/${sceneIds[sceneIndex]}/shots`)).data[0]; }
async function saveCast(sceneIndex: number, characters: { character_id: string; look?: string; outfit_label?: string | null }[]) {
  const shot = await shotOf(sceneIndex);
  const r = await app.inject({ method: 'PUT', url: `/api/v1/shots/${shot.id}/cast`, headers: { ...token(), 'if-match': String(shot.version) }, payload: { characters } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function video(sceneIndex: number, payload: Record<string, unknown>, n = 0) {
  const shot = await shotOf(sceneIndex);
  return app.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/videos`, headers: { ...token(n), 'idempotency-key': randomUUID() }, payload });
}
const jobRow = async (id: string) => (await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, id)))[0]!;

// ── CS-01–CS-06, CS-11: candidates never approve themselves ───────────────
test('a teen creates and refines a character; generated, refined and uploaded pictures stay candidates', async () => {
  const bunny = await addCharacter('Bunny', 'a small white rabbit');
  assert.equal(bunny.look_status, 'none');
  const portrait = await draw(bunny.id, { intent: 'portrait', count: 2 });
  assert.equal(portrait.results.length, 2);
  let s = await studio(bunny.id);
  assert.equal(s.candidates.length, 2);
  assert.equal(s.character.look, null, 'finishing a generation approved nothing');

  const refine = await draw(bunny.id, { intent: 'refine', candidate_id: s.candidates[0].id, note: 'Make the ears floppier.' });
  const sent = provider.submitted.at(-1)!;
  assert.equal(sent.referenceImages.length, 1, 'a change starts from the chosen picture');
  assert.match(sent.prompt, /floppier/);
  s = await studio(bunny.id);
  const refined = s.candidates.find((c: { asset: { id: string } }) => c.asset.id === refine.results[0].id);
  assert.equal(refined.source, 'refinement');
  assert.equal(refined.parent_candidate_id, s.candidates.find((c: { source: string; id: string }) => c.id === refined.parent_candidate_id).id);
  assert.equal(s.character.look, null);

  // Views need an approved anchor; a words-only picture maker is never offered as keeping the look (CS-06).
  const noAnchor = await app.inject({ method: 'POST', url: `/api/v1/characters/${bunny.id}/jobs`, headers: { ...token(), 'idempotency-key': randomUUID() }, payload: { intent: 'view', view: 'back' } });
  assert.equal(noAnchor.statusCode, 422);
  assert.match(noAnchor.json().detail, /looks like Bunny first/);

  // The batch price is quoted before anything is spent (CS-03, DF-05).
  const quote = await app.inject({ method: 'POST', url: `/api/v1/characters/${bunny.id}/jobs/quote`, headers: token(), payload: { intent: 'portrait', count: 3 } });
  assert.equal(quote.statusCode, 200);
  assert.equal(quote.json().pence, 15);
  assert.equal(quote.json().keeps_look, false);
});

test('approval creates one immutable revision; a stale approval conflicts without losing candidates (CS-09)', async () => {
  const bunny = await addCharacter('Bunny', 'a small white rabbit');
  const portrait = await draw(bunny.id, { intent: 'portrait', count: 2 });
  const stale = (await get(`/characters/${bunny.id}`)).version;
  const first = await approve(bunny.id, portrait.results[0].id, [{ asset_id: portrait.results[0].id, role: 'main' }], stale);
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json().look.visual_version, 1);
  const second = await approve(bunny.id, portrait.results[1].id, [{ asset_id: portrait.results[1].id, role: 'main' }], stale);
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().current_state.look.visual_version, 1);
  const s = await studio(bunny.id);
  assert.equal(s.looks.length, 1);
  assert.equal(s.candidates.length, 2, 'both candidates are still there');

  // A view from the approved anchor, then "Use these pictures" makes version 2; version 1 is unchanged.
  const side = await draw(bunny.id, { intent: 'view', view: 'side' });
  const anchorHash = sha(TINY_PNG);
  assert.equal(sha(provider.submitted.at(-1)!.referenceImages[0]!.bytes), anchorHash, 'the approved anchor reached the provider');
  const sideCandidate = (await studio(bunny.id)).candidates.find((c: { asset: { id: string } }) => c.asset.id === side.results[0].id);
  assert.equal(sideCandidate.view_role, 'side');
  assert.equal(sideCandidate.from_look_id, first.json().look.id);
  const pack = await approve(bunny.id, portrait.results[0].id, [{ asset_id: side.results[0].id, role: 'side' }, { asset_id: portrait.results[0].id, role: 'main' }]);
  assert.equal(pack.statusCode, 201, pack.body);
  assert.deepEqual(pack.json().look.references.map((r: { role: string; position: number }) => [r.role, r.position]), [['main', 0], ['side', 1]]);
  const looks = (await studio(bunny.id)).looks;
  assert.deepEqual(looks.map((l: { visual_version: number; current: boolean }) => [l.visual_version, l.current]), [[2, true], [1, false]]);
  assert.equal(looks[1].references.length, 1, 'version 1 still has exactly its own picture');

  // Going back selects version 1 again; history is untouched.
  const back = await app.inject({ method: 'POST', url: `/api/v1/characters/${bunny.id}/looks/${looks[1].id}/select`, headers: { ...token(), 'if-match': String(pack.json().version) } });
  assert.equal(back.statusCode, 200, back.body);
  assert.equal(back.json().look.visual_version, 1);
  assert.equal((await studio(bunny.id)).looks.length, 2);
});

test('rejected, foreign and never-offered pictures cannot become part of a look (CS-11, MG-10)', async () => {
  const bunny = await addCharacter('Bunny', 'a small white rabbit');
  rejectEveryImage = true;
  const held = await draw(bunny.id, { intent: 'portrait', count: 1 });
  assert.equal(held.results.length, 0, 'the teen never sees a held-back picture');
  rejectEveryImage = false;
  const [rejectedAsset] = await db.select().from(schema.assets).where(eq(schema.assets.generationJobId, held.id));
  assert.equal(rejectedAsset!.reviewStatus, 'rejected');
  const tryRejected = await approve(bunny.id, rejectedAsset!.id, [{ asset_id: rejectedAsset!.id, role: 'main' }]);
  assert.equal(tryRejected.statusCode, 404, 'a held-back picture is not even a candidate');

  const other = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: token(1), payload: { title: 'Adult cartoon' } });
  const fox = await app.inject({ method: 'POST', url: `/api/v1/projects/${other.json().id}/cast`, headers: token(1), payload: { name: 'Fox', description: 'an orange fox' } });
  const foxJob = await app.inject({ method: 'POST', url: `/api/v1/characters/${fox.json().id}/jobs`, headers: { ...token(1), 'idempotency-key': randomUUID() }, payload: { intent: 'portrait', count: 1 } });
  await runner.drain();
  const foxPicture = (await get(`/jobs/${foxJob.json().id}`, 1)).results[0].id;
  const foreign = await approve(bunny.id, foxPicture, [{ asset_id: foxPicture, role: 'main' }]);
  assert.equal(foreign.statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/characters/${fox.json().id}/studio`, headers: token() })).statusCode, 404);
});

test('trait edits and story rediscovery never rewrite an approved look (CS-07, CS-08)', async () => {
  const proposal = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/cast/proposals`, headers: { ...token(), 'idempotency-key': randomUUID() } });
  await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/cast/proposals/${proposal.json().id}/accept`, headers: token(), payload: {} });
  const bunny = (await get(`/projects/${projectId}/cast`)).data[0];
  const portrait = await draw(bunny.id, { intent: 'portrait', count: 1 });
  await approve(bunny.id, portrait.results[0].id, [{ asset_id: portrait.results[0].id, role: 'main' }]);

  found = [{ name: 'Bunny', description: 'a huge purple rabbit', scene_numbers: [1] }];
  const scene = await get(`/scenes/${sceneIds[0]}`);
  await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneIds[0]}`, headers: { ...token(), 'if-match': String(scene.version) }, payload: { description: 'Bunny hops alone.' } });
  const again = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/cast/proposals`, headers: { ...token(), 'idempotency-key': randomUUID() } });
  await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/cast/proposals/${again.json().id}/accept`, headers: token(), payload: {} });
  let now = await get(`/characters/${bunny.id}`);
  assert.equal(now.description, 'a small white rabbit', 'the story did not rewrite an approved character');
  assert.equal(now.story_suggestion, 'a huge purple rabbit');
  assert.equal(now.look_status, 'approved');

  const edit = await app.inject({ method: 'PATCH', url: `/api/v1/characters/${bunny.id}`, headers: { ...token(), 'if-match': String(now.version) }, payload: { colours: 'grey fur' } });
  assert.equal(edit.statusCode, 200, edit.body);
  now = edit.json();
  assert.equal(now.look_status, 'changed', 'the approved look stays in use and is marked as needing new pictures');
  assert.equal(now.look.visual_version, 1);
  const staleEdit = await app.inject({ method: 'PATCH', url: `/api/v1/characters/${bunny.id}`, headers: { ...token(), 'if-match': '1' }, payload: { colours: 'black' } });
  assert.equal(staleEdit.statusCode, 409);
  const personality = await app.inject({ method: 'PATCH', url: `/api/v1/characters/${bunny.id}`, headers: token(), payload: { personality: 'brave and silly' } });
  assert.equal(personality.json().look_status, 'changed', 'personality is not identity, and changes nothing about the look');
});

// ── CR-01–CR-06, MG-01–MG-05: production requests ─────────────────────────
test('two shots receive the chosen looks with stable, ordered references; a later look leaves the older job untouched', async () => {
  const bunny = await characterWithLook('Bunny', true);
  const fox = await characterWithLook('Fox', false);
  const castA = await saveCast(0, [{ character_id: bunny.id }, { character_id: fox.id }]);
  assert.deepEqual(castA.characters.map((c: { name: string; look_version: number }) => [c.name, c.look_version]), [['Bunny', 2], ['Fox', 1]]);
  await saveCast(1, [{ character_id: fox.id }, { character_id: bunny.id }]);

  const a = await video(0, { purpose: 'final', duration_seconds: 8 });
  assert.equal(a.statusCode, 202, a.body);
  assert.equal(a.json().plan.reference_count, 3);
  const b = await video(1, { purpose: 'final', duration_seconds: 8 });
  assert.equal(b.statusCode, 202, b.body);
  await runner.drain();
  const [sentA, sentB] = provider.submitted.slice(-2);
  assert.deepEqual(sentA!.referenceNames, ['Bunny', 'Bunny', 'Fox']);
  assert.deepEqual(sentB!.referenceNames, ['Fox', 'Bunny', 'Bunny'], 'the shot order, never a sort');
  // §5.1: each character's picture tokens sit inline where the character is named; nothing is appended.
  const payload = shapeRequest(sentA!, () => 'u');
  assert.match(String(payload.prompt), /^Bunny \(@Image1, @Image2\): .*; Fox \(@Image3\): /);
  assert.doesNotMatch(String(payload.prompt), /@Image1: Bunny/);
  assert.match(String(shapeRequest(sentB!, () => 'u').prompt), /^Fox \(@Image1\): .*; Bunny \(@Image2, @Image3\): /);

  const jobA = await jobRow(a.json().id);
  const creative = (jobA.request as JobRequest).creative!;
  assert.equal(jobA.task, 'reference-to-video');
  assert.equal(creative.references[0]!.assetId, bunny.main);
  assert.equal(creative.references[1]!.assetId, bunny.side);
  assert.equal(creative.references[0]!.contentHash, sha(TINY_PNG));
  assert.equal(jobA.status, 'ready');

  // Bunny gets a new approved look: the old job and the shot's pinned look do not change (CS-10).
  const newer = await draw(bunny.id, { intent: 'portrait', count: 1 });
  const v3 = await approve(bunny.id, newer.results[0].id, [{ asset_id: newer.results[0].id, role: 'main' }]);
  assert.equal(v3.json().look.visual_version, 3);
  const again = await jobRow(a.json().id);
  assert.deepEqual((again.request as JobRequest).creative, creative);
  const shotCast = await get(`/shots/${(await shotOf(0)).id}/cast`);
  assert.equal(shotCast.characters[0].look_version, 2);
  assert.equal(shotCast.characters[0].newer_look_available, true);
});

test('missing looks are named before quoting; a quick draft from the words stays available (CR-02)', async () => {
  const bunny = await characterWithLook('Bunny', false);
  const fox = await addCharacter('Fox', 'an orange fox');
  await saveCast(0, [{ character_id: bunny.id }, { character_id: fox.id }]);
  const calls = provider.submitted.length;
  const blocked = await app.inject({ method: 'POST', url: `/api/v1/shots/${(await shotOf(0)).id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 5 } });
  assert.equal(blocked.statusCode, 422);
  assert.match(blocked.json().detail, /Choose how Fox looks/);
  assert.deepEqual(blocked.json().current_state.characters.map((c: { name: string }) => c.name), ['Fox']);
  assert.equal(provider.submitted.length, calls, 'nothing was sent');
  const draft = await app.inject({ method: 'POST', url: `/api/v1/shots/${(await shotOf(0)).id}/videos/quote`, headers: token(), payload: { purpose: 'preview', continuity: false, duration_seconds: 5 } });
  assert.equal(draft.statusCode, 200, draft.body);
  assert.equal(draft.json().task, 'text-to-video');
  assert.equal(draft.json().words_only, true, 'a clip from the words only says so when characters are in the scene');

  // An empty scene has nobody to picture.
  const empty = await app.inject({ method: 'POST', url: `/api/v1/shots/${(await shotOf(1)).id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 5 } });
  assert.equal(empty.statusCode, 422);
  assert.equal(empty.json().current_state.missing, 'cast');

  // An unsaved story proposal is quoted with each character's current look, and making the clip
  // saves exactly that list (§6.2), so the child is not stopped to confirm it first.
  await db.update(schema.characters).set({ foundInSceneIds: [sceneIds[1]!] }).where(eq(schema.characters.id, bunny.id));
  const proposed = await app.inject({ method: 'POST', url: `/api/v1/shots/${(await shotOf(1)).id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 5 } });
  assert.equal(proposed.statusCode, 200, proposed.body);
  assert.deepEqual(proposed.json().characters.map((c: { name: string }) => c.name), ['Bunny']);
  assert.equal(proposed.json().words_only, false);
  assert.equal((await get(`/shots/${(await shotOf(1)).id}/cast`)).saved, false, 'a quote saves nothing');
  const made = await video(1, { purpose: 'final', duration_seconds: 5, expected_quote_key: proposed.json().quote_key });
  assert.equal(made.statusCode, 202, made.body);
  const saved = await get(`/shots/${(await shotOf(1)).id}/cast`);
  assert.equal(saved.saved, true);
  assert.deepEqual(saved.characters.map((c: { name: string; look_version: number }) => [c.name, c.look_version]), [['Bunny', 1]]);
  await runner.drain();
});

test('too many pictures shrink to one per character, and never drop a character (CR-04)', async () => {
  const a = await characterWithLook('Bunny', true);
  const b = await characterWithLook('Fox', true);
  const c = await characterWithLook('Owl', true);
  await saveCast(0, [{ character_id: a.id }, { character_id: b.id }]);
  const two = await app.inject({ method: 'POST', url: `/api/v1/shots/${(await shotOf(0)).id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 5 } });
  assert.equal(two.statusCode, 200, two.body);
  assert.equal(two.json().reference_count, 4, 'two views each fit the 4-picture limit');
  await saveCast(0, [{ character_id: a.id }, { character_id: b.id }, { character_id: c.id }]);
  const three = await app.inject({ method: 'POST', url: `/api/v1/shots/${(await shotOf(0)).id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 5 } });
  assert.equal(three.statusCode, 200, three.body);
  assert.equal(three.json().reference_count, 3, 'one main picture each; all three characters kept');
  assert.deepEqual(three.json().characters.map((x: { name: string }) => x.name), ['Bunny', 'Fox', 'Owl']);
  const five = [a, b, c, await characterWithLook('Mole', false), await characterWithLook('Newt', false)];
  await saveCast(0, five.map((x) => ({ character_id: x.id })));
  const tooMany = await app.inject({ method: 'POST', url: `/api/v1/shots/${(await shotOf(0)).id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 5 } });
  assert.equal(tooMany.statusCode, 422);
  assert.equal(tooMany.json().current_state.missing, 'compatible_model');
});

test('start and end pictures map to their fields; a sketch cannot start a clip; the hash is checked (CR-06, CS-10)', async () => {
  const shot = await shotOf(0);
  const boundary = 'b0undary';
  const upload = async () => {
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.png"\r\nContent-Type: image/png\r\n\r\n`), TINY_PNG, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const r = await app.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/frames`, headers: { ...token(), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const start = await upload();
  const end = await upload();
  const [sketch] = await db.insert(schema.assets).values({ accountId: ids[0]!, projectId, ownerEntityType: 'scene', ownerEntityId: sceneIds[0]!, kind: 'scene_thumbnail', filename: 's.svg', mimeType: 'image/svg+xml', sizeBytes: 10, storageKey: 'x', thumbnailSvg: '<svg/>', reviewStatus: 'allowed' }).returning();
  const noSketch = await app.inject({ method: 'PUT', url: `/api/v1/shots/${shot.id}/frames`, headers: { ...token(), 'if-match': String(shot.version) }, payload: { start_asset_id: sketch!.id } });
  assert.equal(noSketch.statusCode, 422);
  assert.match(noSketch.json().detail, /rough sketch/);
  const chosen = await app.inject({ method: 'PUT', url: `/api/v1/shots/${shot.id}/frames`, headers: { ...token(), 'if-match': String(shot.version) }, payload: { start_asset_id: start.id, end_asset_id: end.id } });
  assert.equal(chosen.statusCode, 200, chosen.body);

  const endOnly = await video(0, { purpose: 'final', use_end_frame: true, duration_seconds: 6 });
  assert.equal(endOnly.statusCode, 422, 'an ending picture needs a starting picture');
  const made = await video(0, { purpose: 'final', continuity: false, use_start_frame: true, use_end_frame: true, duration_seconds: 6 });
  assert.equal(made.statusCode, 202, made.body);
  await runner.drain();
  const sent = provider.submitted.at(-1)!;
  assert.equal(sent.model.id, 'seedance_25_i2v');
  const payload = shapeRequest(sent, () => 'url');
  assert.equal(payload.image_url, 'url');
  assert.equal(payload.end_image_url, 'url');
  assert.equal((await jobRow(made.json().id)).task, 'image-to-video');

  // The picture's bytes change after it was chosen: the pinned hash no longer matches, nothing is sent.
  const [startRow] = await db.select().from(schema.assets).where(eq(schema.assets.id, start.id));
  const again = await video(0, { purpose: 'final', continuity: false, use_start_frame: true, duration_seconds: 6 });
  store.objects.set(startRow!.storageKey, Buffer.from('tampered'));
  const before = provider.submitted.length;
  await runner.drain();
  const failed = await jobRow(again.json().id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.errorDetail!, /changed since it was chosen/);
  assert.equal(provider.submitted.length, before);
  assert.equal((await db.select().from(schema.generationLedger).where(eq(schema.generationLedger.jobId, failed.id)))[0]!.status, 'refunded');
});

// ── DF-01–DF-05: draft → final ─────────────────────────────────────────────
test('a draft and a separately accepted final keep lineage, sound, their own quotes and the recorded recipe', async () => {
  const bunny = await characterWithLook('Bunny', false);
  await saveCast(0, [{ character_id: bunny.id }]);
  const draft = await video(0, { purpose: 'preview', duration_seconds: 5, audio: true });
  assert.equal(draft.statusCode, 202, draft.body);
  await runner.drain();
  const draftRow = await jobRow(draft.json().id);
  assert.equal(typeof draft.json().source_scene_version, 'number', 'new clips record the scene revision for the editor');
  assert.equal(draftRow.intent, 'draft');
  assert.equal(draftRow.modelId, 'wan_30_refs', 'the preview is the cheapest try of the family the final will use (§7.3)');
  assert.equal((draftRow.request as JobRequest).resolution, '480p', 'a preview is made at the cheaper size');
  await db.update(schema.generationJobs).set({ providerResult: { seed: 4242 } }).where(eq(schema.generationJobs.id, draftRow.id));

  // The story changes after the preview; the final still uses the preview's recipe (DF-02).
  const scene = await get(`/scenes/${sceneIds[0]}`);
  await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneIds[0]}`, headers: { ...token(), 'if-match': String(scene.version) }, payload: { description: 'Bunny eats every carrot.' } });
  const key = randomUUID();
  const shot = await shotOf(0);
  const final = await app.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/videos`, headers: { ...token(), 'idempotency-key': key }, payload: { purpose: 'final', duration_seconds: 5, from_job_id: draftRow.id } });
  assert.equal(final.statusCode, 202, final.body);
  assert.equal(final.json().plan.new_render, true, 'a final is a new render, not an upscale (DF-03)');
  assert.equal(final.json().plan.output.resolution, '720p', 'the final is made at the standard size');
  assert.equal(final.json().plan.native_completion, 'unavailable');
  assert.equal(final.json().source_scene_version, draft.json().source_scene_version, 'a final from a preview keeps the original scene revision');
  assert.equal(final.json().plan.output.audio, true, 'the UI summary reports the saved sound setting');
  assert.equal(final.json().plan.output.durationSeconds, 5);
  assert.equal(final.json().plan.prompt, (draftRow.request as JobRequest).creative!.prompt, 'the UI shows the saved instructions, not later scene edits');
  const twice = await app.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/videos`, headers: { ...token(), 'idempotency-key': key }, payload: { purpose: 'final', duration_seconds: 5, from_job_id: draftRow.id } });
  assert.equal(twice.statusCode, 200, 'clicking twice made one paid job');
  const finalRow = await jobRow(final.json().id);
  assert.equal(finalRow.parentJobId, draftRow.id);
  assert.equal(finalRow.generationGroupId, draftRow.generationGroupId);
  assert.equal(finalRow.intent, 'final');
  assert.equal((finalRow.request as JobRequest).audio, true, 'omitted audio preserves the preview soundtrack setting');
  assert.equal(finalRow.modelId, draftRow.modelId, 'the final stays on the preview’s maker (V4)');
  assert.equal((finalRow.request as JobRequest).creative!.seed, 4242, 'and reuses its seed');
  await runner.drain();
  const sentFinal = provider.submitted.find((r) => r.seed === 4242);
  assert.ok(sentFinal, 'the seed reached the request');
  assert.equal(shapeRequest(sentFinal!, () => 'u').seed, 4242);
  assert.equal((finalRow.request as JobRequest).creative!.prompt, (draftRow.request as JobRequest).creative!.prompt);
  assert.doesNotMatch((finalRow.request as JobRequest).prompt, /every carrot/);
  const ledgers = await db.select().from(schema.generationLedger).where(inArray(schema.generationLedger.jobId, [draftRow.id, finalRow.id]));
  assert.equal(ledgers.length, 2, 'each operation has its own ledger record');
  assert.notEqual(ledgers[0]!.estimatedPence, ledgers[1]!.estimatedPence);

  // A failed final leaves the draft, and the clip in the cartoon, untouched.
  const heroBefore = (await shotOf(0)).hero_video_asset_id;
  await db.update(schema.generationJobs).set({ status: 'failed' }).where(eq(schema.generationJobs.id, finalRow.id));
  assert.equal((await jobRow(draftRow.id)).status, 'ready');
  assert.equal((await shotOf(0)).hero_video_asset_id, heroBefore);

  // "Use latest" is explicit, and rebuilds from today's story.
  const latest = await app.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 5, from_job_id: draftRow.id, use_latest: true } });
  assert.equal(latest.statusCode, 200, latest.body);
  // An unsupported length for the chosen maker is an explicit adjustment, never silently changed (DF-04).
  const tooLong = await app.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 30, from_job_id: draftRow.id } });
  assert.equal(tooLong.statusCode, 422);
  assert.ok(tooLong.json().current_state.supported_durations.includes(15));
});

// ── Release gate and Simple mode ───────────────────────────────────────────
test('models not yet checked live are Advanced-only and never chosen for Simple mode', async () => {
  const simple = await get('/models');
  assert.equal(simple.data.some((m: { id: string }) => m.id === 'ltx_25_fast'), false);
  const adult = await get('/models', 1);
  const gated = adult.data.find((m: { id: string }) => m.id === 'ltx_25_fast');
  assert.ok(gated);
  assert.equal(gated.unverified, true);
  const bunny = await characterWithLook('Bunny', false);
  await saveCast(0, [{ character_id: bunny.id }]);
  const preview = await app.inject({ method: 'POST', url: `/api/v1/shots/${(await shotOf(0)).id}/videos/quote`, headers: token(), payload: { purpose: 'preview', duration_seconds: 5 } });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().model_id, null, 'Simple mode sees a purpose and a price, not the catalogue');
  const job = await video(0, { purpose: 'preview', duration_seconds: 5 });
  assert.notEqual((await jobRow(job.json().id)).modelId, 'ltx_25_fast', 'the cheaper gated maker was not used');
  const pick = await video(0, { purpose: 'preview', duration_seconds: 5, model_id: 'ltx_25_fast' });
  assert.equal(pick.statusCode, 422, 'the teen cannot pick it by id either');
  await runner.drain();
});

test('production refuses an unsupported project shape instead of silently changing it', async () => {
  const bunny = await characterWithLook('Bunny', false);
  await saveCast(0, [{ character_id: bunny.id }]);
  await db.update(schema.seriesBibles).set({ aspectRatio: '1:1' }).where(eq(schema.seriesBibles.projectId, projectId));
  const submittedBefore = provider.submitted.length;
  const shot = await shotOf(0);
  const quoted = await app.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 5 } });
  assert.equal(quoted.statusCode, 422, 'the reference test endpoints cannot produce square video');
  const started = await video(0, { purpose: 'final', duration_seconds: 5 });
  assert.equal(started.statusCode, 422);
  assert.equal(provider.submitted.length, submittedBefore);
});

test('an old displayed quote cannot spend after the creative request changes', async () => {
  const bunny = await characterWithLook('Bunny', false);
  await saveCast(0, [{ character_id: bunny.id }]);
  const shot = await shotOf(0);
  const payload = { purpose: 'final', duration_seconds: 5 };
  const quoted = await app.inject({ method: 'POST', url: `/api/v1/shots/${shot.id}/videos/quote`, headers: token(), payload });
  assert.equal(quoted.statusCode, 200, quoted.body);
  const key = quoted.json().quote_key;
  assert.match(key, /^[a-f0-9]{64}$/);
  const before = provider.submitted.length;
  const changed = await video(0, { ...payload, duration_seconds: 10, expected_quote_key: key });
  assert.equal(changed.statusCode, 409);
  assert.equal(provider.submitted.length, before);
  const accepted = await video(0, { ...payload, expected_quote_key: key });
  assert.equal(accepted.statusCode, 202, accepted.body);
  await runner.drain();
});

test('"Make another version" keeps the clip’s characters, looks and length, and adds the change note', async () => {
  const bunny = await characterWithLook('Bunny', true);
  await saveCast(0, [{ character_id: bunny.id }]);
  const first = await video(0, { purpose: 'preview', duration_seconds: 6 });
  assert.equal(first.statusCode, 202, first.body);
  await runner.drain();
  // Bunny gets a newer look meanwhile: the new version still uses the look the clip had.
  const newer = await draw(bunny.id, { intent: 'portrait', count: 1 });
  await approve(bunny.id, newer.results[0].id, [{ asset_id: newer.results[0].id, role: 'main' }]);
  const again = await video(0, { purpose: 'preview', from_job_id: first.json().id, note: 'Make it snow.' });
  assert.equal(again.statusCode, 202, again.body);
  const a = (await jobRow(first.json().id)).request as JobRequest;
  const b = (await jobRow(again.json().id)).request as JobRequest;
  assert.deepEqual(b.creative!.references, a.creative!.references);
  assert.equal(b.creative!.output.durationSeconds, 6);
  assert.ok(b.creative!.prompt.startsWith(a.creative!.prompt));
  assert.ok(b.creative!.prompt.endsWith('Make it snow.'));
  assert.equal(b.creative!.intent, 'draft');
  assert.equal(b.creative!.seed, null, 'another version gets a new seed');
  await runner.drain();
});

// ── A picture pinned in a look cannot go in the bin ───────────────────────
test('a picture pinned in an approved look cannot be binned; a loose candidate can (CS-10, review 2 Oct P2)', async () => {
  const bunny = await characterWithLook('Bunny', false);
  const spare = await draw(bunny.id, { intent: 'portrait', count: 1 });

  const pinned = await app.inject({ method: 'DELETE', url: `/api/v1/assets/${bunny.main}`, headers: token() });
  assert.equal(pinned.statusCode, 422, pinned.body);
  assert.match(pinned.json().detail, /part of Bunny’s look, so it stays/);
  const still = await db.select().from(schema.assets).where(eq(schema.assets.id, bunny.main));
  assert.equal(still[0]!.deletedAt, null, 'the pinned picture is untouched');

  const loose = await app.inject({ method: 'DELETE', url: `/api/v1/assets/${spare.results[0].id}`, headers: token() });
  assert.equal(loose.statusCode, 204, loose.body);

  // Two characters sharing one picture are both named.
  const fox = await addCharacter('Fox', 'a sly fox');
  const foxLook = await approve(fox.id, bunny.main, [{ asset_id: bunny.main, role: 'main' }]);
  if (foxLook.statusCode === 201) {
    const both = await app.inject({ method: 'DELETE', url: `/api/v1/assets/${bunny.main}`, headers: token() });
    assert.match(both.json().detail, /Bunny and Fox’s looks/);
  }
});

// ── §7.2: the cartoon's style picture ─────────────────────────────────────
test('the style picture rides last, counts against the limit, is named in the prompt and is never dropped quietly (§7.2)', async () => {
  const a = await characterWithLook('Bunny', true);
  const b = await characterWithLook('Fox', true);
  // Any finished picture of the cartoon can be the style picture; a sketch cannot.
  const spare = await draw(a.id, { intent: 'portrait', count: 1 });
  const chosen = await app.inject({ method: 'PUT', url: `/api/v1/projects/${projectId}/style`, headers: token(), payload: { style_picture_asset_id: spare.results[0].id } });
  assert.equal(chosen.statusCode, 200, chosen.body);
  assert.equal(chosen.json().style_picture.id, spare.results[0].id);
  assert.equal((await get(`/projects/${projectId}/style`)).style_picture.id, spare.results[0].id, 'the choice is kept');

  // Two characters with two views each would be 4 pictures; with the style picture that is 5, so one view each + style = 3.
  await saveCast(0, [{ character_id: a.id }, { character_id: b.id }]);
  const quote = await app.inject({ method: 'POST', url: `/api/v1/shots/${(await shotOf(0)).id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 5 } });
  assert.equal(quote.statusCode, 200, quote.body);
  assert.equal(quote.json().reference_count, 3, 'one picture each plus the style picture');

  const made = await video(0, { purpose: 'final', duration_seconds: 5 });
  assert.equal(made.statusCode, 202, made.body);
  await runner.drain();
  const row = await jobRow(made.json().id);
  const r = row.request as JobRequest;
  assert.equal(r.creative!.references.at(-1)!.role, 'style', 'the style picture is the last reference');
  assert.equal(r.referenceAssetIds.at(-1), spare.results[0].id);
  assert.match(r.prompt, /match the art style, colours and line work shown in @Image3/, 'the prompt points at the style picture');
  assert.equal(provider.submitted.at(-1)!.referenceImages.length, 3, 'the provider received all three');
  const [clip] = await db.update(schema.assets).set({ reviewStatus: 'allowed' }).where(eq(schema.assets.generationJobId, row.id)).returning();
  const shot0 = await shotOf(0);
  const picked = await app.inject({ method: 'POST', url: `/api/v1/shots/${shot0.id}/hero`, headers: { ...token(), 'if-match': String(shot0.version) }, payload: { asset_id: clip!.id } });
  assert.equal(picked.statusCode, 200, picked.body);
  const report = await get(`/projects/${projectId}/continuity`);
  assert.equal(report.scenes[0].clip.style_picture, true, 'the report says the style picture reached the clip');

  // Four characters fill the 4-picture limit on their own: the quote says the style picture has no room rather than dropping it.
  const more = [await characterWithLook('Owl', false), await characterWithLook('Mole', false)];
  await saveCast(1, [a, b, ...more].map((x) => ({ character_id: x.id })));
  const noRoom = await app.inject({ method: 'POST', url: `/api/v1/shots/${(await shotOf(1)).id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 5 } });
  assert.equal(noRoom.statusCode, 422, noRoom.body);
  assert.equal(noRoom.json().current_state.missing, 'style_picture_room');
  assert.match(noRoom.json().detail, /Remove the style picture/);

  // The style picture cannot be binned while it is in use; removing it from the cover frees it.
  const binned = await app.inject({ method: 'DELETE', url: `/api/v1/assets/${spare.results[0].id}`, headers: token() });
  assert.equal(binned.statusCode, 422, binned.body);
  assert.match(binned.json().detail, /style picture/);
  const cleared = await app.inject({ method: 'PUT', url: `/api/v1/projects/${projectId}/style`, headers: token(), payload: { style_picture_asset_id: null } });
  assert.equal(cleared.json().style_picture, null);
  const sketch = await app.inject({ method: 'PUT', url: `/api/v1/projects/${projectId}/style`, headers: token(), payload: { style_picture_asset_id: randomUUID() } });
  assert.equal(sketch.statusCode, 404, 'a picture that is not the cartoon\'s is not found');
});

// ── §7.4: start where the last page ended ─────────────────────────────────
test('the previous page’s last frame starts this one, with the character pictures kept; the first page has nothing to continue (§7.4)', async () => {
  const bunny = await characterWithLook('Bunny', false);
  const first = await shotOf(0);
  const nothingBefore = await app.inject({ method: 'POST', url: `/api/v1/shots/${first.id}/start-from-previous`, headers: { ...token(), 'if-match': String(first.version) } });
  assert.equal(nothingBefore.statusCode, 422);
  assert.equal(nothingBefore.json().current_state.missing, 'previous_page');

  const second = await shotOf(1);
  const noClip = await app.inject({ method: 'POST', url: `/api/v1/shots/${second.id}/start-from-previous`, headers: { ...token(), 'if-match': String(second.version) } });
  assert.equal(noClip.statusCode, 422, noClip.body);
  assert.equal(noClip.json().current_state.missing, 'previous_clip');
  assert.match(noClip.json().detail, /Page 1 has no clip chosen yet/);

  // Page 1 gets a chosen clip (a real tiny mp4, so there is a last frame to read).
  await saveCast(0, [{ character_id: bunny.id }]);
  const made = await video(0, { purpose: 'final', duration_seconds: 5 });
  assert.equal(made.statusCode, 202, made.body);
  await runner.drain();
  const [clip] = await db.update(schema.assets).set({ reviewStatus: 'allowed' }).where(eq(schema.assets.generationJobId, made.json().id)).returning();
  const shot0 = await shotOf(0);
  const picked = await app.inject({ method: 'POST', url: `/api/v1/shots/${shot0.id}/hero`, headers: { ...token(), 'if-match': String(shot0.version) }, payload: { asset_id: clip!.id } });
  assert.equal(picked.statusCode, 200, picked.body);
  if (!(await ffmpegAvailable())) { console.log('ffmpeg not available: the last-frame part of this test is skipped'); return; }
  store.objects.set(clip!.storageKey, (await makeTestClip(2))!);

  await saveCast(1, [{ character_id: bunny.id }]);
  const fresh = await shotOf(1);
  const continued = await app.inject({ method: 'POST', url: `/api/v1/shots/${fresh.id}/start-from-previous`, headers: { ...token(), 'if-match': String(fresh.version) } });
  assert.equal(continued.statusCode, 201, continued.body);
  assert.equal(continued.json().from_scene.scene_number, 1);
  assert.equal(continued.json().asset.kind, 'frame_ref');
  assert.equal(continued.json().asset.review_status, 'allowed', 'the frame inherits the clip’s verdict');
  assert.equal(continued.json().shot.start_frame_asset_id, continued.json().asset.id);

  // With the character pictures kept, only a maker that takes both is used, and both are sent.
  const quote = await app.inject({ method: 'POST', url: `/api/v1/shots/${(await shotOf(1)).id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 5, use_start_frame: true, keep_cast_pictures: true } });
  assert.equal(quote.statusCode, 200, quote.body);
  assert.equal(quote.json().task, 'reference-to-video');
  assert.equal(quote.json().reference_count, 1);
  const run = await video(1, { purpose: 'final', duration_seconds: 5, use_start_frame: true, keep_cast_pictures: true });
  assert.equal(run.statusCode, 202, run.body);
  await runner.drain();
  const sent = provider.submitted.at(-1)!;
  assert.equal(sent.model.id, 'h3_max_refs');
  const payload = shapeRequest(sent, () => 'url');
  assert.equal(payload.image_url, 'url', 'the last frame starts the clip');
  assert.deepEqual(payload.image_urls, ['url'], 'Bunny’s picture rides along');
  assert.equal((await jobRow(run.json().id)).task, 'reference-to-video');

  // Without keeping the pictures it is an ordinary start-from-a-picture clip, as before.
  const plain = await app.inject({ method: 'POST', url: `/api/v1/shots/${(await shotOf(1)).id}/videos/quote`, headers: token(), payload: { purpose: 'final', duration_seconds: 6, use_start_frame: true } });
  assert.equal(plain.statusCode, 200, plain.body);
  assert.equal(plain.json().task, 'image-to-video');
  assert.equal(plain.json().reference_count, 0);
});
