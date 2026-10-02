/**
 * Phase 0 API tests. These run against the local Postgres started by `npm run db:up`,
 * because the things most worth testing here — row-level isolation, the 1:1 bible
 * transaction, enum constraints — are exactly the things an in-memory fake would not
 * catch. NF-13 is a database-enforced property or it is nothing.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.ts';
import { db, sql, schema } from '../src/db/client.ts';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/auth.ts';

let app: FastifyInstance;
let adultToken: string;
let teenToken: string;
const testAccountIds = [randomUUID(), randomUUID()];
const testPassword = randomUUID();
const testAdultEmail = `test-${testAccountIds[0]}@example.com`;
const testTeenEmail = `test-${testAccountIds[1]}@example.com`;

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  assert.equal(res.statusCode, 200, `login failed for ${email}: ${res.body}`);
  return res.json().token as string;
}

before(async () => {
  app = await buildApp();
  await app.ready();
  const passwordHash = await hashPassword(testPassword);
  await db.insert(schema.accounts).values([
    { id: testAccountIds[0]!, email: testAdultEmail, displayName: 'Test adult', passwordHash, defaultEditorMode: 'advanced' },
    { id: testAccountIds[1]!, email: testTeenEmail, displayName: 'Test teen', passwordHash, isMinor: true },
  ]);
  adultToken = await login(testAdultEmail, testPassword);
  teenToken = await login(testTeenEmail, testPassword);
});

after(async () => {
  await app.close();
  // Exact test-owned IDs only. Never delete real users' projects created during a test run.
  await db.delete(schema.accounts).where(inArray(schema.accounts.id, testAccountIds));
  await sql.end();
});

describe('auth', () => {
  test('rejects a wrong password with an RFC 7807 body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: testAdultEmail, password: 'definitely-wrong' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['content-type'], 'application/problem+json; charset=utf-8');
    const body = res.json();
    assert.match(body.type, /problems\/unauthorized$/);
    assert.ok(body.detail);
  });

  test('does not reveal whether an email exists', async () => {
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'x' },
    });
    const known = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: testAdultEmail, password: 'x' },
    });
    assert.equal(unknown.statusCode, 401);
    assert.equal(known.statusCode, 401);
    assert.deepEqual(unknown.json().detail, known.json().detail);
  });

  test('rejects an unauthenticated request', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' });
    assert.equal(res.statusCode, 401);
  });

  test('the teen account is flagged as a minor (plan D16)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${teenToken}` },
    });
    assert.equal(res.json().is_minor, true);
    // D13: Simple mode is the designed-for experience for this account.
    assert.equal(res.json().default_editor_mode, 'simple');
  });
});

describe('projects', () => {
  test('creating a project also creates its 1:1 series bible', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adultToken}` },
      payload: { title: 'Bible Transaction Test' },
    });
    assert.equal(res.statusCode, 201);
    const projectId = res.json().id as string;

    const bibles = await db
      .select()
      .from(schema.seriesBibles)
      .where(eq(schema.seriesBibles.projectId, projectId));

    assert.equal(bibles.length, 1, 'every project must have exactly one series bible (§3.4)');
    assert.equal(bibles[0]!.aspectRatio, '16:9');
  });

  test('editor_mode falls back to the account default (§3.3)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${teenToken}` },
      payload: { title: 'Mode Default Test' },
    });
    assert.equal(res.json().editor_mode, 'simple');
  });

  test('an explicit editor_mode overrides the account default', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${teenToken}` },
      payload: { title: 'Mode Override Test', editor_mode: 'advanced' },
    });
    assert.equal(res.json().editor_mode, 'advanced');
  });

  test('NF-13: one account cannot read another account\'s project', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adultToken}` },
      payload: { title: 'Adult Private Project' },
    });
    const id = created.json().id as string;

    for (const [verb, method] of [
      ['read', 'GET'],
      ['update', 'PATCH'],
      ['delete', 'DELETE'],
    ] as const) {
      const res = await app.inject({
        method,
        url: `/api/v1/projects/${id}`,
        headers: { authorization: `Bearer ${teenToken}` },
        ...(method === 'PATCH' ? { payload: { title: 'hijacked' } } : {}),
      });
      assert.equal(res.statusCode, 404, `${verb} should be denied as 404`);
    }

    // And the record is genuinely untouched, not merely hidden.
    const still = await db
      .select({ title: schema.projects.title })
      .from(schema.projects)
      .where(eq(schema.projects.id, id));
    assert.equal(still[0]?.title, 'Adult Private Project');
  });

  test('NF-13: a project list never leaks across accounts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${teenToken}` },
    });
    const [account] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.email, testTeenEmail));

    const ids = res.json().data.map((p: { id: string }) => p.id);
    const owned = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.accountId, account!.id));

    const ownedIds = new Set(owned.map((o) => o.id));
    for (const id of ids) assert.ok(ownedIds.has(id), `project ${id} is not owned by this account`);
  });

  test('deleting a project is logical: hidden everywhere, still in the database, restorable', async () => {
    const auth = { authorization: `Bearer ${adultToken}` };
    const created = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: auth, payload: { title: 'Bin Me' } });
    const id = created.json().id as string;
    const scene = await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/scenes`, headers: auth, payload: { title: 'Kept scene' } });
    const sceneId = scene.json().id as string;

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/projects/${id}`, headers: auth });
    assert.equal(del.statusCode, 204);

    // Hidden from every read path a client has.
    for (const [method, url] of [
      ['GET', `/api/v1/projects/${id}`],
      ['PATCH', `/api/v1/projects/${id}`],
      ['DELETE', `/api/v1/projects/${id}`],
      ['GET', `/api/v1/projects/${id}/scenes`],
      ['GET', `/api/v1/scenes/${sceneId}`],
      ['DELETE', `/api/v1/scenes/${sceneId}`],
    ] as const) {
      const res = await app.inject({ method, url, headers: auth, ...(method === 'PATCH' ? { payload: { title: 'x' } } : {}) });
      assert.equal(res.statusCode, 404, `${method} ${url} should be 404 after delete`);
    }
    const list = await app.inject({ method: 'GET', url: '/api/v1/projects?per_page=100', headers: auth });
    assert.ok(!list.json().data.some((p: { id: string }) => p.id === id), 'deleted project must not be listed');

    // But nothing was destroyed.
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
    assert.ok(row?.deletedAt, 'deleted_at is set');
    assert.equal(row?.title, 'Bin Me');
    const scenes = await db.select().from(schema.scenes).where(eq(schema.scenes.projectId, id));
    assert.equal(scenes.length, 1, 'scenes of a deleted project remain');
    const bibles = await db.select().from(schema.seriesBibles).where(eq(schema.seriesBibles.projectId, id));
    assert.equal(bibles.length, 1, 'series bible remains');

    // It shows in the bin, and only there.
    const bin = await app.inject({ method: 'GET', url: '/api/v1/projects?deleted=true', headers: auth });
    const binned = bin.json().data.find((p: { id: string }) => p.id === id);
    assert.ok(binned, 'deleted project is listed in the bin');
    assert.ok(binned.deleted_at, 'bin entries carry deleted_at');

    // Another account can neither see nor restore it (NF-13: 404, never 403).
    const other = await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/restore`, headers: { authorization: `Bearer ${teenToken}` } });
    assert.equal(other.statusCode, 404);

    // Put back: everything is reachable again, unchanged.
    const restored = await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/restore`, headers: auth });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().deleted_at, null);
    const again = await app.inject({ method: 'GET', url: `/api/v1/scenes/${sceneId}`, headers: auth });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().title, 'Kept scene');
    const restoreTwice = await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/restore`, headers: auth });
    assert.equal(restoreTwice.statusCode, 404, 'restoring a live project is a 404');
  });

  test('a deleted project is excluded from reorder validation', async () => {
    const auth = { authorization: `Bearer ${adultToken}` };
    const live = (await app.inject({ method: 'GET', url: '/api/v1/projects?per_page=100', headers: auth })).json().data as { id: string }[];
    const binMe = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: auth, payload: { title: 'Reorder Bin' } });
    await app.inject({ method: 'DELETE', url: `/api/v1/projects/${binMe.json().id}`, headers: auth });
    // Reordering only the live projects must succeed even though a deleted one exists.
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/reorder', headers: auth, payload: { project_ids: live.map((p) => p.id) } });
    assert.equal(res.statusCode, 200, res.body);
  });

  test('deleting a scene is logical: hidden, renumbered around, kept in the database, restorable', async () => {
    const auth = { authorization: `Bearer ${adultToken}` };
    const project = (await app.inject({ method: 'POST', url: '/api/v1/projects', headers: auth, payload: { title: 'Scene Bin' } })).json().id as string;
    const ids: string[] = [];
    for (const title of ['One', 'Two', 'Three']) {
      ids.push((await app.inject({ method: 'POST', url: `/api/v1/projects/${project}/scenes`, headers: auth, payload: { title } })).json().id as string);
    }

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/scenes/${ids[1]}`, headers: auth });
    assert.equal(del.statusCode, 204);

    // Hidden from every read; the survivors close the gap in numbering.
    const list = (await app.inject({ method: 'GET', url: `/api/v1/projects/${project}/scenes`, headers: auth })).json().data as { id: string; scene_number: number; title: string }[];
    assert.deepEqual(list.map((s) => [s.title, s.scene_number]), [['One', 1], ['Three', 2]]);
    for (const method of ['GET', 'DELETE'] as const) {
      const res = await app.inject({ method, url: `/api/v1/scenes/${ids[1]}`, headers: auth });
      assert.equal(res.statusCode, 404, `${method} of a deleted scene`);
    }
    const patch = await app.inject({ method: 'PATCH', url: `/api/v1/scenes/${ids[1]}`, headers: { ...auth, 'if-match': '1' }, payload: { title: 'x' } });
    assert.equal(patch.statusCode, 404);
    const reorderWithDeleted = await app.inject({ method: 'POST', url: `/api/v1/projects/${project}/scenes/reorder`, headers: auth, payload: { scene_ids: [ids[2], ids[1], ids[0]] } });
    assert.equal(reorderWithDeleted.statusCode, 422, 'a deleted scene cannot be part of a reorder');
    const reorder = await app.inject({ method: 'POST', url: `/api/v1/projects/${project}/scenes/reorder`, headers: auth, payload: { scene_ids: [ids[2], ids[0]] } });
    assert.equal(reorder.statusCode, 200, reorder.body);
    const projects = (await app.inject({ method: 'GET', url: '/api/v1/projects?per_page=100', headers: auth })).json().data as { id: string; scene_count: number }[];
    assert.equal(projects.find((p) => p.id === project)?.scene_count, 2, 'scene_count ignores the bin');

    // Still in the database.
    const [row] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, ids[1]!));
    assert.equal(row?.title, 'Two');
    assert.ok(row?.deletedAt);

    // In the bin, and restorable: it comes back at the end, renumbered.
    const bin = (await app.inject({ method: 'GET', url: `/api/v1/projects/${project}/scenes?deleted=true`, headers: auth })).json().data as { id: string; deleted_at: string | null }[];
    assert.deepEqual(bin.map((s) => s.id), [ids[1]]);
    assert.ok(bin[0]?.deleted_at);
    const other = await app.inject({ method: 'POST', url: `/api/v1/scenes/${ids[1]}/restore`, headers: { authorization: `Bearer ${teenToken}` } });
    assert.equal(other.statusCode, 404);
    const restored = await app.inject({ method: 'POST', url: `/api/v1/scenes/${ids[1]}/restore`, headers: auth });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().scene_number, 3);
    const after = (await app.inject({ method: 'GET', url: `/api/v1/projects/${project}/scenes`, headers: auth })).json().data as { title: string; scene_number: number }[];
    assert.deepEqual(after.map((s) => [s.title, s.scene_number]), [['Three', 1], ['One', 2], ['Two', 3]]);
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/scenes/${ids[1]}/restore`, headers: auth })).statusCode, 404);
  });

  test('rejects an invalid enum value with a field_errors map', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adultToken}` },
      payload: { title: 'Bad Audience', target_audience: 'grown_ups' },
    });
    assert.equal(res.statusCode, 422);
    const body = res.json();
    assert.ok(body.field_errors?.target_audience, 'expected a field-level error');
  });

  test('requires a title', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adultToken}` },
      payload: { title: '' },
    });
    assert.equal(res.statusCode, 422);
  });


  test('patching a project field must not blank the others', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adultToken}` },
      payload: {
        title: 'Preserve Me',
        logline: 'A logline worth keeping.',
        synopsis: 'A synopsis worth keeping.',
        genre: ['comedy'],
        tone: ['warm'],
        target_audience: 'tween',
      },
    });
    const id = created.json().id as string;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${id}`,
      headers: { authorization: `Bearer ${adultToken}` },
      payload: { status: 'in_progress' },
    });
    assert.equal(patched.statusCode, 200);

    const after = patched.json();
    assert.equal(after.status, 'in_progress');
    assert.equal(after.logline, 'A logline worth keeping.');
    assert.equal(after.synopsis, 'A synopsis worth keeping.');
    assert.deepEqual(after.genre, ['comedy']);
    assert.deepEqual(after.tone, ['warm']);
    assert.equal(after.target_audience, 'tween');
  });

  test('scene_count and episode_count are real counts, not silently zero', async () => {
    // Regression: the correlated subqueries were interpolating drizzle column refs, which
    // renders them unqualified inside the subquery -- "id" bound to scenes.id rather than
    // projects.id, so every count came back 0 without raising. A count of 0 is a plausible
    // value, which is exactly why this needs a test rather than a glance.
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adultToken}` },
      payload: { title: 'Count Check Project' },
    });
    const projectId = created.json().id as string;

    // A project is created with one default episode (scenes hang off it in the UI).
    assert.equal(created.json().episode_count, 1);

    for (const title of ['One', 'Two', 'Three']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/scenes`,
        headers: { authorization: `Bearer ${adultToken}` },
        payload: { title },
      });
      assert.equal(res.statusCode, 201);
    }

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adultToken}` },
    });
    const row = list.json().data.find((p: { id: string }) => p.id === projectId);
    assert.equal(row.scene_count, 3, 'scene_count must reflect the scenes that exist');
    assert.equal(row.episode_count, 1);
  });
});

describe('scenes', () => {
  let projectId: string;

  before(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adultToken}` },
      payload: { title: 'Scene Ordering Project' },
    });
    projectId = res.json().id as string;
    for (const title of ['A', 'B', 'C', 'D']) {
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/scenes`,
        headers: { authorization: `Bearer ${adultToken}` },
        payload: { title },
      });
    }
  });

  async function order(): Promise<string[]> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scenes`,
      headers: { authorization: `Bearer ${adultToken}` },
    });
    return res.json().data.map((s: { title: string }) => s.title);
  }

  async function scenes() {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scenes`,
      headers: { authorization: `Bearer ${adultToken}` },
    });
    return res.json().data as { id: string; title: string; scene_number: number }[];
  }

  test('scenes are created in order and numbered from 1', async () => {
    const rows = await scenes();
    assert.deepEqual(rows.map((s) => s.title), ['A', 'B', 'C', 'D']);
    assert.deepEqual(rows.map((s) => s.scene_number), [1, 2, 3, 4]);
  });

  test('reordering resequences scene_number (SC-1)', async () => {
    const rows = await scenes();
    const moved = [rows[3]!, rows[0]!, rows[1]!, rows[2]!];

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scenes/reorder`,
      headers: { authorization: `Bearer ${adultToken}` },
      payload: { scene_ids: moved.map((s) => s.id) },
    });
    assert.equal(res.statusCode, 200);

    const after = res.json().data as { title: string; scene_number: number }[];
    assert.deepEqual(after.map((s) => s.title), ['D', 'A', 'B', 'C']);
    // Numbering is derived server-side, so it must be contiguous from 1 regardless of
    // what the client believed.
    assert.deepEqual(after.map((s) => s.scene_number), [1, 2, 3, 4]);
  });

  test('a partial reorder list is rejected rather than half-applied', async () => {
    const rows = await scenes();
    const before = rows.map((s) => s.title);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scenes/reorder`,
      headers: { authorization: `Bearer ${adultToken}` },
      payload: { scene_ids: [rows[0]!.id] },
    });
    assert.equal(res.statusCode, 422);
    assert.deepEqual(await order(), before, 'order must be untouched after a rejected reorder');
  });

  test('deleting a scene closes the gap in numbering', async () => {
    const rows = await scenes();
    const removed = rows[1]!;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/scenes/${removed.id}`,
      headers: { authorization: `Bearer ${adultToken}` },
    });
    assert.equal(res.statusCode, 204);

    const after = await scenes();
    assert.equal(after.length, rows.length - 1);
    assert.deepEqual(
      after.map((s) => s.scene_number),
      after.map((_, i) => i + 1),
      'numbering must stay contiguous after a delete',
    );
    assert.ok(!after.some((s) => s.id === removed.id));
  });

  test('NF-13: scenes are not reachable across accounts', async () => {
    const rows = await scenes();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/scenes/${rows[0]!.id}`,
      headers: { authorization: `Bearer ${teenToken}` },
    });
    assert.equal(res.statusCode, 404);

    const reorder = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scenes/reorder`,
      headers: { authorization: `Bearer ${teenToken}` },
      payload: { scene_ids: rows.map((s) => s.id) },
    });
    assert.equal(reorder.statusCode, 404);
  });


  test('patching one field must not blank the others', async () => {
    // Regression, and the nastiest bug found so far: updateBody was `createBody.partial()`,
    // and Zod's .partial() keeps .default(). A PATCH of one field therefore parsed into an
    // object holding every OTHER defaulted field as '', which the handler wrote over the
    // user's work. Saving a scene silently erased everything typed before it.
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scenes`,
      headers: { authorization: `Bearer ${adultToken}` },
      payload: {
        title: 'Full Scene',
        scene_intent: 'Establish the stakes.',
        action_description: 'Milo grabs the parcel.',
        scenery_description: 'Peeling yellow paint.',
        time_of_day: 'morning',
        emotional_beat: 'calm to panic',
        director_notes: 'Remember the dog.',
      },
    });
    assert.equal(created.statusCode, 201);
    const scene = created.json();

    // Change exactly one field.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/scenes/${scene.id}`,
      headers: { authorization: `Bearer ${adultToken}`, 'if-match': String(scene.version) },
      payload: { title: 'Full Scene, renamed' },
    });
    assert.equal(patched.statusCode, 200);

    const after = patched.json();
    assert.equal(after.title, 'Full Scene, renamed');
    for (const [field, expected] of [
      ['scene_intent', 'Establish the stakes.'],
      ['action_description', 'Milo grabs the parcel.'],
      ['scenery_description', 'Peeling yellow paint.'],
      ['time_of_day', 'morning'],
      ['emotional_beat', 'calm to panic'],
      ['director_notes', 'Remember the dog.'],
    ] as const) {
      assert.equal(after[field], expected, `${field} must survive a PATCH of another field`);
    }
  });

  test('an explicit empty string still clears a field', async () => {
    // The fix must not overshoot: absent means "leave alone", but an explicitly sent ''
    // is a real instruction to clear.
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scenes`,
      headers: { authorization: `Bearer ${adultToken}` },
      payload: { title: 'Clearable', scene_intent: 'Something to remove.' },
    });
    const scene = created.json();

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/scenes/${scene.id}`,
      headers: { authorization: `Bearer ${adultToken}`, 'if-match': String(scene.version) },
      payload: { scene_intent: '' },
    });
    assert.equal(patched.json().scene_intent, '');
  });

  test('NF-10: a stale If-Match is a 409 carrying the current state', async () => {
    const rows = await scenes();
    const target = rows[0]!;

    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/v1/scenes/${target.id}`,
      headers: { authorization: `Bearer ${adultToken}`, 'if-match': '1' },
      payload: { title: 'Renamed once' },
    });
    assert.equal(ok.statusCode, 200);

    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/v1/scenes/${target.id}`,
      headers: { authorization: `Bearer ${adultToken}`, 'if-match': '1' },
      payload: { title: 'Renamed again' },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().current_state.title, 'Renamed once');
  });
});

test('sign-in is rate limited: the eleventh guess in a minute is refused', async () => {
  let last = 0;
  for (let i = 0; i < 11; i++) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.9.9.9', payload: { email: 'nobody@example.com', password: 'wrong' } });
    last = res.statusCode;
  }
  assert.equal(last, 429);
});
