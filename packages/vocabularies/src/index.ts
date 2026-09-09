/**
 * The single authority for controlled vocabularies (requirements §4, CV-1).
 *
 * Nothing anywhere else in the codebase may hard-code a prompt phrase. The compiler,
 * the API validators and the UI pickers all read from here.
 */
export * from './generated.js';

import {
  SHOT_TYPE,
  CAMERA_ANGLE,
  LENS_FOCAL_LENGTH,
  DEPTH_OF_FIELD,
  LIGHTING_PRESET,
  TIME_OF_DAY,
  ART_STYLE,
  MOOD_ATMOSPHERE,
  MUSIC_GENRE,
} from './generated.js';

/** An option that is injected into compiled prompts. */
export interface PromptOption {
  readonly value: string;
  readonly prompt_phrase: string;
  /** True only for values that deliberately emit nothing, e.g. time_of_day `unspecified` (§4.6). */
  readonly emitsNothing?: boolean;
  readonly label: string;
  /** Plain-English label shown in Simple mode (plan D12). */
  readonly friendlyLabel: string;
  /** One line explaining why you would choose this, for a young user (plan D12). */
  readonly help: string;
  /** Key into the picker diagram set (plan D12). */
  readonly icon: string;
}

/** An option that never reaches an image prompt, e.g. music genre (§4.9). */
export interface NonPromptOption {
  readonly value: string;
  readonly label: string;
  readonly friendlyLabel: string;
  readonly icon: string;
}

export const PROMPT_VOCABULARIES = {
  shot_type: SHOT_TYPE,
  camera_angle: CAMERA_ANGLE,
  lens_focal_length: LENS_FOCAL_LENGTH,
  depth_of_field: DEPTH_OF_FIELD,
  lighting_preset: LIGHTING_PRESET,
  time_of_day: TIME_OF_DAY,
  art_style: ART_STYLE,
  mood_atmosphere: MOOD_ATMOSPHERE,
} as const satisfies Record<string, readonly PromptOption[]>;

export const NON_PROMPT_VOCABULARIES = {
  music_genre: MUSIC_GENRE,
} as const satisfies Record<string, readonly NonPromptOption[]>;

export type PromptVocabularyName = keyof typeof PROMPT_VOCABULARIES;

/**
 * Resolve an enum value to the exact phrase that goes into a compiled prompt.
 *
 * Returns `''` for values that deliberately emit nothing (time_of_day `unspecified`), and for
 * null/undefined — an unset optional field contributes no text. Throws on a value that is not in
 * the vocabulary at all, because that is a bug rather than an empty field: silently dropping it
 * would produce a quietly wrong prompt, which is exactly what P2 (continuity is the product)
 * cannot tolerate.
 */
export function promptPhrase(
  vocabulary: PromptVocabularyName,
  value: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return '';
  const options: readonly PromptOption[] = PROMPT_VOCABULARIES[vocabulary];
  const match = options.find((o) => o.value === value);
  if (match === undefined) {
    throw new Error(`Unknown ${vocabulary} value: ${JSON.stringify(value)}`);
  }
  return match.prompt_phrase;
}

/** Look up a full option record, for rendering a picker card. */
export function option(
  vocabulary: PromptVocabularyName,
  value: string,
): PromptOption | undefined {
  const options: readonly PromptOption[] = PROMPT_VOCABULARIES[vocabulary];
  return options.find((o) => o.value === value);
}

/** Every valid value for a vocabulary — used by API validators and DB enum generation. */
export function values(vocabulary: PromptVocabularyName): readonly string[] {
  return PROMPT_VOCABULARIES[vocabulary].map((o) => o.value);
}
