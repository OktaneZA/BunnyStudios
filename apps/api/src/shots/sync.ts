/**
 * One shot per scene, kept in sync (plan D34, DM-11).
 *
 * Simple mode never shows the word "shot". The server creates a scene's first shot when it
 * is first needed and recompiles its prompt whenever the scene, the cast or the bible
 * changes. The server is the sole compilation authority; the web app compiles only for
 * live preview and never sends a prompt back.
 */
import { and, asc, eq, inArray, isNull, or, sql as raw } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { compileShot, TEMPLATE_VERSION, type CompileInput } from '@storyboard/compiler';
import { db, schema } from '../db/client.ts';
import { ApiError } from '../errors.ts';
import { sceneDescription } from '../scenes/description.ts';
import type { Tx } from '../generation/budget.ts';
import { compileCharacter, shotCast, shotCastForScenes, type ShotCastEntry } from './cast.ts';
import { cartoonStyle } from '../cartoon/style.ts';

type Scene = typeof schema.scenes.$inferSelect;
type Shot = typeof schema.shots.$inferSelect;
type Database = typeof db | Tx;

/** Characters that appear in a scene: found there by the cast proposal, or attached by id. */
export async function sceneCharacters(database: Database, accountId: string, scene: Scene) {
  const rows = await database.select().from(schema.characters).where(and(
    eq(schema.characters.accountId, accountId), eq(schema.characters.projectId, scene.projectId), isNull(schema.characters.deletedAt),
    or(raw`${scene.id} = ANY(${schema.characters.foundInSceneIds})`, scene.characterIds.length ? raw`${schema.characters.id} = ANY(${raw.raw(`ARRAY[${scene.characterIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})` : raw`false`),
  )).orderBy(asc(schema.characters.name), asc(schema.characters.id));
  return rows;
}

/** What every scene of a cartoon shares; loaded once when many scenes compile together. */
export interface CompileContext {
  bible: typeof schema.seriesBibles.$inferSelect | undefined;
  style: Awaited<ReturnType<typeof cartoonStyle>>;
  locations: Map<string, typeof schema.locations.$inferSelect>;
  /** Cast entries by shot id, for the shots this context was built for. */
  casts: Map<string, ShotCastEntry[]>;
}

export async function loadCompileContext(database: Database, accountId: string, projectId: string, pairs: { shot: Shot; scene: Scene }[]): Promise<CompileContext> {
  const [bible] = await database.select().from(schema.seriesBibles).where(and(eq(schema.seriesBibles.projectId, projectId), eq(schema.seriesBibles.accountId, accountId)));
  const style = await cartoonStyle(database, accountId, projectId);
  const locationIds = [...new Set(pairs.map((p) => p.scene.locationId).filter((id): id is string => Boolean(id)))];
  const locationRows = locationIds.length ? await database.select().from(schema.locations).where(and(inArray(schema.locations.id, locationIds), eq(schema.locations.accountId, accountId))) : [];
  const casts = await shotCastForScenes(database, accountId, pairs);
  return { bible, style, locations: new Map(locationRows.map((l) => [l.id, l])), casts };
}

export async function compileInput(database: Database, accountId: string, scene: Scene, shot: Shot | null, ctx?: CompileContext): Promise<CompileInput> {
  const bible = ctx ? ctx.bible : (await database.select().from(schema.seriesBibles).where(and(eq(schema.seriesBibles.projectId, scene.projectId), eq(schema.seriesBibles.accountId, accountId))))[0];
  const location = scene.locationId
    ? ctx ? ctx.locations.get(scene.locationId) : (await database.select().from(schema.locations).where(and(eq(schema.locations.id, scene.locationId), eq(schema.locations.accountId, accountId))))[0]
    : undefined;
  // CR-01: a saved "Characters in this shot" list drives the words. Each character is described
  // from a look: the pinned one when saved, else the character's current look (§6.2), so two scenes
  // never describe the same character differently because one of them was not saved yet.
  const entries = shot ? (ctx?.casts.get(shot.id) ?? await shotCast(database, accountId, shot, scene))
    : (await sceneCharacters(database, accountId, scene)).map((character) => ({ character, binding: null, look: null, proposed: true }));
  const subjects = (!shot?.castSaved && shot?.subjectCharacterIds.length ? entries.filter((e) => shot.subjectCharacterIds.includes(e.character.id)) : entries).map(compileCharacter);
  const style = ctx ? ctx.style : await cartoonStyle(database, accountId, scene.projectId);
  return {
    bible: {
      artStyle: style.artStyle,
      lineTreatment: style.lineTreatment,
      defaultLighting: bible?.defaultLighting ?? '',
      renderQualityTokens: bible?.renderQualityTokens ?? '',
      negativePrompt: bible?.negativePrompt ?? '',
      colourPalette: Array.isArray(bible?.colourPalette) ? (bible.colourPalette as unknown[]).map(String) : [],
    },
    scene: {
      description: sceneDescription(scene),
      sceneryDescription: scene.description === null ? scene.sceneryDescription : '',
      cameraAngle: scene.cameraAngle,
      timeOfDay: scene.timeOfDay,
      weather: scene.weather,
      moodAtmosphere: scene.moodAtmosphere,
      lightingPreset: scene.lightingPreset,
      lighting: scene.lighting,
      styleOverride: scene.styleOverride,
      locationName: location?.name ?? '',
      // The cartoon's setting stands in when a scene has no location of its own, so scene 3 does
      // not wander off the beach because its words never mentioned it.
      locationDescription: location?.promptToken ?? bible?.defaultSetting ?? '',
      locationDefaultLighting: location?.defaultLighting ?? '',
    },
    shot: {
      shotType: shot?.shotType ?? null,
      lensFocalLength: shot?.lensFocalLength ?? null,
      depthOfField: shot?.depthOfField ?? null,
      subjectPlacement: shot?.subjectPlacement ?? '',
      actionBeat: shot?.actionBeat ?? '',
      expressionNote: shot?.expressionNote ?? '',
      lightingOverride: shot?.lightingOverride ?? null,
      userPromptAddendum: shot?.userPromptAddendum ?? '',
      characters: subjects,
      propTokens: [],
    },
  };
}

async function uniqueExportKey(database: Database, projectId: string): Promise<string> {
  for (let length = 6; length <= 32; length += 2) {
    const key = randomUUID().replace(/-/g, '').slice(0, length);
    const [clash] = await database.select({ id: schema.shots.id }).from(schema.shots).where(and(eq(schema.shots.projectId, projectId), eq(schema.shots.exportKey, key)));
    if (!clash) return key;
  }
  throw new Error('Could not allocate an export key');
}

/** Ensure the scene has at least one shot and every unlocked shot's prompt is current. */
export async function syncSceneShots(database: Database, accountId: string, scene: Scene, ctx?: CompileContext): Promise<Shot[]> {
  let shots = await database.select().from(schema.shots).where(and(eq(schema.shots.sceneId, scene.id), eq(schema.shots.accountId, accountId))).orderBy(asc(schema.shots.sortOrder), asc(schema.shots.id));
  if (!shots.length) {
    const [created] = await database.insert(schema.shots).values({
      accountId, projectId: scene.projectId, sceneId: scene.id, sortOrder: 0, shotNumber: '1',
      exportKey: await uniqueExportKey(database, scene.projectId),
      // The scene's own angle is the shot's angle; a Simple-mode scene is one wide shot of the action.
      shotType: 'wide', cameraAngle: scene.cameraAngle ?? 'eye_level',
    }).returning();
    shots = [created!];
  }
  const out: Shot[] = [];
  for (const shot of shots) {
    if (shot.promptLocked) { out.push(shot); continue; }
    const input = await compileInput(database, accountId, scene, shot, ctx?.casts.has(shot.id) ? ctx : undefined);
    const compiled = compileShot(input);
    if (compiled.prompt !== shot.compiledPrompt || compiled.negativePrompt !== shot.compiledNegativePrompt || shot.promptTemplateVersion !== TEMPLATE_VERSION) {
      const [updated] = await database.update(schema.shots).set({
        compiledPrompt: compiled.prompt, compiledNegativePrompt: compiled.negativePrompt, promptTemplateVersion: TEMPLATE_VERSION, updatedAt: new Date(),
      }).where(eq(schema.shots.id, shot.id)).returning();
      out.push(updated!);
    } else out.push(shot);
  }
  return out;
}

/**
 * Sync every scene of a cartoon: the cartoon's bible, style, locations and casts are read once,
 * then each scene compiles from them. Returns the first shot of each scene, by scene id.
 */
export async function syncProjectShots(database: Database, accountId: string, projectId: string, scenes: Scene[]): Promise<Map<string, Shot>> {
  const out = new Map<string, Shot>();
  if (!scenes.length) return out;
  const existing = await database.select().from(schema.shots)
    .where(and(eq(schema.shots.accountId, accountId), inArray(schema.shots.sceneId, scenes.map((s) => s.id))))
    .orderBy(asc(schema.shots.sortOrder), asc(schema.shots.id));
  const pairs = scenes.flatMap((scene) => { const shot = existing.find((s) => s.sceneId === scene.id); return shot ? [{ shot, scene }] : []; });
  const ctx = await loadCompileContext(database, accountId, projectId, pairs);
  for (const scene of scenes) {
    const [first] = await syncSceneShots(database, accountId, scene, ctx);
    if (first) out.set(scene.id, first);
  }
  return out;
}

export async function ownShot(database: Database, accountId: string, id: string, lock = false) {
  const query = database.select({ shot: schema.shots, scene: schema.scenes }).from(schema.shots)
    .innerJoin(schema.scenes, eq(schema.scenes.id, schema.shots.sceneId))
    .where(and(eq(schema.shots.id, id), eq(schema.shots.accountId, accountId), isNull(schema.scenes.deletedAt),
      raw`EXISTS (SELECT 1 FROM projects WHERE projects.id = scenes.project_id AND projects.deleted_at IS NULL)`));
  const [row] = await (lock ? query.for('update', { of: schema.shots }) : query);
  if (!row) throw ApiError.notFound('Scene');
  return row;
}

export function presentShot(s: Shot) {
  return {
    id: s.id,
    scene_id: s.sceneId,
    shot_number: s.shotNumber,
    sort_order: s.sortOrder,
    compiled_prompt: s.compiledPrompt,
    compiled_negative_prompt: s.compiledNegativePrompt,
    prompt_template_version: s.promptTemplateVersion,
    prompt_locked: s.promptLocked,
    user_prompt_addendum: s.userPromptAddendum,
    action_beat: s.actionBeat,
    shot_type: s.shotType,
    camera_angle: s.cameraAngle,
    hero_asset_id: s.heroAssetId,
    hero_video_asset_id: s.heroVideoAssetId,
    start_frame_asset_id: s.startFrameAssetId,
    end_frame_asset_id: s.endFrameAssetId,
    cast_saved: s.castSaved,
    generated_asset_ids: s.generatedAssetIds,
    version: s.version,
    updated_at: s.updatedAt.toISOString(),
  };
}
