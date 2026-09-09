import type { FastifyInstance } from 'fastify';
import { and, eq, asc, desc, inArray, sql as raw, isNull, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.ts';
import { ApiError } from '../errors.ts';
import { values } from '@storyboard/vocabularies';
import { sceneThumbnailMetadata, sceneThumbnailPreviews } from '../thumbnails/context.ts';
import { sceneDescription } from '../scenes/description.ts';

const TIME_OF_DAY = values('time_of_day') as [string, ...string[]];
const MOOD = values('mood_atmosphere') as [string, ...string[]];
const CAMERA_ANGLES = ['eye_level', 'low_angle', 'high_angle', 'birds_eye', 'profile', 'three_quarter'] as const;

const createBody = z.object({
  description: z.string().max(12000).optional(),
  camera_angle: z.enum(CAMERA_ANGLES).nullable().optional(),
  title: z.string().min(1).max(200),
  scene_intent: z.string().default(''),
  action_description: z.string().default(''),
  scenery_description: z.string().default(''),
  time_of_day: z.enum(TIME_OF_DAY).default('unspecified'),
  mood_atmosphere: z.enum(MOOD).nullable().optional(),
  emotional_beat: z.string().max(200).default(''),
  director_notes: z.string().default(''),
  location_id: z.string().uuid().nullable().optional(),
});

/**
 * Defined separately rather than as `createBody.partial()`.
 *
 * Zod's `.partial()` makes keys optional but does NOT strip `.default()`, so a PATCH of one
 * field parses into an object containing every defaulted field filled with '' — and the
 * handler then writes those blanks over the user's work. Every field here is optional with
 * no default, so an absent key stays absent and is never patched.
 */
const updateBody = z.object({
  description: z.string().max(12000).optional(),
  camera_angle: z.enum(CAMERA_ANGLES).nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  scene_intent: z.string().optional(),
  action_description: z.string().optional(),
  scenery_description: z.string().optional(),
  time_of_day: z.enum(TIME_OF_DAY).optional(),
  mood_atmosphere: z.enum(MOOD).nullable().optional(),
  emotional_beat: z.string().max(200).optional(),
  director_notes: z.string().optional(),
  location_id: z.string().uuid().nullable().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

/**
 * §3.10 — the slugline is derived, never typed. Without a location yet (which is the normal
 * state for a new user who has not built their world) it falls back to the scene title, so
 * the board still reads sensibly rather than showing "INT. — DAY".
 */
function buildSlugline(
  title: string,
  timeOfDay: string,
  location?: { name: string; interiorExterior: string } | null,
): string {
  const time = timeOfDay === 'unspecified' ? '' : ` — ${timeOfDay.toUpperCase()}`;
  if (!location) return title ? `${title.toUpperCase()}${time}` : 'UNTITLED SCENE';
  return `${location.interiorExterior}. ${location.name.toUpperCase()}${time}`;
}

function present(s: typeof schema.scenes.$inferSelect) {
  return {
    id: s.id,
    scene_number: s.sceneNumber,
    sort_order: s.sortOrder,
    slugline: s.slugline,
    title: s.title,
    description: sceneDescription(s),
    camera_angle: s.cameraAngle,
    location_id: s.locationId,
    time_of_day: s.timeOfDay,
    mood_atmosphere: s.moodAtmosphere,
    emotional_beat: s.emotionalBeat,
    // §3.10 — director_notes is never exported to prompts. It is the user's own margin note.
    director_notes: s.directorNotes,
    scene_intent: s.sceneIntent,
    action_description: s.actionDescription,
    scenery_description: s.sceneryDescription,
    is_locked: s.isLocked,
    version: s.version,
    updated_at: s.updatedAt.toISOString(),
    thumbnail: null,
  };
}

async function presentMany(rows: (typeof schema.scenes.$inferSelect)[], includePreviews = false) {
  if (!rows.length) return [];
  const thumbnails = await sceneThumbnailMetadata(rows, rows[0]!.accountId);
  const previews = includePreviews ? await sceneThumbnailPreviews(rows, rows[0]!.accountId) : new Map();
  return rows.map((s) => ({ ...present(s), deleted_at: s.deletedAt ? s.deletedAt.toISOString() : null, thumbnail: thumbnails.get(s.id) ?? null,
    ...(includePreviews ? { thumbnail_preview: previews.get(s.id) ?? null } : {}),
  }));
}

async function ownedLocation(accountId: string, projectId: string, id: string | null | undefined) {
  if (!id) return null;
  const [location] = await db.select().from(schema.locations).where(and(
    eq(schema.locations.id, id), eq(schema.locations.projectId, projectId), eq(schema.locations.accountId, accountId),
  ));
  if (!location) throw ApiError.notFound('Location');
  return location;
}

/**
 * Scenes of a logically deleted cartoon are hidden along with it. Written out longhand:
 * interpolated drizzle columns render unqualified inside a raw subquery (see docs/working-in-this-repo.md).
 */
export const projectIsLive = raw`EXISTS (
  SELECT 1 FROM projects WHERE projects.id = scenes.project_id AND projects.deleted_at IS NULL
)`;

/** A scene the client may see: not in the bin itself, and its cartoon not in the bin either. */
const sceneIsLive = and(isNull(schema.scenes.deletedAt), projectIsLive)!;

/** Confirms the project belongs to the caller, is not in the bin, and returns its default episode. */
async function resolveEpisode(accountId: string, projectId: string) {
  const [row] = await db
    .select({ episodeId: schema.episodes.id })
    .from(schema.projects)
    .innerJoin(schema.episodes, eq(schema.episodes.projectId, schema.projects.id))
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.accountId, accountId), isNull(schema.projects.deletedAt)))
    .orderBy(asc(schema.episodes.sortOrder))
    .limit(1);

  if (!row) throw ApiError.notFound('Project');
  return row.episodeId;
}

