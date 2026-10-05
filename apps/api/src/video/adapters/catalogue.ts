import type { GenerationModel } from '@storyboard/models';
import type { CreativeVideoRequest } from '../creativeVideoRequest.ts';

/** Recorded on every production snapshot (MG-05): which payload mapping built the request. */
export const ADAPTER_VERSION = 'catalogue-flat-3';

/**
 * CR-03: the prompt a reference endpoint receives, with one line per picture in manifest order
 * ("@Image1: Bunny"). Shared with routing so the length check and review see the same text (MB-06).
 * Only recipes compiled before the video template use this; the template puts tokens inline.
 */
export function promptWithReferenceTokens(model: GenerationModel, prompt: string, names: readonly string[]): string {
  const prefix = model.request_shape.reference_token_prefix;
  if (!prefix || !names.length) return prompt;
  return `${prompt}\n${names.map((name, i) => `${prefix}${i + 1}: ${name}`).join('\n')}`;
}

/** Flat endpoint schemas share an adapter; future nested schemas get a separate adapter. */
export function buildVideoPayload<Image>(model: GenerationModel, creative: CreativeVideoRequest<Image>, toUrl: (image: Image) => string): Record<string, unknown> {
  const s = model.request_shape;
  const body: Record<string, unknown> = { ...s.defaults, [s.prompt]: creative.prompt };
  // MG-03: an input the endpoint cannot take is an error, never silently dropped.
  if (creative.referenceImages.length > model.max_reference_images) throw new Error('Too many character pictures for this model');
  if (creative.referenceImages.length && !s.reference_images) throw new Error('This model cannot use character pictures');
  if (model.capabilities.requires_reference_images && !creative.referenceImages.length) throw new Error('This model needs character pictures');
  if (creative.endFrame && !s.end_frame) throw new Error('This model cannot use an ending picture');
  if (creative.startFrame && !s.start_frame) throw new Error('This model cannot use a starting picture');
  if (creative.endFrame && !creative.startFrame) throw new Error('An ending picture needs a starting picture');
  if (s.negative_prompt && creative.negativePrompt) body[s.negative_prompt] = creative.negativePrompt;
  if (s.reference_images && creative.referenceImages.length) {
    body[s.reference_images] = creative.referenceImages.map(toUrl);
    if (s.reference_token_prefix && creative.referenceNames?.length && !creative.tokensInline) {
      if (creative.referenceNames.length !== creative.referenceImages.length) throw new Error('Character picture names do not match');
      body[s.prompt] = promptWithReferenceTokens(model, creative.prompt, creative.referenceNames);
    }
  }
  if (s.start_frame && creative.startFrame) body[s.start_frame] = toUrl(creative.startFrame);
  if (s.end_frame && creative.endFrame) body[s.end_frame] = toUrl(creative.endFrame);
  if (s.duration && creative.durationSeconds !== null) {
    body[s.duration] = s.duration_format === 'string_seconds' ? String(creative.durationSeconds)
      : s.duration_format === 'string_seconds_suffix' ? `${creative.durationSeconds}s` : creative.durationSeconds;
  }
  if (s.aspect_ratio) body[s.aspect_ratio] = creative.aspectRatio;
  if (s.resolution) body[s.resolution] = creative.resolution;
  if (s.audio) body[s.audio] = creative.audio;
  if (s.safety) body[s.safety] = true;
  if (s.seed && typeof creative.seed === 'number') body[s.seed] = creative.seed;
  const motion = creative.cameraMovement ? model.video?.camera_motion_map?.[creative.cameraMovement] : undefined;
  if (s.camera_motion && motion) body[s.camera_motion] = motion;
  return body;
}
