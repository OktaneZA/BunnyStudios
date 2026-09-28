/**
 * Director Mode routes: models and allowance, per-scene shots, generation jobs, takes and
 * heroes, and the media bin (docs/director-mode-plan-v1.md §5).
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { estimatePence, clipPlan, CLIP_LENGTHS, type GenerationModel } from '@storyboard/models';
import { promptBudget } from '@storyboard/compiler';
import { db, schema } from '../db/client.ts';
import { ApiError } from '../errors.ts';
import { allowance, allowanceInWords, keepAsUnknown, pence, reachedProvider, refund, reserve } from '../generation/budget.ts';
import { presentModel, type Catalogue } from '../generation/catalogue.ts';
import type { ReviewProvider } from '../generation/review.ts';
import type { ObjectStore } from '../storage/objectStore.ts';
import type { JobRequest, Runner } from '../jobs/runner.ts';
import { ownShot, presentShot, syncSceneShots } from '../shots/sync.ts';
import { buildManifest, shotCast } from '../shots/cast.ts';
import { projectIsLive } from './scenes.ts';

const idParam = z.object({ id: z.string().uuid() });
const ASPECTS = ['16:9', '9:16', '1:1'] as const;

const jobBody = z.object({
  kind: z.enum(['image', 'video']),
  model_id: z.string().min(1).max(60),
  aspect_ratio: z.enum(ASPECTS).optional(),
  count: z.number().int().min(1).max(4).optional(),
  duration_seconds: z.number().int().min(1).max(60).optional(),
  audio: z.boolean().optional(),
  resolution: z.string().max(20).optional(),
  /** "Try again with a note": appended to the prompt for this run only. */
  note: z.string().max(400).optional(),
});

export interface DirectorDeps {
  catalogue: Catalogue;
  store: ObjectStore;
  review: ReviewProvider;
  runner: Runner;
}

type Asset = typeof schema.assets.$inferSelect;
type Job = typeof schema.generationJobs.$inferSelect;

export function presentAsset(a: Asset) {
  return {
    id: a.id,
    kind: a.kind,
    mime_type: a.mimeType,
    width: a.width,
    height: a.height,
    duration_ms: a.durationMs,
    poster_asset_id: a.posterAssetId,
    url: `/api/v1/assets/${a.id}/file`,
    poster_url: a.posterAssetId ? `/api/v1/assets/${a.posterAssetId}/file` : null,
    review_status: a.reviewStatus,
    review_reason: a.reviewReason,
    owner_entity_type: a.ownerEntityType,
    owner_entity_id: a.ownerEntityId,
    job_id: a.generationJobId,
    model_id: a.modelId,
    created_at: a.uploadedAt.toISOString(),
    deleted_at: a.deletedAt ? a.deletedAt.toISOString() : null,
  };
}

const STEPS: Record<Job['status'], string> = {
  queued: 'Waiting', submitted: 'Making', running: 'Making', reviewing: 'Checking', ready: 'Ready', failed: 'Failed', cancelled: 'Cancelled',
};

export function presentJob(j: Job, assets: Asset[], hideRejected: boolean) {
  const visible = assets.filter((a) => j.resultAssetIds.includes(a.id) && (!hideRejected || a.reviewStatus !== 'rejected'));
  const heldBack = assets.filter((a) => j.resultAssetIds.includes(a.id) && a.reviewStatus === 'rejected').length;
  return {
    id: j.id,
    kind: j.kind,
    status: j.status,
    step: STEPS[j.status],
    target_entity_type: j.targetEntityType,
    target_entity_id: j.targetEntityId,
    model_id: j.modelId,
    task: j.task,
    intent: j.intent,
    parent_job_id: j.parentJobId,
    source_scene_version: (j.request as JobRequest).creative?.sceneVersion ?? null,
    attempt: j.attempt,
    error: j.status === 'failed' ? j.errorDetail : null,
    results: visible.map(presentAsset),
    held_back: heldBack,
    created_at: j.createdAt.toISOString(),
    finished_at: j.finishedAt ? j.finishedAt.toISOString() : null,
    // The latest child-safe step ("Making part 2 of 3"), and when it began.
    progress: lastStep(j.events),
    // The full trail, raw errors included, only for the adult account.
    ...(hideRejected ? {} : { events: Array.isArray(j.events) ? j.events : [] }),
  };
}

