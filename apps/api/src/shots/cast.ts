/**
 * "Characters in this shot" (Character Studio CR-01–CR-04).
 *
 * The story proposes who is in a scene; the user's saved choice is what production uses. A
 * binding pins the look a character had when it was chosen, so a later approval never changes
 * a shot silently (CS-10). The reference manifest built here is ordered by binding position,
 * then by position inside each look, and never re-sorted, so two characters cannot swap
 * identities because a list was filtered or sorted differently (CR-03).
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '../db/client.ts';
import type { Tx } from '../generation/budget.ts';
import { loadLooks, type Look, type VisualTraits } from '../cast/looks.ts';
import { sceneCharacters } from './sync.ts';
import type { CastBinding, ReferenceBinding } from '../video/creativeVideoRequest.ts';

type Database = typeof db | Tx;
type Character = typeof schema.characters.$inferSelect;
type Scene = typeof schema.scenes.$inferSelect;
type Binding = typeof schema.shotCharacterBindings.$inferSelect;

export interface ShotCastEntry {
  character: Character;
  binding: Binding | null;
  /** The look production would use: the pinned one, or (for a proposal) the current one. */
  look: Look | null;
  proposed: boolean;
}

/** Saved bindings when there are any; otherwise the story's proposal, marked as such. */
export async function shotCast(database: Database, accountId: string, shot: { id: string; castSaved: boolean }, scene: Scene): Promise<ShotCastEntry[]> {
  const shotId = shot.id;
  const bindings = await database.select({ b: schema.shotCharacterBindings, c: schema.characters }).from(schema.shotCharacterBindings)
    .innerJoin(schema.characters, eq(schema.characters.id, schema.shotCharacterBindings.characterId))
    .where(and(eq(schema.shotCharacterBindings.shotId, shotId), eq(schema.shotCharacterBindings.accountId, accountId), isNull(schema.characters.deletedAt)))
    .orderBy(asc(schema.shotCharacterBindings.position));
  if (shot.castSaved) {
    const looks = await loadLooks(database, accountId, bindings.map((r) => r.c.id));
    // A binding pinned to a look keeps it (CS-10). One saved before the character had any look
    // ("no look yet") follows the character's current look, so choosing a look later reaches the scene.
    return bindings.map(({ b, c }) => ({ character: c, binding: b, look: looks.find((l) => l.id === (b.visualVersionId ?? c.currentVisualVersionId)) ?? null, proposed: false }));
  }
  const cast = await sceneCharacters(database, accountId, scene);
  const looks = await loadLooks(database, accountId, cast.map((c) => c.id));
  return cast.map((c) => ({ character: c, binding: null, look: looks.find((l) => l.id === c.currentVisualVersionId) ?? null, proposed: true }));
}

/** Words for the compiler: the pinned look's traits when there is one, else the live character. */
export function compileCharacter(entry: ShotCastEntry): { id: string; name: string; description: string; costume: string } {
  const traits = entry.look?.traits as VisualTraits | undefined;
  const outfits = Array.isArray(entry.character.costumeVariants) ? entry.character.costumeVariants as { label: string; description: string }[] : [];
  const outfit = entry.binding?.outfitLabel ? outfits.find((o) => o.label === entry.binding!.outfitLabel) : undefined;
  const base = traits ?? { name: entry.character.name, description: entry.character.promptToken, costume: entry.character.defaultCostume, species: entry.character.species, build: entry.character.physicalBuild, colours: entry.character.colours, features: entry.character.distinguishingFeatures };
  const description = [base.description, base.species, base.build, base.colours, base.features].map((s) => (s ?? '').trim()).filter(Boolean).join(', ');
  return { id: entry.character.id, name: entry.character.name, description, costume: outfit?.description ?? base.costume ?? '' };
}

export interface Manifest {
  characters: CastBinding[];
  references: ReferenceBinding[];
  /** Characters chosen for continuity with no approved look: production must stop and say who (CR-02). */
  missingLooks: { characterId: string; name: string }[];
}

/**
 * CR-03: the ordered reference manifest for a shot's saved cast. `viewsPerCharacter` caps how
 * many pictures of each look are sent; it never drops a character. The caller checks the total
 * against the chosen endpoint and refuses rather than truncating (CR-04).
 */
export function buildManifest(entries: ShotCastEntry[], viewsPerCharacter: number): Manifest {
  const characters: CastBinding[] = [];
  const references: ReferenceBinding[] = [];
  const missingLooks: Manifest['missingLooks'] = [];
  for (const entry of entries) {
    const look = entry.look;
    characters.push({ characterId: entry.character.id, name: entry.character.name, visualVersionId: look?.id ?? null, visualVersion: look?.visualVersion ?? null, outfitLabel: entry.binding?.outfitLabel ?? null });
    if (!look) { missingLooks.push({ characterId: entry.character.id, name: entry.character.name }); continue; }
    for (const ref of look.references.slice(0, Math.max(1, viewsPerCharacter))) {
      references.push({
        assetId: ref.assetId, contentHash: ref.contentHash, modality: 'image', role: 'character', characterId: entry.character.id,
        characterName: entry.character.name, characterVisualVersionId: look.id, view: ref.role, position: references.length,
      });
    }
  }
  return { characters, references, missingLooks };
}

/** Replace a shot's saved cast. Caller has locked the shot and checked its version. */
export async function saveShotCast(tx: Tx, accountId: string, shotId: string, projectId: string, choices: { characterId: string; look: 'current' | 'none' | string; outfitLabel: string | null }[]) {
  const ids = choices.map((c) => c.characterId);
  if (new Set(ids).size !== ids.length) return { error: 'Each character can only be chosen once.' } as const;
  const characters = ids.length ? await tx.select().from(schema.characters).where(and(inArray(schema.characters.id, ids), eq(schema.characters.accountId, accountId), eq(schema.characters.projectId, projectId), isNull(schema.characters.deletedAt))) : [];
  if (characters.length !== ids.length) return { notFound: true } as const;
  const looks = await loadLooks(tx, accountId, ids);
  const rows: (typeof schema.shotCharacterBindings.$inferInsert)[] = [];
  for (const [position, choice] of choices.entries()) {
    const character = characters.find((c) => c.id === choice.characterId)!;
    let visualVersionId: string | null = null;
    if (choice.look === 'current') visualVersionId = character.currentVisualVersionId;
    else if (choice.look !== 'none') {
      const look = looks.find((l) => l.id === choice.look && l.characterId === character.id);
      if (!look) return { notFound: true } as const;
      visualVersionId = look.id;
    }
    const outfits = Array.isArray(character.costumeVariants) ? character.costumeVariants as { label: string }[] : [];
    if (choice.outfitLabel && !outfits.some((o) => o.label === choice.outfitLabel)) return { error: `${character.name} has no outfit called “${choice.outfitLabel}”.` } as const;
    rows.push({ accountId, shotId, characterId: character.id, visualVersionId, outfitLabel: choice.outfitLabel, position, updatedAt: new Date() });
  }
  await tx.delete(schema.shotCharacterBindings).where(and(eq(schema.shotCharacterBindings.shotId, shotId), eq(schema.shotCharacterBindings.accountId, accountId)));
  if (rows.length) await tx.insert(schema.shotCharacterBindings).values(rows);
  await tx.update(schema.shots).set({ castSaved: true }).where(eq(schema.shots.id, shotId));
  return { ok: true } as const;
}
