/**
 * Character looks (Character Studio CS-04–CS-12): candidates, approval into immutable visual
 * revisions, and the pinned references that production requests use.
 *
 * Invariants:
 *   - A candidate never changes identity. Only approveLook() creates a revision, and only an
 *     explicit user action calls it (CS-04).
 *   - A revision's traits and references never change after insert; going back selects an
 *     older revision (CS-09).
 *   - Each reference is pinned by content hash, so later edits cannot swap the bytes (CS-10).
 */
import { and, asc, desc, eq, inArray, isNull, sql as raw } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db, schema } from '../db/client.ts';
import { ApiError } from '../errors.ts';
import type { Tx } from '../generation/budget.ts';
import type { ObjectStore } from '../storage/objectStore.ts';

type Database = typeof db | Tx;
type Character = typeof schema.characters.$inferSelect;
type Asset = typeof schema.assets.$inferSelect;
export type ViewRole = (typeof schema.referenceViewEnum.enumValues)[number];
export const VIEW_ROLES = schema.referenceViewEnum.enumValues;
/** A pack is small on purpose (CS-05): what the upload, review and pricing paths support today. */
export const MAX_PACK_SIZE = 8;

/** CS-07: the traits that make up visual identity. Personality and story are not here. */
export function visualTraits(c: Character) {
  return {
    name: c.name, description: c.promptToken, species: c.species, build: c.physicalBuild,
    colours: c.colours, features: c.distinguishingFeatures, costume: c.defaultCostume,
  };
}
export type VisualTraits = ReturnType<typeof visualTraits>;

export function sameTraits(a: VisualTraits, b: VisualTraits): boolean {
  return (Object.keys(a) as (keyof VisualTraits)[]).every((k) => (a[k] ?? '').trim() === (b[k] ?? '').trim());
}

/** The asset's content hash, computed from its stored bytes once for rows that predate hashing. */
export async function assetHash(database: Database, store: ObjectStore, asset: Asset): Promise<string> {
  if (asset.contentSha256) return asset.contentSha256;
  const hash = createHash('sha256').update(await store.get(asset.storageKey)).digest('hex');
  await database.update(schema.assets).set({ contentSha256: hash }).where(eq(schema.assets.id, asset.id));
  return hash;
}

/** CS-11: may this picture become part of an approved look on this account? */
export function usableForLook(asset: Asset, constrained: boolean): boolean {
  if (asset.deletedAt || !asset.mimeType.startsWith('image/') || asset.thumbnailSvg) return false;
  if (asset.reviewStatus === 'rejected' || asset.reviewStatus === 'pending') return false;
  return !constrained || asset.reviewStatus === 'allowed';
}

export interface LookReference { assetId: string; contentHash: string; role: ViewRole; position: number; isMain: boolean; asset: Asset }
export interface Look { id: string; characterId: string; visualVersion: number; traits: VisualTraits; artStyle: string; approvedAt: Date; references: LookReference[] }

/** Every look of these characters, newest first, with ordered references. */
export async function loadLooks(database: Database, accountId: string, characterIds: string[]): Promise<Look[]> {
  if (!characterIds.length) return [];
  const versions = await database.select().from(schema.characterVisualVersions)
    .where(and(eq(schema.characterVisualVersions.accountId, accountId), inArray(schema.characterVisualVersions.characterId, characterIds)))
    .orderBy(desc(schema.characterVisualVersions.visualVersion));
  if (!versions.length) return [];
  const refs = await database.select({ ref: schema.characterVisualReferences, asset: schema.assets }).from(schema.characterVisualReferences)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.characterVisualReferences.assetId))
    .where(and(eq(schema.characterVisualReferences.accountId, accountId), inArray(schema.characterVisualReferences.visualVersionId, versions.map((v) => v.id))))
    .orderBy(asc(schema.characterVisualReferences.position));
  return versions.map((v) => ({
    id: v.id, characterId: v.characterId, visualVersion: v.visualVersion, traits: v.traits as VisualTraits, artStyle: v.artStyle, approvedAt: v.approvedAt,
    references: refs.filter((r) => r.ref.visualVersionId === v.id).map((r) => ({ assetId: r.ref.assetId, contentHash: r.ref.contentSha256, role: r.ref.role, position: r.ref.position, isMain: r.ref.isMain, asset: r.asset })),
  }));
}

export async function loadLook(database: Database, accountId: string, lookId: string): Promise<Look | null> {
  const [v] = await database.select().from(schema.characterVisualVersions).where(and(eq(schema.characterVisualVersions.id, lookId), eq(schema.characterVisualVersions.accountId, accountId)));
  if (!v) return null;
  return (await loadLooks(database, accountId, [v.characterId])).find((l) => l.id === lookId) ?? null;
}

/**
 * CS-09: approve a look atomically. Locks the character, checks the version the user saw,
 * validates every picture, pins hashes, inserts the next revision and selects it. A stale
 * version is a 409 carrying the current state; neither side's candidates are touched.
 */