function lastStep(events: unknown) {
  const list = Array.isArray(events) ? events as { at: string; say: string; part?: number; parts?: number }[] : [];
  const last = list[list.length - 1];
  return last ? { say: last.say, at: last.at, part: last.part ?? null, parts: last.parts ?? null } : null;
}

export async function isConstrained(database: typeof db, accountId: string, projectId: string) {
  const [account] = await database.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
  const [project] = await database.select().from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.accountId, accountId), isNull(schema.projects.deletedAt)));
  if (!account || !project) throw ApiError.notFound('Project');
  const [bible] = await database.select({ aspectRatio: schema.seriesBibles.aspectRatio }).from(schema.seriesBibles).where(eq(schema.seriesBibles.projectId, project.id));
  return { account, project, aspectRatio: bible?.aspectRatio ?? '16:9', constrained: account.isMinor || ['preschool', 'kids_6_11'].includes(project.targetAudience) };
}

/** Validate the chosen options against what the model declares (DM-4). */
export function resolveOptions(model: GenerationModel, body: z.infer<typeof jobBody>, projectAspect: string) {
  if (model.kind !== body.kind) throw ApiError.validation(`${model.friendlyLabel} makes ${model.kind === 'image' ? 'pictures' : 'clips'}, not ${body.kind === 'image' ? 'pictures' : 'clips'}.`);
  const aspect = body.aspect_ratio ?? (ASPECTS as readonly string[]).find((a) => a === projectAspect) as typeof ASPECTS[number] | undefined ?? model.aspect_ratios[0]!;
  if (!model.aspect_ratios.includes(aspect)) throw ApiError.validation(`${model.friendlyLabel} cannot make a ${aspect} picture. Choose another shape.`);
  const resolution = body.resolution ?? model.resolutions[0]!;
  if (!model.resolutions.includes(resolution)) throw ApiError.validation('That size is not available for this picture maker.');
  let durationSeconds: number | null = null;
  if (model.kind === 'video') {
    const d = model.duration_seconds!;
    durationSeconds = body.duration_seconds ?? d.min;
    if (!(model.capabilities.text_to_video && CLIP_LENGTHS.includes(durationSeconds)) && (durationSeconds < d.min || durationSeconds > d.max || (durationSeconds - d.min) % d.step !== 0)) {
      throw ApiError.validation(`${model.friendlyLabel} makes clips between ${d.min} and ${d.max} seconds.`);
    }
  }
  const count = model.kind === 'image' ? body.count ?? 1 : 1;
  const audio = model.video?.audio_mode === 'always' || (Boolean(body.audio) && model.capabilities.audio);
  return { aspect, resolution, durationSeconds, count, audio };
}

