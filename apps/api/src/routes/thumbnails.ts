import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { promptPhrase } from '@storyboard/vocabularies';
import { z } from 'zod';
import { db, schema } from '../db/client.ts';
import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { thumbnailSources, type Transaction } from '../thumbnails/context.ts';
import { renderSketch, svgDataUrl } from '../thumbnails/sketch.ts';
import { createClaudeThumbnailProvider, thumbnailUnavailable, type ThumbnailProvider } from '../thumbnails/provider.ts';
import { createClaudeSceneImprover, type SceneImprovementProvider } from '../scenes/improver.ts';
import { sceneDescription } from '../scenes/description.ts';
import { projectIsLive } from './scenes.ts';

const paramsSchema = z.object({ id: z.string().uuid(), proposalId: z.string().uuid().optional() });
const payloadSchema = z.object({
  state: z.enum(['generating', 'ready', 'failed']), fingerprint: z.string(), revision: z.number(),
  constrained: z.boolean(), svg: z.string().optional(), description: z.string().optional(), error: z.string().optional(),
  text: z.string().max(12000).optional(),
});
type Payload = z.infer<typeof payloadSchema>;

async function ownScene(database: typeof db | Transaction, accountId: string, id: string, lock = false) {
  const query = database.select().from(schema.scenes).where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, accountId), isNull(schema.scenes.deletedAt), projectIsLive));
  const [scene] = await (lock ? query.for('update') : query);
  if (!scene) throw ApiError.notFound('Scene');
  return scene;
}

async function context(database: typeof db | Transaction, accountId: string, scene: typeof schema.scenes.$inferSelect, includeStory = false) {
  const [account] = await database.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
  const [project] = await database.select().from(schema.projects).where(and(eq(schema.projects.id, scene.projectId), eq(schema.projects.accountId, accountId)));
  if (!account || !project) throw ApiError.notFound('Project');
  let source = (await thumbnailSources([scene], accountId, database)).get(scene.id)!;
  if (includeStory) {
    const siblings = await database.select().from(schema.scenes).where(and(
      eq(schema.scenes.accountId, accountId), eq(schema.scenes.projectId, scene.projectId),
      eq(schema.scenes.episodeId, scene.episodeId), isNull(schema.scenes.deletedAt),
    )).orderBy(asc(schema.scenes.sortOrder), asc(schema.scenes.id));
    const enriched = { ...source.source, selected_settings: {
      camera_angle: promptPhrase('camera_angle', scene.cameraAngle ?? 'eye_level'),
      time_of_day: promptPhrase('time_of_day', scene.timeOfDay),
      mood: promptPhrase('mood_atmosphere', scene.moodAtmosphere),
    }, story: {
      title: project.title,
      current_scene_number: scene.sceneNumber,
      other_scenes: siblings.filter((s) => s.id !== scene.id).map((s) => ({
        scene_number: s.sceneNumber, title: s.title, description: sceneDescription(s), synopsis: s.synopsis,
      })),
    } };
    source = { source: enriched, fingerprint: createHash('sha256').update(JSON.stringify(enriched)).digest('hex') };
  }
  return { ...source, constrained: account.isMinor || ['preschool', 'kids_6_11'].includes(project.targetAudience), mode: project.editorMode };
}

function present(proposal: typeof schema.aiProposals.$inferSelect) {
  const payload = payloadSchema.safeParse(proposal.payload);
  return {
    id: proposal.id,
    status: proposal.status === 'pending' && payload.success ? payload.data.state : proposal.status,
    preview: proposal.status === 'pending' && payload.success && payload.data.state === 'ready' && payload.data.svg
      ? { src: svgDataUrl(payload.data.svg), description: payload.data.description ?? 'Scene sketch' } : null,
    error: payload.success ? payload.data.error ?? null : null,
    text: proposal.status === 'pending' && payload.success && payload.data.state === 'ready' ? payload.data.text ?? null : null,
  };
}

