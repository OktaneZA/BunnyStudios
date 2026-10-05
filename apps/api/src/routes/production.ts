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
import { and, asc, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { lastFrame } from '../generation/media.ts';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { compileVideoShot, promptBudget, TEMPLATE_VERSION, VIDEO_TEMPLATE_VERSION } from '@storyboard/compiler';
import { CLIP_LENGTHS, durationOptions, quoteGeneration, type GenerationModel, type VideoModelDefinition, type VideoTask } from '@storyboard/models';
import { db, schema } from '../db/client.ts';
import { ApiError, ProblemType } from '../errors.ts';
import { pence, type Tx } from '../generation/budget.ts';
import { isGated } from '../generation/catalogue.ts';
import { validateUpload } from '../storage/uploads.ts';
import { assetHash, usableForLook } from '../cast/looks.ts';
import { compileInput, ownShot, presentShot, syncSceneShots } from '../shots/sync.ts';
import { buildManifest, saveShotCast, shotCast, type ShotCastEntry } from '../shots/cast.ts';
import { CREATIVE_SNAPSHOT_VERSION, STYLE_REFERENCE, type CreativeVideoSnapshot, type ReferenceBinding } from '../video/creativeVideoRequest.ts';
import { stylePicture } from '../cartoon/style.ts';
import { ADAPTER_VERSION, promptWithReferenceTokens } from '../video/adapters/catalogue.ts';
import { isConstrained, presentAsset, presentJob, type DirectorDeps } from './director.ts';
import type { JobRequest } from '../jobs/runner.ts';
import { createJob } from '../jobs/create.ts';

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
  /** §7.4: with a starting picture, still send the character pictures (needs a maker that takes both). */
  keep_cast_pictures: z.boolean().default(false),
  audio: z.boolean().optional(),
  /** Advanced only: a specific endpoint and size. */
  model_id: z.string().min(1).max(60).optional(),
  resolution: z.string().max(20).optional(),
  /** DF-02: make the final from this accepted draft's recorded snapshot. */
  from_job_id: z.string().uuid().optional(),
  /** DF-02: rebuild from the current story instead of the draft's snapshot. Explicit only. */
  use_latest: z.boolean().default(false),
  /** "Make another version": a short change for this run only, added to the recorded recipe. */
  note: z.string().trim().max(300).optional(),
});
type VideoBody = z.infer<typeof videoBody>;

const TIER_RANK = { high: 3, medium: 2, low: 1 } as const;

/** What a final would use: a recommended maker first, else the highest cost level, else catalogue order. */
function finalPick(candidates: VideoModelDefinition[]): VideoModelDefinition | undefined {
  return candidates.find((m) => m.video?.categories.includes('recommended'))
    ?? [...candidates].sort((a, b) => (TIER_RANK[b.tier ?? 'low'] ?? 0) - (TIER_RANK[a.tier ?? 'low'] ?? 0))[0];
}

