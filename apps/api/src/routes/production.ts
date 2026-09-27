/**
 * Production video (Character Studio Stages 4–5): who is in the shot, its starting and ending
 * pictures, and "Quick preview" / "Make final video" with draft → final lineage.
 *
 *   GET  /shots/:id/cast            the saved cast, or the story's proposal
 *   PUT  /shots/:id/cast            save "Characters in this shot" (If-Match: shot version)
 *   POST /shots/:id/frames          upload a starting/ending picture (reviewed like any upload)
 *   PUT  /shots/:id/frames          choose the starting/ending picture (If-Match)
 *   POST /shots/:id/videos/quote    route + price, nothing spent
 *   POST /shots/:id/videos          route + price + reserve + queue, in one transaction
 *
 * The server builds the request: it compiles the prompt, resolves approved looks into an
 * ordered, hash-pinned manifest, and picks an endpoint that has every required capability.
 * It never falls back to a model that would drop a reference, a frame or the sound (MG-03), and
 * it never trims a character to fit a limit (CR-04): it tries a smaller pack per character,
 * then asks the user to choose fewer characters.
 */
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { promptBudget, TEMPLATE_VERSION } from '@storyboard/compiler';
import { CLIP_LENGTHS, durationOptions, quoteGeneration, type VideoModelDefinition, type VideoTask } from '@storyboard/models';
import { db, schema } from '../db/client.ts';
import { ApiError, ProblemType } from '../errors.ts';
import { pence, reserve, type Tx } from '../generation/budget.ts';
import { isGated } from '../generation/catalogue.ts';
import { validateUpload } from '../storage/uploads.ts';
import { assetHash, usableForLook } from '../cast/looks.ts';
import { ownShot, presentShot, syncSceneShots } from '../shots/sync.ts';
import { buildManifest, saveShotCast, shotCast, type ShotCastEntry } from '../shots/cast.ts';
import { CREATIVE_SNAPSHOT_VERSION, type CreativeVideoSnapshot } from '../video/creativeVideoRequest.ts';
import { ADAPTER_VERSION, promptWithReferenceTokens } from '../video/adapters/catalogue.ts';
import { isConstrained, presentAsset, presentJob, type DirectorDeps } from './director.ts';
import type { JobRequest } from '../jobs/runner.ts';

const idParam = z.object({ id: z.string().uuid() });
type Asset = typeof schema.assets.$inferSelect;
type Shot = typeof schema.shots.$inferSelect;
type Scene = typeof schema.scenes.$inferSelect;
type Job = typeof schema.generationJobs.$inferSelect;
type Database = typeof db | Tx;

/** A 422 that tells the child what to choose, with the facts the screen needs to offer it. */
function needs(detail: string, state: Record<string, unknown>): ApiError {
  return new ApiError(422, ProblemType.validation, 'Something to choose first', detail, { current_state: state });
}

const videoBody = z.object({
  expected_quote_key: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /** DF-01: a purpose, never a model name, in Simple mode. */
  purpose: z.enum(['preview', 'final']),
  /** Use the approved looks of the characters in this shot. False = a quick text draft, no promise. */
  continuity: z.boolean().default(true),
  /** Optional only when finishing a preview: the preview's length is reused. */
  duration_seconds: z.number().int().min(1).max(60).optional(),
  use_start_frame: z.boolean().default(false),
  use_end_frame: z.boolean().default(false),
  audio: z.boolean().optional(),
  /** Advanced only: a specific endpoint and size. */
  model_id: z.string().min(1).max(60).optional(),
  resolution: z.string().max(20).optional(),
  /** DF-02: make the final from this accepted draft's recorded snapshot. */
  from_job_id: z.string().uuid().optional(),
  /** DF-02: rebuild from the current story instead of the draft's snapshot. Explicit only. */
  use_latest: z.boolean().default(false),
});
type VideoBody = z.infer<typeof videoBody>;

/** Is this picture allowed to start or end a clip? Production pictures only, never a sketch (CR-06). */
function frameUsable(asset: Asset, projectId: string, constrained: boolean): boolean {
  if (asset.projectId !== projectId) return false;
  const kindOk = asset.kind === 'frame_ref' || asset.kind === 'character_ref' || (asset.kind === 'generated_output' && asset.mimeType.startsWith('image/'));
  return kindOk && usableForLook(asset, constrained);
}

