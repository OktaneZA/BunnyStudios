import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.ts';
import { db, sql, schema } from '../src/db/client.ts';
import { config } from '../src/config.ts';
import type { ThumbnailProvider, ThumbnailInput } from '../src/thumbnails/provider.ts';
import type { SceneImprovementProvider } from '../src/scenes/improver.ts';

const ids = [randomUUID(), randomUUID()];
let calls: ThumbnailInput[] = [];
let reject = false;
let blocked: Promise<void> | null = null;
const provider: ThumbnailProvider = {
  enabled: true, model: 'test-drawing-model',
  async generate(input) {
    calls.push(input);
    if (blocked) await blocked;
    if (reject) throw new Error('provider private diagnostics');
    return { sketch: { description: 'A parcel on a porch.', background: '#ffffff', shapes: [
      { type: 'rect', x: 200, y: 180, width: 120, height: 80, fill: '#aa8866', stroke: '#333333', strokeWidth: 3, path: '' },
    ] }, inputTokens: 30, outputTokens: 40 };
  },
};
let improvementCalls: ThumbnailInput[] = [];
const improver: SceneImprovementProvider = {
  enabled: true, model: 'test-writer',
  async generate(input) {
    improvementCalls.push(input);
    if (blocked) await blocked;
    if (reject) throw new Error('private provider details');
    return { text: 'On the sunlit wooden porch, the boy bends beside the peeling yellow door and lifts a brown parcel with both hands.', inputTokens: 25, outputTokens: 35 };
  },
};
const app = await buildApp({ thumbnailProvider: provider, improvementProvider: improver });
const token = (n = 0) => ({ authorization: `Bearer ${app.jwt.sign({ sub: ids[n] })}` });
let projectId: string;
let sceneId: string;
let address: string;

before(async () => {
  await db.insert(schema.accounts).values(ids.map((id, i) => ({ id, email: `thumbnail-test-${id}@example.com`, displayName: 'Thumbnail test', isMinor: i === 0 })));
  address = await app.listen({ host: '127.0.0.1', port: 0 });
});
beforeEach(async () => {
  calls = []; reject = false; blocked = null; provider.enabled = true;
  improvementCalls = []; improver.enabled = true;
  await db.update(schema.aiInteractions).set({ createdAt: new Date('2000-01-01') }).where(inArray(schema.aiInteractions.accountId, ids));
  const project = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: token(), payload: { title: 'Thumbnail test', target_audience: 'adult' } });
  assert.equal(project.statusCode, 201);
  projectId = project.json().id;
  const scene = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/scenes`, headers: token(), payload: {
    title: 'The parcel', action_description: 'A boy picks up a parcel on a porch.', director_notes: 'PRIVATE NOTE NEVER SENT',
  } });
  assert.equal(scene.statusCode, 201); sceneId = scene.json().id;
});
after(async () => {
  await app.close();
  await db.delete(schema.accounts).where(inArray(schema.accounts.id, ids));
  await sql.end();
});

async function read() { return (await app.inject({ method: 'GET', url: `/api/v1/scenes/${sceneId}`, headers: token() })).json(); }
async function start(id = randomUUID()) {
  const response = await app.inject({ method: 'POST', url: `/api/v1/scenes/${sceneId}/thumbnail-proposals`, headers: { ...token(), 'idempotency-key': id } });
  assert.ok([200, 202].includes(response.statusCode), response.body);
  return id;
}
async function waitFor(id: string, collection = 'thumbnail-proposals') {
  for (let i = 0; i < 100; i++) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/scenes/${sceneId}/${collection}/${id}`, headers: token() });
    assert.equal(response.statusCode, 200, response.body);
    if (response.json().status !== 'generating') return response.json();
    await delay(10);
  }
  assert.fail('Thumbnail worker did not finish');
}

async function startImprovement(id = randomUUID()) {
  const response = await app.inject({ method: 'POST', url: `/api/v1/scenes/${sceneId}/description-proposals`, headers: { ...token(), 'idempotency-key': id } });
  assert.ok([200, 202].includes(response.statusCode), response.body);
  return id;
}
async function resolveImprovement(id: string, action: 'accept' | 'cancel', account = 0) {
  return app.inject({ method: 'POST', url: `/api/v1/scenes/${sceneId}/description-proposals/${id}/${action}`, headers: token(account) });
}

