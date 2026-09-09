import { createHash } from 'node:crypto';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { promptPhrase } from '@storyboard/vocabularies';
import { db, schema } from '../db/client.ts';
import { svgDataUrl } from './sketch.ts';

type Scene = typeof schema.scenes.$inferSelect;
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Batch the shared lookups so a board does not issue queries for every card. */
export async function thumbnailSources(rows: Scene[], accountId: string, database: typeof db | Transaction = db) {
  const characterIds = [...new Set(rows.flatMap((s) => s.characterIds))];
  const locationIds = [...new Set(rows.flatMap((s) => s.locationId ? [s.locationId] : []))];
  const [characters, locations] = await Promise.all([
    characterIds.length ? database.select().from(schema.characters).where(and(eq(schema.characters.accountId, accountId), inArray(schema.characters.id, characterIds))) : [],
    locationIds.length ? database.select().from(schema.locations).where(and(eq(schema.locations.accountId, accountId), inArray(schema.locations.id, locationIds))) : [],
  ]);
  return new Map(rows.map((s) => {
    const source = {
      title: s.title, intent: s.description === null ? s.sceneIntent : '', synopsis: s.synopsis,
      action: s.description ?? s.actionDescription, scenery: s.description === null ? s.sceneryDescription : '',
      time: s.timeOfDay, weather: s.weather, mood: s.moodAtmosphere,
      costumes: s.costumeOverrides,
      characters: characters.filter((c) => c.projectId === s.projectId && s.characterIds.includes(c.id))
        .sort((a, b) => a.id.localeCompare(b.id)).map((c) => ({ name: c.name, description: c.promptToken, costume: c.defaultCostume, variants: c.costumeVariants })),
      location: locations.filter((l) => l.projectId === s.projectId && l.id === s.locationId)
        .map((l) => ({ name: l.name, description: l.promptToken, dressing: l.setDressing }))[0] ?? null,
    };
    // Keep existing preview fingerprints valid until a user changes description or angle.
    const framedSource = s.cameraAngle ? { ...source, camera_angle: promptPhrase('camera_angle', s.cameraAngle) } : source;
    return [s.id, { source: framedSource, fingerprint: createHash('sha256').update(JSON.stringify(framedSource)).digest('hex') }];
  }));
}

export async function sceneThumbnailPreviews(rows: Scene[], accountId: string) {
  const result = new Map<string, { src: string; description: string }>();
  if (!rows.length) return result;
  const proposals = await db.select().from(schema.aiProposals).where(and(
    eq(schema.aiProposals.accountId, accountId), eq(schema.aiProposals.operation, 'generate_scene_thumbnail'),
    eq(schema.aiProposals.status, 'pending'), gt(schema.aiProposals.expiresAt, new Date()),
    inArray(schema.aiProposals.targetEntityId, rows.map((s) => s.id)),
  )).orderBy(desc(schema.aiProposals.createdAt));
  const seen = new Set<string>();
  for (const p of proposals) {
    if (!p.targetEntityId || seen.has(p.targetEntityId)) continue;
    seen.add(p.targetEntityId);
    const payload = p.payload as { state?: string; svg?: string; description?: string };
    if (payload.state === 'ready' && payload.svg) result.set(p.targetEntityId, {
      src: svgDataUrl(payload.svg), description: payload.description ?? 'Scene sketch preview',
    });
  }
  return result;
}

export async function sceneThumbnailMetadata(rows: Scene[], accountId: string): Promise<Map<string, { src: string; description: string; stale: boolean } | null>> {
  const selected = rows.filter((s) => s.thumbnailAssetId);
  if (!selected.length) return new Map();
  const [sources, assets] = await Promise.all([
    thumbnailSources(selected, accountId),
    db.select().from(schema.assets).where(and(
      eq(schema.assets.accountId, accountId), eq(schema.assets.kind, 'scene_thumbnail'),
      inArray(schema.assets.id, selected.map((s) => s.thumbnailAssetId!)),
    )),
  ]);
  return new Map(selected.map((s) => {
    const asset = assets.find((a) => a.id === s.thumbnailAssetId && a.projectId === s.projectId && a.ownerEntityId === s.id);
    return [s.id, asset?.thumbnailSvg ? {
      src: svgDataUrl(asset.thumbnailSvg), description: asset.thumbnailDescription ?? 'Scene sketch',
      stale: s.thumbnailSourceFingerprint !== sources.get(s.id)?.fingerprint,
    } : null];
  }));
}
