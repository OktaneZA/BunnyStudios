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
  readonly defaults?: Readonly<Record<string, string | number | boolean>>;
  readonly reference_token_prefix?: string;
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
  readonly video?: {
    readonly family: string;
    readonly categories: readonly VideoCategory[];
    readonly audio_mode?: 'optional' | 'always' | 'none';
    readonly final_model_id?: string;
    readonly documentation: string;
    /**
     * Release gate (build plan Stage 1/6). `advanced`: only Advanced accounts can pick it, and
     * Simple-mode routing ignores it, until a real request, bill and the teen policy have been
     * checked (`verified_live`). Absent means the model is in production.
     */
    readonly rollout?: 'production' | 'advanced';
    readonly verified_live?: boolean;
  };
  readonly pricing?: VideoPricing;
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

/** A video endpoint, derived from the shared catalogue rather than a second model list. */
export interface VideoModelDefinition extends GenerationModel {
  readonly kind: 'video';
  readonly duration_seconds: DurationRange;
  readonly unit: 'second';
}

export type VideoCategory = 'recommended' | 'fast' | 'cinematic' | 'references' | 'more';
export const VIDEO_CATEGORIES: readonly { id: VideoCategory; label: string }[] = [
  { id: 'recommended', label: 'Recommended' }, { id: 'fast', label: 'Fast' },
  { id: 'cinematic', label: 'Cinematic' }, { id: 'references', label: 'Character / References' },
  { id: 'more', label: 'More models' },
];

/** Provider USD prices and an explicit budget conversion, never a hidden UI credit rate. */
export interface VideoPricing {
  readonly strategy: 'per_second' | 'per_clip' | 'video_tokens';
  readonly rates: Readonly<Record<string, number>>;
  readonly pixels_per_frame?: Readonly<Record<string, number>>;
  readonly fps?: number;
  readonly pence_per_usd: number;
  readonly verified_on: string;
  readonly source: string;
}

export type VideoTask = 'text-to-video' | 'image-to-video' | 'reference-to-video';

/** Required features, not preferences: an incompatible model must never be a fallback. */
export interface VideoModelRequirements {
  readonly task?: VideoTask;
  readonly tier?: ModelTier;
  readonly startFrame?: boolean;
  readonly endFrame?: boolean;
  readonly referenceImageCount?: number;
  readonly audio?: boolean;
  readonly multiShot?: boolean;
  readonly aspectRatio?: AspectRatio;
  readonly resolution?: string;
  /** Native endpoint duration. Assembly/trim is a separate job-planning decision. */
  readonly nativeDurationSeconds?: number;
}

export interface VideoModelRegistry {
  get(id: string): VideoModelDefinition | undefined;
  /** Includes disabled definitions for inspection; callers decide deployment availability. */
  readonly definitions: readonly VideoModelDefinition[];
  /** Catalogue order is the explicit default priority; there is no hidden cost ranking. */
  matching(requirements?: VideoModelRequirements): VideoModelDefinition[];
}

export function createVideoModelRegistry(models: readonly GenerationModel[]): VideoModelRegistry {
  const definitions: VideoModelDefinition[] = [];
  const byId = new Map<string, VideoModelDefinition>();
  for (const model of models) {
    if (model.kind !== 'video') continue;
    const d = model.duration_seconds;
    if (!d || !Number.isInteger(d.min) || !Number.isInteger(d.max) || !Number.isInteger(d.step)
      || d.min < 1 || d.max < d.min || d.step < 1 || model.unit !== 'second') {
      throw new Error(`Invalid video definition: ${model.id}`);
    }
    if (byId.has(model.id)) throw new Error(`Duplicate video definition: ${model.id}`);
    const definition: VideoModelDefinition = { ...model, kind: 'video', duration_seconds: d, unit: 'second' };
    definitions.push(definition);
    byId.set(model.id, definition);
  }
  return {
    definitions: Object.freeze(definitions),
    get: (id) => byId.get(id),
    matching: (requirements = {}) => definitions.filter((model) => videoModelMatches(model, requirements)),
  };
}

export function videoModelMatches(model: VideoModelDefinition, requirements: VideoModelRequirements): boolean {
  const c = model.capabilities;
  const refs = requirements.referenceImageCount;
  if (refs !== undefined && (!Number.isInteger(refs) || refs < 0)) return false;
  if (requirements.task === 'text-to-video' && (!c.text_to_video || c.requires_reference_images)) return false;
  if (requirements.task === 'image-to-video' && !c.image_to_video) return false;
  if (requirements.task === 'reference-to-video' && !c.reference_images) return false;
  if (requirements.tier && model.tier !== requirements.tier) return false;
  if (requirements.startFrame && !c.start_frame) return false;
  if (requirements.endFrame && !c.end_frame) return false;
  if (refs !== undefined && ((refs > 0 && !c.reference_images) || refs > model.max_reference_images
    || (refs === 0 && c.requires_reference_images))) return false;
  if (requirements.audio && !c.audio) return false;
  if (requirements.multiShot && !c.multi_shot) return false;
  if (requirements.aspectRatio && !model.aspect_ratios.includes(requirements.aspectRatio)) return false;
  if (requirements.resolution && !model.resolutions.includes(requirements.resolution)) return false;
  const seconds = requirements.nativeDurationSeconds;
  if (seconds !== undefined && (!Number.isInteger(seconds) || !durationOptions(model).includes(seconds))) return false;
  return true;
}

export const VIDEO_MODEL_REGISTRY = createVideoModelRegistry(ALL_MODELS);