/** The family a maker belongs to; a maker without one is its own family. */
const familyOf = (m: GenerationModel) => m.video?.family ?? m.id;

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

  /**
   * §7.4: the last frame of the previous page's chosen clip becomes this scene's starting picture.
   * The frame inherits the clip's review verdict (it is a picture from an allowed clip, not new
   * content). The response names the page it came from; the caller then quotes with
   * use_start_frame and keep_cast_pictures so the identity pictures ride along.
   */
  app.post('/shots/:id/start-from-previous', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const version = z.coerce.number().int().positive().parse(request.headers['if-match']);
    return db.transaction(async (tx) => {
      const { shot, scene } = await ownShot(tx, request.accountId, id, true);
      const { constrained } = await isConstrained(tx as unknown as typeof db, request.accountId, scene.projectId);
      if (shot.version !== version) throw ApiError.conflict('This scene changed somewhere else. Have a look, then choose again.', presentShot(shot));
      const [previous] = await tx.select().from(schema.scenes)
        .where(and(eq(schema.scenes.projectId, scene.projectId), eq(schema.scenes.accountId, request.accountId), isNull(schema.scenes.deletedAt), lt(schema.scenes.sortOrder, scene.sortOrder)))
        .orderBy(desc(schema.scenes.sortOrder), desc(schema.scenes.sceneNumber)).limit(1);
      if (!previous) throw needs('This is the first page, so there is no page before it to continue from.', { missing: 'previous_page' });
      const [previousShot] = await tx.select().from(schema.shots).where(and(eq(schema.shots.sceneId, previous.id), eq(schema.shots.accountId, request.accountId))).orderBy(asc(schema.shots.sortOrder), asc(schema.shots.id)).limit(1);
      const clipId = previousShot?.heroVideoAssetId;
      const [clip] = clipId ? await tx.select().from(schema.assets).where(and(eq(schema.assets.id, clipId), eq(schema.assets.accountId, request.accountId), isNull(schema.assets.deletedAt))) : [];
      if (!clip || !clip.mimeType.startsWith('video/')) throw needs(`Page ${previous.sceneNumber} has no clip chosen yet. Make its clip and choose it first.`, { missing: 'previous_clip', scene_id: previous.id });
      if (clip.reviewStatus === 'rejected' || (constrained && clip.reviewStatus !== 'allowed')) throw ApiError.validation(`Page ${previous.sceneNumber}’s clip has not passed the check, so it cannot start this one.`);
      const frame = await lastFrame(await store.get(clip.storageKey));
      if (!frame) throw ApiError.validation('The last picture of that clip could not be read. Try again, or upload a starting picture instead.');
      const stored = await store.put(frame, 'jpg', { accountId: request.accountId, projectId: scene.projectId });
      const [asset] = await tx.insert(schema.assets).values({
        accountId: request.accountId, projectId: scene.projectId, ownerEntityType: 'shot', ownerEntityId: shot.id, kind: 'frame_ref',
        filename: `${shot.id}-from-page-${previous.sceneNumber}.jpg`, mimeType: 'image/jpeg', sizeBytes: stored.sizeBytes, storageKey: stored.key, contentSha256: stored.sha256,
        reviewStatus: clip.reviewStatus, reviewReason: null,
      }).returning();
      const [updated] = await tx.update(schema.shots).set({ startFrameAssetId: asset!.id, version: shot.version + 1, updatedAt: new Date() }).where(eq(schema.shots.id, shot.id)).returning();
      return reply.code(201).send({ shot: presentShot(updated!), asset: presentAsset(asset!), from_scene: { scene_id: previous.id, scene_number: previous.sceneNumber, title: previous.title } });
    });
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
      if (row.status !== 'ready') throw ApiError.validation('That clip is not finished yet, so it cannot be used again.');
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
      // §7.4: "start where the last page ended" keeps the identity pictures as well as the frame, so
      // errors never accumulate from chaining generated frames alone.
      task = body.use_start_frame ? (body.keep_cast_pictures && body.continuity ? 'reference-to-video' : 'image-to-video') : body.continuity ? 'reference-to-video' : 'text-to-video';
      if (body.use_start_frame) startFrame = await frameBinding(database, accountId, shot.startFrameAssetId, scene.projectId, constrained, 'start');
      if (body.use_end_frame) endFrame = await frameBinding(database, accountId, shot.endFrameAssetId, scene.projectId, constrained, 'end');
      // CR-01 keeps production on a saved list. An unsaved scene uses the story's proposal with each
      // character's current look, and making the clip saves exactly that list (§6.2, V2). The cast is
      // recorded on every clip, so a clip made from the words only can say so.
      cast = await shotCast(database, accountId, shot, scene);
    }

    // Candidate endpoints for this task, before references are counted.
    const parentRequest = parent?.request as JobRequest | null | undefined;
    const nativeSeconds = body.duration_seconds ?? base?.output.durationSeconds ?? parentRequest?.durationSeconds ?? undefined;
    if (!nativeSeconds) throw ApiError.validation('Choose how long the clip should be.');
    const requestedAudio = body.audio ?? base?.output.audio ?? parentRequest?.audio ?? false;
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
      // §7.2: the cartoon's style picture rides last, counted against the limit, never dropped on the quiet.
      const styleAsset = await stylePicture(database, accountId, scene.projectId, constrained);
      const styleRef: ReferenceBinding | null = styleAsset ? {
        assetId: styleAsset.id, contentHash: await assetHash(database, store, styleAsset), modality: 'image', role: 'style',
        characterId: STYLE_REFERENCE.id, characterName: STYLE_REFERENCE.name, characterVisualVersionId: '', view: 'style', position: 0,
      } : null;
      for (const views of [8, 1]) {
        manifest = buildManifest(cast, views);
        if (styleRef) manifest.references.push({ ...styleRef, position: manifest.references.length });
        candidates = catalogue.videoModels({ ...requirements, referenceImageCount: manifest.references.length }, advanced);
        if (candidates.length) break;
      }
      if (!candidates.length && styleRef) {
        const without = buildManifest(cast, 1);
        if (catalogue.videoModels({ ...requirements, referenceImageCount: without.references.length }, advanced).length) {
          throw needs('The style picture does not fit alongside everyone’s pictures for any clip maker. Remove the style picture on the cover, or take someone out of this scene.', { missing: 'style_picture_room' });
        }
      }
    } else if (!base) {
      // A starting picture carries the look, and words only sends none; the cast is still recorded for lineage.
      manifest = { characters: buildManifest(cast, 1).characters, references: [], missingLooks: [] };
    }
    if (!candidates.length) candidates = catalogue.videoModels({ ...requirements, ...(manifest ? { referenceImageCount: manifest.references.length } : {}) }, advanced);

    // Simple lengths: text-to-video may be planned as joined parts (disclosed); frame/reference tasks are one native shot.
    if (task === 'text-to-video') candidates = candidates.filter((m) => CLIP_LENGTHS.includes(nativeSeconds) || durationOptions(m).includes(nativeSeconds));
    if (body.resolution) candidates = candidates.filter((m) => m.resolutions.includes(body.resolution!));

    // A final made from a recipe whose prompt already names pictures inline must keep the same token wording.
    const baseModel = base ? catalogue.find(base!.modelId) : undefined;
    if (base && !baseModel) throw needs('That clip’s maker is not available any more. Make it from the scene as it is now instead.', { can_use_latest: true });
    if (base?.compilerVersion === VIDEO_TEMPLATE_VERSION && base.references.length) {
      candidates = candidates.filter((m) => m.request_shape.reference_token_prefix === baseModel?.request_shape.reference_token_prefix);
    }

    const intent = body.purpose === 'preview' ? 'draft' as const : 'final' as const;
    const parentModel = parent ? catalogue.find(parent!.modelId) : undefined;
    const costAt = (m: VideoModelDefinition, resolution: string) =>
      quoteGeneration(m, { durationSeconds: nativeSeconds, resolution, native: task !== 'text-to-video', referenceCount: manifest?.references.length ?? 0 }).pence;
    const cheapestResolution = (m: VideoModelDefinition) => [...m.resolutions].sort((a, b) => costAt(m, a) - costAt(m, b))[0]!;

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
    } else if (parentModel?.video?.family) {
      // V4: a final (or another version) stays with the clip it came from: the same maker, else its family.
      const family = candidates.filter((m) => familyOf(m) === familyOf(parentModel));
      model = family.find((m) => m.id === parentModel.id) ?? finalPick(family);
    }
    if (!model && !body.model_id) {
      // Recommendations, not guarantees. A final follows catalogue order, recommended first. A preview is
      // the cheapest try of the family the final would use, so the final looks like the preview (§7.3);
      // makers without a family (the original tiers) keep the cheapest fit overall.
      const final = finalPick(candidates);
      if (intent === 'final') model = final;
      else {
        const pool = final?.video?.family ? candidates.filter((m) => familyOf(m) === familyOf(final)) : candidates;
        model = [...pool].sort((a, b) => costAt(a, cheapestResolution(a)) - costAt(b, cheapestResolution(b)))[0];
      }
    }
    if (!model) {
      const { nativeDurationSeconds: _ignored, ...anyLength } = requirements as typeof requirements & { nativeDurationSeconds?: number };
      const lengths = [...new Set(catalogue.videoModels(anyLength, advanced).flatMap((m) => durationOptions(m)))].sort((a, b) => a - b);
      throw needs(task === 'text-to-video'
        ? 'No clip maker can make that right now. Try a different length.'
        : task === 'reference-to-video'
          ? (startFrame
            ? 'No clip maker can start from a picture and use the character pictures at the same time for this clip. Try a different length, or turn off “keep the character pictures”.'
            : 'No clip maker that uses character pictures can make this yet. Make a quick draft from the words, or ask a grown-up.')
          : 'No clip maker can start from a picture like this yet. Try without the starting picture.', {
        missing: 'compatible_model', supported_durations: lengths, quick_draft_available: task !== 'text-to-video',
      });
    }

    // A preview is made at the maker's cheapest size, a final at its standard size; another version keeps its size.
    const kept = base && base.intent === intent && model.resolutions.includes(base.output.resolution) ? base.output.resolution : null;
    const resolution = body.resolution ?? kept ?? (intent === 'draft' ? cheapestResolution(model) : model.resolutions[0]!);
    if (!model.resolutions.includes(resolution)) throw needs('That size is not available for this clip maker.', { missing: 'resolution', resolutions: model.resolutions });
    const aspectRatio = requestedAspect;
    const audio = model.video?.audio_mode === 'always' || (requestedAudio && model.capabilities.audio);
    const native = task !== 'text-to-video';
    const references = manifest?.references ?? [];
    // §5.1: the video template, compiled for this maker, with each character's picture tokens inline.
    // A recorded recipe keeps its words; a locked prompt is used verbatim.
    let compiled: { prompt: string; negativePrompt: string; compilerVersion: string };
    if (base) compiled = { prompt: base.prompt, negativePrompt: base.negativePrompt, compilerVersion: base.compilerVersion };
    else if (shot.promptLocked) compiled = { prompt: shot.compiledPrompt, negativePrompt: shot.compiledNegativePrompt, compilerVersion: TEMPLATE_VERSION };
    else {
      const prefix = model.request_shape.reference_token_prefix;
      const characterTokens: { id: string; name: string; tokens: string[] }[] = [];
      let styleToken = '';
      for (const r of prefix ? references : []) {
        if (r.role === 'style') { styleToken = `${prefix}${r.position + 1}`; continue; }
        let entry = characterTokens.find((c) => c.id === r.characterId);
        if (!entry) characterTokens.push(entry = { id: r.characterId, name: r.characterName, tokens: [] });
        entry.tokens.push(`${prefix}${r.position + 1}`);
      }
      const video = compileVideoShot({
        ...await compileInput(database, accountId, scene, shot),
        video: { cameraMovement: scene.cameraMovement, characterTokens, styleToken, negative: model.request_shape.negative_prompt ? 'field' : 'fold', audio },
      });
      compiled = { prompt: video.prompt, negativePrompt: video.negativePrompt, compilerVersion: VIDEO_TEMPLATE_VERSION };
    }
    // The note is part of this run's recipe, reviewed and length-checked with the rest (MB-06).
    const prompt = [compiled.prompt, body.note ?? ''].filter((s) => s.trim()).join(' ');
    if (!prompt.trim()) throw ApiError.validation('Write what happens in this scene first, in Story.');
    // MB-06: names an older recipe's adapter appends count towards the limit and are reviewed with the prompt.
    const sent = compiled.compilerVersion === VIDEO_TEMPLATE_VERSION ? prompt : promptWithReferenceTokens(model, prompt, references.map((r) => r.characterName));
    // V4: a final made from its preview on the same maker reuses the preview's seed; another version gets a new one.
    const parentSeed = (parent?.providerResult as { seed?: unknown } | null)?.seed;
    const seed = parent?.intent === 'draft' && intent === 'final' && parent.modelId === model.id && model.request_shape.seed && typeof parentSeed === 'number' ? parentSeed : null;
    const budget = promptBudget(sent, model.max_prompt_length);
    if (budget.over) throw ApiError.validation(`The scene description is too long for this clip maker. Shorten it in Story by about ${budget.length - budget.max} letters.`);
    const quote = quoteGeneration(model, { durationSeconds: nativeSeconds, resolution, native, referenceCount: references.length });

    const snapshot: CreativeVideoSnapshot = {
      schemaVersion: CREATIVE_SNAPSHOT_VERSION, shotId: shot.id, task, intent,
      ...(base ? (base.sceneVersion === undefined ? {} : { sceneVersion: base.sceneVersion }) : { sceneVersion: scene.version }),
      prompt, negativePrompt: compiled.negativePrompt, compilerVersion: compiled.compilerVersion,
      startFrame, endFrame, references, characters: manifest?.characters ?? [],
      output: { durationSeconds: nativeSeconds, resolution, aspectRatio, audio },
      cameraMovement: base ? base.cameraMovement ?? null : scene.cameraMovement, seed,
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
      // §6.2: an unsaved scene's proposal is what this clip uses; making it saves that list.
      saveCast: !base && body.continuity && !shot.castSaved ? cast : null,
    };
  }

  function presentPlan(p: Awaited<ReturnType<typeof plan>>, advanced: boolean) {
    const generated = (p.parts ?? []).reduce((a, b) => a + b, 0);
    return {
      quote_key: createHash('sha256').update(JSON.stringify({ creative: p.snapshot, pricing: p.quote.snapshot })).digest('hex'),
      pence: p.quote.pence, words: `about ${pence(p.quote.pence)}`,
      task: p.snapshot.task, intent: p.snapshot.intent,
      output: p.snapshot.output, prompt: p.snapshot.prompt,
      model_id: advanced ? p.model.id : null, model_label: advanced ? p.model.label : null,
      parts: p.parts, generated_seconds: generated,
      characters: p.snapshot.characters.map((c) => ({ character_id: c.characterId, name: c.name, look_version: c.visualVersion })),
      reference_count: p.snapshot.references.length,
      // Said plainly on the screen: characters are in the scene but no pictures of them are sent.
      words_only: p.snapshot.task !== 'image-to-video' && p.snapshot.characters.length > 0 && p.snapshot.references.length === 0,
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
    const created = await createJob({ accountId: request.accountId, requestKey, runner, log: request.log }, async (tx) => {
      const c = await context(tx, request.accountId, id, true);
      if (c.constrained && !review.enabled) throw ApiError.validation('The safety checker is not set up, so clips cannot be made on this account yet. Ask a grown-up.');
      const p = await plan(tx, request.accountId, c.shot, c.scene, body, c.advanced, c.constrained);
      const presented = presentPlan(p, c.advanced);
      if (body.expected_quote_key && body.expected_quote_key !== presented.quote_key) {
        throw ApiError.conflict('The clip or its price changed. Check the new quote before making it.', presented);
      }
      if (p.saveCast) {
        const saved = await saveShotCast(tx, request.accountId, c.shot.id, c.scene.projectId, p.saveCast.map((e) => ({ characterId: e.character.id, look: e.look?.id ?? 'none', outfitLabel: e.binding?.outfitLabel ?? null })));
        if (!('ok' in saved)) throw ApiError.conflict('The characters in this scene changed. Check the new quote before making it.', presented);
        await tx.update(schema.shots).set({ version: c.shot.version + 1, updatedAt: new Date() }).where(eq(schema.shots.id, c.shot.id));
      }
      return {
        values: {
          projectId: c.scene.projectId, kind: 'video', targetEntityType: 'shot', targetEntityId: c.shot.id,
          modelId: p.model.id, provider: p.model.provider, request: p.jobRequest, task: p.snapshot.task, intent: p.snapshot.intent,
          snapshotVersion: CREATIVE_SNAPSHOT_VERSION, generationGroupId: p.parent?.generationGroupId ?? randomUUID(), parentJobId: p.parent?.id ?? null,
        },
        reserve: { model: p.model, durationSeconds: p.snapshot.output.durationSeconds, resolution: p.snapshot.output.resolution, native: p.jobRequest.native ?? false, referenceCount: p.snapshot.references.length },
        extra: presented,
      };
    });
    reply.header('Cache-Control', 'no-store');
    // The shot's version moves when the cast is saved with the clip; the screen needs the new one.
    const [shot] = await db.select().from(schema.shots).where(and(eq(schema.shots.id, created.job.targetEntityId), eq(schema.shots.accountId, request.accountId)));
    return reply.code(created.fresh ? 202 : 200).send({ ...presentJob(created.job, [], true), plan: created.extra, shot: shot ? presentShot(shot) : null });
  });
}