export async function thumbnailRoutes(app: FastifyInstance, options: {
  provider?: ThumbnailProvider; improvementProvider?: SceneImprovementProvider; kind?: 'improvement';
}) {
  app.addHook('onRequest', app.requireAuth);
  const isImprovement = options.kind === 'improvement';
  const operation = isImprovement ? 'improve_scene_description' : 'generate_scene_thumbnail';
  const collection = isImprovement ? 'description-proposals' : 'thumbnail-proposals';
  const provider = isImprovement ? options.improvementProvider ?? createClaudeSceneImprover()
    : options.provider ?? createClaudeThumbnailProvider();
  const jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>();

  async function cleanExpired() {
    await db.transaction(async (tx) => {
      const expired = await tx.update(schema.aiProposals).set({ status: 'expired', payload: {}, resolvedAt: new Date() })
        .where(and(eq(schema.aiProposals.operation, operation), eq(schema.aiProposals.status, 'pending'), lt(schema.aiProposals.expiresAt, new Date())))
        .returning({ interaction: schema.aiProposals.aiInteractionId });
      for (const p of expired) if (p.interaction) await tx.update(schema.aiInteractions).set({ accepted: false }).where(eq(schema.aiInteractions.id, p.interaction));
    });
  }
  await cleanExpired();
  const cleanup = setInterval(() => { void cleanExpired().catch(() => app.log.error('Thumbnail preview cleanup failed')); }, 60_000);
  cleanup.unref();
  app.addHook('onClose', async () => {
    clearInterval(cleanup);
    for (const job of jobs.values()) job.controller.abort();
    await Promise.allSettled([...jobs.values()].map((job) => job.promise));
  });

  if (!isImprovement) app.get('/settings/ai', async () => ({
    thumbnails_enabled: provider.enabled,
    improve_enabled: options.improvementProvider?.enabled ?? Boolean(config.ANTHROPIC_API_KEY),
    daily_limit: config.THUMBNAIL_DAILY_LIMIT,
    message: provider.enabled ? null : 'Thumbnails are not set up yet. You can keep writing your scenes.',
  }));

  app.get(`/scenes/:id/${collection}`, async (request) => {
    const { id } = paramsSchema.parse(request.params);
    await ownScene(db, request.accountId, id);
    await cleanExpired();
    const [proposal] = await db.select().from(schema.aiProposals).where(and(
      eq(schema.aiProposals.accountId, request.accountId), eq(schema.aiProposals.targetEntityId, id),
      eq(schema.aiProposals.operation, operation), eq(schema.aiProposals.status, 'pending'),
    )).orderBy(desc(schema.aiProposals.createdAt)).limit(1);
    return { proposal: proposal ? present(proposal) : null };
  });

  async function generate(proposal: typeof schema.aiProposals.$inferSelect, input: Awaited<ReturnType<typeof context>>, signal: AbortSignal) {
    const started = Date.now();
    const original = payloadSchema.parse(proposal.payload);
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const result = await provider.generate({ source: input.source, constrained: input.constrained }, signal, (input, output) => {
        inputTokens += input; outputTokens += output;
      });
      const rendered = 'sketch' in result ? renderSketch(result.sketch) : { text: result.text };
      await db.transaction(async (tx) => {
        // Cancellation may have cleared the proposal while the network call was running.
        const [current] = await tx.select().from(schema.aiProposals).where(eq(schema.aiProposals.id, proposal.id)).for('update');
        if (proposal.aiInteractionId) await tx.update(schema.aiInteractions).set({
          inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs: Date.now() - started,
        }).where(and(eq(schema.aiInteractions.id, proposal.aiInteractionId), eq(schema.aiInteractions.accountId, proposal.accountId)));
        if (!current || current.status !== 'pending') return;
        await tx.update(schema.aiProposals).set({
          payload: { ...original, state: 'ready', ...rendered },
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }).where(eq(schema.aiProposals.id, proposal.id));
      });
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : 'The AI request could not be completed. Please try again.';
      await db.transaction(async (tx) => {
        await tx.update(schema.aiProposals).set({ payload: { ...original, state: 'failed', error: detail } })
          .where(and(eq(schema.aiProposals.id, proposal.id), eq(schema.aiProposals.accountId, proposal.accountId), eq(schema.aiProposals.status, 'pending')));
        if (proposal.aiInteractionId) await tx.update(schema.aiInteractions).set({ accepted: false, latencyMs: Date.now() - started, inputTokens, outputTokens })
          .where(and(eq(schema.aiInteractions.id, proposal.aiInteractionId), eq(schema.aiInteractions.accountId, proposal.accountId)));
      });
    }
  }

  app.post(`/scenes/:id/${collection}`, async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const requestId = z.string().uuid().parse(request.headers['idempotency-key']);
    const reserved = await db.transaction(async (tx) => {
      // Serialize quota reservations across app instances, without keeping a transaction
      // open during the external call. Every attempted request consumes a daily slot.
      await tx.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.id, request.accountId)).for('update');
      const scene = await ownScene(tx, request.accountId, id);
      const [previous] = await tx.select().from(schema.aiProposals).where(eq(schema.aiProposals.id, requestId));
      if (previous) {
        if (previous.accountId !== request.accountId || previous.targetEntityId !== id || previous.operation !== operation) {
          throw ApiError.notFound('Thumbnail request');
        }
        return { proposal: previous, input: null };
      }
      if (!provider.enabled) throw thumbnailUnavailable('AI is not set up yet. Ask the app owner to configure the Claude API key.');
      if (scene.isLocked) throw ApiError.validation('Unlock this scene before using AI.');
      if (!sceneDescription(scene).trim() && !scene.synopsis.trim()) {
        throw ApiError.validation('Write a scene description first.');
      }
      const day = new Date(); day.setUTCHours(0, 0, 0, 0);
      const attempts = await tx.select({ at: schema.aiInteractions.createdAt }).from(schema.aiInteractions)
        .where(and(eq(schema.aiInteractions.accountId, request.accountId), inArray(schema.aiInteractions.operation, ['generate_scene_thumbnail', 'improve_scene_description']), gte(schema.aiInteractions.createdAt, day)));
      if (attempts.length >= config.THUMBNAIL_DAILY_LIMIT) throw thumbnailUnavailable('You have used today’s AI allowance. Try again tomorrow.', 429);
      if (attempts.filter((a) => a.at.getTime() > Date.now() - 60_000).length >= config.THUMBNAIL_REQUESTS_PER_MINUTE) {
        throw thumbnailUnavailable('Please wait a minute before another AI request.', 429);
      }
      const input = await context(tx, request.accountId, scene, isImprovement);
      if (JSON.stringify(input.source).length > 24_000) throw ApiError.validation('Shorten the scene or character descriptions before making a thumbnail.');
      const [interaction] = await tx.insert(schema.aiInteractions).values({
        accountId: request.accountId, projectId: scene.projectId, operation, mode: input.mode,
        targetEntityType: 'scene', targetEntityId: scene.id, model: provider.model,
      }).returning();
      const [proposal] = await tx.insert(schema.aiProposals).values({
        id: requestId, accountId: request.accountId, projectId: scene.projectId, operation, scope: 'field',
        targetEntityType: 'scene', targetEntityId: scene.id, aiInteractionId: interaction!.id,
        payload: { state: 'generating', fingerprint: input.fingerprint, revision: scene.thumbnailRevision, constrained: input.constrained },
        // A lost/restarted worker must not leave a preview stuck forever.
        expiresAt: new Date(Date.now() + 180_000),
      }).returning();
      return { proposal: proposal!, input };
    });
    if (reserved.input) {
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
      const promise = generate(reserved.proposal, reserved.input, signal)
        .catch(() => app.log.error('Thumbnail generation could not be recorded'))
        .finally(() => jobs.delete(reserved.proposal.id));
      jobs.set(reserved.proposal.id, { controller, promise });
    }
    reply.header('Cache-Control', 'no-store');
    return reply.code(reserved.input ? 202 : 200).send(present(reserved.proposal));
  });

  app.get(`/scenes/:id/${collection}/:proposalId`, async (request, reply) => {
    const { id, proposalId } = paramsSchema.parse(request.params);
    await ownScene(db, request.accountId, id);
    await cleanExpired();
    const [proposal] = await db.select().from(schema.aiProposals).where(and(
      eq(schema.aiProposals.id, proposalId!), eq(schema.aiProposals.accountId, request.accountId),
      eq(schema.aiProposals.targetEntityId, id), eq(schema.aiProposals.operation, operation),
    ));
    if (!proposal) throw ApiError.notFound('Thumbnail preview');
    reply.header('Cache-Control', 'no-store');
    return present(proposal);
  });

  app.post(`/scenes/:id/${collection}/:proposalId/:action`, async (request) => {
    const { id, proposalId, action } = paramsSchema.extend({ action: z.enum(['accept', 'cancel']) }).parse(request.params);
    await cleanExpired();
    await db.transaction(async (tx) => {
      const scene = await ownScene(tx, request.accountId, id, true);
      const [proposal] = await tx.select().from(schema.aiProposals).where(and(
        eq(schema.aiProposals.id, proposalId!), eq(schema.aiProposals.accountId, request.accountId),
        eq(schema.aiProposals.targetEntityId, id), eq(schema.aiProposals.operation, operation),
      )).for('update');
      if (!proposal) throw ApiError.notFound('Thumbnail preview');
      if (proposal.status === 'accepted' && action === 'accept') return;
      if (action === 'cancel' && proposal.status !== 'pending') return;
      if (proposal.status !== 'pending') throw ApiError.conflict('This preview has expired. Make a new thumbnail.', null);
      if (action === 'accept') {
        if (scene.isLocked) throw ApiError.validation('Unlock this scene before applying the preview.');
        const payload = payloadSchema.parse(proposal.payload);
        if (payload.state !== 'ready' || (isImprovement ? !payload.text : !payload.svg)) throw ApiError.validation('Wait for the preview before using it.');
        const current = await context(tx, request.accountId, scene, isImprovement);
        if (payload.fingerprint !== current.fingerprint || (!isImprovement && payload.revision !== scene.thumbnailRevision) || payload.constrained !== current.constrained) {
          throw ApiError.conflict('The scene has changed. Request a new preview from the latest description.', null);
        }
        if (isImprovement) {
          await tx.update(schema.scenes).set({ description: payload.text!, version: scene.version + 1, updatedAt: new Date() })
            .where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, request.accountId)));
        } else {
        const [asset] = await tx.insert(schema.assets).values({
          accountId: request.accountId, projectId: scene.projectId, ownerEntityType: 'scene', ownerEntityId: id,
          kind: 'scene_thumbnail', filename: `${id}.svg`, mimeType: 'image/svg+xml',
          sizeBytes: Buffer.byteLength(payload.svg!), storageKey: `db:scene-thumbnail:${proposal.id}`,
          thumbnailSvg: payload.svg!, thumbnailDescription: payload.description ?? 'Scene sketch', width: 640, height: 360,
        }).returning();
        await tx.update(schema.scenes).set({ thumbnailAssetId: asset!.id,
          thumbnailSourceFingerprint: payload.fingerprint, thumbnailRevision: scene.thumbnailRevision + 1,
          version: scene.version + 1, updatedAt: new Date(),
        }).where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, request.accountId)));
        if (scene.thumbnailAssetId) await tx.delete(schema.assets).where(and(eq(schema.assets.id, scene.thumbnailAssetId), eq(schema.assets.accountId, request.accountId), eq(schema.assets.kind, 'scene_thumbnail')));
        }
      }
      await tx.update(schema.aiProposals).set({ status: action === 'accept' ? 'accepted' : 'cancelled', payload: {}, resolvedAt: new Date() })
        .where(and(eq(schema.aiProposals.id, proposal.id), eq(schema.aiProposals.accountId, request.accountId)));
      if (proposal.aiInteractionId) await tx.update(schema.aiInteractions).set({ accepted: action === 'accept' })
        .where(and(eq(schema.aiInteractions.id, proposal.aiInteractionId), eq(schema.aiInteractions.accountId, request.accountId)));
    });
    if (action === 'cancel') jobs.get(proposalId!)?.controller.abort();
    return { status: action === 'accept' ? 'accepted' : 'cancelled' };
  });

  if (!isImprovement) app.delete('/scenes/:id/thumbnail', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const version = z.coerce.number().int().positive().parse(request.headers['if-match']);
    await db.transaction(async (tx) => {
      const scene = await ownScene(tx, request.accountId, id, true);
      if (scene.version !== version) throw ApiError.conflict('This scene changed. Reload before removing its thumbnail.', null);
      if (scene.isLocked) throw ApiError.validation('Unlock this scene before removing its thumbnail.');
      await tx.update(schema.scenes).set({ thumbnailAssetId: null, thumbnailSourceFingerprint: null,
        thumbnailRevision: scene.thumbnailRevision + 1, version: scene.version + 1, updatedAt: new Date(),
      }).where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, request.accountId)));
      if (scene.thumbnailAssetId) await tx.delete(schema.assets).where(and(eq(schema.assets.id, scene.thumbnailAssetId), eq(schema.assets.accountId, request.accountId), eq(schema.assets.kind, 'scene_thumbnail')));
    });
    return reply.code(204).send();
  });
}
