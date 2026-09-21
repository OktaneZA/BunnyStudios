/**
 * The prompt compiler (requirements §5, plan Phase 2, DM-10).
 *
 * PURE. Same inputs → byte-identical output, in Node and in the browser. This module must never
 * import a framework, a database client, a Node built-in, a clock, a random source or anything
 * that does I/O, and must never call a locale-sensitive method. The only dependency is the
 * vocabulary package, which is the sole authority for every prompt phrase (CV-1): nothing in
 * here retypes a phrase.
 *
 * Deviations from §5.2 are deliberate: step 10 (camera movement / motion intent) is omitted
 * entirely because v1 compiles one still prompt per shot (plan D6), and in Simple mode the scene
 * description stands in for the action beat because every scene owns exactly one shot
 * (D18, D34).
 */
import { option, type PromptVocabularyName } from '@storyboard/vocabularies';

export const TEMPLATE_VERSION = 'v1';

/**
 * The standard cartoon exclusions appended to every negative prompt (§5.2). This is the one
 * constant the compiler is allowed to own; every other phrase comes from the vocabulary.
 */
export const STANDARD_NEGATIVE =
  'text, watermark, signature, extra limbs, deformed hands, photorealistic, blurry';

/** A subject character, already resolved by the caller from `subject_character_ids`. */
export interface CompileCharacter {
  name: string;
  description: string;
  costume: string;
}

export interface CompileInput {
  bible: {
    /** An `art_style` vocabulary value, or `''` when the bible has none. */
    artStyle: string;
    lineTreatment: string;
    defaultLighting: string;
    renderQualityTokens: string;
    negativePrompt: string;
    colourPalette: string[];
  };
  scene: {
    description: string;
    sceneryDescription: string;
    /** A `camera_angle` vocabulary value. */
    cameraAngle: string | null;
    /** A `time_of_day` vocabulary value. */
    timeOfDay: string;
    weather: string | null;
    /** A `mood_atmosphere` vocabulary value. */
    moodAtmosphere: string | null;
    /** A `lighting_preset` vocabulary value. */
    lightingPreset: string | null;
    /** Free-text lighting, the third level of the lighting fallback. */
    lighting: string;
    /** Verbatim replacement for the bible's art-style phrase when non-empty. */
    styleOverride: string | null;
    locationName: string;
    locationDescription: string;
    locationDefaultLighting: string;
  };
  shot: {
    /** A `shot_type` vocabulary value. */
    shotType: string | null;
    /** A `lens_focal_length` vocabulary value. */
    lensFocalLength: string | null;
    /** A `depth_of_field` vocabulary value. */
    depthOfField: string | null;
    subjectPlacement: string;
    actionBeat: string;
    expressionNote: string;
    lightingOverride: string | null;
    userPromptAddendum: string;
    /** Already-resolved subject characters, in `subject_character_ids` order. */
    characters: CompileCharacter[];
    propTokens: string[];
  };
}

export interface CompileResult {
  prompt: string;
  negativePrompt: string;
  templateVersion: string;
  /** Distinct characters that contributed to the prompt (PC-3). */
  characterCount: number;
}

export interface PromptBudget {
  length: number;
  max: number;
  /** Over the provider's limit; export must refuse the shot (D11). */
  over: boolean;
  /** At or past 75% of the limit; the counter turns amber (PC-5). */
  warning: boolean;
}

/** Collapse internal runs of whitespace and trim the ends. */
function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The prompt phrase for a vocabulary value, or `''` when the value is unset, deliberately
 * silent (`emitsNothing`) or not in the vocabulary at all. Unknown values are dropped rather
 * than thrown: the compiler runs on every keystroke in the live preview and a stale bundle
 * must degrade to a slightly shorter prompt, never to a crash.
 */
function phrase(vocabulary: PromptVocabularyName, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const match = option(vocabulary, value);
  if (match === undefined || match.emitsNothing === true) return '';
  return match.prompt_phrase;
}

/** Join the non-empty, cleaned parts of a section with a separator. */
function join(parts: readonly string[], separator: string): string {
  return parts.map(clean).filter((p) => p !== '').join(separator);
}

/** First non-empty value wins; the lighting fallback (§5.2 step 8) is the caller. */
function firstNonEmpty(candidates: readonly string[]): string {
  for (const candidate of candidates) {
    const cleaned = clean(candidate);
    if (cleaned !== '') return cleaned;
  }
  return '';
}