export function modelById(id: string): GenerationModel | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

export const TIERS: readonly ModelTier[] = ['low', 'medium', 'high'];

export function modelsOfKind(kind: ModelKind): GenerationModel[] {
  return ALL_MODELS.filter((m) => m.kind === kind);
}

/** Units a request will consume: images for an image model, seconds for a video model. */
export function unitsFor(model: GenerationModel, options: { count?: number; durationSeconds?: number; native?: boolean }): number {
  if (model.kind === 'image') return Math.max(1, options.count ?? 1);
  if (!options.native && model.capabilities.text_to_video && options.durationSeconds && CLIP_LENGTHS.includes(options.durationSeconds)) {
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

export interface QuoteOptions {
  count?: number;
  durationSeconds?: number;
  resolution?: string;
  /** Plan the clip as one native generation, never as joined parts (reference/frame tasks). */
  native?: boolean;
  referenceCount?: number;
}

/**
 * MB-02: how an estimate was made, stored on the ledger row with the reservation. The budget
 * conversion is a configured policy, never a live exchange rate, and the estimate is not a bill.
 */
export interface PricingSnapshot {
  readonly model_id: string;
  readonly strategy: 'per_second' | 'per_clip' | 'video_tokens' | 'catalogue_unit';
  readonly provider_currency: 'USD' | 'GBP';
  /** Provider-currency amount before conversion (USD), or pence for catalogue unit prices. */
  readonly provider_amount: number;
  readonly rate_key: string | null;
  readonly rate: number;
  readonly resolution: string | null;
  readonly parts: readonly number[];
  readonly generated_seconds: number | null;
  readonly units: number;
  readonly reference_count: number;
  readonly source: string | null;
  readonly verified_on: string | null;
  readonly conversion: { readonly policy: 'budget_policy'; readonly pence_per_usd: number } | null;
  readonly estimated_pence: number;
}

export interface Quote {
  readonly pence: number;
  readonly parts: readonly number[] | null;
  readonly snapshot: PricingSnapshot;
}

/**
 * MB-01: the one quote calculation. The price shown to the user and the amount reserved in the
 * job's transaction both come from here, so they cannot drift apart.
 */
export function quoteGeneration(model: GenerationModel, options: QuoteOptions): Quote {
  const pricing = model.pricing;
  const referenceCount = options.referenceCount ?? 0;
  if (pricing) {
    const resolution = options.resolution ?? model.resolutions[0]!;
    if (!model.resolutions.includes(resolution)) throw new Error('Unsupported pricing resolution');
    const target = options.durationSeconds ?? model.duration_seconds!.min;
    const parts = !options.native && model.capabilities.text_to_video && CLIP_LENGTHS.includes(target) ? clipPlan(model, target) : [target];
    if (parts.some((seconds) => !durationOptions(model).includes(seconds))) throw new Error('Unsupported pricing duration');
    let rate = 0;
    const usd = parts.reduce((total, seconds) => {
      const r = pricing.rates[pricing.strategy === 'per_clip' ? String(seconds) : resolution];
      if (r === undefined) throw new Error('Missing model price');
      rate = r;
      if (pricing.strategy === 'per_clip') return total + r;
      if (pricing.strategy === 'per_second') return total + seconds * r;
      const area = pricing.pixels_per_frame?.[resolution];
      if (!area || !pricing.fps) throw new Error('Missing video token dimensions');
      return total + area * seconds * pricing.fps / 1024 / 1000 * r;
    }, 0);
    const pence = Math.ceil(Number((usd * pricing.pence_per_usd).toFixed(8)));
    const generated = parts.reduce((a, b) => a + b, 0);
    return {
      pence, parts: model.kind === 'video' ? parts : null,
      snapshot: {
        model_id: model.id, strategy: pricing.strategy, provider_currency: 'USD', provider_amount: Number(usd.toFixed(6)),
        rate_key: pricing.strategy === 'per_clip' ? parts.map(String).join('+') : resolution, rate, resolution, parts, generated_seconds: generated,
        units: generated, reference_count: referenceCount, source: pricing.source, verified_on: pricing.verified_on,
        conversion: { policy: 'budget_policy', pence_per_usd: pricing.pence_per_usd }, estimated_pence: pence,
      },
    };
  }
  const units = unitsFor(model, options);
  const parts = model.kind === 'video' && !options.native && model.capabilities.text_to_video && options.durationSeconds && CLIP_LENGTHS.includes(options.durationSeconds)
    ? clipPlan(model, options.durationSeconds) : model.kind === 'video' ? [units] : null;
  const pence = Math.ceil(units * model.unit_cost_pence);
  return {
    pence, parts,
    snapshot: {
      model_id: model.id, strategy: 'catalogue_unit', provider_currency: 'GBP', provider_amount: pence, rate_key: model.unit, rate: model.unit_cost_pence,
      resolution: options.resolution ?? null, parts: parts ?? [], generated_seconds: model.kind === 'video' ? units : null, units,
      reference_count: referenceCount, source: null, verified_on: null, conversion: null, estimated_pence: pence,
    },
  };
}

/** Estimated cost in whole pence, rounded up so the estimate is never below the bill. */
export function estimatePence(model: GenerationModel, options: QuoteOptions): number {
  return quoteGeneration(model, options).pence;
}

/** The durations a video model offers, in seconds, from its declared range. */
export function durationOptions(model: GenerationModel): number[] {
  const d = model.duration_seconds;
  if (!d) return [];
  const out: number[] = [];
  for (let s = d.min; s <= d.max; s += d.step) out.push(s);
  return out;
}
