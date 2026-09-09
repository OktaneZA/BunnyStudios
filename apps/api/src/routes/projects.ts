import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, isNotNull, sql as raw, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.ts';
import { ApiError } from '../errors.ts';

const TARGET_AUDIENCE = ['preschool', 'kids_6_11', 'tween', 'teen', 'adult', 'all_ages'] as const;
const EDITOR_MODE = ['simple', 'advanced'] as const;
const STATUS = ['draft', 'in_progress', 'complete', 'archived'] as const;

const createBody = z.object({
  series_number: z.number().int().min(1).max(999999).nullable().optional(),
  title: z.string().min(1).max(200),
  logline: z.string().max(500).default(''),
  synopsis: z.string().default(''),
  genre: z.array(z.string()).default([]),
  target_audience: z.enum(TARGET_AUDIENCE).default('kids_6_11'),
  tone: z.array(z.string()).default([]),
  editor_mode: z.enum(EDITOR_MODE).optional(),
});

/**
 * Explicit rather than `createBody.partial()` — see the note in routes/scenes.ts. `.partial()`
 * keeps `.default()`, so renaming a project would have silently blanked its logline, synopsis,
 * genre and tone.
 */
const updateBody = z.object({
  series_number: z.number().int().min(1).max(999999).nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  logline: z.string().max(500).optional(),
  synopsis: z.string().optional(),
  genre: z.array(z.string()).optional(),
  target_audience: z.enum(TARGET_AUDIENCE).optional(),
  tone: z.array(z.string()).optional(),
  editor_mode: z.enum(EDITOR_MODE).optional(),
  status: z.enum(STATUS).optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(STATUS).optional(),
  q: z.string().optional(),
  /** `true` lists only cartoons in the bin, so they can be put back. */
  deleted: z.enum(['true', 'false']).default('false'),
});