/**
 * Rewrites sort_order and scene_number to match the given order, in one transaction (SC-1).
 *
 * scene_number is derived, so it is always recomputed here rather than trusted from the
 * client — that is what stops a reorder leaving gaps or duplicates in the numbering.
 */
async function resequence(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  episodeId: string,
  orderedIds: string[],
): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await tx
      .update(schema.scenes)
      .set({ sortOrder: index, sceneNumber: index + 1, updatedAt: new Date() })
      .where(and(eq(schema.scenes.id, id), eq(schema.scenes.episodeId, episodeId)));
  }
}

export async function sceneRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.requireAuth);

  app.get('/projects/:id/scenes', async (request) => {
    const { id } = idParam.parse(request.params);
    const { deleted } = z.object({ deleted: z.enum(['true', 'false']).default('false') }).parse(request.query);
    const episodeId = await resolveEpisode(request.accountId, id);

    const rows = deleted === 'true'
      ? await db.select().from(schema.scenes)
          .where(and(eq(schema.scenes.episodeId, episodeId), isNotNull(schema.scenes.deletedAt)))
          .orderBy(desc(schema.scenes.deletedAt), asc(schema.scenes.id))
      : await db.select().from(schema.scenes)
          .where(and(eq(schema.scenes.episodeId, episodeId), isNull(schema.scenes.deletedAt)))
          .orderBy(asc(schema.scenes.sortOrder));

    return { data: await presentMany(rows, deleted !== 'true') };
  });

  app.post('/projects/:id/scenes', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = createBody.parse(request.body);
    const episodeId = await resolveEpisode(request.accountId, id);

    const location = await ownedLocation(request.accountId, id, body.location_id);

    const scene = await db.transaction(async (tx) => {
      // New scenes land at the end of the board.
      const [{ next = 0 } = {}] = await tx
        .select({ next: raw<number>`COALESCE(MAX(${schema.scenes.sortOrder}) + 1, 0)::int` })
        .from(schema.scenes)
        .where(and(eq(schema.scenes.episodeId, episodeId), isNull(schema.scenes.deletedAt)));

      const [created] = await tx
        .insert(schema.scenes)
        .values({
          accountId: request.accountId,
          projectId: id,
          episodeId,
          title: body.title,
          description: body.description ?? null,
          cameraAngle: body.camera_angle ?? null,
          sceneIntent: body.scene_intent,
          actionDescription: body.action_description,
          sceneryDescription: body.scenery_description,
          timeOfDay: body.time_of_day,
          moodAtmosphere: body.mood_atmosphere ?? null,
          emotionalBeat: body.emotional_beat,
          directorNotes: body.director_notes,
          locationId: body.location_id ?? null,
          sortOrder: next,
          sceneNumber: next + 1,
          slugline: buildSlugline(body.title, body.time_of_day, location),
        })
        .returning();

      if (!created) throw new Error('scene insert returned no row');
      return created;
    });

    return reply.status(201).send(present(scene));
  });

  app.get('/scenes/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const [row] = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, request.accountId), sceneIsLive))
      .limit(1);

    if (!row) throw ApiError.notFound('Scene');
    return (await presentMany([row]))[0];
  });

  app.patch('/scenes/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const body = updateBody.parse(request.body);

    const [current] = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, request.accountId), sceneIsLive))
      .limit(1);

    if (!current) throw ApiError.notFound('Scene');

    // NF-10: optimistic concurrency. A stale write returns 409 with the server's record so
    // the client can diff per field without a second round trip, rather than silently losing
    // an edit made on another device.
    const ifMatch = z.coerce.number().int().positive().parse(request.headers['if-match']);
    if (ifMatch !== current.version) {
      throw ApiError.conflict(
        'This scene was changed somewhere else since you loaded it.',
        (await presentMany([current]))[0],
      );
    }

    if (current.isLocked) {
      throw ApiError.validation('This scene is locked. Unlock it before editing.');
    }

    const patch: Partial<typeof schema.scenes.$inferInsert> = {
      updatedAt: new Date(),
      version: current.version + 1,
    };
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.camera_angle !== undefined) patch.cameraAngle = body.camera_angle;
    if (body.scene_intent !== undefined) patch.sceneIntent = body.scene_intent;
    if (body.action_description !== undefined) patch.actionDescription = body.action_description;
    if (body.scenery_description !== undefined) patch.sceneryDescription = body.scenery_description;
    if (body.time_of_day !== undefined) patch.timeOfDay = body.time_of_day;
    if (body.mood_atmosphere !== undefined) patch.moodAtmosphere = body.mood_atmosphere;
    if (body.emotional_beat !== undefined) patch.emotionalBeat = body.emotional_beat;
    if (body.director_notes !== undefined) patch.directorNotes = body.director_notes;
    if (body.location_id !== undefined) patch.locationId = body.location_id;

    const title = body.title ?? current.title;
    const timeOfDay = body.time_of_day ?? current.timeOfDay;
    const location = await ownedLocation(request.accountId, current.projectId,
      body.location_id === undefined ? current.locationId : body.location_id);
    patch.slugline = buildSlugline(title, timeOfDay, location);

    const [row] = await db
      .update(schema.scenes)
      .set(patch)
      .where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, request.accountId), eq(schema.scenes.version, ifMatch)))
      .returning();

    if (!row) {
      const [fresh] = await db.select().from(schema.scenes).where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, request.accountId)));
      if (!fresh) throw ApiError.notFound('Scene');
      throw ApiError.conflict('This scene changed while saving. Your unsaved text is still here.', (await presentMany([fresh]))[0]);
    }
    return (await presentMany([row]))[0];
  });

  app.delete('/scenes/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);

    const [scene] = await db
      .select({ episodeId: schema.scenes.episodeId })
      .from(schema.scenes)
      .where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, request.accountId), sceneIsLive))
      .limit(1);

    if (!scene) throw ApiError.notFound('Scene');

    // Logical delete: the row, its thumbnail asset and its AI history stay. Only pending
    // previews are cancelled, because they were fingerprinted against a board that is
    // about to change; a restored scene simply asks for a new one.
    await db.transaction(async (tx) => {
      await tx.update(schema.scenes).set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, request.accountId)));
      await tx.update(schema.aiProposals).set({ status: 'cancelled', payload: {}, resolvedAt: new Date() }).where(and(
        eq(schema.aiProposals.targetEntityId, id), eq(schema.aiProposals.accountId, request.accountId), eq(schema.aiProposals.status, 'pending'),
      ));

      // Deleting scene 3 of 6 must not leave a hole in the numbering.
      const remaining = await tx
        .select({ id: schema.scenes.id })
        .from(schema.scenes)
        .where(and(eq(schema.scenes.episodeId, scene.episodeId), isNull(schema.scenes.deletedAt)))
        .orderBy(asc(schema.scenes.sortOrder));

      await resequence(tx, scene.episodeId, remaining.map((r) => r.id));
    });

    return reply.status(204).send();
  });

  /** Puts a scene back from the bin, at the end of the board, renumbered. */
  app.post('/scenes/:id/restore', async (request) => {
    const { id } = idParam.parse(request.params);
    const row = await db.transaction(async (tx) => {
      const [scene] = await tx.select().from(schema.scenes)
        .where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, request.accountId), isNotNull(schema.scenes.deletedAt), projectIsLive))
        .for('update');
      if (!scene) throw ApiError.notFound('Scene');
      const [{ next = 0 } = {}] = await tx
        .select({ next: raw<number>`COALESCE(MAX(${schema.scenes.sortOrder}) + 1, 0)::int` })
        .from(schema.scenes)
        .where(and(eq(schema.scenes.episodeId, scene.episodeId), isNull(schema.scenes.deletedAt)));
      const [restored] = await tx.update(schema.scenes)
        .set({ deletedAt: null, sortOrder: next, sceneNumber: next + 1, version: scene.version + 1, updatedAt: new Date() })
        .where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, request.accountId)))
        .returning();
      return restored!;
    });
    return (await presentMany([row], true))[0];
  });

  // SC-1 — reorder and resequence. The client sends the complete intended order, which makes
  // the operation idempotent and safe to retry, unlike a relative "move up" instruction.
  app.post('/projects/:id/scenes/reorder', async (request) => {
    const { id } = idParam.parse(request.params);
    const { scene_ids } = z
      .object({ scene_ids: z.array(z.string().uuid()).min(1) })
      .parse(request.body);

    const episodeId = await resolveEpisode(request.accountId, id);

    const existing = await db
      .select({ id: schema.scenes.id })
      .from(schema.scenes)
      .where(and(eq(schema.scenes.episodeId, episodeId), inArray(schema.scenes.id, scene_ids), isNull(schema.scenes.deletedAt)));

    // Reject a partial list outright: applying it would renumber some scenes and orphan
    // others at stale positions, which is worse than refusing.
    if (existing.length !== scene_ids.length) {
      throw ApiError.validation(
        'The reorder list does not match the scenes in this project. Reload and try again.',
      );
    }
    const total = await db
      .select({ n: raw<number>`COUNT(*)::int` })
      .from(schema.scenes)
      .where(and(eq(schema.scenes.episodeId, episodeId), isNull(schema.scenes.deletedAt)));

    if ((total[0]?.n ?? 0) !== scene_ids.length) {
      throw ApiError.validation(
        'The reorder list must include every scene in the project. Reload and try again.',
      );
    }

    await db.transaction(async (tx) => resequence(tx, episodeId, scene_ids));

    const rows = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.episodeId, episodeId), isNull(schema.scenes.deletedAt)))
      .orderBy(asc(schema.scenes.sortOrder));

    return { data: await presentMany(rows, true) };
  });
}
