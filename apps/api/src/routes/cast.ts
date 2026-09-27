/**
 * The cast (plan D39, DM-5–DM-9) and Character Studio (docs/character-studio-requirements.md):
 * the proposal that finds characters in the story, the characters themselves, their candidate
 * pictures, approved looks, and the jobs that draw them.
 *
 * Nothing here promotes a picture into a look except POST /characters/:id/looks (CS-04), and
 * story rediscovery never rewrites an approved look (CS-08).
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, isNotNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { compileCharacterSheet } from '@storyboard/compiler';
import { REFERENCE_VIEW } from '@storyboard/vocabularies';
import { quoteGeneration, type GenerationModel } from '@storyboard/models';
import { db, schema } from '../db/client.ts';
import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { pence, reserve } from '../generation/budget.ts';
import { sceneDescription } from '../scenes/description.ts';
import { validateUpload } from '../storage/uploads.ts';
import { castUnavailable, type CastFinder, type FoundCharacter } from '../cast/finder.ts';
import { approveLook, assetHash, loadLooks, sameTraits, selectLook, usableForLook, visualTraits, VIEW_ROLES, type Look, type ViewRole } from '../cast/looks.ts';
import { isConstrained, presentAsset, presentJob, type DirectorDeps } from './director.ts';
import type { JobRequest, CandidateIntent } from '../jobs/runner.ts';

const idParam = z.object({ id: z.string().uuid(), proposalId: z.string().uuid().optional(), candidateId: z.string().uuid().optional(), lookId: z.string().uuid().optional() });
const viewSchema = z.enum(VIEW_ROLES as unknown as [ViewRole, ...ViewRole[]]);
type Character = typeof schema.characters.$inferSelect;
type Asset = typeof schema.assets.$inferSelect;

function fingerprint(source: unknown) { return createHash('sha256').update(JSON.stringify(source)).digest('hex'); }
const ifMatch = (headers: Record<string, unknown>) => z.coerce.number().int().positive().parse(headers['if-match']);
const optionalIfMatch = (headers: Record<string, unknown>) => headers['if-match'] === undefined ? null : ifMatch(headers);

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

async function projectStyle(projectId: string) {
  const [bible] = await db.select({ artStyle: schema.seriesBibles.artStyle, lineTreatment: schema.seriesBibles.lineTreatment }).from(schema.seriesBibles).where(eq(schema.seriesBibles.projectId, projectId));
  return { artStyle: bible?.artStyle ?? '', lineTreatment: bible?.lineTreatment ?? '' };
}

export function presentLook(look: Look, hideRejected: boolean) {
  return {
    id: look.id, visual_version: look.visualVersion, approved_at: look.approvedAt.toISOString(), art_style: look.artStyle, traits: look.traits,
    references: look.references.filter((r) => !hideRejected || r.asset.reviewStatus !== 'rejected').map((r) => ({ role: r.role, position: r.position, is_main: r.isMain, content_sha256: r.contentHash, asset: presentAsset(r.asset) })),
  };
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
    const looks = await loadLooks(db, accountId, ids);
    const sceneIds = [...new Set(rows.flatMap((r) => r.foundInSceneIds))];
    const scenes = sceneIds.length ? await db.select({ id: schema.scenes.id, n: schema.scenes.sceneNumber }).from(schema.scenes).where(and(inArray(schema.scenes.id, sceneIds), isNull(schema.scenes.deletedAt))) : [];
    const numbers = new Map(scenes.map((s) => [s.id, s.n]));
    return rows.map((c) => {
      const mine = refs.filter((a) => a.ownerEntityId === c.id && (!hideRejected || a.reviewStatus !== 'rejected'));
      const look = looks.find((l) => l.id === c.currentVisualVersionId) ?? null;
      // The face on the chip is the approved main picture. A legacy "main" is only a candidate (CS-12).
      const main = look?.references[0]?.asset ?? null;
      return {
        id: c.id,
        name: c.name,
        version: c.version,
        description: c.promptToken,
        species: c.species,
        build: c.physicalBuild,
        colours: c.colours,
        features: c.distinguishingFeatures,
        costume: c.defaultCostume,
        outfits: Array.isArray(c.costumeVariants) ? c.costumeVariants : [],
        personality: c.personality,
        background_story: c.backgroundStory,
        source: c.source,
        scene_numbers: c.foundInSceneIds.map((id) => numbers.get(id)).filter((n): n is number => typeof n === 'number').sort((a, b) => a - b),
        main_reference: main && (!hideRejected || main.reviewStatus !== 'rejected') ? presentAsset(main) : null,
        look: look ? presentLook(look, hideRejected) : null,
        look_status: look ? (c.lookOutdated ? 'changed' : 'approved') : 'none',
        story_suggestion: c.storySuggestion,
        references: mine.map(presentAsset),
        pictures_stale: Boolean(c.descriptionFingerprint && storyFingerprint && c.source === 'story' && c.descriptionFingerprint !== fingerprint(c.promptToken)),
        deleted_at: c.deletedAt ? c.deletedAt.toISOString() : null,
      };
    });
  }
  const presentOne = async (c: Character, accountId: string, hideRejected: boolean) => (await presentCharacters([c], accountId, hideRejected, null))[0]!;

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
    const { project, constrained } = await isConstrained(db, request.accountId, id);
    const [previous] = await db.select().from(schema.aiProposals).where(eq(schema.aiProposals.id, requestKey));
    if (previous) {
      if (previous.accountId !== request.accountId || previous.targetEntityId !== id) throw ApiError.notFound('Request');
      return presentProposal(previous);
    }
    if (!finder.enabled) throw castUnavailable('The cast finder is not switched on yet. Ask a grown-up to turn it on.');
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
            // CS-08: with an approved look, the story's new wording is only a suggestion.
            const describe = match.source === 'story' && !match.currentVisualVersionId;
            const suggest = match.source === 'story' && match.currentVisualVersionId && c.description.trim() !== match.promptToken.trim();
            await tx.update(schema.characters).set({
              foundInSceneIds: sceneIds,
              ...(describe ? { promptToken: c.description, descriptionFingerprint: fingerprint(c.description), version: match.version + 1 } : {}),
              ...(suggest ? { storySuggestion: c.description } : {}),
            }).where(eq(schema.characters.id, match.id));
          } else {
            const [row] = await tx.insert(schema.characters).values({ accountId: request.accountId, projectId: id, name: c.name, promptToken: c.description, source: 'story', foundInSceneIds: sceneIds, descriptionFingerprint: fingerprint(c.description) }).returning();
            kept.add(row!.id);
          }
        }
        // Story-found characters no longer in the story go, unless they have pictures or a look.
        for (const e of existing) {
          if (kept.has(e.id) || e.source !== 'story') continue;
          const [pic] = await tx.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.ownerEntityType, 'character'), eq(schema.assets.ownerEntityId, e.id), isNull(schema.assets.deletedAt))).limit(1);
          if (pic || e.currentVisualVersionId) await tx.update(schema.characters).set({ foundInSceneIds: [] }).where(eq(schema.characters.id, e.id));
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
  const traitFields = {
    description: z.string().max(600), species: z.string().max(120), build: z.string().max(200), colours: z.string().max(300),
    features: z.string().max(400), costume: z.string().max(300),
  };

  app.post('/projects/:id/cast', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    // CS-02: a name and a short description are enough to begin; every other trait is optional.
    const body = z.object({ name: z.string().trim().min(1).max(60), description: traitFields.description.default(''), species: traitFields.species.optional(), build: traitFields.build.optional(), colours: traitFields.colours.optional(), features: traitFields.features.optional(), costume: traitFields.costume.optional() }).parse(request.body);
    const { account } = await isConstrained(db, request.accountId, id);
    const [row] = await db.insert(schema.characters).values({
      accountId: request.accountId, projectId: id, name: body.name, promptToken: body.description, source: 'manual',
      species: body.species ?? '', physicalBuild: body.build ?? '', colours: body.colours ?? '', distinguishingFeatures: body.features ?? '', defaultCostume: body.costume ?? '',
    }).returning();
    return reply.code(201).send(await presentOne(row!, request.accountId, account.isMinor));
  });

  app.get('/characters/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const character = await ownCharacter(request.accountId, id);
    const { account } = await isConstrained(db, request.accountId, character.projectId);
    return presentOne(character, request.accountId, account.isMinor);
  });

  /** Studio: the character, its candidates and every look, current one marked (CS-04, CS-09). */
  app.get('/characters/:id/studio', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const character = await ownCharacter(request.accountId, id);
    const { account, constrained } = await isConstrained(db, request.accountId, character.projectId);
    const strict = constrained || account.isMinor;
    const rows = await db.select({ c: schema.characterReferenceCandidates, a: schema.assets }).from(schema.characterReferenceCandidates)
      .innerJoin(schema.assets, eq(schema.assets.id, schema.characterReferenceCandidates.assetId))
      .where(and(eq(schema.characterReferenceCandidates.characterId, id), eq(schema.characterReferenceCandidates.accountId, request.accountId),
        eq(schema.characterReferenceCandidates.status, 'candidate'), isNull(schema.assets.deletedAt)))
      .orderBy(desc(schema.characterReferenceCandidates.createdAt));
    const looks = await loadLooks(db, request.accountId, [id]);
    reply.header('Cache-Control', 'no-store');
    return {
      character: await presentOne(character, request.accountId, account.isMinor),
      candidates: rows.filter(({ a }) => !account.isMinor || a.reviewStatus !== 'rejected').map(({ c, a }) => ({
        id: c.id, view_role: c.viewRole, source: c.source, created_at: c.createdAt.toISOString(),
        from_look_id: c.sourceVisualVersionId, parent_candidate_id: c.parentCandidateId, job_id: c.generationJobId,
        // CS-11: approval is a separate gate from review; a picture must pass review to be chosen.
        can_approve: usableForLook(a, strict),
        asset: presentAsset(a),
      })),
      looks: looks.map((l) => ({ ...presentLook(l, account.isMinor), current: l.id === character.currentVisualVersionId })),
      views: REFERENCE_VIEW.map((v) => ({ value: v.value, label: v.friendlyLabel, help: v.help })),
    };
  });

  /**
   * Trait edits (CS-02, CS-07, CS-08). Optimistic with If-Match when sent. Editing what someone
   * looks like after a look was approved keeps that look in use and marks it "changed" until a
   * new one is approved.
   */
  app.patch('/characters/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({
      name: z.string().trim().min(1).max(60).optional(), description: traitFields.description.optional(), species: traitFields.species.optional(), build: traitFields.build.optional(),
      colours: traitFields.colours.optional(), features: traitFields.features.optional(), costume: traitFields.costume.optional(),
      personality: z.string().max(1000).optional(), background_story: z.string().max(2000).optional(),
      outfits: z.array(z.object({ label: z.string().trim().min(1).max(40), description: z.string().max(300) })).max(8).optional(),
      dismiss_story_suggestion: z.literal(true).optional(),
    }).strict().parse(request.body);
    const expected = optionalIfMatch(request.headers);
    const character = await ownCharacter(request.accountId, id);
    const { account } = await isConstrained(db, request.accountId, character.projectId);
    const updated = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(schema.characters).where(eq(schema.characters.id, id)).for('update');
      if (!locked) throw ApiError.notFound('Character');
      if (expected !== null && locked.version !== expected) throw ApiError.conflict('This character changed somewhere else.', await presentOne(locked, request.accountId, account.isMinor));
      const patch: Partial<typeof schema.characters.$inferInsert> = { version: locked.version + 1 };
      if (body.name !== undefined) patch.name = body.name;
      if (body.description !== undefined) patch.promptToken = body.description;
      if (body.species !== undefined) patch.species = body.species;
      if (body.build !== undefined) patch.physicalBuild = body.build;
      if (body.colours !== undefined) patch.colours = body.colours;
      if (body.features !== undefined) patch.distinguishingFeatures = body.features;
      if (body.costume !== undefined) patch.defaultCostume = body.costume;
      if (body.personality !== undefined) patch.personality = body.personality;
      if (body.background_story !== undefined) patch.backgroundStory = body.background_story;
      if (body.outfits !== undefined) patch.costumeVariants = body.outfits;
      if (body.dismiss_story_suggestion) patch.storySuggestion = null;
      if (body.description !== undefined && locked.storySuggestion && body.description.trim() === locked.storySuggestion.trim()) patch.storySuggestion = null;
      if (locked.currentVisualVersionId) {
        const [look] = await tx.select({ traits: schema.characterVisualVersions.traits }).from(schema.characterVisualVersions).where(eq(schema.characterVisualVersions.id, locked.currentVisualVersionId));
        patch.lookOutdated = look ? !sameTraits(visualTraits({ ...locked, ...patch } as Character), look.traits as ReturnType<typeof visualTraits>) : locked.lookOutdated;
      }
      const [row] = await tx.update(schema.characters).set(patch).where(eq(schema.characters.id, id)).returning();
      return row!;
    });
    return presentOne(updated, request.accountId, account.isMinor);
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
    return presentOne(row, request.accountId, false);
  });

  // ── Candidates: upload (CS-03, CS-04) ─────────────────────────────────────
  app.post('/characters/:id/references', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const view = viewSchema.default('main').parse((request.query as Record<string, string>).view);
    const character = await ownCharacter(request.accountId, id);
    const { constrained } = await isConstrained(db, request.accountId, character.projectId);
    const part = await request.file();
    if (!part) throw ApiError.validation('Choose a picture to upload.');
    const raw = await part.toBuffer();
    const file = validateUpload(raw, 'image');
    let reviewStatus: 'not_required' | 'allowed' | 'rejected' = 'not_required';
    let reviewReason: string | null = null;
    // MB-05: uploads follow the same account policy as generated pictures.
    if (constrained || review.enabled) {
      if (!review.enabled) throw ApiError.validation('The safety checker is not set up, so pictures cannot be added on this account yet. Ask a grown-up.');
      const verdict = await review.reviewImage({ bytes: file.bytes, mimeType: file.mimeType }, constrained, AbortSignal.timeout(60_000));
      reviewStatus = verdict.allowed ? 'allowed' : 'rejected';
      reviewReason = verdict.allowed ? null : verdict.reason;
    }
    const stored = await store.put(file.bytes, file.extension, { accountId: request.accountId, projectId: character.projectId });
    const [asset] = await db.insert(schema.assets).values({
      accountId: request.accountId, projectId: character.projectId, ownerEntityType: 'character', ownerEntityId: id, kind: 'character_ref',
      filename: `${id}-upload.${file.extension}`, mimeType: file.mimeType, sizeBytes: stored.sizeBytes, storageKey: stored.key, contentSha256: stored.sha256, reviewStatus, reviewReason,
    }).returning();
    if (reviewStatus === 'rejected') throw ApiError.validation('That picture was held back by the safety checker. Try a different one.');
    // A candidate only: uploading, even the first picture, never approves a look (CS-04).
    const [candidate] = await db.insert(schema.characterReferenceCandidates).values({
      accountId: request.accountId, characterId: id, assetId: asset!.id, viewRole: view, source: 'upload',
    }).returning();
    return reply.code(201).send({ id: candidate!.id, view_role: candidate!.viewRole, source: candidate!.source, created_at: candidate!.createdAt.toISOString(), can_approve: usableForLook(asset!, constrained), asset: presentAsset(asset!) });
  });

  app.delete('/characters/:id/candidates/:candidateId', async (request, reply) => {
    const { id, candidateId } = idParam.parse(request.params);
    await ownCharacter(request.accountId, id);
    const [row] = await db.update(schema.characterReferenceCandidates).set({ status: 'removed' })
      .where(and(eq(schema.characterReferenceCandidates.id, candidateId!), eq(schema.characterReferenceCandidates.characterId, id), eq(schema.characterReferenceCandidates.accountId, request.accountId))).returning();
    if (!row) throw ApiError.notFound('Picture');
    return reply.code(204).send();
  });

  // ── Looks: approve, go back (CS-08, CS-09, CS-11) ─────────────────────────
  app.post('/characters/:id/looks', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const expected = ifMatch(request.headers);
    const body = z.object({
      main_asset_id: z.string().uuid(),
      pictures: z.array(z.object({ asset_id: z.string().uuid(), role: viewSchema })).min(1).max(12),
    }).parse(request.body);
    const character = await ownCharacter(request.accountId, id);
    const { account, constrained } = await isConstrained(db, request.accountId, character.projectId);
    const style = await projectStyle(character.projectId);
    const result = await db.transaction((tx) => approveLook(tx, {
      accountId: request.accountId, character, expectedVersion: expected, constrained: constrained || account.isMinor, store, artStyle: style.artStyle,
      pictures: body.pictures.map((p) => ({ assetId: p.asset_id, role: p.role })), mainAssetId: body.main_asset_id,
      present: (c) => presentOne(c, request.accountId, account.isMinor),
    }));
    return reply.code(201).send(await presentOne(result.character, request.accountId, account.isMinor));
  });

  app.post('/characters/:id/looks/:lookId/select', async (request) => {
    const { id, lookId } = idParam.parse(request.params);
    const expected = ifMatch(request.headers);
    const character = await ownCharacter(request.accountId, id);
    const { account } = await isConstrained(db, request.accountId, character.projectId);
    const updated = await db.transaction((tx) => selectLook(tx, { accountId: request.accountId, characterId: id, lookId: lookId!, expectedVersion: expected, present: (c) => presentOne(c, request.accountId, account.isMinor) }));
    return presentOne(updated, request.accountId, account.isMinor);
  });

  // ── Draw pictures: main choices, views from the approved look, changes (CS-03, CS-06) ─
  const jobBody = z.object({
    intent: z.enum(['portrait', 'view', 'refine']),
    count: z.number().int().min(1).max(4).optional(),
    view: viewSchema.optional(),
    candidate_id: z.string().uuid().optional(),
    note: z.string().trim().max(300).optional(),
    model_id: z.string().min(1).max(60).optional(),
  });
  type StudioJob = z.infer<typeof jobBody>;

  /**
   * Which picture maker does this, or a plain-words reason why nothing can. A view or a change
   * needs a maker that takes the anchor picture: a words-only maker is never presented as
   * keeping someone's look (CS-06).
   */
  function studioModel(body: StudioJob): GenerationModel {
    const images = catalogue.available(false).filter((m) => m.kind === 'image');
    const needsAnchor = body.intent !== 'portrait';
    const fits = images.filter((m) => needsAnchor ? m.capabilities.reference_images : !m.capabilities.requires_reference_images);
    const chosen = body.model_id ? fits.find((m) => m.id === body.model_id) : [...fits].sort((a, b) => a.unit_cost_pence - b.unit_cost_pence)[0];
    if (!chosen) throw ApiError.validation(needsAnchor
      ? 'Making more views needs a picture maker that can look at your chosen picture, and none is switched on. Ask a grown-up.'
      : 'Generation isn’t connected yet. Ask the account owner to set it up.');
    return chosen;
  }

  async function planStudioJob(character: Character, body: StudioJob, constrained: boolean) {
    const model = studioModel(body);
    const count = body.intent === 'portrait' ? body.count ?? 2 : 1;
    let anchor: { assetId: string; hash: string } | null = null;
    let candidate: CandidateIntent = { viewRole: 'main', source: 'generated', sourceVisualVersionId: null, parentCandidateId: null };
    let view: ViewRole = 'main';
    if (body.intent === 'view') {
      if (!body.view || body.view === 'main') throw ApiError.validation('Choose which view to make.');
      view = body.view;
      const [look] = character.currentVisualVersionId ? (await loadLooks(db, character.accountId, [character.id])).filter((l) => l.id === character.currentVisualVersionId) : [];
      const main = look?.references[0];
      if (!look || !main) throw ApiError.validation(`Choose the picture that looks like ${character.name} first. New views are made from it.`);
      anchor = { assetId: main.assetId, hash: main.contentHash };
      candidate = { viewRole: view, source: 'generated', sourceVisualVersionId: look.id, parentCandidateId: null };
    }
    if (body.intent === 'refine') {
      if (!body.candidate_id || !body.note) throw ApiError.validation('Say what to change about the picture.');
      const [row] = await db.select({ c: schema.characterReferenceCandidates, a: schema.assets }).from(schema.characterReferenceCandidates)
        .innerJoin(schema.assets, eq(schema.assets.id, schema.characterReferenceCandidates.assetId))
        .where(and(eq(schema.characterReferenceCandidates.id, body.candidate_id), eq(schema.characterReferenceCandidates.characterId, character.id),
          eq(schema.characterReferenceCandidates.accountId, character.accountId), eq(schema.characterReferenceCandidates.status, 'candidate'), isNull(schema.assets.deletedAt)));
      if (!row) throw ApiError.notFound('Picture');
      if (!usableForLook(row.a, constrained)) throw ApiError.validation('That picture has not passed the safety check, so it cannot be changed.');
      view = row.c.viewRole;
      anchor = { assetId: row.a.id, hash: await assetHash(db, store, row.a) };
      candidate = { viewRole: view, source: 'refinement', sourceVisualVersionId: row.c.sourceVisualVersionId, parentCandidateId: row.c.id };
    }
    if (body.intent === 'portrait' && !character.promptToken.trim() && !character.species.trim()) {
      throw ApiError.validation(`Say what ${character.name} looks like first.`);
    }
    const style = await projectStyle(character.projectId);
    const sheet = compileCharacterSheet({
      artStyle: style.artStyle, styleOverride: '', lineTreatment: style.lineTreatment, view,
      character: visualTraits(character), note: body.note ?? '',
    });
    const quote = quoteGeneration(model, { count });
    return { model, count, anchor, candidate, sheet, quote };
  }

  /** DF-05/CS-03: the total for this batch, before anything is spent. */
  app.post('/characters/:id/jobs/quote', async (request) => {
    const { id } = idParam.parse(request.params);
    const body = jobBody.parse(request.body);
    const character = await ownCharacter(request.accountId, id);
    const { constrained, account } = await isConstrained(db, request.accountId, character.projectId);
    const plan = await planStudioJob(character, body, constrained || account.isMinor);
    return { pence: plan.quote.pence, words: `about ${pence(plan.quote.pence)}`, count: plan.count, keeps_look: plan.anchor !== null, model_id: plan.model.id };
  });

  app.post('/characters/:id/jobs', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = jobBody.parse(request.body);
    const requestKey = z.string().uuid().parse(request.headers['idempotency-key']);
    const created = await db.transaction(async (tx) => {
      await tx.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.id, request.accountId)).for('update');
      const [previous] = await tx.select().from(schema.generationJobs).where(and(eq(schema.generationJobs.accountId, request.accountId), eq(schema.generationJobs.requestKey, requestKey)));
      if (previous) return { job: previous, fresh: false };
      const character = await ownCharacter(request.accountId, id);
      const { account, constrained } = await isConstrained(tx as unknown as typeof db, request.accountId, character.projectId);
      const strict = constrained || account.isMinor;
      if (strict && !review.enabled) throw ApiError.validation('The safety checker is not set up, so pictures cannot be made on this account yet. Ask a grown-up.');
      const plan = await planStudioJob(character, body, strict);
      const jobRequest: JobRequest = {
        prompt: plan.sheet.prompt, negativePrompt: plan.sheet.negativePrompt,
        referenceAssetIds: plan.anchor ? [plan.anchor.assetId] : [], referenceHashes: plan.anchor ? [plan.anchor.hash] : [],
        startFrameAssetId: null, aspectRatio: '1:1', count: plan.count, durationSeconds: null, audio: false, resolution: plan.model.resolutions[0]!,
        constrained: strict, assetKind: 'character_ref', candidate: plan.candidate,
      };
      const [job] = await tx.insert(schema.generationJobs).values({
        accountId: request.accountId, projectId: character.projectId, requestKey, kind: 'image', targetEntityType: 'character', targetEntityId: character.id,
        modelId: plan.model.id, provider: plan.model.provider, request: jobRequest, task: `character-${body.intent}`,
      }).returning();
      await reserve(tx, { accountId: account.id, projectId: character.projectId, jobId: job!.id, model: plan.model, count: plan.count, referenceCount: plan.anchor ? 1 : 0 });
      return { job: job!, fresh: true };
    });
    if (created.fresh) void runner.tick().catch(() => {});
    reply.header('Cache-Control', 'no-store');
    return reply.code(created.fresh ? 202 : 200).send(presentJob(created.job, [], true));
  });
}

export type { Asset };
