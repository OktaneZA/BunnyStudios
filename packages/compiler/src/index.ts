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
  /** Stable id when the caller has one: two characters may share a name. */
  id?: string;
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

/** Each character exactly once (PC-3), by id when given else by name, in first-seen order. */
function dedupeCharacters(characters: readonly CompileCharacter[]): CompileCharacter[] {
  const seen = new Set<string>();
  const unique: CompileCharacter[] = [];
  for (const character of characters) {
    if (clean(character.name) === '') continue;
    const key = character.id ? `id:${character.id}` : `name:${clean(character.name)}`;
    if (seen.has(key)) continue;
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

// ── Video template (docs/video-optimisation-plan.md §5.1) ───────────────────

/**
 * The video template's version, recorded on every clip's snapshot. It is separate from
 * TEMPLATE_VERSION: the still prompt on the shot is unchanged and still feeds pictures.
 */
export const VIDEO_TEMPLATE_VERSION = 'video-v1';

export interface VideoCompileInput extends CompileInput {
  video: {
    /** A `camera_movement` vocabulary value (§4.3); emitted only here, never in a still (PC-2c). */
    cameraMovement: string | null;
    /**
     * Each character's picture tokens ("@Image1", "Image 2") in manifest order, matched by id when
     * both sides have one, else by name. The server numbers them from the manifest (CR-03).
     */
    characterTokens: readonly { id?: string; name: string; tokens: readonly string[] }[];
    /** Token of the cartoon's style picture, or `''` when none is sent. */
    styleToken: string;
    /** `field`: the model takes a negative prompt; `fold`: say the keep-outs in the prompt instead. */
    negative: 'field' | 'fold';
    /** Sound is on: ask for effects and background sound, never voices (V6). */
    audio: boolean;
  };
}

/**
 * Compile one shot for a video model. Motion-first: who is in it and what happens, then how the
 * camera sees and moves, then where and when, then the look. The style comes last because the
 * opening words steer content most, and the style picture (when sent) carries the look.
 */
export function compileVideoShot(input: VideoCompileInput): CompileResult {
  const { bible, scene, shot, video } = input;

  const tokensFor = (c: CompileCharacter) => video.characterTokens
    .find((t) => (c.id && t.id ? t.id === c.id : clean(t.name) === clean(c.name)))?.tokens.filter((t) => clean(t) !== '') ?? [];
  const characters = dedupeCharacters(shot.characters);
  const subjects = join([
    ...characters.map((c) => {
      const tokens = tokensFor(c);
      return tokens.length ? describeCharacter({ ...c, name: `${clean(c.name)} (${tokens.join(', ')})` }) : describeCharacter(c);
    }),
    shot.expressionNote,
  ], '; ');

  const action = firstNonEmpty([shot.actionBeat, scene.description]);
  const camera = join([
    phrase('shot_type', shot.shotType),
    phrase('camera_angle', scene.cameraAngle),
    phrase('camera_movement', video.cameraMovement),
    phrase('lens_focal_length', shot.lensFocalLength),
    phrase('depth_of_field', shot.depthOfField),
  ], ', ');
  const placement = clean(shot.subjectPlacement);
  const setting = join([describeLocation(scene.locationName, scene.locationDescription), scene.sceneryDescription, join(shot.propTokens, ', ')], ', ');
  const timeAndWeather = join([phrase('time_of_day', scene.timeOfDay), scene.weather ?? ''], ', ');
  const lighting = firstNonEmpty([shot.lightingOverride ?? '', phrase('lighting_preset', scene.lightingPreset), scene.lighting, scene.locationDefaultLighting, bible.defaultLighting]);
  const mood = phrase('mood_atmosphere', scene.moodAtmosphere);

  const style = firstNonEmpty([scene.styleOverride ?? '', phrase('art_style', bible.artStyle)]);
  const palette = join(bible.colourPalette, ', ');
  const styleReference = clean(video.styleToken) === '' ? '' : `${phrase('video_direction', 'style_reference')} ${clean(video.styleToken)}`;
  const look = join([style, bible.lineTreatment, palette === '' ? '' : `colour palette: ${palette}`, bible.renderQualityTokens, styleReference], ', ');

  const sections = [
    subjects,
    action,
    camera,
    placement,
    setting,
    timeAndWeather,
    lighting,
    mood,
    look,
    clean(shot.userPromptAddendum),
    video.audio ? phrase('video_direction', 'ambient_sound') : '',
    video.negative === 'fold' ? phrase('video_direction', 'keep_out') : '',
  ].map(stripTrailingStops).filter((s) => s !== '');

  const bibleNegative = clean(bible.negativePrompt);
  return {
    prompt: sections.length === 0 ? '' : `${sections.join('. ')}.`,
    negativePrompt: video.negative === 'fold' ? '' : bibleNegative === '' ? STANDARD_NEGATIVE : `${bibleNegative}, ${STANDARD_NEGATIVE}`,
    templateVersion: VIDEO_TEMPLATE_VERSION,
    characterCount: characters.length,
  };
}

// ── Character sheets (Character Studio CS-02, CS-06) ────────────────────────

export const CHARACTER_SHEET_VERSION = 'cs1';

/** CS-02/CS-07: visual identity only. Personality and story never reach a picture prompt. */
export interface CharacterSheetInput {
  /** An `art_style` vocabulary value, or `''`. */
  artStyle: string;
  /** Verbatim style phrase that replaces the art style when non-empty. */
  styleOverride: string;
  lineTreatment: string;
  /** A `reference_view` vocabulary value. */
  view: string;
  character: {
    name: string;
    description: string;
    species: string;
    build: string;
    colours: string;
    features: string;
    /** The named outfit for this sheet (CS-07); identity does not include clothes. */
    costume: string;
  };
  /** Free text for an expression view ("surprised") or a "change this picture" request. */
  note: string;
}

/**
 * Compile a character-sheet prompt: style, the view from the `reference_view` vocabulary, the
 * visual traits, then the child's note. Identity for non-main views comes from the approved
 * anchor picture the caller supplies; nothing here claims the words alone preserve it (CS-06).
 */
export function compileCharacterSheet(input: CharacterSheetInput): { prompt: string; negativePrompt: string; version: string } {
  const style = firstNonEmpty([input.styleOverride, phrase('art_style', input.artStyle)]);
  const stylePrefix = join([style, input.lineTreatment], ', ');
  const c = input.character;
  const traits = join([c.species, c.build, c.colours, c.features], ', ');
  const who = describeCharacter({ name: c.name, description: join([c.description, traits], ', '), costume: c.costume });
  const sections = [stylePrefix, phrase('reference_view', input.view), who, clean(input.note)]
    .map(stripTrailingStops)
    .filter((s) => s !== '');
  return {
    prompt: sections.length === 0 ? '' : `${sections.join('. ')}.`,
    negativePrompt: STANDARD_NEGATIVE,
    version: CHARACTER_SHEET_VERSION,
  };
}