test('unified description preserves all legacy text and becomes the sole editable description', async () => {
  await db.update(schema.scenes).set({ sceneIntent: 'Introduce the delivery.', sceneryDescription: 'Peeling yellow paint.', emotionalBeat: 'calm to curious' }).where(eq(schema.scenes.id, sceneId));
  const original = await read();
  assert.equal(original.description, 'Introduce the delivery.\n\nA boy picks up a parcel on a porch.\n\nPeeling yellow paint.');
  const saved = await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneId}`, headers: { ...token(), 'if-match': String(original.version) }, payload: { description: 'A boy opens a parcel in a sunny kitchen.' } });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().description, 'A boy opens a parcel in a sunny kitchen.');
  assert.equal(saved.json().emotional_beat, 'calm to curious');
  assert.equal(saved.json().scenery_description, 'Peeling yellow paint.', 'legacy text remains available');
  const preview = await start(); await waitFor(preview);
  assert.match(JSON.stringify(calls[0]?.source), /sunny kitchen/);
  assert.doesNotMatch(JSON.stringify(calls[0]?.source), /Peeling yellow|Introduce the delivery/);
});

test('camera angle survives reload and guides the generation source', async () => {
  const response = await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneId}`, headers: { ...token(), 'if-match': '1' }, payload: { camera_angle: 'birds_eye' } });
  assert.equal(response.statusCode, 200);
  assert.equal((await read()).camera_angle, 'birds_eye');
  const id = await start(); await waitFor(id);
  assert.match(JSON.stringify(calls[0]?.source), /top-down bird's eye view/);
  const unsupported = await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneId}`, headers: { ...token(), 'if-match': '2' }, payload: { camera_angle: 'made_up_angle' } });
  assert.equal(unsupported.statusCode, 422);
});

test('board shows an unaccepted thumbnail as a preview without selecting it', async () => {
  const id = await start(); const preview = await waitFor(id);
  const board = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/scenes`, headers: token() });
  assert.equal(board.json().data[0].thumbnail, null);
  assert.deepEqual(board.json().data[0].thumbnail_preview, preview.preview);
  await resolve(id, 'cancel');
  const cleared = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/scenes`, headers: token() });
  assert.equal(cleared.json().data[0].thumbnail_preview, null);
});

test('Improve for me previews text, accepts atomically and preserves unrelated scene fields', async () => {
  const original = await read();
  const id = await startImprovement(); const preview = await waitFor(id, 'description-proposals');
  assert.equal(preview.status, 'ready'); assert.match(preview.text, /sunlit wooden porch/);
  assert.deepEqual(await read(), original);
  assert.equal(improvementCalls[0]?.constrained, true);
  assert.doesNotMatch(JSON.stringify(improvementCalls), /PRIVATE NOTE/);
  await startImprovement(id); assert.equal(improvementCalls.length, 1);
  assert.equal((await resolveImprovement(id, 'accept')).statusCode, 200);
  const after = await read();
  assert.equal(after.description, preview.text);
  assert.equal(after.director_notes, original.director_notes);
  assert.equal(after.thumbnail, original.thumbnail);
  assert.equal(after.version, original.version + 1);
  assert.equal((await resolveImprovement(id, 'accept')).statusCode, 200);
  assert.equal((await read()).version, after.version);
});

test('improvement includes ordered story context and rejects changes to that context', async () => {
  await db.update(schema.scenes).set({ timeOfDay: 'night', moodAtmosphere: 'eerie', cameraAngle: 'high_angle' }).where(eq(schema.scenes.id, sceneId));
  const sibling = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/scenes`, headers: token(), payload: {
    title: 'The reveal', description: 'Inside the parcel is a red kite.', director_notes: 'SIBLING PRIVATE NOTE',
  } });
  assert.equal(sibling.statusCode, 201);
  const id = await startImprovement(); await waitFor(id, 'description-proposals');
  const settings = (improvementCalls[0]!.source as { selected_settings: { time_of_day: string; mood: string; camera_angle: string } }).selected_settings;
  assert.match(settings.time_of_day, /night/i);
  assert.match(settings.mood, /eerie/i);
  assert.match(settings.camera_angle, /high.angle/i);
  const source = improvementCalls[0]!.source as { story: { title: string; current_scene_number: number; other_scenes: { title: string; description: string; scene_number: number }[] } };
  assert.equal(source.story.title, 'Thumbnail test');
  assert.equal(source.story.current_scene_number, 1);
  assert.deepEqual(source.story.other_scenes, [{ scene_number: 2, title: 'The reveal', description: 'Inside the parcel is a red kite.', synopsis: '' }]);
  assert.doesNotMatch(JSON.stringify(source), /PRIVATE NOTE/);
  const changed = await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sibling.json().id}`, headers: { ...token(), 'if-match': '1' }, payload: { description: 'Inside the parcel is a blue kite.' } });
  assert.equal(changed.statusCode, 200);
  assert.equal((await resolveImprovement(id, 'accept')).statusCode, 409);

  const fresh = await startImprovement(); await waitFor(fresh, 'description-proposals');
  await db.update(schema.projects).set({ title: 'A different story title' }).where(and(eq(schema.projects.id, projectId), eq(schema.projects.accountId, ids[0]!)));
  assert.equal((await resolveImprovement(fresh, 'accept')).statusCode, 409);
});

test('improvement proposals are account isolated and cannot overwrite a newer description', async () => {
  const id = await startImprovement(); await waitFor(id, 'description-proposals');
  assert.equal((await resolveImprovement(id, 'accept', 1)).statusCode, 404);
  const other = await app.inject({ method: 'GET', url: `/api/v1/scenes/${sceneId}/description-proposals`, headers: token(1) });
  assert.equal(other.statusCode, 404);
  await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneId}`, headers: { ...token(), 'if-match': '1' }, payload: { description: 'My newer description.' } });
  assert.equal((await resolveImprovement(id, 'accept')).statusCode, 409);
  assert.equal((await read()).description, 'My newer description.');
});

