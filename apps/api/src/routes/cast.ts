/**
 * The cast, found from the story (plan D39, DM-5–DM-9): the proposal that finds it, the
 * characters it produces, their reference pictures, and the jobs that draw them.
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, isNotNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { compileShot } from '@storyboard/compiler';
import { db, schema } from '../db/client.ts';
import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { reserve } from '../generation/budget.ts';
import { sceneDescription } from '../scenes/description.ts';
import { validateUpload } from '../storage/uploads.ts';
import { compileInput } from '../shots/sync.ts';
import { castUnavailable, type CastFinder, type FoundCharacter } from '../cast/finder.ts';
import { isConstrained, presentAsset, presentJob, resolveOptions, type DirectorDeps } from './director.ts';
import type { JobRequest } from '../jobs/runner.ts';

const idParam = z.object({ id: z.string().uuid(), proposalId: z.string().uuid().optional() });
type Character = typeof schema.characters.$inferSelect;

function fingerprint(source: unknown) { return createHash('sha256').update(JSON.stringify(source)).digest('hex'); }

async function ownProject(accountId: string, id: string) {
  const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.accountId, accountId), isNull(schema.projects.deletedAt)));
  if (!project) throw ApiError.notFound('Project');
  return project;
}

async function ownCharacter(accountId: string, id: string) {
  const [row] = await db.select().from(schema.characters).where(and(eq(schema.characters.id, id), eq(schema.characters.accountId, accountId), isNull(schema.characters.deletedAt)));
  if (!row) throw ApiError.notFound('Character');
  await ownProject(accountId, row.projectId);
  return row;
}

async function storySource(accountId: string, projectId: string) {
  const project = await ownProject(accountId, projectId);
  const scenes = await db.select().from(schema.scenes).where(and(eq(schema.scenes.projectId, projectId), eq(schema.scenes.accountId, accountId), isNull(schema.scenes.deletedAt))).orderBy(asc(schema.scenes.sortOrder), asc(schema.scenes.id));
  const source = { title: project.title, scenes: scenes.map((s) => ({ scene_number: s.sceneNumber, title: s.title, description: sceneDescription(s) })) };
  return { project, scenes, source, fingerprint: fingerprint(source) };
}

export async function castRoutes(app: FastifyInstance, deps: DirectorDeps & { finder: CastFinder }) {
  app.addHook('onRequest', app.requireAuth);
  const { catalogue, store, review, runner, finder } = deps;

  async function presentCharacters(rows: Character[], accountId: string, hideRejected: boolean, storyFingerprint: string | null) {
    const ids = rows.map((r) => r.id);
    const refs = ids.length ? await db.select().from(schema.assets).where(and(
      eq(schema.assets.accountId, accountId), eq(schema.assets.kind, 'character_ref'), eq(schema.assets.ownerEntityType, 'character'),
      inArray(schema.assets.ownerEntityId, ids), isNull(schema.assets.deletedAt),
    )).orderBy(desc(schema.assets.uploadedAt)) : [];
    const sceneIds = [...new Set(rows.flatMap((r) => r.foundInSceneIds))];
    const scenes = sceneIds.length ? await db.select({ id: schema.scenes.id, n: schema.scenes.sceneNumber }).from(schema.scenes).where(and(inArray(schema.scenes.id, sceneIds), isNull(schema.scenes.deletedAt))) : [];
    const numbers = new Map(scenes.map((s) => [s.id, s.n]));
    return rows.map((c) => {
      const mine = refs.filter((a) => a.ownerEntityId === c.id && (!hideRejected || a.reviewStatus !== 'rejected'));
      const main = mine.find((a) => a.id === c.mainReferenceAssetId) ?? null;
      return {
        id: c.id,
        name: c.name,
        description: c.promptToken,
        costume: c.defaultCostume,
        background_story: c.backgroundStory,
        source: c.source,
        scene_numbers: c.foundInSceneIds.map((id) => numbers.get(id)).filter((n): n is number => typeof n === 'number').sort((a, b) => a - b),
        main_reference: main ? presentAsset(main) : null,
        references: mine.map(presentAsset),
        pictures_stale: Boolean(c.descriptionFingerprint && storyFingerprint && c.source === 'story' && c.descriptionFingerprint !== fingerprint(c.promptToken)),
        deleted_at: c.deletedAt ? c.deletedAt.toISOString() : null,
      };
    });
  }

  app.get('/projects/:id/cast', async (request) => {
    const { id } = idParam.parse(request.params);
    const { account } = await isConstrained(db, request.accountId, id);
    const { fingerprint: fp } = await storySource(request.accountId, id);
    const rows = await db.select().from(schema.characters).where(and(eq(schema.characters.projectId, id), eq(schema.characters.accountId, request.accountId), isNull(schema.characters.deletedAt))).orderBy(asc(schema.characters.name));
    const [latest] = await db.select().from(schema.aiProposals).where(and(eq(schema.aiProposals.accountId, request.accountId), eq(schema.aiProposals.targetEntityId, id), eq(schema.aiProposals.operation, 'find_cast'), eq(schema.aiProposals.status, 'accepted'))).orderBy(desc(schema.aiProposals.resolvedAt)).limit(1);
    const lastFingerprint = (latest?.revertPayload as { fingerprint?: string } | null)?.fingerprint ?? null;
    return {
      data: await presentCharacters(rows, request.accountId, account.isMinor, fp),
      story_changed: lastFingerprint !== null && lastFingerprint !== fp,
      never_found: lastFingerprint === null,
      finder_enabled: finder.enabled,
    };
  });

  // ── Find the cast (a proposal the user accepts) ───────────────────────────
  function presentProposal(p: typeof schema.aiProposals.$inferSelect) {
    const payload = p.payload as { characters?: FoundCharacter[]; error?: string };
    return { id: p.id, status: p.status, characters: p.status === 'pending' ? payload.characters ?? [] : [], error: payload.error ?? null };
  }

  app.post('/projects/:id/cast/proposals', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const requestKey = z.string().uuid().parse(request.headers['idempotency-key']);
    const { account, project, constrained } = await isConstrained(db, request.accountId, id);
    const [previous] = await db.select().from(schema.aiProposals).where(eq(schema.aiProposals.id, requestKey));
    if (previous) {
      if (previous.accountId !== request.accountId || previous.targetEntityId !== id) throw ApiError.notFound('Request');
      return presentProposal(previous);
    }
    if (!finder.enabled) throw castUnavailable('The cast finder is not set up yet. Ask a grown-up to add the Claude key.');
    const { source, fingerprint: fp, scenes } = await storySource(request.accountId, id);
    if (!scenes.some((s) => sceneDescription(s).trim())) throw ApiError.validation('Write what happens in at least one scene first, in Story.');
    const day = new Date(); day.setUTCHours(0, 0, 0, 0);
    const attempts = await db.select({ id: schema.aiInteractions.id }).from(schema.aiInteractions).where(and(eq(schema.aiInteractions.accountId, request.accountId), inArray(schema.aiInteractions.operation, ['generate_scene_thumbnail', 'improve_scene_description', 'find_cast']), gte(schema.aiInteractions.createdAt, day)));
    if (attempts.length >= config.THUMBNAIL_DAILY_LIMIT) throw castUnavailable('You have used today’s AI allowance. Try again tomorrow.', 429);
    const [interaction] = await db.insert(schema.aiInteractions).values({ accountId: request.accountId, projectId: id, operation: 'find_cast', mode: project.editorMode, targetEntityType: 'project', targetEntityId: id, model: finder.model }).returning();
    const started = Date.now();
    let payload: Record<string, unknown>;
    try {
      const found = await finder.find(source, constrained, AbortSignal.timeout(60_000));
      await db.update(schema.aiInteractions).set({ inputTokens: found.inputTokens, outputTokens: found.outputTokens, latencyMs: Date.now() - started }).where(eq(schema.aiInteractions.id, interaction!.id));
      const valid = scenes.map((s) => s.sceneNumber);
      payload = { state: 'ready', fingerprint: fp, characters: found.characters.map((c) => ({ ...c, name: c.name.trim(), scene_numbers: [...new Set(c.scene_numbers.filter((n) => valid.includes(n)))] })) };
    } catch (error) {
      await db.update(schema.aiInteractions).set({ accepted: false, latencyMs: Date.now() - started }).where(eq(schema.aiInteractions.id, interaction!.id));
      throw error;
    }
    const [proposal] = await db.insert(schema.aiProposals).values({
      id: requestKey, accountId: request.accountId, projectId: id, operation: 'find_cast', scope: 'collection', targetEntityType: 'project', targetEntityId: id,
      aiInteractionId: interaction!.id, payload, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).returning();
    reply.header('Cache-Control', 'no-store');
    void account;
    return reply.code(201).send(presentProposal(proposal!));
  });

  app.post('/projects/:id/cast/proposals/:proposalId/:action', async (request) => {
    const { id, proposalId, action } = idParam.extend({ action: z.enum(['accept', 'cancel']) }).parse(request.params);
    const body = z.object({ keep: z.array(z.string().min(1).max(60)).optional() }).parse(request.body ?? {});
    await ownProject(request.accountId, id);
    const result = await db.transaction(async (tx) => {
      const [proposal] = await tx.select().from(schema.aiProposals).where(and(eq(schema.aiProposals.id, proposalId!), eq(schema.aiProposals.accountId, request.accountId), eq(schema.aiProposals.targetEntityId, id), eq(schema.aiProposals.operation, 'find_cast'))).for('update');
      if (!proposal) throw ApiError.notFound('Request');
      if (proposal.status !== 'pending') return proposal.status;
      if (action === 'accept') {
        const payload = proposal.payload as { fingerprint: string; characters: FoundCharacter[] };
        const { fingerprint: fp, scenes } = await storySource(request.accountId, id);
        if (payload.fingerprint !== fp) throw ApiError.conflict('The story changed. Find the cast again.', null);
        const keep = body.keep ? new Set(body.keep.map((n) => n.toLowerCase())) : null;
        const chosen = payload.characters.filter((c) => !keep || keep.has(c.name.toLowerCase()));
        const existing = await tx.select().from(schema.characters).where(and(eq(schema.characters.projectId, id), eq(schema.characters.accountId, request.accountId), isNull(schema.characters.deletedAt)));
        const byNumber = new Map(scenes.map((s) => [s.sceneNumber, s.id]));
        const kept = new Set<string>();
        for (const c of chosen) {
          const sceneIds = c.scene_numbers.map((n) => byNumber.get(n)).filter((v): v is string => Boolean(v));
          const match = existing.find((e) => e.name.toLowerCase() === c.name.toLowerCase());
          if (match) {
            kept.add(match.id);
            await tx.update(schema.characters).set({ foundInSceneIds: sceneIds, ...(match.source === 'story' ? { promptToken: c.description, descriptionFingerprint: fingerprint(c.description) } : {}) }).where(eq(schema.characters.id, match.id));
          } else {
            const [row] = await tx.insert(schema.characters).values({ accountId: request.accountId, projectId: id, name: c.name, promptToken: c.description, source: 'story', foundInSceneIds: sceneIds, descriptionFingerprint: fingerprint(c.description) }).returning();
            kept.add(row!.id);
          }
        }
        // Story-found characters no longer in the story go, unless they have pictures.
        for (const e of existing) {
          if (kept.has(e.id) || e.source !== 'story') continue;
          const [pic] = await tx.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.ownerEntityType, 'character'), eq(schema.assets.ownerEntityId, e.id), isNull(schema.assets.deletedAt))).limit(1);
          if (pic) await tx.update(schema.characters).set({ foundInSceneIds: [] }).where(eq(schema.characters.id, e.id));
          else await tx.update(schema.characters).set({ deletedAt: new Date() }).where(eq(schema.characters.id, e.id));
        }
        await tx.update(schema.aiProposals).set({ status: 'accepted', payload: {}, revertPayload: { fingerprint: fp }, resolvedAt: new Date() }).where(eq(schema.aiProposals.id, proposal.id));
      } else {
        await tx.update(schema.aiProposals).set({ status: 'cancelled', payload: {}, resolvedAt: new Date() }).where(eq(schema.aiProposals.id, proposal.id));
      }
      if (proposal.aiInteractionId) await tx.update(schema.aiInteractions).set({ accepted: action === 'accept' }).where(eq(schema.aiInteractions.id, proposal.aiInteractionId));
      return action === 'accept' ? 'accepted' : 'cancelled';
    });
    return { status: result };
  });

  // ── Characters ────────────────────────────────────────────────────────────
  app.post('/projects/:id/cast', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ name: z.string().min(1).max(60), description: z.string().max(600).default('') }).parse(request.body);
    const { account } = await isConstrained(db, request.accountId, id);
    const [row] = await db.insert(schema.characters).values({ accountId: request.accountId, projectId: id, name: body.name.trim(), promptToken: body.description, source: 'manual' }).returning();
    return reply.code(201).send((await presentCharacters([row!], request.accountId, account.isMinor, null))[0]);
  });

  app.patch('/characters/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ name: z.string().min(1).max(60).optional(), description: z.string().max(600).optional(), costume: z.string().max(300).optional(), background_story: z.string().max(2000).optional(), main_reference_asset_id: z.string().uuid().nullable().optional() }).parse(request.body);
    const character = await ownCharacter(request.accountId, id);
    const { account } = await isConstrained(db, request.accountId, character.projectId);
    const patch: Partial<typeof schema.characters.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.description !== undefined) patch.promptToken = body.description;
    if (body.costume !== undefined) patch.defaultCostume = body.costume;
    if (body.background_story !== undefined) patch.backgroundStory = body.background_story;
    if (body.main_reference_asset_id !== undefined) {
      if (body.main_reference_asset_id) {
        const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, body.main_reference_asset_id), eq(schema.assets.accountId, request.accountId), eq(schema.assets.ownerEntityType, 'character'), eq(schema.assets.ownerEntityId, id), eq(schema.assets.kind, 'character_ref'), isNull(schema.assets.deletedAt)));
        if (!asset) throw ApiError.notFound('Picture');
        if (asset.reviewStatus === 'rejected') throw ApiError.validation('That picture cannot be used.');
      }
      patch.mainReferenceAssetId = body.main_reference_asset_id;
    }
    const [updated] = await db.update(schema.characters).set(patch).where(eq(schema.characters.id, id)).returning();
    return (await presentCharacters([updated!], request.accountId, account.isMinor, null))[0];
  });

  app.delete('/characters/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    await ownCharacter(request.accountId, id);
    await db.update(schema.characters).set({ deletedAt: new Date() }).where(eq(schema.characters.id, id));
    return reply.code(204).send();
  });

  app.post('/characters/:id/restore', async (request) => {
    const { id } = idParam.parse(request.params);
    const [row] = await db.update(schema.characters).set({ deletedAt: null }).where(and(eq(schema.characters.id, id), eq(schema.characters.accountId, request.accountId), isNotNull(schema.characters.deletedAt))).returning();
    if (!row) throw ApiError.notFound('Character');
    return (await presentCharacters([row], request.accountId, false, null))[0];
  });

  // ── Reference pictures: upload (DM-6) ─────────────────────────────────────
  app.post('/characters/:id/references', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const character = await ownCharacter(request.accountId, id);
    const { account, constrained } = await isConstrained(db, request.accountId, character.projectId);
    const part = await request.file();
    if (!part) throw ApiError.validation('Choose a picture to upload.');
    const raw = await part.toBuffer();
    const file = validateUpload(raw, 'image');
    let reviewStatus: 'not_required' | 'allowed' | 'rejected' = 'not_required';
    let reviewReason: string | null = null;
    if (constrained || review.enabled) {
      if (!review.enabled) throw ApiError.validation('The safety checker is not set up, so pictures cannot be added on this account yet. Ask a grown-up.');
      const verdict = await review.reviewImage({ bytes: file.bytes, mimeType: file.mimeType }, constrained, AbortSignal.timeout(60_000));
      reviewStatus = verdict.allowed ? 'allowed' : 'rejected';
      reviewReason = verdict.allowed ? null : verdict.reason;
    }
    const stored = await store.put(file.bytes, file.extension, { accountId: request.accountId, projectId: character.projectId });
    const [asset] = await db.insert(schema.assets).values({
      accountId: request.accountId, projectId: character.projectId, ownerEntityType: 'character', ownerEntityId: id, kind: 'character_ref',
      filename: `${id}-upload.${file.extension}`, mimeType: file.mimeType, sizeBytes: stored.sizeBytes, storageKey: stored.key, reviewStatus, reviewReason,
    }).returning();
    if (reviewStatus === 'rejected') throw ApiError.validation('That picture was held back by the safety checker. Try a different one.');
    if (!character.mainReferenceAssetId) await db.update(schema.characters).set({ mainReferenceAssetId: asset!.id }).where(eq(schema.characters.id, id));
    void account;
    return reply.code(201).send(presentAsset(asset!));
  });

  // ── Draw <name> / More angles (DM-7) ──────────────────────────────────────
  app.post('/characters/:id/jobs', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ intent: z.enum(['portrait', 'angles']), model_id: z.string().min(1).max(60), count: z.number().int().min(1).max(4).optional() }).parse(request.body);
    const requestKey = z.string().uuid().parse(request.headers['idempotency-key']);
    const created = await db.transaction(async (tx) => {
      await tx.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.id, request.accountId)).for('update');
      const [previous] = await tx.select().from(schema.generationJobs).where(and(eq(schema.generationJobs.accountId, request.accountId), eq(schema.generationJobs.requestKey, requestKey)));
      if (previous) return { job: previous, fresh: false };
      const character = await ownCharacter(request.accountId, id);
      const { account, aspectRatio, constrained } = await isConstrained(tx as unknown as typeof db, request.accountId, character.projectId);
      const model = catalogue.enabled().find((m) => m.id === body.model_id);
      if (!model || model.kind !== 'image') throw ApiError.validation('Pick a picture maker for pictures.');
      if (constrained && !review.enabled) throw ApiError.validation('The safety checker is not set up, so pictures cannot be made on this account yet. Ask a grown-up.');
      if (body.intent === 'angles' && (!character.mainReferenceAssetId || !model.capabilities.reference_images)) {
        throw ApiError.validation(character.mainReferenceAssetId ? 'Pick a picture maker that uses your cast pictures for more angles.' : 'Give this character a main picture first.');
      }
      if (!character.promptToken.trim() && body.intent === 'portrait') throw ApiError.validation('Say what this character looks like first. The story is the best place: describe them in a scene.');
      const options = resolveOptions(model, { kind: 'image', model_id: model.id, aspect_ratio: '1:1', ...(body.count ? { count: body.count } : {}) }, aspectRatio);
      // The style and the character description travel through the compiler so no phrase is typed here.
      const [anyScene] = await tx.select().from(schema.scenes).where(and(eq(schema.scenes.projectId, character.projectId), isNull(schema.scenes.deletedAt))).limit(1);
      const base = await compileInput(tx, request.accountId, anyScene ?? ({ projectId: character.projectId, description: '', sceneIntent: '', actionDescription: '', sceneryDescription: '', cameraAngle: null, timeOfDay: 'unspecified', weather: null, moodAtmosphere: null, lightingPreset: null, lighting: '', styleOverride: null, locationId: null, characterIds: [], id: '' } as unknown as typeof schema.scenes.$inferSelect), null);
      const sheet = body.intent === 'portrait'
        ? 'Character reference sheet. Full body, standing, facing the camera, neutral pose, plain white background.'
        : 'Character reference sheet showing the same character from the side and from behind, full body, plain white background.';
      const compiled = compileShot({ ...base, scene: { ...base.scene, description: sheet, sceneryDescription: '', cameraAngle: null, timeOfDay: 'unspecified', weather: null, moodAtmosphere: null, lightingPreset: null, lighting: '', locationName: '', locationDescription: '', locationDefaultLighting: '' },
        shot: { ...base.shot, actionBeat: '', characters: [{ name: character.name, description: character.promptToken, costume: character.defaultCostume }], userPromptAddendum: '' } });
      const jobRequest: JobRequest = {
        prompt: compiled.prompt, negativePrompt: compiled.negativePrompt,
        referenceAssetIds: body.intent === 'angles' && character.mainReferenceAssetId ? [character.mainReferenceAssetId] : [],
        startFrameAssetId: null, aspectRatio: options.aspect, count: options.count, durationSeconds: null, audio: false, resolution: options.resolution,
        constrained, assetKind: 'character_ref',
      };
      const [job] = await tx.insert(schema.generationJobs).values({
        accountId: request.accountId, projectId: character.projectId, requestKey, kind: 'image', targetEntityType: 'character', targetEntityId: character.id,
        modelId: model.id, provider: model.provider, request: jobRequest,
      }).returning();
      await reserve(tx, { accountId: account.id, projectId: character.projectId, jobId: job!.id, model, count: options.count });
      return { job: job!, fresh: true };
    });
    if (created.fresh) void runner.tick().catch(() => {});
    reply.header('Cache-Control', 'no-store');
    return reply.code(created.fresh ? 202 : 200).send(presentJob(created.job, [], true));
  });
}