export async function productionRoutes(app: FastifyInstance, deps: DirectorDeps) {
  app.addHook('onRequest', app.requireAuth);
  const { catalogue, store, review, runner } = deps;

  function presentCast(entries: ShotCastEntry[], shot: Shot, hideRejected: boolean) {
    return {
      shot_id: shot.id, version: shot.version, saved: shot.castSaved,
      characters: entries.map((e) => ({
        character_id: e.character.id, name: e.character.name, proposed: e.proposed,
        look_id: e.look?.id ?? null, look_version: e.look?.visualVersion ?? null,
        current_look_id: e.character.currentVisualVersionId,
        // The shot keeps the look it was given; a newer approved look is offered, never applied silently.
        newer_look_available: Boolean(e.look && e.character.currentVisualVersionId && e.character.currentVisualVersionId !== e.look.id),
        look_status: e.look ? 'approved' : 'none',
        main_picture: e.look?.references[0] && (!hideRejected || e.look.references[0].asset.reviewStatus !== 'rejected') ? presentAsset(e.look.references[0].asset) : null,
        outfit_label: e.binding?.outfitLabel ?? null,
        outfits: Array.isArray(e.character.costumeVariants) ? (e.character.costumeVariants as { label: string }[]).map((o) => o.label) : [],
      })),
    };
  }

  app.get('/shots/:id/cast', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { shot, scene } = await ownShot(db, request.accountId, id);
    const { account } = await isConstrained(db, request.accountId, scene.projectId);
    reply.header('Cache-Control', 'no-store');
    return presentCast(await shotCast(db, request.accountId, shot, scene), shot, account.isMinor);
  });

  app.put('/shots/:id/cast', async (request) => {
    const { id } = idParam.parse(request.params);
    const version = z.coerce.number().int().positive().parse(request.headers['if-match']);
    const body = z.object({ characters: z.array(z.object({
      character_id: z.string().uuid(),
      look: z.union([z.literal('current'), z.literal('none'), z.string().uuid()]).default('current'),
      outfit_label: z.string().trim().min(1).max(40).nullable().default(null),
    })).max(12) }).parse(request.body);
    return db.transaction(async (tx) => {
      const { shot, scene } = await ownShot(tx, request.accountId, id, true);
      const { account } = await isConstrained(tx as unknown as typeof db, request.accountId, scene.projectId);
      if (shot.version !== version) throw ApiError.conflict('This scene changed somewhere else. Have a look, then choose again.', presentShot(shot));
      const saved = await saveShotCast(tx, request.accountId, shot.id, scene.projectId, body.characters.map((c) => ({ characterId: c.character_id, look: c.look, outfitLabel: c.outfit_label })));
      if ('notFound' in saved) throw ApiError.notFound('Character');
      if ('error' in saved) throw ApiError.validation(saved.error);
      await tx.update(schema.shots).set({ version: shot.version + 1, updatedAt: new Date() }).where(eq(schema.shots.id, shot.id));
      const [fresh] = await tx.select().from(schema.shots).where(eq(schema.shots.id, shot.id));
      await syncSceneShots(tx, request.accountId, scene);
      const [synced] = await tx.select().from(schema.shots).where(eq(schema.shots.id, shot.id));
      return presentCast(await shotCast(tx, request.accountId, synced ?? fresh!, scene), synced ?? fresh!, account.isMinor);
    });
  });

  // ── Starting and ending pictures (CR-06) ──────────────────────────────────
  app.post('/shots/:id/frames', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { shot, scene } = await ownShot(db, request.accountId, id);
    const { constrained } = await isConstrained(db, request.accountId, scene.projectId);
    const part = await request.file();
    if (!part) throw ApiError.validation('Choose a picture to upload.');
    const file = validateUpload(await part.toBuffer(), 'image');
    let reviewStatus: 'not_required' | 'allowed' | 'rejected' = 'not_required';
    let reviewReason: string | null = null;
    if (constrained || review.enabled) {
      if (!review.enabled) throw ApiError.validation('The safety checker is not set up, so pictures cannot be added on this account yet. Ask a grown-up.');
      const verdict = await review.reviewImage({ bytes: file.bytes, mimeType: file.mimeType }, constrained, AbortSignal.timeout(60_000));
      reviewStatus = verdict.allowed ? 'allowed' : 'rejected';
      reviewReason = verdict.allowed ? null : verdict.reason;
    }
    const stored = await store.put(file.bytes, file.extension, { accountId: request.accountId, projectId: scene.projectId });
    const [asset] = await db.insert(schema.assets).values({
      accountId: request.accountId, projectId: scene.projectId, ownerEntityType: 'shot', ownerEntityId: shot.id, kind: 'frame_ref',
      filename: `${shot.id}-frame.${file.extension}`, mimeType: file.mimeType, sizeBytes: stored.sizeBytes, storageKey: stored.key, contentSha256: stored.sha256, reviewStatus, reviewReason,
    }).returning();
    if (reviewStatus === 'rejected') throw ApiError.validation('That picture was held back by the safety checker. Try a different one.');
    return reply.code(201).send(presentAsset(asset!));
  });

  app.put('/shots/:id/frames', async (request) => {
    const { id } = idParam.parse(request.params);
    const version = z.coerce.number().int().positive().parse(request.headers['if-match']);
    const body = z.object({ start_asset_id: z.string().uuid().nullable().optional(), end_asset_id: z.string().uuid().nullable().optional() }).parse(request.body);
    return db.transaction(async (tx) => {
      const { shot, scene } = await ownShot(tx, request.accountId, id, true);
      const { constrained } = await isConstrained(tx as unknown as typeof db, request.accountId, scene.projectId);
      if (shot.version !== version) throw ApiError.conflict('This scene changed somewhere else. Have a look, then choose again.', presentShot(shot));
      const ids = [body.start_asset_id, body.end_asset_id].filter((v): v is string => Boolean(v));
      const assets = ids.length ? await tx.select().from(schema.assets).where(and(inArray(schema.assets.id, ids), eq(schema.assets.accountId, request.accountId), isNull(schema.assets.deletedAt))) : [];
      for (const assetId of ids) {
        const asset = assets.find((a) => a.id === assetId);
        if (!asset) throw ApiError.notFound('Picture');
        if (!frameUsable(asset, scene.projectId, constrained)) throw ApiError.validation(asset.kind === 'scene_thumbnail' ? 'A rough sketch cannot start a clip. Choose a finished picture.' : 'That picture cannot start or end a clip.');
      }
      const patch: Partial<typeof schema.shots.$inferInsert> = { version: shot.version + 1, updatedAt: new Date() };
      if (body.start_asset_id !== undefined) patch.startFrameAssetId = body.start_asset_id;
      if (body.end_asset_id !== undefined) patch.endFrameAssetId = body.end_asset_id;
      const [updated] = await tx.update(schema.shots).set(patch).where(eq(schema.shots.id, shot.id)).returning();
      return presentShot(updated!);
    });
  });

  // ── Quick preview / Make final video (DF-01–DF-05, CR-01–CR-04, MG-01–MG-05) ─
  async function frameBinding(database: Database, accountId: string, assetId: string | null, projectId: string, constrained: boolean, which: 'start' | 'end') {
    if (!assetId) throw needs(which === 'start' ? 'Choose a starting picture for this scene first.' : 'Choose an ending picture for this scene first.', { missing: `${which}_frame` });
    const [asset] = await database.select().from(schema.assets).where(and(eq(schema.assets.id, assetId), eq(schema.assets.accountId, accountId), isNull(schema.assets.deletedAt)));
    if (!asset) throw ApiError.notFound('Picture');
    if (!frameUsable(asset, projectId, constrained)) throw ApiError.validation('That picture cannot start or end a clip.');
    return { assetId: asset.id, contentHash: await assetHash(database, store, asset) };
  }

  /**
   * Plan one production request: build (or reuse) the creative snapshot, then choose an endpoint
   * with every required capability. Throws before any money moves when nothing fits.
   */
  async function plan(database: Database, accountId: string, shot: Shot, scene: Scene, body: VideoBody, advanced: boolean, constrained: boolean) {
    // DF-02: a final starts from the draft's recorded snapshot unless the user asked for the latest story.
    let parent: Job | null = null;
    let base: CreativeVideoSnapshot | null = null;
    if (body.from_job_id) {
      const [row] = await database.select().from(schema.generationJobs).where(and(eq(schema.generationJobs.id, body.from_job_id), eq(schema.generationJobs.accountId, accountId), eq(schema.generationJobs.targetEntityId, shot.id)));
      if (!row) throw ApiError.notFound('Preview');
      if (row.status !== 'ready') throw ApiError.validation('That preview is not finished, so it cannot be made into a final video yet.');
      parent = row;
      const recorded = (row.request as JobRequest).creative;
      if (!recorded && !body.use_latest) throw needs('That clip was made before previews kept their recipe. Use the latest story instead.', { can_use_latest: true });
      if (!body.use_latest) base = recorded!;
    }

    let task: VideoTask;
    let startFrame: CreativeVideoSnapshot['startFrame'] = null;
    let endFrame: CreativeVideoSnapshot['endFrame'] = null;
    let cast: ShotCastEntry[] = [];
    if (base) {
      task = base.task;
      startFrame = base.startFrame;
      endFrame = base.endFrame;
    } else {
      if (body.use_end_frame && !body.use_start_frame) throw ApiError.validation('An ending picture needs a starting picture too.');
      task = body.use_start_frame ? 'image-to-video' : body.continuity ? 'reference-to-video' : 'text-to-video';
      if (body.use_start_frame) startFrame = await frameBinding(database, accountId, shot.startFrameAssetId, scene.projectId, constrained, 'start');
      if (body.use_end_frame) endFrame = await frameBinding(database, accountId, shot.endFrameAssetId, scene.projectId, constrained, 'end');
      if (body.continuity || body.use_start_frame) {
        cast = await shotCast(database, accountId, shot, scene);
        // CR-01: production follows the saved choice. A story proposal must be looked at first.
        if (body.continuity && !shot.castSaved) throw needs('Check who is in this scene first.', { missing: 'cast', proposed: cast.map((e) => ({ character_id: e.character.id, name: e.character.name })) });
      }
    }

    // Candidate endpoints for this task, before references are counted.
    const nativeSeconds = body.duration_seconds ?? base?.output.durationSeconds;
    if (!nativeSeconds) throw ApiError.validation('Choose how long the clip should be.');
    const requestedAudio = body.audio ?? base?.output.audio ?? false;
    const requestedAspect = base?.output.aspectRatio ?? ((await isConstrained(database as typeof db, accountId, scene.projectId)).aspectRatio as '16:9' | '9:16' | '1:1');
    const requirements = {
      task, startFrame: Boolean(startFrame), endFrame: Boolean(endFrame), audio: requestedAudio, aspectRatio: requestedAspect,
      ...(task === 'text-to-video' ? {} : { nativeDurationSeconds: nativeSeconds }),
    };

    // CR-03/CR-04: every character keeps their place; try the full pack, then one picture each.
    let manifest = base ? { characters: base.characters, references: base.references, missingLooks: [] as { characterId: string; name: string }[] } : null;
    let candidates: VideoModelDefinition[] = [];
    if (!base && task === 'reference-to-video') {
      const full = buildManifest(cast, 8);
      if (full.missingLooks.length) {
        throw needs(`Choose how ${full.missingLooks.map((m) => m.name).join(' and ')} ${full.missingLooks.length === 1 ? 'looks' : 'look'} in Cast first, or make a quick draft without their pictures.`, {
          missing: 'looks', characters: full.missingLooks.map((m) => ({ character_id: m.characterId, name: m.name })), quick_draft_available: true,
        });
      }
      if (!full.references.length) throw needs('Nobody is in this scene yet. Add who is in it, or make a quick draft from the words.', { missing: 'cast', quick_draft_available: true });
      for (const views of [8, 1]) {
        manifest = buildManifest(cast, views);
        candidates = catalogue.videoModels({ ...requirements, referenceImageCount: manifest.references.length }, advanced);
        if (candidates.length) break;
      }
    } else if (!base) {
      // A starting picture carries the look; the cast is still recorded for lineage, with no references sent.
      manifest = { characters: buildManifest(cast, 1).characters, references: [], missingLooks: [] };
    }
    if (!candidates.length) candidates = catalogue.videoModels({ ...requirements, ...(manifest ? { referenceImageCount: manifest.references.length } : {}) }, advanced);

    // Simple lengths: text-to-video may be planned as joined parts (disclosed); frame/reference tasks are one native shot.
    if (task === 'text-to-video') candidates = candidates.filter((m) => CLIP_LENGTHS.includes(nativeSeconds) || durationOptions(m).includes(nativeSeconds));
    if (body.resolution) candidates = candidates.filter((m) => m.resolutions.includes(body.resolution!));

    let model: VideoModelDefinition | undefined;
    if (body.model_id) {
      model = candidates.find((m) => m.id === body.model_id);
      if (!model) {
        const asked = catalogue.available(advanced).find((m) => m.id === body.model_id);
        if (!asked) throw ApiError.validation('That clip maker is not available. Pick another one.');
        const d = asked.duration_seconds;
        throw needs(`${asked.friendlyLabel} cannot make this clip as asked${d ? ` (it makes ${d.min} to ${d.max} seconds)` : ''}. Nothing was lost; choose another maker or change the clip.`, {
          missing: 'compatible_model', compatible: candidates.map((m) => m.id), supported_durations: asked.kind === 'video' ? durationOptions(asked) : [],
        });
      }
    } else {
      // Recommendations, not guarantees: previews go to the cheapest fit; finals follow catalogue order,
      // recommended first. "Recommended" never picks a pricier model without this fresh quote.
      const priced = candidates.map((m) => ({ m, p: quoteGeneration(m, { durationSeconds: nativeSeconds, native: task !== 'text-to-video', referenceCount: manifest?.references.length ?? 0 }).pence }));
      if (body.purpose === 'preview') model = priced.sort((a, b) => a.p - b.p)[0]?.m;
      else model = candidates.find((m) => m.video?.categories.includes('recommended')) ?? candidates[0];
    }
    if (!model) {
      const { nativeDurationSeconds: _ignored, ...anyLength } = requirements as typeof requirements & { nativeDurationSeconds?: number };
      const lengths = [...new Set(catalogue.videoModels(anyLength, advanced).flatMap((m) => durationOptions(m)))].sort((a, b) => a - b);
      throw needs(task === 'text-to-video'
        ? 'No clip maker can make that right now. Try a different length.'
        : task === 'reference-to-video'
          ? 'No clip maker that uses character pictures can make this yet. Make a quick draft from the words, or ask a grown-up.'
          : 'No clip maker can start from a picture like this yet. Try without the starting picture.', {
        missing: 'compatible_model', supported_durations: lengths, quick_draft_available: task !== 'text-to-video',
      });
    }

    const resolution = body.resolution ?? base?.output.resolution ?? model.resolutions[0]!;
    if (!model.resolutions.includes(resolution)) throw needs('That size is not available for this clip maker.', { missing: 'resolution', resolutions: model.resolutions });
    const aspectRatio = requestedAspect;
    const audio = model.video?.audio_mode === 'always' || (requestedAudio && model.capabilities.audio);
    const native = task !== 'text-to-video';
    const references = manifest?.references ?? [];
    const prompt = base?.prompt ?? shot.compiledPrompt;
    if (!prompt.trim()) throw ApiError.validation('Write what happens in this scene first, in Story.');
    // MB-06: the names the adapter adds count towards the limit and are reviewed with the prompt.
    const sent = promptWithReferenceTokens(model, prompt, references.map((r) => r.characterName));
    const budget = promptBudget(sent, model.max_prompt_length);
    if (budget.over) throw ApiError.validation(`The scene description is too long for this clip maker. Shorten it in Story by about ${budget.length - budget.max} letters.`);
    const quote = quoteGeneration(model, { durationSeconds: nativeSeconds, resolution, native, referenceCount: references.length });

    const snapshot: CreativeVideoSnapshot = {
      schemaVersion: CREATIVE_SNAPSHOT_VERSION, shotId: shot.id, task, intent: body.purpose === 'preview' ? 'draft' : 'final',
      prompt, negativePrompt: base?.negativePrompt ?? shot.compiledNegativePrompt, compilerVersion: base?.compilerVersion ?? TEMPLATE_VERSION,
      startFrame, endFrame, references, characters: manifest?.characters ?? [],
      output: { durationSeconds: nativeSeconds, resolution, aspectRatio, audio },
      modelId: model.id, adapterVersion: ADAPTER_VERSION, quotePence: quote.pence,
    };
    const jobRequest: JobRequest = {
      prompt: snapshot.prompt, negativePrompt: snapshot.negativePrompt,
      referenceAssetIds: references.map((r) => r.assetId), referenceHashes: references.map((r) => r.contentHash), referenceNames: references.map((r) => r.characterName),
      startFrameAssetId: startFrame?.assetId ?? null, endFrameAssetId: endFrame?.assetId ?? null,
      aspectRatio, count: 1, durationSeconds: nativeSeconds, audio, resolution, native, constrained, assetKind: 'generated_output', creative: snapshot,
    };
    return {
      model, quote, snapshot, jobRequest, parent,
      // DF-03: generating a final is a new render, even on the same endpoint.
      newRender: Boolean(parent),
      parts: native ? [nativeSeconds] : quote.parts,
      gated: isGated(model),
    };
  }

  function presentPlan(p: Awaited<ReturnType<typeof plan>>, advanced: boolean) {
    const generated = (p.parts ?? []).reduce((a, b) => a + b, 0);
    return {
      quote_key: createHash('sha256').update(JSON.stringify({ creative: p.snapshot, pricing: p.quote.snapshot })).digest('hex'),
      pence: p.quote.pence, words: `about ${pence(p.quote.pence)}`,
      task: p.snapshot.task, intent: p.snapshot.intent,
      model_id: advanced ? p.model.id : null, model_label: advanced ? p.model.label : null,
      parts: p.parts, generated_seconds: generated,
      characters: p.snapshot.characters.map((c) => ({ character_id: c.characterId, name: c.name, look_version: c.visualVersion })),
      reference_count: p.snapshot.references.length,
      new_render: p.newRender,
      // Native completion of a provider draft is not offered until its endpoint and price are wired (DF-03).
      native_completion: 'unavailable' as const,
      estimate_only: true,
    };
  }

  async function context(database: Database, accountId: string, shotId: string, lock: boolean) {
    const { shot, scene } = await ownShot(database, accountId, shotId, lock);
    const { account, constrained } = await isConstrained(database as typeof db, accountId, scene.projectId);
    const [synced] = await syncSceneShots(database, accountId, scene);
    return { shot: synced?.id === shot.id ? synced : shot, scene, account, constrained: constrained || account.isMinor, advanced: account.defaultEditorMode === 'advanced' };
  }

  app.post('/shots/:id/videos/quote', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = videoBody.parse(request.body);
    const c = await context(db, request.accountId, id, false);
    reply.header('Cache-Control', 'no-store');
    return presentPlan(await plan(db, request.accountId, c.shot, c.scene, body, c.advanced, c.constrained), c.advanced);
  });

  app.post('/shots/:id/videos', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = videoBody.parse(request.body);
    const requestKey = z.string().uuid().parse(request.headers['idempotency-key']);
    const created = await db.transaction(async (tx) => {
      // The account row lock serialises spending (MB-03); the idempotency key makes a double tap one job (DF-05).
      await tx.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.id, request.accountId)).for('update');
      const [previous] = await tx.select().from(schema.generationJobs).where(and(eq(schema.generationJobs.accountId, request.accountId), eq(schema.generationJobs.requestKey, requestKey)));
      if (previous) return { job: previous, fresh: false, planned: null };
      const c = await context(tx, request.accountId, id, true);
      if (c.constrained && !review.enabled) throw ApiError.validation('The safety checker is not set up, so clips cannot be made on this account yet. Ask a grown-up.');
      const p = await plan(tx, request.accountId, c.shot, c.scene, body, c.advanced, c.constrained);
      const presented = presentPlan(p, c.advanced);
      if (body.expected_quote_key && body.expected_quote_key !== presented.quote_key) {
        throw ApiError.conflict('The clip or its price changed. Check the new quote before making it.', presented);
      }
      const [job] = await tx.insert(schema.generationJobs).values({
        accountId: request.accountId, projectId: c.scene.projectId, requestKey, kind: 'video', targetEntityType: 'shot', targetEntityId: c.shot.id,
        modelId: p.model.id, provider: p.model.provider, request: p.jobRequest, task: p.snapshot.task, intent: p.snapshot.intent,
        snapshotVersion: CREATIVE_SNAPSHOT_VERSION, generationGroupId: p.parent?.generationGroupId ?? randomUUID(), parentJobId: p.parent?.id ?? null,
      }).returning();
      await reserve(tx, { accountId: request.accountId, projectId: c.scene.projectId, jobId: job!.id, model: p.model, durationSeconds: p.snapshot.output.durationSeconds, resolution: p.snapshot.output.resolution, native: p.jobRequest.native ?? false, referenceCount: p.snapshot.references.length });
      return { job: job!, fresh: true, planned: presented };
    });
    if (created.fresh) void runner.tick().catch(() => {});
    reply.header('Cache-Control', 'no-store');
    return reply.code(created.fresh ? 202 : 200).send({ ...presentJob(created.job, [], true), plan: created.planned });
  });
}