export async function approveLook(tx: Tx, input: {
  accountId: string; character: Character; expectedVersion: number; constrained: boolean; store: ObjectStore; artStyle: string;
  pictures: { assetId: string; role: ViewRole }[]; mainAssetId: string;
  present: (c: Character) => Promise<unknown>;
}) {
  const [locked] = await tx.select().from(schema.characters).where(eq(schema.characters.id, input.character.id)).for('update');
  if (!locked || locked.deletedAt) throw ApiError.notFound('Character');
  if (locked.version !== input.expectedVersion) throw ApiError.conflict('This character changed somewhere else. Have a look, then choose again.', await input.present(locked));
  const pictures = input.pictures;
  if (!pictures.length) throw ApiError.validation('Choose at least one picture.');
  if (pictures.length > MAX_PACK_SIZE) throw ApiError.validation(`Choose up to ${MAX_PACK_SIZE} pictures.`);
  if (new Set(pictures.map((p) => p.assetId)).size !== pictures.length) throw ApiError.validation('Each picture can only be chosen once.');
  if (!pictures.some((p) => p.assetId === input.mainAssetId)) throw ApiError.validation('Choose which picture is the main one.');
  // A picture qualifies when it is a live candidate of this character, or already part of one of its looks.
  const ids = pictures.map((p) => p.assetId);
  const candidates = await tx.select().from(schema.characterReferenceCandidates).where(and(
    eq(schema.characterReferenceCandidates.characterId, locked.id), eq(schema.characterReferenceCandidates.accountId, input.accountId),
    eq(schema.characterReferenceCandidates.status, 'candidate'), inArray(schema.characterReferenceCandidates.assetId, ids)));
  const inLooks = await tx.select({ assetId: schema.characterVisualReferences.assetId }).from(schema.characterVisualReferences)
    .innerJoin(schema.characterVisualVersions, eq(schema.characterVisualVersions.id, schema.characterVisualReferences.visualVersionId))
    .where(and(eq(schema.characterVisualVersions.characterId, locked.id), eq(schema.characterVisualReferences.accountId, input.accountId), inArray(schema.characterVisualReferences.assetId, ids)));
  const allowedIds = new Set([...candidates.map((c) => c.assetId), ...inLooks.map((r) => r.assetId)]);
  const assets = await tx.select().from(schema.assets).where(and(inArray(schema.assets.id, ids), eq(schema.assets.accountId, input.accountId)));
  const pinned: { assetId: string; role: ViewRole; hash: string }[] = [];
  for (const p of pictures) {
    const asset = assets.find((a) => a.id === p.assetId);
    // Another account's asset, or one that was never offered for this character: 404, not a hint.
    if (!asset || !allowedIds.has(p.assetId)) throw ApiError.notFound('Picture');
    if (!usableForLook(asset, input.constrained)) throw ApiError.validation('One of those pictures has not passed the safety check, so it cannot be used.');
    pinned.push({ assetId: p.assetId, role: p.assetId === input.mainAssetId ? 'main' : p.role, hash: await assetHash(tx, input.store, asset) });
  }
  // Main first, then the order the user gave: positions are what providers see (CR-03).
  pinned.sort((a, b) => Number(b.role === 'main') - Number(a.role === 'main'));
  const [{ next }] = await tx.select({ next: raw<number>`COALESCE(MAX(${schema.characterVisualVersions.visualVersion}), 0)::int + 1` })
    .from(schema.characterVisualVersions).where(eq(schema.characterVisualVersions.characterId, locked.id)) as [{ next: number }];
  const [look] = await tx.insert(schema.characterVisualVersions).values({
    accountId: input.accountId, characterId: locked.id, visualVersion: next, traits: visualTraits(locked), artStyle: input.artStyle, approvedBy: input.accountId,
  }).returning();
  await tx.insert(schema.characterVisualReferences).values(pinned.map((p, i) => ({
    accountId: input.accountId, visualVersionId: look!.id, assetId: p.assetId, contentSha256: p.hash, role: p.role, position: i, isMain: i === 0,
  })));
  const [updated] = await tx.update(schema.characters).set({
    currentVisualVersionId: look!.id, version: locked.version + 1, lookOutdated: false, mainReferenceAssetId: pinned[0]!.assetId,
  }).where(eq(schema.characters.id, locked.id)).returning();
  return { look: look!, character: updated! };
}

/** CS-09: select a recorded look again. History is untouched. */
export async function selectLook(tx: Tx, input: { accountId: string; characterId: string; lookId: string; expectedVersion: number; present: (c: Character) => Promise<unknown> }) {
  const [locked] = await tx.select().from(schema.characters).where(and(eq(schema.characters.id, input.characterId), eq(schema.characters.accountId, input.accountId), isNull(schema.characters.deletedAt))).for('update');
  if (!locked) throw ApiError.notFound('Character');
  if (locked.version !== input.expectedVersion) throw ApiError.conflict('This character changed somewhere else. Have a look, then choose again.', await input.present(locked));
  const look = await loadLook(tx, input.accountId, input.lookId);
  if (!look || look.characterId !== locked.id) throw ApiError.notFound('Look');
  const [updated] = await tx.update(schema.characters).set({
    currentVisualVersionId: look.id, version: locked.version + 1, lookOutdated: !sameTraits(visualTraits(locked), look.traits),
    mainReferenceAssetId: look.references[0]?.assetId ?? null,
  }).where(eq(schema.characters.id, locked.id)).returning();
  return updated!;
}
