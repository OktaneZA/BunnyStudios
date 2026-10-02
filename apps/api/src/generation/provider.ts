/**
 * The generation provider seam (requirements GP-1, plan D27/D28).
 *
 * One interface, several adapters, one data-driven catalogue. A request is generic; the
 * adapter maps it onto the provider model's input fields using the catalogue's
 * `request_shape`, so a new model is usually a JSON edit and never a domain change.
 *
 * Adapters never reflect upstream response bodies into errors: those may contain request
 * content or credential details. They throw ProviderError with a user-safe message and a
 * stable code the runner uses to decide whether to retry.
 */
import type { GenerationModel } from '@storyboard/models';
import { buildVideoPayload } from '../video/adapters/catalogue.ts';

export interface BinaryImage {
  bytes: Buffer;
  mimeType: string;
}

export interface GenerationRequest {
  model: GenerationModel;
  prompt: string;
  negativePrompt: string;
  /** Main pictures of the cast in the scene, already truncated to the model's limit. */
  referenceImages: BinaryImage[];
  referenceNames?: string[];
  endFrame?: BinaryImage | null;
  /** The picked picture a clip starts from (video models with start_frame). */
  startFrame: BinaryImage | null;
  aspectRatio: '16:9' | '9:16' | '1:1';
  /** Images per request (image models). */
  count: number;
  /** Clip length (video models). */
  durationSeconds: number | null;
  /** Ask the model for its own sound track (video models with audio). */
  audio: boolean;
  resolution: string;
  /** Strictest provider-side safety setting for the teen account (plan D32 gate 2). */
  strictSafety: boolean;
  /** Video only: see CreativeVideoRequest. */
  seed?: number | null;
  cameraMovement?: string | null;
  tokensInline?: boolean;
}

export type ProviderJobStatus =
  | { state: 'queued'; position?: number }
  | { state: 'running' }
  | { state: 'completed' }
  | { state: 'failed'; message: string };

export interface ProviderFile {
  /** Where to fetch the bytes from. May be a data: URL from a fake provider. */
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Set on the first file of a result when the provider reports a seed or a draft id. */
  meta?: ProviderResultMeta;
}

export interface ProviderError extends Error {
  code: 'unavailable' | 'rejected' | 'invalid' | 'auth' | 'timeout';
  /**
   * MG-07: true only when the provider answered and definitely did not accept the request
   * (a 4xx, a 429). A network failure, a timeout or a 5xx on submit is ambiguous: the request
   * may have been accepted and billed, so the runner must not resubmit it blind.
   */
  notAccepted?: boolean;
}

export function providerError(code: ProviderError['code'], message: string, notAccepted = false): ProviderError {
  const error = new Error(message) as ProviderError;
  error.name = 'ProviderError';
  error.code = code;
  if (notAccepted) error.notAccepted = true;
  return error;
}

/** Provider metadata kept for lineage (MG-05, DF-04). Never shown to the child. */
export interface ProviderResultMeta {
  seed?: number;
  draftId?: string;
  /** What a provider's prompt rewriter actually used, when it reports it. Adults only, for diagnosis. */
  expandedPrompt?: string;
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof Error && error.name === 'ProviderError';
}

export interface GenerationProvider {
  readonly name: string;
  /** False when the adapter's key is not configured; its models are hidden. */
  readonly enabled: boolean;
  submit(request: GenerationRequest, signal: AbortSignal): Promise<{ providerJobId: string }>;
  poll(providerJobId: string, model: GenerationModel, signal: AbortSignal): Promise<ProviderJobStatus>;
  fetchResult(providerJobId: string, model: GenerationModel, signal: AbortSignal): Promise<ProviderFile[]>;
  cancel(providerJobId: string, model: GenerationModel, signal: AbortSignal): Promise<void>;
  /** Downloads a result file. Kept on the adapter so it can add auth headers if needed. */
  download(file: ProviderFile, signal: AbortSignal): Promise<Buffer>;
}

/** Convert a request into the provider's input object using the catalogue's request_shape. */
export function shapeRequest(request: GenerationRequest, toUrl: (image: BinaryImage) => string): Record<string, unknown> {
  if (request.model.kind === 'video') return buildVideoPayload(request.model, request, toUrl);
  const s = request.model.request_shape;
  const body: Record<string, unknown> = { [s.prompt]: request.prompt };
  if (s.negative_prompt && request.negativePrompt) body[s.negative_prompt] = request.negativePrompt;
  if (s.count) body[s.count] = request.count;
  if (s.reference_images && request.referenceImages.length) body[s.reference_images] = request.referenceImages.map(toUrl);
  if (s.start_frame && request.startFrame) body[s.start_frame] = toUrl(request.startFrame);
  if (s.duration && request.durationSeconds !== null) {
    const d = request.durationSeconds;
    body[s.duration] = s.duration_format === 'string_seconds' ? String(d) : s.duration_format === 'string_seconds_suffix' ? `${d}s` : d;
  }
  if (s.aspect_ratio) {
    body[s.aspect_ratio] = s.aspect_ratio_format === 'flux_size'
      ? ({ '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '1:1': 'square_hd' } as const)[request.aspectRatio]
      : request.aspectRatio;
  }
  if (s.audio) body[s.audio] = request.audio;
  if (s.resolution) body[s.resolution] = request.resolution;
  if (s.safety) body[s.safety] = true;
  return body;
}

/** Read the result files out of a provider response using the catalogue's result_shape. */
export function shapeResult(model: GenerationModel, response: unknown): ProviderFile[] {
  const field = (response as Record<string, unknown> | null)?.[model.result_shape.files];
  const list = Array.isArray(field) ? field : field ? [field] : [];
  const files: ProviderFile[] = [];
  for (const item of list) {
    const f = item as Record<string, unknown>;
    if (typeof f?.url !== 'string') continue;
    const file: ProviderFile = { url: f.url, mimeType: typeof f.content_type === 'string' ? f.content_type : model.kind === 'video' ? 'video/mp4' : 'image/png' };
    if (typeof f.width === 'number') file.width = f.width;
    if (typeof f.height === 'number') file.height = f.height;
    if (typeof f.duration === 'number') file.durationMs = Math.round(f.duration * 1000);
    files.push(file);
  }
  const root = response as Record<string, unknown> | null;
  const meta: ProviderResultMeta = {};
  if (typeof root?.seed === 'number') meta.seed = root.seed;
  if (typeof root?.draft_id === 'string' && root.draft_id) meta.draftId = root.draft_id;
  const expanded = root?.expanded_prompt ?? root?.actual_prompt;
  if (typeof expanded === 'string' && expanded) meta.expandedPrompt = expanded.slice(0, 4000);
  if (files[0] && (meta.seed !== undefined || meta.draftId || meta.expandedPrompt)) files[0].meta = meta;
  return files;
}