/** Each character exactly once, by name (PC-3), in first-seen order. */
function dedupeCharacters(characters: readonly CompileCharacter[]): CompileCharacter[] {
  const seen = new Set<string>();
  const unique: CompileCharacter[] = [];
  for (const character of characters) {
    const key = clean(character.name);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    unique.push(character);
  }
  return unique;
}

function describeCharacter(character: CompileCharacter): string {
  const name = clean(character.name);
  const description = clean(character.description);
  const costume = clean(character.costume);
  let text = description === '' ? name : `${name}: ${description}`;
  if (costume !== '') text += `, wearing ${costume}`;
  return text;
}

function describeLocation(name: string, description: string): string {
  const cleanName = clean(name);
  const cleanDescription = clean(description);
  if (cleanName === '') return cleanDescription;
  if (cleanDescription === '') return cleanName;
  return `${cleanName}: ${cleanDescription}`;
}

/** Strip trailing full stops so joining sections with `'. '` never yields `'..'`. */
function stripTrailingStops(section: string): string {
  return section.replace(/[.\s]+$/, '');
}

/**
 * Compile one shot to one flowing paragraph plus a negative prompt, in the §5.2 order.
 */
export function compileShot(input: CompileInput): CompileResult {
  const { bible, scene, shot } = input;

  // 1. Style prefix — the scene's override beats the bible's art style, verbatim.
  const style = firstNonEmpty([scene.styleOverride ?? '', phrase('art_style', bible.artStyle)]);
  const stylePrefix = join([style, bible.lineTreatment], ', ');

  // 2. Shot grammar.
  const shotGrammar = join(
    [
      phrase('shot_type', shot.shotType),
      phrase('camera_angle', scene.cameraAngle),
      phrase('lens_focal_length', shot.lensFocalLength),
      phrase('depth_of_field', shot.depthOfField),
    ],
    ', ',
  );

  // 3. Subjects — each character once, then the expression note.
  const characters = dedupeCharacters(shot.characters);
  const subjects = join([...characters.map(describeCharacter), shot.expressionNote], '; ');

  // 4. Action — the shot's beat, or the scene description when the scene is its own shot.
  const action = firstNonEmpty([shot.actionBeat, scene.description]);

  // 5. Placement.
  const placement = clean(shot.subjectPlacement);

  // 6. Setting.
  const setting = join(
    [
      describeLocation(scene.locationName, scene.locationDescription),
      scene.sceneryDescription,
      join(shot.propTokens, ', '),
    ],
    ', ',
  );

  // 7. Time & weather.
  const timeAndWeather = join([phrase('time_of_day', scene.timeOfDay), scene.weather ?? ''], ', ');

  // 8. Lighting — five levels, first non-empty wins.
  const lighting = firstNonEmpty([
    shot.lightingOverride ?? '',
    phrase('lighting_preset', scene.lightingPreset),
    scene.lighting,
    scene.locationDefaultLighting,
    bible.defaultLighting,
  ]);

  // 9. Mood.
  const mood = phrase('mood_atmosphere', scene.moodAtmosphere);

  // 10. Camera movement — omitted: one still prompt per shot (D6).

  // 11. Palette.
  const palette = join(bible.colourPalette, ', ');
  const paletteSection = palette === '' ? '' : `colour palette: ${palette}`;

  // 12. Quality tokens.
  const quality = clean(bible.renderQualityTokens);

  // 13. User addendum, last.
  const addendum = clean(shot.userPromptAddendum);

  const sections = [
    stylePrefix,
    shotGrammar,
    subjects,
    action,
    placement,
    setting,
    timeAndWeather,
    lighting,
    mood,
    paletteSection,
    quality,
    addendum,
  ]
    .map(stripTrailingStops)
    .filter((s) => s !== '');

  const prompt = sections.length === 0 ? '' : `${sections.join('. ')}.`;

  const bibleNegative = clean(bible.negativePrompt);
  const negativePrompt =
    bibleNegative === '' ? STANDARD_NEGATIVE : `${bibleNegative}, ${STANDARD_NEGATIVE}`;

  return {
    prompt,
    negativePrompt,
    templateVersion: TEMPLATE_VERSION,
    characterCount: characters.length,
  };
}

/**
 * Measure a prompt against the active provider's `max_prompt_length` (PC-5, D11). The limit is
 * passed in — nothing here knows a number.
 */
export function promptBudget(prompt: string, maxLength: number): PromptBudget {
  const length = prompt.length;
  return {
    length,
    max: maxLength,
    over: length > maxLength,
    warning: length >= maxLength * 0.75,
  };
}