/** Shapes a row for the wire. snake_case out, matching the §10 API surface. */
function present(p: typeof schema.projects.$inferSelect, counts?: { episodes: number; scenes: number }) {
  return {
    id: p.id,
    title: p.title,
    logline: p.logline,
    synopsis: p.synopsis,
    genre: p.genre,
    target_audience: p.targetAudience,
    tone: p.tone,
    editor_mode: p.editorMode,
    status: p.status,
    series_number: p.seriesNumber,
    cover_image_asset_id: p.coverImageAssetId,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
    deleted_at: p.deletedAt ? p.deletedAt.toISOString() : null,
    ...(counts ? { episode_count: counts.episodes, scene_count: counts.scenes } : {}),
  };
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.requireAuth);

  app.post('/projects/reorder', async (request) => {
    const { project_ids } = z.object({ project_ids: z.array(z.string().uuid()).min(1) }).parse(request.body);
    await db.transaction(async (tx) => {
      await tx.select().from(schema.accounts).where(eq(schema.accounts.id, request.accountId)).for('update');
      const owned = await tx.select({ id: schema.projects.id }).from(schema.projects)
        .where(and(eq(schema.projects.accountId, request.accountId), isNull(schema.projects.deletedAt))).for('update');
      if (new Set(project_ids).size !== project_ids.length || owned.length !== project_ids.length ||
        owned.some((p) => !project_ids.includes(p.id))) {
        throw ApiError.validation('The cartoon list changed. Reload before reordering.');
      }
      const updatedAt = new Date();
      for (const [index, id] of project_ids.entries()) {
        await tx.update(schema.projects).set({ seriesNumber: index + 1, updatedAt })
          .where(and(eq(schema.projects.id, id), eq(schema.projects.accountId, request.accountId)));
      }
    });
    return { saved: true };
  });

  // PR-2 / PR-3 / PR-4 — paginated, filterable, with counts resolved in one query (no N+1, NF-6).
  app.get('/projects', async (request) => {
    const { page, per_page, status, q, deleted } = listQuery.parse(request.query);

    const filters = [
      eq(schema.projects.accountId, request.accountId),
      deleted === 'true' ? isNotNull(schema.projects.deletedAt) : isNull(schema.projects.deletedAt),
    ];
    if (status) filters.push(eq(schema.projects.status, status));
    if (q) filters.push(raw`${schema.projects.title} ILIKE ${'%' + q + '%'}`);
    const where = and(...filters);

    const rows = await db
      .select({
        project: schema.projects,
        // Table names are written out rather than interpolated as drizzle column
        // references. Interpolating them renders the columns UNQUALIFIED inside the
        // subquery, so `"id"` binds to scenes.id instead of projects.id and the count
        // silently returns 0 for every project rather than raising an error.
        episodeCount: raw<number>`(
          SELECT COUNT(*)::int FROM episodes WHERE episodes.project_id = projects.id
        )`,
        sceneCount: raw<number>`(
          SELECT COUNT(*)::int FROM scenes WHERE scenes.project_id = projects.id AND scenes.deleted_at IS NULL
        )`,
      })
      .from(schema.projects)
      .where(where)
      .orderBy(...(deleted === 'true'
        ? [desc(schema.projects.deletedAt), schema.projects.id]
        : [raw`${schema.projects.seriesNumber} ASC NULLS LAST`, desc(schema.projects.updatedAt), schema.projects.id]))
      .limit(per_page)
      .offset((page - 1) * per_page);

    const [{ total = 0 } = {}] = await db
      .select({ total: raw<number>`COUNT(*)::int` })
      .from(schema.projects)
      .where(where);

    return {
      data: rows.map((r) => present(r.project, { episodes: r.episodeCount, scenes: r.sceneCount })),
      page,
      per_page,
      total,
    };
  });

  app.post('/projects', async (request, reply) => {
    const body = createBody.parse(request.body);

    const [account] = await db
      .select({ defaultEditorMode: schema.accounts.defaultEditorMode })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, request.accountId))
      .limit(1);

    // §3.3 — a project's editor_mode overrides the account default when set explicitly.
    const editorMode = body.editor_mode ?? account?.defaultEditorMode ?? 'simple';

    // The SeriesBible is 1:1 with Project (§3.4) and every compiled prompt inherits from it,
    // so it is created in the same transaction — a project can never exist without one.
    const project = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.projects)
        .values({
          accountId: request.accountId,
          seriesNumber: body.series_number,
          title: body.title,
          logline: body.logline,
          synopsis: body.synopsis,
          genre: body.genre,
          targetAudience: body.target_audience,
          tone: body.tone,
          editorMode: editorMode,
        })
        .returning();

      if (!created) throw new Error('project insert returned no row');

      await tx.insert(schema.seriesBibles).values({
        accountId: request.accountId,
        projectId: created.id,
      });

      // Scenes belong to an Episode in the domain model (§3.9/§3.10) and export filenames
      // depend on it (E01_S04_SH02, EX-7). The UI presents scenes directly under a project,
      // so every project gets a default episode here and the layer stays hidden until a
      // user actually needs a second one. Keeping the row means no migration when they do.
      await tx.insert(schema.episodes).values({
        accountId: request.accountId,
        projectId: created.id,
        episodeNumber: 1,
        title: 'Episode 1',
        sortOrder: 0,
      });

      return created;
    });

    return reply.status(201).send(present(project, { episodes: 1, scenes: 0 }));
  });

  app.get('/projects/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const [row] = await db
      .select()
      .from(schema.projects)
      // NF-13: scoped by the authenticated account, never by a client-supplied id.
      .where(and(eq(schema.projects.id, id), eq(schema.projects.accountId, request.accountId), isNull(schema.projects.deletedAt)))
      .limit(1);

    if (!row) throw ApiError.notFound('Project');
    return present(row);
  });

  app.patch('/projects/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateBody.parse(request.body);

    const patch: Partial<typeof schema.projects.$inferInsert> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.series_number !== undefined) patch.seriesNumber = body.series_number;
    if (body.logline !== undefined) patch.logline = body.logline;
    if (body.synopsis !== undefined) patch.synopsis = body.synopsis;
    if (body.genre !== undefined) patch.genre = body.genre;
    if (body.target_audience !== undefined) patch.targetAudience = body.target_audience;
    if (body.tone !== undefined) patch.tone = body.tone;
    if (body.editor_mode !== undefined) patch.editorMode = body.editor_mode;
    if (body.status !== undefined) patch.status = body.status;

    const [row] = await db
      .update(schema.projects)
      .set(patch)
      .where(and(eq(schema.projects.id, id), eq(schema.projects.accountId, request.accountId), isNull(schema.projects.deletedAt)))
      .returning();

    if (!row) throw ApiError.notFound('Project');
    return present(row);
  });

  /**
   * Logical delete. The row and everything under it stay in the database; only
   * `deleted_at` is set, and every other read filters it out. A cartoon in the bin can be
   * put back with POST /projects/:id/restore. Deleting twice is a 404, like any other
   * read of a deleted cartoon.
   */
  app.delete('/projects/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const [row] = await db
      .update(schema.projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.projects.id, id), eq(schema.projects.accountId, request.accountId), isNull(schema.projects.deletedAt)))
      .returning({ id: schema.projects.id });

    if (!row) throw ApiError.notFound('Project');
    return reply.status(204).send();
  });

  app.post('/projects/:id/restore', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const [row] = await db
      .update(schema.projects)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(schema.projects.id, id), eq(schema.projects.accountId, request.accountId), isNotNull(schema.projects.deletedAt)))
      .returning();

    if (!row) throw ApiError.notFound('Project');
    return present(row);
  });
}