test('cancelled improvement, failure, and missing key all preserve the source', async () => {
  const original = await read();
  let release!: () => void;
  blocked = new Promise<void>((done) => { release = done; });
  const id = await startImprovement();
  assert.equal((await resolveImprovement(id, 'cancel')).statusCode, 200);
  release(); await delay(40); blocked = null;
  assert.equal((await waitFor(id, 'description-proposals')).status, 'cancelled');
  assert.deepEqual(await read(), original);
  reject = true;
  const failed = await startImprovement();
  const result = await waitFor(failed, 'description-proposals');
  assert.equal(result.status, 'failed'); assert.doesNotMatch(result.error, /private provider/);
  improver.enabled = false;
  const disabled = await app.inject({ method: 'POST', url: `/api/v1/scenes/${sceneId}/description-proposals`, headers: { ...token(), 'idempotency-key': randomUUID() } });
  assert.equal(disabled.statusCode, 503);
  assert.deepEqual(await read(), original);
});
async function resolve(id: string, action: 'accept' | 'cancel', account = 0) {
  return app.inject({ method: 'POST', url: `/api/v1/scenes/${sceneId}/thumbnail-proposals/${id}/${action}`, headers: token(account) });
}

test('proposal acceptance persists one private thumbnail, preserves text, survives board reload/reorder, and removal works', async () => {
  const original = await read();
  const id = await start();
  assert.equal((await waitFor(id)).status, 'ready');
  assert.deepEqual(await read(), original, 'generating must not modify the scene');
  assert.equal(calls[0]?.constrained, true, 'minor policy applies even to an adult-audience project');
  assert.doesNotMatch(JSON.stringify(calls), /PRIVATE NOTE NEVER SENT/);
  assert.equal((await resolve(id, 'accept')).statusCode, 200);
  const accepted = await read();
  assert.match(accepted.thumbnail.src, /^data:image\/svg\+xml;base64,/);
  assert.equal(accepted.action_description, original.action_description);
  assert.equal(accepted.thumbnail.stale, false);
  assert.equal((await resolve(id, 'accept')).statusCode, 200, 'accept is idempotent');
  assert.equal((await read()).version, accepted.version);
  const reorder = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/scenes/reorder`, headers: token(), payload: { scene_ids: [sceneId] } });
  assert.deepEqual(reorder.json().data[0].thumbnail, accepted.thumbnail);
  const assets = await db.select().from(schema.assets).where(eq(schema.assets.projectId, projectId));
  assert.equal(assets.length, 1);
  const [interaction] = await db.select().from(schema.aiInteractions).where(eq(schema.aiInteractions.projectId, projectId));
  assert.equal(interaction?.accepted, true); assert.equal(interaction?.inputTokens, 30);
  const removed = await app.inject({ method: 'DELETE', url: `/api/v1/scenes/${sceneId}/thumbnail`, headers: { ...token(), 'if-match': String(accepted.version) } });
  assert.equal(removed.statusCode, 204); assert.equal((await read()).thumbnail, null);
  assert.equal((await db.select().from(schema.assets).where(eq(schema.assets.projectId, projectId))).length, 0);
});

test('same idempotency key across app instances invokes the provider only once', async () => {
  const id = randomUUID();
  const second = await buildApp({ thumbnailProvider: provider });
  try {
    const responses = await Promise.all([app, second].map((instance) => instance.inject({ method: 'POST', url: `/api/v1/scenes/${sceneId}/thumbnail-proposals`, headers: { ...token(), 'idempotency-key': id } })));
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 202]);
    await waitFor(id); assert.equal(calls.length, 1);
  } finally { await second.close(); }
});

test('cross-account preview, acceptance, generation and removal are denied', async () => {
  const id = await start(); await waitFor(id);
  assert.equal((await resolve(id, 'accept', 1)).statusCode, 404);
  for (const [method, suffix] of [['GET', `/thumbnail-proposals/${id}`], ['DELETE', '/thumbnail'], ['POST', '/thumbnail-proposals']] as const) {
    const response = await app.inject({ method, url: `/api/v1/scenes/${sceneId}${suffix}`, headers: { ...token(1), 'if-match': '1', 'idempotency-key': randomUUID() } });
    assert.equal(response.statusCode, 404);
  }
  assert.equal(calls.length, 1);
});

test('cancel during generation never replaces an existing thumbnail or leaves preview data', async () => {
  const first = await start(); await waitFor(first); await resolve(first, 'accept');
  const before = await read();
  let release!: () => void;
  blocked = new Promise<void>((done) => { release = done; });
  const second = await start();
  assert.equal((await resolve(second, 'cancel')).statusCode, 200);
  release(); await delay(50);
  assert.equal((await waitFor(second)).status, 'cancelled');
  assert.deepEqual(await read(), before);
  const [stored] = await db.select().from(schema.aiProposals).where(eq(schema.aiProposals.id, second));
  assert.deepEqual(stored?.payload, {});
});

test('source changes stale the thumbnail and reject old previews; unrelated notes do not', async () => {
  const first = await start(); await waitFor(first); await resolve(first, 'accept');
  const second = await start(); await waitFor(second);
  let scene = await read();
  await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneId}`, headers: { ...token(), 'if-match': String(scene.version) }, payload: { director_notes: 'A new private note' } });
  assert.equal((await read()).thumbnail.stale, false);
  scene = await read();
  await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneId}`, headers: { ...token(), 'if-match': String(scene.version) }, payload: { action_description: 'The parcel floats away.' } });
  assert.equal((await read()).thumbnail.stale, true);
  assert.equal((await resolve(second, 'accept')).statusCode, 409);
});

test('one accepted preview prevents another preview from silently replacing it', async () => {
  const first = await start(); const second = await start();
  await waitFor(first); await waitFor(second);
  assert.equal((await resolve(first, 'accept')).statusCode, 200);
  assert.equal((await resolve(second, 'accept')).statusCode, 409);
});

test('scene reload recovers the latest pending preview without another generation', async () => {
  const first = await start(); await waitFor(first);
  const second = await start(); await waitFor(second);
  const latest = await app.inject({ method: 'GET', url: `/api/v1/scenes/${sceneId}/thumbnail-proposals`, headers: token() });
  assert.equal(latest.statusCode, 200);
  assert.equal(latest.json().proposal.id, second);
  assert.equal(latest.json().proposal.status, 'ready');
  assert.equal(calls.length, 2);
  const denied = await app.inject({ method: 'GET', url: `/api/v1/scenes/${sceneId}/thumbnail-proposals`, headers: token(1) });
  assert.equal(denied.statusCode, 404);
});

test('shared character changes stale existing thumbnails and locked scenes reject acceptance', async () => {
  const [character] = await db.insert(schema.characters).values({ accountId: ids[0]!, projectId, name: 'Milo', promptToken: 'Boy with a red scarf' }).returning();
  await db.update(schema.scenes).set({ characterIds: [character!.id] }).where(eq(schema.scenes.id, sceneId));
  const first = await start(); await waitFor(first); await resolve(first, 'accept');
  assert.equal((await read()).thumbnail.stale, false);
  await db.update(schema.characters).set({ promptToken: 'Boy with a blue scarf' }).where(eq(schema.characters.id, character!.id));
  assert.equal((await read()).thumbnail.stale, true);
  const second = await start(); await waitFor(second);
  await db.update(schema.scenes).set({ isLocked: true }).where(eq(schema.scenes.id, sceneId));
  assert.equal((await resolve(second, 'accept')).statusCode, 422);
});

test('missing provider, provider errors and expiration keep manual scene editing usable', async () => {
  provider.enabled = false;
  const settings = await app.inject({ method: 'GET', url: '/api/v1/settings/ai', headers: token() });
  assert.equal(settings.json().thumbnails_enabled, false);
  assert.doesNotMatch(settings.body, /ANTHROPIC|apiKey|api_key/);
  const disabled = await app.inject({ method: 'POST', url: `/api/v1/scenes/${sceneId}/thumbnail-proposals`, headers: { ...token(), 'idempotency-key': randomUUID() } });
  assert.equal(disabled.statusCode, 503);
  provider.enabled = true; reject = true;
  const failed = await start();
  const result = await waitFor(failed);
  assert.equal(result.status, 'failed'); assert.doesNotMatch(result.error, /private diagnostics/);
  assert.equal((await read()).thumbnail, null);
  await db.update(schema.aiProposals).set({ expiresAt: new Date(0) }).where(eq(schema.aiProposals.id, failed));
  assert.equal((await waitFor(failed)).status, 'expired');
  const edit = await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneId}`, headers: { ...token(), 'if-match': '1' }, payload: { title: 'Still editable' } });
  assert.equal(edit.statusCode, 200);
});

