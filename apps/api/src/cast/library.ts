/**
 * Your characters (docs/character-library-requirements.md).
 *
 * The library is not a table: it is every character with a chosen look in any cartoon of this
 * account that is not in the bin, grouped by name (CL-01). Reusing one copies it into another
 * cartoon with the same traits and the same chosen look, pinned to the same pictures, so the
 * clip makers receive exactly what they did before (CL-05). The copy remembers where it came
 * from (`source_character_id`); neither side changes the other afterwards.
 */
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '../db/client.ts';
import { ApiError } from '../errors.ts';
import type { Tx } from '../generation/budget.ts';
import { loadLooks, type Look } from './looks.ts';

type Database = typeof db | Tx;
type Character = typeof schema.characters.$inferSelect;

/** "Stick Man", "stickman" and " STICK  MAN " are the same name (CL-03). */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export interface LibraryEntry {
  character: Character;
  project: { id: string; title: string };
  look: Look;
}

/** Every reusable character on the account, most recently chosen look first. */
export async function libraryEntries(database: Database, accountId: string): Promise<LibraryEntry[]> {
  const rows = await database.select({ character: schema.characters, project: { id: schema.projects.id, title: schema.projects.title } })
    .from(schema.characters)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.characters.projectId))
    .where(and(eq(schema.characters.accountId, accountId), isNull(schema.characters.deletedAt), isNotNull(schema.characters.currentVisualVersionId), isNull(schema.projects.deletedAt)))
    .orderBy(desc(schema.characters.id));
  if (!rows.length) return [];
  const looks = await loadLooks(database, accountId, rows.map((r) => r.character.id));
  const entries: LibraryEntry[] = [];
  for (const row of rows) {
    const look = looks.find((l) => l.id === row.character.currentVisualVersionId);
    if (look && look.references.length) entries.push({ character: row.character, project: row.project, look });
  }
  return entries.sort((a, b) => b.look.approvedAt.getTime() - a.look.approvedAt.getTime());
}

/** The best library match for a name: the most recently chosen look among characters of that name, outside this cartoon. */
export function matchByName(entries: LibraryEntry[], name: string, excludeProjectId: string): { best: LibraryEntry; others: LibraryEntry[] } | null {
  const key = nameKey(name);
  if (!key) return null;
  const same = entries.filter((e) => nameKey(e.character.name) === key && e.project.id !== excludeProjectId);
  if (!same.length) return null;
  return { best: same[0]!, others: same.slice(1) };
}

/**
 * Copy a library character into a cartoon: traits, the chosen look and its pinned pictures.
 * Caller has checked the cartoon belongs to the account. Refuses when the cartoon already has a
 * live character of that name (the creator would have two Timmys with no way to tell them apart).
 */
export async function copyFromLibrary(tx: Tx, input: { accountId: string; sourceCharacterId: string; targetProjectId: string; foundInSceneIds?: string[] }): Promise<Character> {
  const [row] = await tx.select({ character: schema.characters, project: { id: schema.projects.id, title: schema.projects.title } })
    .from(schema.characters).innerJoin(schema.projects, eq(schema.projects.id, schema.characters.projectId))
    .where(and(eq(schema.characters.id, input.sourceCharacterId), eq(schema.characters.accountId, input.accountId), isNull(schema.characters.deletedAt), isNull(schema.projects.deletedAt)));
  if (!row) throw ApiError.notFound('Character');
  const source = row.character;
  if (!source.currentVisualVersionId) throw ApiError.validation(`${source.name} has no chosen look yet, so there is nothing to reuse. Choose a look on ${source.name}’s sheet first.`);
  if (source.projectId === input.targetProjectId) throw ApiError.validation(`${source.name} is already in this cartoon.`);
  const existing = await tx.select({ name: schema.characters.name }).from(schema.characters)
    .where(and(eq(schema.characters.projectId, input.targetProjectId), eq(schema.characters.accountId, input.accountId), isNull(schema.characters.deletedAt)));
  if (existing.some((e) => nameKey(e.name) === nameKey(source.name))) throw ApiError.validation(`There is already a ${source.name} in this cartoon.`);

  const [look] = await loadLooks(tx, input.accountId, [source.id]).then((ls) => ls.filter((l) => l.id === source.currentVisualVersionId));
  if (!look || !look.references.length) throw ApiError.validation(`${source.name}’s look has no pictures, so it cannot be reused.`);
  // Every pinned picture must still be usable; a binned one would be refused by the maker later.
  const assets = await tx.select().from(schema.assets).where(and(inArray(schema.assets.id, look.references.map((r) => r.assetId)), eq(schema.assets.accountId, input.accountId)));
  if (assets.some((a) => a.deletedAt) || assets.length !== look.references.length) throw ApiError.validation(`One of ${source.name}’s pictures is in the bin. Put it back first.`);

  const [copy] = await tx.insert(schema.characters).values({
    accountId: input.accountId, projectId: input.targetProjectId, name: source.name, role: source.role,
    promptToken: source.promptToken, ageAppearance: source.ageAppearance, physicalBuild: source.physicalBuild,
    distinguishingFeatures: source.distinguishingFeatures, defaultCostume: source.defaultCostume, costumeVariants: source.costumeVariants,
    personality: source.personality, motivation: source.motivation, speechPattern: source.speechPattern, voiceDirection: source.voiceDirection,
    characterArc: source.characterArc, backgroundStory: source.backgroundStory, species: source.species, colours: source.colours,
    source: 'library', sourceCharacterId: source.id, foundInSceneIds: input.foundInSceneIds ?? [],
    descriptionFingerprint: source.descriptionFingerprint,
  }).returning();
  const [version] = await tx.insert(schema.characterVisualVersions).values({
    accountId: input.accountId, characterId: copy!.id, visualVersion: 1, traits: look.traits, artStyle: look.artStyle, approvedBy: input.accountId,
  }).returning();
  await tx.insert(schema.characterVisualReferences).values(look.references.map((r) => ({
    accountId: input.accountId, visualVersionId: version!.id, assetId: r.assetId, contentSha256: r.contentHash, role: r.role, position: r.position, isMain: r.isMain,
  })));
  const [done] = await tx.update(schema.characters).set({ currentVisualVersionId: version!.id, mainReferenceAssetId: look.references[0]!.assetId })
    .where(eq(schema.characters.id, copy!.id)).returning();
  return done!;
}