export async function directorRoutes(app: FastifyInstance, deps: DirectorDeps) {
  app.addHook('onRequest', app.requireAuth);
  const { catalogue, store, review, runner } = deps;

  async function jobAssets(jobs: Job[]) {
    const ids = jobs.flatMap((j) => j.resultAssetIds);
    if (!ids.length) return [] as Asset[];
    return db.select().from(schema.assets).where(and(inArray(schema.assets.id, ids), isNull(schema.assets.deletedAt)));
  }

  app.get('/settings/generation', async (request) => {
    const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, request.accountId));
    if (!account) throw ApiError.notFound('Account');
    const advanced = account.defaultEditorMode === 'advanced';
    const enabled = catalogue.available(advanced);
    const a = await allowance(request.accountId);
    const cheapestImage = catalogue.cheapest('image');
    const cheapestClip = catalogue.cheapest('video');
    return {
      enabled: enabled.length > 0,
      test_mode: enabled.some((m) => String(m.provider).startsWith('fake')),
      review_enabled: review.enabled,
      models: enabled.map((m) => presentModel(m, advanced)),
      allowance: a,
      allowance_words: allowanceInWords(a, cheapestImage ? estimatePence(cheapestImage, { count: 1 }) : null, cheapestClip ? estimatePence(cheapestClip, { durationSeconds: cheapestClip.duration_seconds?.min ?? 1 }) : null),
      message: enabled.length ? null : 'Generation isn’t connected yet. Ask the account owner to set it up.',
    };
  });

  app.get('/models', async (request) => {
    const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, request.accountId));
    const advanced = account?.defaultEditorMode === 'advanced';
    return { data: catalogue.available(advanced).map((m) => presentModel(m, advanced)) };
  });

  // ── Shots (one per scene in Simple mode) ──────────────────────────────────
  app.get('/scenes/:id/shots', async (request) => {
    const { id } = idParam.parse(request.params);
    const [scene] = await db.select().from(schema.scenes).where(and(eq(schema.scenes.id, id), eq(schema.scenes.accountId, request.accountId), isNull(schema.scenes.deletedAt), projectIsLive));
    if (!scene) throw ApiError.notFound('Scene');
    const shots = await syncSceneShots(db, request.accountId, scene);
    return { data: shots.map(presentShot) };
  });

  app.patch('/shots/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ user_prompt_addendum: z.string().max(400).optional(), prompt_locked: z.boolean().optional(), action_beat: z.string().max(2000).optional() }).parse(request.body);
    const version = z.coerce.number().int().positive().parse(request.headers['if-match']);
    return db.transaction(async (tx) => {
      const { shot, scene } = await ownShot(tx, request.accountId, id, true);
      if (shot.version !== version) throw ApiError.conflict('This changed somewhere else. Reload and try again.', presentShot(shot));
      const patch: Partial<typeof schema.shots.$inferInsert> = { version: shot.version + 1, updatedAt: new Date() };
      if (body.user_prompt_addendum !== undefined) patch.userPromptAddendum = body.user_prompt_addendum;
      if (body.prompt_locked !== undefined) patch.promptLocked = body.prompt_locked;
      if (body.action_beat !== undefined) patch.actionBeat = body.action_beat;
      await tx.update(schema.shots).set(patch).where(eq(schema.shots.id, id));
      const [updated] = await syncSceneShots(tx, request.accountId, scene);
      const fresh = (await tx.select().from(schema.shots).where(eq(schema.shots.id, id)))[0]!;
      return presentShot(updated?.id === id ? updated : fresh);
    });
  });

  // ── Jobs ──────────────────────────────────────────────────────────────────
  app.post('/shots/:id/jobs', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = jobBody.parse(request.body);
    const requestKey = z.string().uuid().parse(request.headers['idempotency-key']);
    const created = await db.transaction(async (tx) => {
      await tx.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.id, request.accountId)).for('update');
      const [previous] = await tx.select().from(schema.generationJobs).where(and(eq(schema.generationJobs.accountId, request.accountId), eq(schema.generationJobs.requestKey, requestKey)));
      if (previous) return { job: previous, fresh: false };
      const { shot, scene } = await ownShot(tx, request.accountId, id, true);
      const { account, aspectRatio, constrained } = await isConstrained(tx as unknown as typeof db, request.accountId, scene.projectId);
      const model = catalogue.available(account.defaultEditorMode === 'advanced').find((m) => m.id === body.model_id);
      if (!model) throw ApiError.validation('That picture maker is not available. Pick another one.');
      if (constrained && !review.enabled) throw ApiError.validation('The safety checker is not set up, so pictures cannot be made on this account yet. Ask a grown-up.');
      const options = resolveOptions(model, body, aspectRatio);
      const [synced] = await syncSceneShots(tx, request.accountId, scene);
      const current = synced?.id === shot.id ? synced : shot;
      const note = body.note?.trim();
      const prompt = note ? `${current.compiledPrompt} ${note}` : current.compiledPrompt;
      if (!prompt.trim()) throw ApiError.validation('Write what happens in this scene first, in Story.');
      const budget = promptBudget(prompt, model.max_prompt_length);
      if (budget.over) throw ApiError.validation(`The scene description is too long for ${model.friendlyLabel}. Shorten it in Story by about ${budget.length - budget.max} letters.`);
      let startFrameAssetId: string | null = null;
      if (model.kind === 'video' && model.capabilities.image_to_video && !model.capabilities.text_to_video) {
        // An image-to-video model (Advanced only) needs a picked picture to start from.
        if (current.heroAssetId) startFrameAssetId = current.heroAssetId;
        else throw ApiError.validation('This clip maker needs a picture to start from. Pick one that makes clips straight from the scene instead.');
      }
      // Character pictures come only from approved looks, one main picture each, pinned by hash (CS-10).
      const manifest = model.capabilities.reference_images ? buildManifest(await shotCast(tx, request.accountId, current, scene), 1) : null;
      const refs = manifest?.references ?? [];
      if (refs.length > model.max_reference_images) throw ApiError.validation('There are too many characters for this maker. Choose fewer characters in this scene, or another maker.');
      if (model.kind === 'video' && model.capabilities.requires_reference_images && manifest?.missingLooks.length) {
        throw ApiError.validation(`Choose how ${manifest.missingLooks.map((m) => m.name).join(' and ')} ${manifest.missingLooks.length === 1 ? 'looks' : 'look'} in Cast first.`);
      }
      if (model.capabilities.requires_reference_images && !refs.length) {
        throw ApiError.validation(`${model.friendlyLabel} works from your approved character pictures, and nobody in this scene has one yet. Choose a look in Cast, or pick a different picture maker.`);
      }
      const jobRequest: JobRequest = {
        prompt, negativePrompt: current.compiledNegativePrompt, referenceAssetIds: refs.map((r) => r.assetId), referenceHashes: refs.map((r) => r.contentHash),
        referenceNames: refs.map((r) => r.characterName), startFrameAssetId,
        aspectRatio: options.aspect, count: options.count, durationSeconds: options.durationSeconds, audio: options.audio, resolution: options.resolution,
        constrained, assetKind: 'generated_output',
      };
      const [job] = await tx.insert(schema.generationJobs).values({
        accountId: request.accountId, projectId: scene.projectId, requestKey, kind: model.kind, targetEntityType: 'shot', targetEntityId: shot.id,
        modelId: model.id, provider: model.provider, request: jobRequest,
      }).returning();
      await reserve(tx, { accountId: account.id, projectId: scene.projectId, jobId: job!.id, model, count: options.count, resolution: options.resolution, ...(options.durationSeconds ? { durationSeconds: options.durationSeconds } : {}) });
      return { job: job!, fresh: true };
    });
    if (created.fresh) void runner.tick().catch(() => {});
    reply.header('Cache-Control', 'no-store');
    return reply.code(created.fresh ? 202 : 200).send(presentJob(created.job, [], true));
  });

  app.get('/jobs/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [job] = await db.select().from(schema.generationJobs).where(and(eq(schema.generationJobs.id, id), eq(schema.generationJobs.accountId, request.accountId)));
    if (!job) throw ApiError.notFound('Request');
    // Not isConstrained: a job still answers after its cartoon went in the bin, so polling ends cleanly.
    const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, request.accountId));
    reply.header('Cache-Control', 'no-store');
    return presentJob(job, await jobAssets([job]), account?.isMinor ?? true);
  });

  app.get('/projects/:id/jobs', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { account } = await isConstrained(db, request.accountId, id);
    const jobs = await db.select().from(schema.generationJobs)
      .where(and(eq(schema.generationJobs.projectId, id), eq(schema.generationJobs.accountId, request.accountId)))
      .orderBy(desc(schema.generationJobs.createdAt)).limit(200);
    const assets = await jobAssets(jobs);
    reply.header('Cache-Control', 'no-store');
    return { data: jobs.map((j) => presentJob(j, assets, account.isMinor)) };
  });

  app.post('/jobs/:id/cancel', async (request) => {
    const { id } = idParam.parse(request.params);
    const job = await db.transaction(async (tx) => {
      const [job] = await tx.select().from(schema.generationJobs).where(and(eq(schema.generationJobs.id, id), eq(schema.generationJobs.accountId, request.accountId))).for('update');
      if (!job) throw ApiError.notFound('Request');
      if (!['queued', 'submitted', 'running', 'reviewing'].includes(job.status)) return job;
      const [updated] = await tx.update(schema.generationJobs).set({ status: 'cancelled', claimedBy: null, finishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.generationJobs.id, id)).returning();
      // MG-08: stopping here does not mean the provider refunded work it already started.
      if (reachedProvider(job)) await keepAsUnknown(id, tx);
      else await refund(id, tx);
      return updated!;
    });
    runner.abort(id);
    if (job.providerJobId) {
      const model = catalogue.find(job.modelId);
      const provider = model && catalogue.providerFor(model);
      if (model && provider) await provider.cancel(job.providerJobId, model, AbortSignal.timeout(10_000)).catch(() => {});
    }
    return { status: job.status };
  });

  // ── Heroes (the accept, D35) ──────────────────────────────────────────────
  app.post('/shots/:id/hero', async (request) => {
    const { id } = idParam.parse(request.params);
    const { asset_id } = z.object({ asset_id: z.string().uuid() }).parse(request.body);
    return db.transaction(async (tx) => {
      const { shot } = await ownShot(tx, request.accountId, id, true);
      const [asset] = await tx.select().from(schema.assets).where(and(
        eq(schema.assets.id, asset_id), eq(schema.assets.accountId, request.accountId), eq(schema.assets.ownerEntityType, 'shot'),
        eq(schema.assets.ownerEntityId, shot.id), eq(schema.assets.kind, 'generated_output'), isNull(schema.assets.deletedAt),
      ));
      if (!asset) throw ApiError.notFound('Take');
      if (asset.reviewStatus === 'rejected' || asset.reviewStatus === 'pending') throw ApiError.validation('That one cannot be used.');
      const isVideo = asset.mimeType.startsWith('video/');
      const [updated] = await tx.update(schema.shots).set({
        ...(isVideo ? { heroVideoAssetId: asset.id } : { heroAssetId: asset.id, heroVideoAssetId: null }),
        generationStatus: 'approved', version: shot.version + 1, updatedAt: new Date(),
      }).where(eq(schema.shots.id, shot.id)).returning();
      return presentShot(updated!);
    });
  });

  // ── Media bin ─────────────────────────────────────────────────────────────
  app.get('/projects/:id/media', async (request) => {
    const { id } = idParam.parse(request.params);
    const query = z.object({ scene_id: z.string().uuid().optional(), kind: z.enum(['generated_output', 'character_ref', 'final_render', 'music', 'voiceover']).optional(), deleted: z.enum(['true', 'false']).default('false') }).parse(request.query);
    const { account } = await isConstrained(db, request.accountId, id);
    const conditions = [eq(schema.assets.projectId, id), eq(schema.assets.accountId, request.accountId),
      query.deleted === 'true' ? isNotNull(schema.assets.deletedAt) : isNull(schema.assets.deletedAt),
      inArray(schema.assets.kind, query.kind ? [query.kind] : ['generated_output', 'character_ref', 'final_render', 'music', 'voiceover'])];
    if (account.isMinor) conditions.push(inArray(schema.assets.reviewStatus, ['allowed', 'not_required']));
    let rows = await db.select().from(schema.assets).where(and(...conditions)).orderBy(desc(schema.assets.uploadedAt)).limit(500);
    if (query.scene_id) {
      const shots = await db.select({ id: schema.shots.id }).from(schema.shots).where(and(eq(schema.shots.sceneId, query.scene_id), eq(schema.shots.accountId, request.accountId)));
      const shotIds = new Set(shots.map((s) => s.id));
      rows = rows.filter((a) => a.ownerEntityType === 'shot' && a.ownerEntityId && shotIds.has(a.ownerEntityId));
    }
    return { data: rows.map(presentAsset) };
  });

  /** The adult's held-back list (D32): rejected takes with reasons. */
  app.get('/projects/:id/held-back', async (request) => {
    const { id } = idParam.parse(request.params);
    const { account } = await isConstrained(db, request.accountId, id);
    if (account.isMinor) throw ApiError.notFound('Page');
    const rows = await db.select().from(schema.assets).where(and(eq(schema.assets.projectId, id), eq(schema.assets.accountId, request.accountId), eq(schema.assets.reviewStatus, 'rejected'))).orderBy(desc(schema.assets.uploadedAt)).limit(200);
    const shotIds = rows.filter((a) => a.ownerEntityType === 'shot' && a.ownerEntityId).map((a) => a.ownerEntityId!);
    const characterIds = rows.filter((a) => a.ownerEntityType === 'character' && a.ownerEntityId).map((a) => a.ownerEntityId!);
    const shots = shotIds.length ? await db.select({ id: schema.shots.id, n: schema.scenes.sceneNumber, title: schema.scenes.title }).from(schema.shots).innerJoin(schema.scenes, eq(schema.scenes.id, schema.shots.sceneId)).where(inArray(schema.shots.id, shotIds)) : [];
    const characters = characterIds.length ? await db.select({ id: schema.characters.id, name: schema.characters.name }).from(schema.characters).where(inArray(schema.characters.id, characterIds)) : [];
    return { data: rows.map((a) => {
      const shot = shots.find((s) => s.id === a.ownerEntityId);
      const character = characters.find((c) => c.id === a.ownerEntityId);
      return { ...presentAsset(a), scene_number: shot?.n ?? null, scene_title: shot?.title ?? null, character_name: character?.name ?? null };
    }) };
  });

  app.get('/assets/:id/file', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, id), eq(schema.assets.accountId, request.accountId)));
    if (!asset) throw ApiError.notFound('File');
    const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, request.accountId));
    if (account?.isMinor && asset.reviewStatus === 'rejected') throw ApiError.notFound('File');
    if (asset.thumbnailSvg) return reply.type('image/svg+xml').header('Cache-Control', 'private, max-age=3600').send(asset.thumbnailSvg);
    const { stream, sizeBytes } = await store.stream(asset.storageKey);
    return reply.type(asset.mimeType).header('Content-Length', String(sizeBytes)).header('Cache-Control', 'private, max-age=31536000, immutable').send(stream);
  });

  app.delete('/assets/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, id), eq(schema.assets.accountId, request.accountId), isNull(schema.assets.deletedAt)));
    if (!asset) throw ApiError.notFound('File');
    await db.transaction(async (tx) => {
      await tx.update(schema.assets).set({ deletedAt: new Date() }).where(eq(schema.assets.id, id));
      if (asset.ownerEntityType === 'shot' && asset.ownerEntityId) {
        await tx.update(schema.shots).set({ heroAssetId: null }).where(and(eq(schema.shots.id, asset.ownerEntityId), eq(schema.shots.heroAssetId, id)));
        await tx.update(schema.shots).set({ heroVideoAssetId: null }).where(and(eq(schema.shots.id, asset.ownerEntityId), eq(schema.shots.heroVideoAssetId, id)));
      }
      if (asset.ownerEntityType === 'character' && asset.ownerEntityId) {
        await tx.update(schema.characters).set({ mainReferenceAssetId: null }).where(and(eq(schema.characters.id, asset.ownerEntityId), eq(schema.characters.mainReferenceAssetId, id)));
      }
    });
    return reply.code(204).send();
  });

  app.post('/assets/:id/restore', async (request) => {
    const { id } = idParam.parse(request.params);
    const [asset] = await db.update(schema.assets).set({ deletedAt: null }).where(and(eq(schema.assets.id, id), eq(schema.assets.accountId, request.accountId), isNotNull(schema.assets.deletedAt))).returning();
    if (!asset) throw ApiError.notFound('File');
    return presentAsset(asset);
  });

  /** The clip maker for a cost level: the child picks low, medium or high, never a model. */
  app.get('/models/tiers', async () => {
    // Only makers that work straight from the scene text: the child never needs a picture first.
    const enabled = catalogue.videoModels({ task: 'text-to-video', referenceImageCount: 0 });
    return { data: ['low', 'medium', 'high'].map((tier) => enabled.find((m) => m.tier === tier)).filter(Boolean).map((m) => presentModel(m!, false)) };
  });

  /** The adult's clip log: recent jobs for any account, each with its full step trail. */
  app.get('/accounts/:id/jobs', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [me] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, request.accountId));
    if (!me || me.isMinor) throw ApiError.notFound('Page');
    const rows = await db.select({ job: schema.generationJobs, title: schema.projects.title }).from(schema.generationJobs)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.generationJobs.projectId))
      .where(eq(schema.generationJobs.accountId, id)).orderBy(desc(schema.generationJobs.createdAt)).limit(30);
    reply.header('Cache-Control', 'no-store');
    return { data: rows.map(({ job, title }) => ({
      ...presentJob(job, [], false), project_title: title,
      duration_seconds: (job.request as { durationSeconds?: number } | null)?.durationSeconds ?? null,
      error_code: job.errorCode,
    })) };
  });

  /** Adult-only budget settings (DM-26). */
  app.get('/accounts', async (request) => {
    const [me] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, request.accountId));
    if (!me || me.isMinor) throw ApiError.notFound('Page');
    const rows = await db.select().from(schema.accounts).where(isNull(schema.accounts.deletedAt)).orderBy(asc(schema.accounts.displayName));
    const out = [];
    for (const a of rows) out.push({ id: a.id, display_name: a.displayName, is_minor: a.isMinor, allowance: await allowance(a.id) });
    return { data: out };
  });

  app.patch('/accounts/:id/budget', async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ daily_budget_pence: z.number().int().min(0).max(100_000).optional(), monthly_budget_pence: z.number().int().min(0).max(1_000_000).optional() }).parse(request.body);
    const [me] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, request.accountId));
    if (!me || me.isMinor) throw ApiError.notFound('Page');
    const [updated] = await db.update(schema.accounts).set({
      ...(body.daily_budget_pence !== undefined ? { dailyBudgetPence: body.daily_budget_pence } : {}),
      ...(body.monthly_budget_pence !== undefined ? { monthlyBudgetPence: body.monthly_budget_pence } : {}),
    }).where(eq(schema.accounts.id, id)).returning();
    if (!updated) throw ApiError.notFound('Account');
    return { id: updated.id, display_name: updated.displayName, is_minor: updated.isMinor, allowance: await allowance(updated.id) };
  });

  app.get('/settings/estimate', async (request) => {
    const q = z.object({ model_id: z.string(), resolution: z.string().max(20).optional(), count: z.coerce.number().int().min(1).max(4).optional(), duration_seconds: z.coerce.number().int().min(1).max(60).optional() }).parse(request.query);
    const model = catalogue.find(q.model_id);
    if (!model) throw ApiError.notFound('Picture maker');
    const options = resolveOptions(model, { kind: model.kind, model_id: model.id, resolution: q.resolution, duration_seconds: q.duration_seconds, count: q.count }, model.aspect_ratios[0]!);
    const p = estimatePence(model, { resolution: options.resolution, count: options.count, ...(options.durationSeconds ? { durationSeconds: options.durationSeconds } : {}) });
      const parts = model.kind === 'video' && model.capabilities.text_to_video && q.duration_seconds && CLIP_LENGTHS.includes(q.duration_seconds) ? clipPlan(model, q.duration_seconds) : null;
      return { pence: p, words: `about ${pence(p)}`, parts };
  });
}