test('daily generation cap rejects before calling the provider', async () => {
  await db.insert(schema.aiInteractions).values(Array.from({ length: config.THUMBNAIL_DAILY_LIMIT }, () => ({
    accountId: ids[0]!, projectId, operation: 'generate_scene_thumbnail', mode: 'simple' as const,
  })));
  const limited = await app.inject({ method: 'POST', url: `/api/v1/scenes/${sceneId}/thumbnail-proposals`, headers: { ...token(), 'idempotency-key': randomUUID() } });
  assert.equal(limited.statusCode, 429); assert.equal(calls.length, 0);
});

test('per-minute reservations hold under parallel generation requests', async () => {
  const responses = await Promise.all(Array.from({ length: config.THUMBNAIL_REQUESTS_PER_MINUTE + 1 }, () =>
    app.inject({ method: 'POST', url: `/api/v1/scenes/${sceneId}/thumbnail-proposals`, headers: { ...token(), 'idempotency-key': randomUUID() } })));
  assert.equal(responses.filter((r) => r.statusCode === 202).length, config.THUMBNAIL_REQUESTS_PER_MINUTE);
  assert.equal(responses.filter((r) => r.statusCode === 429).length, 1);
  for (const response of responses.filter((r) => r.statusCode === 202)) await waitFor(response.json().id);
  assert.equal(calls.length, config.THUMBNAIL_REQUESTS_PER_MINUTE);
});

