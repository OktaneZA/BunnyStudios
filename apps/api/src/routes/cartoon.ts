/**
 * One cartoon, one look (docs/video-optimisation-plan.md §6–§7).
 *
 *   GET  /projects/:id/style                            the cartoon's look, and how many scenes have their own
 *   PUT  /projects/:id/style                            choose the look for the whole cartoon
 *   GET  /projects/:id/continuity                       does every scene match? (style, looks, pictures, makers)
 *   GET  /characters/:id/looks/:lookId/use-everywhere   how many scenes still use an earlier look
 *   POST /characters/:id/looks/:lookId/use-everywhere   use this look in every scene without a chosen clip
 *
 * Finished clips never change. A scene with a chosen clip keeps the look it was made with.
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';

import { ART_STYLE, values } from '@storyboard/vocabularies';
import { db, schema } from '../db/client.ts';
import { ApiError } from '../errors.ts';
import type { Tx } from '../generation/budget.ts';
import { cartoonStyle, sceneStyleValue } from '../cartoon/style.ts';
import { shotCast } from '../shots/cast.ts';
import { syncSceneShots } from '../shots/sync.ts';
import { isConstrained, type DirectorDeps } from './director.ts';
import type { JobRequest } from '../jobs/runner.ts';

type Database = typeof db | Tx;
const idParam = z.object({ id: z.string().uuid() });
const lookParam = z.object({ id: z.string().uuid(), lookId: z.string().uuid() });
const ART_STYLES = values('art_style') as [string, ...string[]];

/** "1", "1 and 3", "1, 2 and 4". */
function sceneList(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b).map(String);
  return sorted.length <= 1 ? sorted.join('') : `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
}
const styleName = (value: string) => ART_STYLE.find((s) => s.value === value)?.friendlyLabel ?? value;

async function liveScenes(database: Database, accountId: string, projectId: string) {
  return database.select().from(schema.scenes)
    .where(and(eq(schema.scenes.projectId, projectId), eq(schema.scenes.accountId, accountId), isNull(schema.scenes.deletedAt)))
    .orderBy(asc(schema.scenes.sortOrder), asc(schema.scenes.sceneNumber));
}

/** Bindings of this character that point at a different look, in live scenes of a live cartoon. */
async function olderLookBindings(database: Database, accountId: string, characterId: string, lookId: string) {
  return database.select({ binding: schema.shotCharacterBindings, shot: schema.shots, scene: schema.scenes }).from(schema.shotCharacterBindings)
    .innerJoin(schema.shots, eq(schema.shots.id, schema.shotCharacterBindings.shotId))
    .innerJoin(schema.scenes, eq(schema.scenes.id, schema.shots.sceneId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.scenes.projectId))
    .where(and(
      eq(schema.shotCharacterBindings.accountId, accountId), eq(schema.shotCharacterBindings.characterId, characterId),
      isNotNull(schema.shotCharacterBindings.visualVersionId), ne(schema.shotCharacterBindings.visualVersionId, lookId),
      isNull(schema.scenes.deletedAt), isNull(schema.projects.deletedAt),
    ));
}

export async function cartoonRoutes(app: FastifyInstance, deps: DirectorDeps) {
  app.addHook('onRequest', app.requireAuth);

  async function presentStyle(database: Database, accountId: string, projectId: string) {
    const style = await cartoonStyle(database, accountId, projectId);
    const scenes = await liveScenes(database, accountId, projectId);
    const own = scenes.filter((s) => s.styleOverride && sceneStyleValue(s.styleOverride) !== style.artStyle);
    return { art_style: style.artStyle, chosen: style.chosen, scenes_with_own_style: own.map((s) => ({ scene_id: s.id, scene_number: s.sceneNumber, art_style: sceneStyleValue(s.styleOverride) })) };
  }

  app.get('/projects/:id/style', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    await isConstrained(db, request.accountId, id);
    reply.header('Cache-Control', 'no-store');
    return presentStyle(db, request.accountId, id);
  });

  app.put('/projects/:id/style', async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({
      art_style: z.enum(ART_STYLES),
      /** Advanced: leave scenes that have their own look alone. Simple always gives every scene the cartoon's look. */
      keep_scene_styles: z.boolean().default(false),
    }).parse(request.body);
    return db.transaction(async (tx) => {
      const { project } = await isConstrained(tx as unknown as typeof db, request.accountId, id);
      const [bible] = await tx.select({ id: schema.seriesBibles.id }).from(schema.seriesBibles)
        .where(and(eq(schema.seriesBibles.projectId, project.id), eq(schema.seriesBibles.accountId, request.accountId))).for('update');
      if (bible) await tx.update(schema.seriesBibles).set({ artStyle: body.art_style }).where(eq(schema.seriesBibles.id, bible.id));
      else await tx.insert(schema.seriesBibles).values({ accountId: request.accountId, projectId: project.id, artStyle: body.art_style });
      const scenes = await liveScenes(tx, request.accountId, project.id);
      if (!body.keep_scene_styles) {
        // A locked scene is left exactly as it is, like every other edit.
        for (const scene of scenes.filter((s) => s.styleOverride !== null && !s.isLocked)) {
          await tx.update(schema.scenes).set({ styleOverride: null, version: scene.version + 1, updatedAt: new Date() }).where(eq(schema.scenes.id, scene.id));
        }
      }
      // Every scene's instructions follow the new look straight away.
      for (const scene of await liveScenes(tx, request.accountId, project.id)) await syncSceneShots(tx, request.accountId, scene);
      return presentStyle(tx, request.accountId, project.id);
    });
  });

  app.get('/projects/:id/continuity', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { account } = await isConstrained(db, request.accountId, id);
    const adult = !account.isMinor;
    const style = await cartoonStyle(db, request.accountId, id);
    const scenes = await liveScenes(db, request.accountId, id);
    const shots = scenes.length ? await db.select().from(schema.shots)
      .where(and(eq(schema.shots.accountId, request.accountId), inArray(schema.shots.sceneId, scenes.map((s) => s.id))))
      .orderBy(asc(schema.shots.sortOrder), asc(schema.shots.id)) : [];
    const heroIds = shots.map((s) => s.heroVideoAssetId).filter((v): v is string => Boolean(v));
    const heroAssets = heroIds.length ? await db.select().from(schema.assets).where(and(eq(schema.assets.accountId, request.accountId), inArray(schema.assets.id, heroIds))) : [];
    const jobIds = heroAssets.map((a) => a.generationJobId).filter((v): v is string => Boolean(v));
    const jobs = jobIds.length ? await db.select().from(schema.generationJobs).where(and(eq(schema.generationJobs.accountId, request.accountId), inArray(schema.generationJobs.id, jobIds))) : [];

    const rows = [];
    for (const scene of scenes) {
      const shot = shots.find((s) => s.sceneId === scene.id);
      const entries = shot ? await shotCast(db, request.accountId, shot, scene) : [];
      const hero = shot?.heroVideoAssetId ? heroAssets.find((a) => a.id === shot.heroVideoAssetId) : undefined;
      const job = hero?.generationJobId ? jobs.find((j) => j.id === hero.generationJobId) : undefined;
      const creative = job ? (job.request as JobRequest).creative : undefined;
      const model = job ? deps.catalogue.find(job.modelId) : undefined;
      const ownStyle = sceneStyleValue(scene.styleOverride);
      rows.push({
        scene_id: scene.id, scene_number: scene.sceneNumber, title: scene.title,
        art_style: ownStyle ?? (scene.styleOverride ? null : style.artStyle), own_style: Boolean(scene.styleOverride) && ownStyle !== style.artStyle,
        characters: entries.map((e) => ({
          character_id: e.character.id, name: e.character.name, saved: !e.proposed,
          look_id: e.look?.id ?? null, look_version: e.look?.visualVersion ?? null, current_look_id: e.character.currentVisualVersionId,
          look_art_style: e.look?.artStyle || null,
        })),
        clip: job ? {
          job_id: job.id, intent: job.intent,
          // Characters are in the scene but no pictures of them reached the clip maker.
          words_only: Boolean(creative && creative.task !== 'image-to-video' && creative.characters.length > 0 && creative.references.length === 0),
          family: model?.video?.family ?? job.modelId,
          ...(adult ? { model_id: job.modelId, seed: (job.providerResult as { seed?: number } | null)?.seed ?? null } : {}),
        } : null,
      });
    }

    // Warnings in the child's words: what does not match, and where.
    const warnings: { kind: string; detail: string; scene_ids: string[] }[] = [];
    const ownStyle = rows.filter((r) => r.own_style);
    if (ownStyle.length) {
      warnings.push({ kind: 'scene_style', scene_ids: ownStyle.map((r) => r.scene_id),
        detail: `${ownStyle.length === 1 ? 'Scene' : 'Scenes'} ${sceneList(ownStyle.map((r) => r.scene_number))} ${ownStyle.length === 1 ? 'has its' : 'have their'} own look, different from the rest of the cartoon (${styleName(style.artStyle)}).` });
    }
    const characterIds = [...new Set(rows.flatMap((r) => r.characters.map((c) => c.character_id)))];
    for (const characterId of characterIds) {
      const uses = rows.flatMap((r) => r.characters.filter((c) => c.character_id === characterId && c.look_id).map((c) => ({ row: r, c })));
      const looks = new Set(uses.map((u) => u.c.look_id));
      const name = uses[0]?.c.name ?? rows.flatMap((r) => r.characters).find((c) => c.character_id === characterId)!.name;
      if (looks.size > 1) {
        const older = uses.filter((u) => u.c.look_id !== u.c.current_look_id);
        warnings.push({ kind: 'mixed_looks', scene_ids: older.map((u) => u.row.scene_id),
          detail: `${name} uses an earlier look in ${older.length === 1 ? 'scene' : 'scenes'} ${sceneList(older.map((u) => u.row.scene_number))}, so they may look different there.` });
      }
      const drawn = uses.find((u) => u.c.look_art_style && u.c.look_art_style !== style.artStyle);
      if (drawn) {
        warnings.push({ kind: 'look_style', scene_ids: uses.filter((u) => u.c.look_art_style !== style.artStyle).map((u) => u.row.scene_id),
          detail: `${name}’s picture was drawn in a different style (${styleName(drawn.c.look_art_style!)}). Make a new picture in the cartoon’s look so they match.` });
      }
    }
    const wordsOnly = rows.filter((r) => r.clip?.words_only);
    if (wordsOnly.length) {
      warnings.push({ kind: 'words_only', scene_ids: wordsOnly.map((r) => r.scene_id),
        detail: `The ${wordsOnly.length === 1 ? 'clip' : 'clips'} in ${wordsOnly.length === 1 ? 'scene' : 'scenes'} ${sceneList(wordsOnly.map((r) => r.scene_number))} ${wordsOnly.length === 1 ? 'was' : 'were'} made from the words only, so the characters may not look like their pictures.` });
    }
    const families = new Set(rows.map((r) => r.clip?.family).filter(Boolean));
    if (families.size > 1) {
      warnings.push({ kind: 'mixed_makers', scene_ids: rows.filter((r) => r.clip).map((r) => r.scene_id),
        detail: 'Your clips were made by different clip makers, so their look may not match exactly.' });
    }

    reply.header('Cache-Control', 'no-store');
    return { art_style: style.artStyle, style_chosen: style.chosen, scenes: rows, warnings };
  });

  async function ownLook(database: Database, accountId: string, characterId: string, lookId: string) {
    const [row] = await database.select({ character: schema.characters, look: schema.characterVisualVersions }).from(schema.characterVisualVersions)
      .innerJoin(schema.characters, eq(schema.characters.id, schema.characterVisualVersions.characterId))
      .where(and(eq(schema.characterVisualVersions.id, lookId), eq(schema.characterVisualVersions.accountId, accountId),
        eq(schema.characters.id, characterId), eq(schema.characters.accountId, accountId), isNull(schema.characters.deletedAt)));
    if (!row) throw ApiError.notFound('Look');
    await isConstrained(database as typeof db, accountId, row.character.projectId);
    return row;
  }

  app.get('/characters/:id/looks/:lookId/use-everywhere', async (request, reply) => {
    const { id, lookId } = lookParam.parse(request.params);
    await ownLook(db, request.accountId, id, lookId);
    const bindings = await olderLookBindings(db, request.accountId, id, lookId);
    reply.header('Cache-Control', 'no-store');
    return {
      scenes_to_update: new Set(bindings.filter((b) => !b.shot.heroVideoAssetId).map((b) => b.scene.id)).size,
      scenes_kept: new Set(bindings.filter((b) => b.shot.heroVideoAssetId).map((b) => b.scene.id)).size,
    };
  });

  app.post('/characters/:id/looks/:lookId/use-everywhere', async (request) => {
    const { id, lookId } = lookParam.parse(request.params);
    return db.transaction(async (tx) => {
      await ownLook(tx, request.accountId, id, lookId);
      const bindings = await olderLookBindings(tx, request.accountId, id, lookId);
      // A scene with a chosen clip keeps the look that clip was made with (finished clips never change).
      const update = bindings.filter((b) => !b.shot.heroVideoAssetId);
      for (const b of update) {
        await tx.update(schema.shotCharacterBindings).set({ visualVersionId: lookId, updatedAt: new Date() }).where(eq(schema.shotCharacterBindings.id, b.binding.id));
        await tx.update(schema.shots).set({ version: b.shot.version + 1, updatedAt: new Date() }).where(eq(schema.shots.id, b.shot.id));
      }
      for (const scene of new Map(update.map((b) => [b.scene.id, b.scene])).values()) await syncSceneShots(tx, request.accountId, scene);
      return { scenes_updated: new Set(update.map((b) => b.scene.id)).size, scenes_kept: new Set(bindings.filter((b) => b.shot.heroVideoAssetId).map((b) => b.scene.id)).size };
    });
  });

}
