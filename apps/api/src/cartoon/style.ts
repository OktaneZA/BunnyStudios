/**
 * One look per cartoon (docs/video-optimisation-plan.md §7.1, V1).
 *
 * The cartoon's art style lives on its series bible and is used by everything that draws:
 * character pictures, scene sketches, starting pictures and clips. A scene may still carry its
 * own style (an Advanced choice, "different look for this scene only"); the compiler lets that
 * override win, exactly as before.
 *
 * Before a cartoon has chosen a style, it uses the style most of its scenes already use, so an
 * existing cartoon keeps the look its clips were made in. With no scene styles at all it uses
 * the default. This is resolved on read; nothing is backfilled.
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { ART_STYLE, values } from '@storyboard/vocabularies';
import { db, schema } from '../db/client.ts';
import type { Tx } from '../generation/budget.ts';

type Database = typeof db | Tx;

/** A default *value* from the art_style vocabulary. Naming a value is not naming a phrase (CV-1). */
export const DEFAULT_ART_STYLE = '2d_flat_vector';
if (!values('art_style').includes(DEFAULT_ART_STYLE)) throw new Error('DEFAULT_ART_STYLE is not in the vocabulary');

export interface CartoonStyle {
  /** An art_style vocabulary value. */
  artStyle: string;
  lineTreatment: string;
  /** False until someone chooses the cartoon's look; the value is then inferred. */
  chosen: boolean;
}

/** The art_style value a scene's override phrase came from, or null for free text / none. */
export function sceneStyleValue(styleOverride: string | null): string | null {
  if (!styleOverride) return null;
  return ART_STYLE.find((s) => s.prompt_phrase === styleOverride)?.value ?? null;
}

export async function cartoonStyle(database: Database, accountId: string, projectId: string): Promise<CartoonStyle> {
  const [bible] = await database.select({ artStyle: schema.seriesBibles.artStyle, lineTreatment: schema.seriesBibles.lineTreatment }).from(schema.seriesBibles)
    .where(and(eq(schema.seriesBibles.projectId, projectId), eq(schema.seriesBibles.accountId, accountId)));
  const lineTreatment = bible?.lineTreatment ?? '';
  if (bible?.artStyle && values('art_style').includes(bible.artStyle)) return { artStyle: bible.artStyle, lineTreatment, chosen: true };
  const rows = await database.select({ style: schema.scenes.styleOverride }).from(schema.scenes)
    .where(and(eq(schema.scenes.projectId, projectId), eq(schema.scenes.accountId, accountId), isNull(schema.scenes.deletedAt), isNotNull(schema.scenes.styleOverride)));
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = sceneStyleValue(row.style);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  // Most common wins; a tie goes to the earlier vocabulary entry, so the answer never depends on row order.
  let best: string | null = null;
  for (const value of values('art_style')) if ((counts.get(value) ?? 0) > (best ? counts.get(best)! : 0)) best = value;
  return { artStyle: best ?? DEFAULT_ART_STYLE, lineTreatment, chosen: false };
}