test('live HTTP listener serves authenticated settings and correct CORS headers', async () => {
  const response = await fetch(`${address}/api/v1/settings/ai`, { headers: { ...token(), origin: config.corsOrigins[0]! } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), config.corsOrigins[0]);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json() as { thumbnails_enabled: boolean }).thumbnails_enabled, true);
  const preflight = await fetch(`${address}/api/v1/scenes/${sceneId}/thumbnail-proposals`, {
    method: 'OPTIONS', headers: { origin: config.corsOrigins[0]!, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,idempotency-key' },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /Idempotency-Key/i);
});

test('scene saves require a version and concurrent edits have one winner', async () => {
  const missing = await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneId}`, headers: token(), payload: { title: 'No version' } });
  assert.equal(missing.statusCode, 422);
  const result = await Promise.all(['One', 'Two'].map((title) => app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneId}`, headers: { ...token(), 'if-match': '1' }, payload: { title } })));
  assert.deepEqual(result.map((r) => r.statusCode).sort(), [200, 409]);
});

test('foreign project locations cannot enter the thumbnail context', async () => {
  const other = await db.insert(schema.projects).values({ accountId: ids[1]!, title: 'Other account' }).returning();
  const [location] = await db.insert(schema.locations).values({ accountId: ids[1]!, projectId: other[0]!.id, name: 'Private place' }).returning();
  const update = await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${sceneId}`, headers: { ...token(), 'if-match': '1' }, payload: { location_id: location!.id } });
  assert.equal(update.statusCode, 404);
  assert.equal((await read()).location_id, null);
});

test('deleting a scene keeps its thumbnail (logical delete) but cancels the pending preview', async () => {
  const first = await start(); await waitFor(first); await resolve(first, 'accept');
  const second = await start(); await waitFor(second);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/scenes/${sceneId}`, headers: token() })).statusCode, 204);
  assert.equal((await db.select().from(schema.assets).where(eq(schema.assets.projectId, projectId))).length, 1, 'the accepted thumbnail survives a logical delete');
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/scenes/${sceneId}/thumbnail-proposals`, headers: token() })).statusCode, 404, 'AI routes hide a deleted scene');
  const [pending] = await db.select().from(schema.aiProposals).where(and(eq(schema.aiProposals.id, second), eq(schema.aiProposals.accountId, ids[0]!)));
  assert.equal(pending?.status, 'cancelled'); assert.deepEqual(pending?.payload, {});
});
