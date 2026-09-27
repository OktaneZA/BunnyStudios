/**
 * The single authority for generation models (plan D27, DM-1).
 *
 * No application code may name a provider model id. Routes, validators, the job runner
 * and the picker all read from here; adding a model is a JSON edit.
 */
export * from './generated.js';
import { MODELS, type ModelId } from './generated.js';

export type ModelKind = 'image' | 'video';
/** The cost level a child picks for a clip (plan: no model names in Simple mode). */
export type ModelTier = 'low' | 'medium' | 'high';
export type AspectRatio = '16:9' | '9:16' | '1:1';

export interface ModelCapabilities {
  readonly reference_images: boolean;
  /** The endpoint refuses a request with no reference pictures (an edit model). */
  readonly requires_reference_images?: boolean;
  readonly start_frame: boolean;
  readonly end_frame: boolean;
  readonly audio: boolean;
  readonly multi_shot: boolean;
  readonly image_to_video: boolean;
  readonly text_to_video: boolean;
}

export interface DurationRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/**
 * How a generic request maps onto this provider model's input fields. Adapters read this
 * so that a new model with a different field name is a catalogue edit, not code.
 */
export interface RequestShape {
  readonly prompt: string;
  readonly negative_prompt?: string;
  readonly count?: string;
  readonly reference_images?: string;
  readonly start_frame?: string;
  readonly end_frame?: string;
  readonly duration?: string;
  /** 'number' sends 5; 'string_seconds' sends "5"; 'string_seconds_suffix' sends "5s". */
  readonly duration_format?: 'number' | 'string_seconds' | 'string_seconds_suffix';
  readonly aspect_ratio?: string;
  /** 'ratio' sends "16:9"; 'flux_size' sends landscape_16_9 / portrait_16_9 / square_hd. */
  readonly aspect_ratio_format?: 'ratio' | 'flux_size';
  readonly audio?: string;
  readonly resolution?: string;
  readonly safety?: string;
}

export interface ResultShape {
  /** The response field holding the file (or list of files): e.g. "images" or "video". */
  readonly files: string;
}

export interface GenerationModel {
  readonly id: ModelId;
  readonly provider: 'fal' | 'fake';
  readonly provider_model: string;
  readonly kind: ModelKind;
  readonly tier?: ModelTier;
  readonly label: string;
  readonly friendlyLabel: string;
  readonly help: string;
  readonly icon: string;
  readonly capabilities: ModelCapabilities;
  readonly aspect_ratios: readonly AspectRatio[];
  readonly resolutions: readonly string[];
  readonly duration_seconds: DurationRange | null;
  readonly max_reference_images: number;
  readonly max_prompt_length: number;
  readonly unit: 'image' | 'second';
  readonly unit_cost_pence: number;
  readonly request_shape: RequestShape;
  readonly result_shape: ResultShape;
  readonly enabled: boolean;
}

export const ALL_MODELS: readonly GenerationModel[] = MODELS as unknown as readonly GenerationModel[];

export function modelById(id: string): GenerationModel | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

export const TIERS: readonly ModelTier[] = ['low', 'medium', 'high'];

export function modelsOfKind(kind: ModelKind): GenerationModel[] {
  return ALL_MODELS.filter((m) => m.kind === kind);
}

/** Units a request will consume: images for an image model, seconds for a video model. */
export function unitsFor(model: GenerationModel, options: { count?: number; durationSeconds?: number }): number {
  if (model.kind === 'image') return Math.max(1, options.count ?? 1);
  if (model.capabilities.text_to_video && options.durationSeconds && CLIP_LENGTHS.includes(options.durationSeconds)) {
    return clipPlan(model, options.durationSeconds).reduce((sum, seconds) => sum + seconds, 0);
  }
  return Math.max(model.duration_seconds?.min ?? 1, options.durationSeconds ?? model.duration_seconds?.min ?? 1);
}

export const CLIP_LENGTHS: readonly number[] = [5, 10, 15, 30];

/** Minimise paid seconds, then cuts; trim only the final part to the requested length. */
export function clipPlan(model: GenerationModel, target: number): number[] {
  const choices = durationOptions(model);
  if (!choices.length || !Number.isInteger(target) || target < 1 || target > 60) throw new Error('Invalid clip length');
  const limit = target + Math.max(...choices);
  const plans: (number[] | undefined)[] = Array(limit + 1);
  plans[0] = [];
  for (let total = 1; total <= limit; total++) {
    for (const seconds of choices) {
      const previous = plans[total - seconds];
      if (previous && (!plans[total] || previous.length + 1 < plans[total]!.length)) plans[total] = [...previous, seconds];
    }
  }
  for (let total = target; total <= limit; total++) if (plans[total]) return plans[total]!.sort((a, b) => b - a);
  throw new Error('No supported clip length');
}

/** Estimated cost in whole pence, rounded up so the estimate is never below the bill. */
export function estimatePence(model: GenerationModel, options: { count?: number; durationSeconds?: number }): number {
  return Math.ceil(unitsFor(model, options) * model.unit_cost_pence);
}

/** The durations a video model offers, in seconds, from its declared range. */
export function durationOptions(model: GenerationModel): number[] {
  const d = model.duration_seconds;
  if (!d) return [];
  const out: number[] = [];
  for (let s = d.min; s <= d.max; s += d.step) out.push(s);
  return out;
}
