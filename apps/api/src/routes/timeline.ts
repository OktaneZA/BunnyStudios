/**
 * Put it together (plan D36, D40, DM-21–DM-24): the timeline, its music and voice tracks,
 * the three transitions, and the render job.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.ts';
import { ApiError } from '../errors.ts';
import { validateUpload } from '../storage/uploads.ts';
import { ensureTimeline, resolveItems, totalMs, STILL_HOLD_MS } from '../jobs/render.ts';
import { TRANSITION_MS } from '../generation/media.ts';
import { isConstrained, presentAsset, presentJob, type DirectorDeps } from './director.ts';

const idParam = z.object({ id: z.string().uuid() });
const TRANSITIONS = ['cut', 'fade', 'slide'] as const;

/**
 * The caller's own, live cartoon first, then its timeline. ensureTimeline inserts a row when
 * there is none, so without this check another account could claim a cartoon's timeline slot.
 */
async function ownTimeline(accountId: string, projectId: string) {
  await isConstrained(db, accountId, projectId);
  return ensureTimeline(accountId, projectId);
}

export async function timelineRoutes(app: FastifyInstance, deps: DirectorDeps) {
  app.addHook('onRequest', app.requireAuth);
  const { store, runner } = deps;

  async function present(accountId: string, projectId: string) {
    const { account } = await isConstrained(db, accountId, projectId);
    const timeline = await ensureTimeline(accountId, projectId);
    const items = await resolveItems(accountId, projectId, account.isMinor);
    // Which scenes have a clip being made right now, so Write and Make clips show the same state.
    const activeShots = await db.select({ sceneId: schema.shots.sceneId }).from(schema.generationJobs)
      .innerJoin(schema.shots, eq(schema.shots.id, schema.generationJobs.targetEntityId))
      .where(and(eq(schema.generationJobs.projectId, projectId), eq(schema.generationJobs.accountId, accountId), eq(schema.generationJobs.kind, 'video'),
        inArray(schema.generationJobs.status, ['queued', 'submitted', 'running', 'reviewing'])));
    const makingScenes = new Set(activeShots.map((r) => r.sceneId));
    const [music] = timeline.musicAssetId ? await db.select().from(schema.assets).where(and(eq(schema.assets.id, timeline.musicAssetId), eq(schema.assets.accountId, accountId), isNull(schema.assets.deletedAt))) : [];
    const voiceRows = await db.select().from(schema.timelineVoiceovers).where(and(eq(schema.timelineVoiceovers.timelineId, timeline.id), isNull(schema.timelineVoiceovers.deletedAt))).orderBy(asc(schema.timelineVoiceovers.startMs));
    const voiceAssets = voiceRows.length ? await db.select().from(schema.assets).where(and(inArray(schema.assets.id, voiceRows.map((v) => v.assetId)), isNull(schema.assets.deletedAt))) : [];
    const [renderAsset] = timeline.renderAssetId ? await db.select().from(schema.assets).where(and(eq(schema.assets.id, timeline.renderAssetId), isNull(schema.assets.deletedAt))) : [];
    const [activeJob] = await db.select().from(schema.generationJobs).where(and(eq(schema.generationJobs.targetEntityId, timeline.id), eq(schema.generationJobs.kind, 'render'), inArray(schema.generationJobs.status, ['queued', 'submitted', 'running', 'reviewing']))).limit(1);
    const [lastJob] = await db.select().from(schema.generationJobs).where(and(eq(schema.generationJobs.targetEntityId, timeline.id), eq(schema.generationJobs.kind, 'render'))).orderBy(desc(schema.generationJobs.createdAt)).limit(1);
    const renders = await db.select().from(schema.assets).where(and(eq(schema.assets.ownerEntityId, timeline.id), eq(schema.assets.kind, 'final_render'), isNull(schema.assets.deletedAt))).orderBy(schema.assets.uploadedAt);
    const total = totalMs(items, TRANSITION_MS);
    // start_ms walks only the items that play, so an empty scene between two playing ones
    // neither adds time nor breaks the transition overlap of the pair around it.
    let cursor = 0;
    let previousPlaying: (typeof items)[number] | null = null;
    return {
      id: timeline.id,
      version: timeline.version,
      hand_edited: timeline.handEdited,
      total_ms: total,
      still_hold_ms: STILL_HOLD_MS,
      transition_ms: TRANSITION_MS,
      items: items.map((i) => {
        let start = cursor;
        if (i.durationMs > 0) {
          if (previousPlaying && previousPlaying.transitionOut !== 'cut') start -= TRANSITION_MS;
          cursor = Math.max(0, start) + i.durationMs;
          start = Math.max(0, start);
          previousPlaying = i;
        }
        return {
          id: i.itemId, scene_id: i.sceneId, scene_number: i.sceneNumber, scene_title: i.sceneTitle,
          source: i.source, duration_ms: i.durationMs, start_ms: i.durationMs > 0 ? start : null,
          has_sound: i.source === 'video' && Boolean(i.asset?.durationMs),
          making: makingScenes.has(i.sceneId),
          asset: i.asset ? presentAsset(i.asset) : null, transition_out: i.transitionOut,
        };
      }),
      music: music ? { asset: presentAsset(music), volume: timeline.musicVolume, fade_in_ms: timeline.musicFadeInMs, fade_out_ms: timeline.musicFadeOutMs } : null,
      voiceovers: voiceRows.map((v) => { const a = voiceAssets.find((x) => x.id === v.assetId); return { id: v.id, start_ms: v.startMs, volume: v.volume, duration_ms: a?.durationMs ?? null, asset: a ? presentAsset(a) : null }; }),
      render: renderAsset ? presentAsset(renderAsset) : null,
      renders: renders.reverse().map(presentAsset),
      render_job: activeJob ? presentJob(activeJob, [], account.isMinor) : lastJob && lastJob.status === 'failed' ? presentJob(lastJob, [], account.isMinor) : null,
    };
  }

  app.get('/projects/:id/timeline', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    reply.header('Cache-Control', 'no-store');
    return present(request.accountId, id);
  });

  app.patch('/projects/:id/timeline', async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ music_asset_id: z.string().uuid().nullable().optional(), music_volume: z.number().int().min(0).max(100).optional(), music_fade_in_ms: z.number().int().min(0).max(10_000).optional(), music_fade_out_ms: z.number().int().min(0).max(10_000).optional(), hand_edited: z.boolean().optional() }).parse(request.body);
    const timeline = await ownTimeline(request.accountId, id);
    const patch: Partial<typeof schema.timelines.$inferInsert> = { updatedAt: new Date(), version: timeline.version + 1 };
    if (body.music_asset_id !== undefined) {
      if (body.music_asset_id) {
        const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, body.music_asset_id), eq(schema.assets.accountId, request.accountId), eq(schema.assets.kind, 'music'), isNull(schema.assets.deletedAt)));
        if (!asset) throw ApiError.notFound('Music');
      }
      patch.musicAssetId = body.music_asset_id;
    }
    if (body.music_volume !== undefined) patch.musicVolume = body.music_volume;
    if (body.music_fade_in_ms !== undefined) patch.musicFadeInMs = body.music_fade_in_ms;
    if (body.music_fade_out_ms !== undefined) patch.musicFadeOutMs = body.music_fade_out_ms;
    if (body.hand_edited !== undefined) patch.handEdited = body.hand_edited;
    await db.update(schema.timelines).set(patch).where(eq(schema.timelines.id, timeline.id));
    return present(request.accountId, id);
  });

  app.patch('/timeline-items/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ transition_out: z.enum(TRANSITIONS).optional(), asset_id: z.string().uuid().nullable().optional(), trim_in_ms: z.number().int().min(0).optional(), trim_out_ms: z.number().int().min(0).nullable().optional() }).parse(request.body);
    const [row] = await db.select({ item: schema.timelineItems, timeline: schema.timelines }).from(schema.timelineItems).innerJoin(schema.timelines, eq(schema.timelines.id, schema.timelineItems.timelineId))
      .where(and(eq(schema.timelineItems.id, id), eq(schema.timelineItems.accountId, request.accountId), isNull(schema.timelineItems.deletedAt)));
    if (!row) throw ApiError.notFound('Timeline item');
    await isConstrained(db, request.accountId, row.timeline.projectId);
    const patch: Partial<typeof schema.timelineItems.$inferInsert> = {};
    if (body.transition_out !== undefined) patch.transitionOut = body.transition_out;
    if (body.asset_id !== undefined) {
      if (body.asset_id) {
        const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, body.asset_id), eq(schema.assets.accountId, request.accountId), eq(schema.assets.projectId, row.timeline.projectId), eq(schema.assets.kind, 'generated_output'), isNull(schema.assets.deletedAt)));
        if (!asset || asset.reviewStatus === 'rejected') throw ApiError.notFound('Take');
      }
      patch.assetId = body.asset_id;
    }
    if (body.trim_in_ms !== undefined) patch.trimInMs = body.trim_in_ms;
    if (body.trim_out_ms !== undefined) patch.trimOutMs = body.trim_out_ms;
    await db.update(schema.timelineItems).set(patch).where(eq(schema.timelineItems.id, id));
    return present(request.accountId, row.timeline.projectId);
  });

  app.post('/projects/:id/timeline/transitions', async (request) => {
    const { id } = idParam.parse(request.params);
    const { transition_out } = z.object({ transition_out: z.enum(TRANSITIONS) }).parse(request.body);
    const timeline = await ownTimeline(request.accountId, id);
    await db.update(schema.timelineItems).set({ transitionOut: transition_out }).where(eq(schema.timelineItems.timelineId, timeline.id));
    return present(request.accountId, id);
  });

  app.post('/projects/:id/timeline/items/reorder', async (request) => {
    const { id } = idParam.parse(request.params);
    const { item_ids } = z.object({ item_ids: z.array(z.string().uuid()).min(1) }).parse(request.body);
    const timeline = await ownTimeline(request.accountId, id);
    const items = await db.select().from(schema.timelineItems).where(and(eq(schema.timelineItems.timelineId, timeline.id), isNull(schema.timelineItems.deletedAt)));
    const live = await db.select({ id: schema.scenes.id }).from(schema.scenes).where(and(eq(schema.scenes.projectId, id), isNull(schema.scenes.deletedAt)));
    const liveIds = new Set(live.map((s) => s.id));
    const expected = items.filter((i) => liveIds.has(i.sceneId)).map((i) => i.id).sort();
    if (JSON.stringify([...item_ids].sort()) !== JSON.stringify(expected)) throw ApiError.validation('Send every scene exactly once.');
    await db.transaction(async (tx) => {
      for (const [index, itemId] of item_ids.entries()) await tx.update(schema.timelineItems).set({ sortOrder: index }).where(eq(schema.timelineItems.id, itemId));
      await tx.update(schema.timelines).set({ handEdited: true, updatedAt: new Date() }).where(eq(schema.timelines.id, timeline.id));
    });
    return present(request.accountId, id);
  });

  app.post('/projects/:id/timeline/match-scenes', async (request) => {
    const { id } = idParam.parse(request.params);
    const timeline = await ownTimeline(request.accountId, id);
    await db.update(schema.timelines).set({ handEdited: false, updatedAt: new Date() }).where(eq(schema.timelines.id, timeline.id));
    await ensureTimeline(request.accountId, id);
    return present(request.accountId, id);
  });

  // ── Music and voice (DM-22) ───────────────────────────────────────────────
  async function storeAudio(request: FastifyRequest, projectId: string, kind: 'music' | 'voiceover') {
    const part = await request.file();
    if (!part) throw ApiError.validation('Choose a sound file.');
    const file = validateUpload(await part.toBuffer(), 'audio');
    const stored = await store.put(file.bytes, file.extension, { accountId: request.accountId, projectId });
    const { probeDurationMs } = await import('../generation/media.ts');
    const durationMs = await probeDurationMs(file.bytes);
    const [asset] = await db.insert(schema.assets).values({
      accountId: request.accountId, projectId, ownerEntityType: 'timeline', ownerEntityId: null, kind, filename: `${kind}.${file.extension}`,
      mimeType: file.mimeType, sizeBytes: stored.sizeBytes, storageKey: stored.key, durationMs, reviewStatus: 'not_required',
    }).returning();
    return asset!;
  }

  app.post('/projects/:id/timeline/music', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const timeline = await ownTimeline(request.accountId, id);
    const asset = await storeAudio(request, id, 'music');
    await db.update(schema.assets).set({ ownerEntityId: timeline.id }).where(eq(schema.assets.id, asset.id));
    await db.update(schema.timelines).set({ musicAssetId: asset.id, updatedAt: new Date(), version: timeline.version + 1 }).where(eq(schema.timelines.id, timeline.id));
    return reply.code(201).send(await present(request.accountId, id));
  });

  app.post('/projects/:id/timeline/voiceovers', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const startMs = z.coerce.number().int().min(0).max(3_600_000).default(0).parse((request.query as Record<string, string>).start_ms);
    const timeline = await ownTimeline(request.accountId, id);
    const asset = await storeAudio(request, id, 'voiceover');
    await db.update(schema.assets).set({ ownerEntityId: timeline.id }).where(eq(schema.assets.id, asset.id));
    await db.insert(schema.timelineVoiceovers).values({ accountId: request.accountId, timelineId: timeline.id, assetId: asset.id, startMs });
    return reply.code(201).send(await present(request.accountId, id));
  });

  app.patch('/timeline-voiceovers/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ start_ms: z.number().int().min(0).max(3_600_000).optional(), volume: z.number().int().min(0).max(100).optional() }).parse(request.body);
    const [row] = await db.select({ v: schema.timelineVoiceovers, t: schema.timelines }).from(schema.timelineVoiceovers).innerJoin(schema.timelines, eq(schema.timelines.id, schema.timelineVoiceovers.timelineId)).where(and(eq(schema.timelineVoiceovers.id, id), eq(schema.timelineVoiceovers.accountId, request.accountId), isNull(schema.timelineVoiceovers.deletedAt)));
    if (!row) throw ApiError.notFound('Voice');
    await isConstrained(db, request.accountId, row.t.projectId);
    await db.update(schema.timelineVoiceovers).set({ ...(body.start_ms !== undefined ? { startMs: body.start_ms } : {}), ...(body.volume !== undefined ? { volume: body.volume } : {}) }).where(eq(schema.timelineVoiceovers.id, id));
    return present(request.accountId, row.t.projectId);
  });

  app.delete('/timeline-voiceovers/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [row] = await db.update(schema.timelineVoiceovers).set({ deletedAt: new Date() }).where(and(eq(schema.timelineVoiceovers.id, id), eq(schema.timelineVoiceovers.accountId, request.accountId), isNull(schema.timelineVoiceovers.deletedAt))).returning();
    if (!row) throw ApiError.notFound('Voice');
    return reply.code(204).send();
  });

  // ── Make my cartoon (DM-23) ───────────────────────────────────────────────
  app.post('/projects/:id/timeline/render', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const requestKey = z.string().uuid().parse(request.headers['idempotency-key']);
    const { account, constrained } = await isConstrained(db, request.accountId, id);
    const timeline = await ownTimeline(request.accountId, id);
    const created = await db.transaction(async (tx) => {
      const [previous] = await tx.select().from(schema.generationJobs).where(and(eq(schema.generationJobs.accountId, request.accountId), eq(schema.generationJobs.requestKey, requestKey)));
      if (previous) return { job: previous, fresh: false };
      const [active] = await tx.select().from(schema.generationJobs).where(and(eq(schema.generationJobs.targetEntityId, timeline.id), eq(schema.generationJobs.kind, 'render'), inArray(schema.generationJobs.status, ['queued', 'submitted', 'running', 'reviewing'])));
      if (active) return { job: active, fresh: false };
      const items = (await resolveItems(request.accountId, id, account.isMinor)).filter((i) => i.durationMs > 0);
      if (!items.length) throw ApiError.validation('There is nothing to put together yet. Make a picture for a scene first.');
      const [job] = await tx.insert(schema.generationJobs).values({
        accountId: request.accountId, projectId: id, requestKey, kind: 'render', targetEntityType: 'timeline', targetEntityId: timeline.id,
        modelId: 'render', provider: 'ffmpeg', request: { constrained },
      }).returning();
      return { job: job!, fresh: true };
    });
    if (created.fresh) void runner.tick().catch(() => {});
    reply.header('Cache-Control', 'no-store');
    return reply.code(created.fresh ? 202 : 200).send(presentJob(created.job, [], account.isMinor));
  });
}
