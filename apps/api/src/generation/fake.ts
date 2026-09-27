/**
 * A controllable in-memory provider for tests and for local development without a key.
 * Produces tiny real PNGs (and a minimal MP4 stand-in) as data: URLs so the whole pipeline,
 * including download, storage and poster extraction, runs end to end with no network.
 */
import { randomUUID } from 'node:crypto';
import type { GenerationModel } from '@storyboard/models';
import { providerError, type GenerationProvider, type GenerationRequest, type ProviderFile, type ProviderJobStatus } from './provider.ts';

/** 1x1 opaque PNG. */
export const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

export interface FakeJob {
  request: GenerationRequest;
  status: ProviderJobStatus;
  files: ProviderFile[];
}

export interface FakeProviderOptions {
  /** Called on submit; return files to complete immediately, or throw to fail submission. */
  onSubmit?: (request: GenerationRequest) => ProviderFile[] | Promise<ProviderFile[]>;
  /** Number of polls a job stays queued/running before completing. */
  pollsBeforeDone?: number;
  /** Optional byte source for downloads; defaults to TINY_PNG or a small MP4 stub. */
  bytesFor?: (file: ProviderFile) => Buffer | Promise<Buffer>;
}

export function createFakeProvider(options: FakeProviderOptions = {}) {
  const jobs = new Map<string, FakeJob & { polls: number }>();
  const submitted: GenerationRequest[] = [];
  const cancelled: string[] = [];
  const provider: GenerationProvider & { jobs: typeof jobs; submitted: typeof submitted; cancelled: typeof cancelled; enabled: boolean } = {
    name: 'fake',
    enabled: true,
    jobs, submitted, cancelled,
    async submit(request) {
      submitted.push(request);
      const files = options.onSubmit ? await options.onSubmit(request) : defaultFiles(request);
      const id = randomUUID();
      jobs.set(id, { request, status: { state: 'queued' }, files, polls: 0 });
      return { providerJobId: id };
    },
    async poll(id) {
      const job = jobs.get(id);
      if (!job) throw providerError('invalid', 'That request is no longer known to the picture maker.');
      job.polls += 1;
      if (job.status.state === 'failed') return job.status;
      const limit = options.pollsBeforeDone ?? 0;
      job.status = job.polls > limit ? { state: 'completed' } : job.polls === limit ? { state: 'running' } : { state: 'queued' };
      return job.status;
    },
    async fetchResult(id) {
      const job = jobs.get(id);
      if (!job) throw providerError('invalid', 'That request is no longer known to the picture maker.');
      return job.files;
    },
    async cancel(id) { cancelled.push(id); jobs.delete(id); },
    async download(file) {
      if (options.bytesFor) return await options.bytesFor(file);
      if (file.url.startsWith('data:')) return Buffer.from(file.url.slice(file.url.indexOf(',') + 1), 'base64');
      return file.mimeType.startsWith('video/') ? Buffer.alloc(0) : TINY_PNG;
    },
  };
  return provider;
}

export function fakeImageFile(): ProviderFile {
  return { url: `data:image/png;base64,${TINY_PNG.toString('base64')}`, mimeType: 'image/png', width: 1, height: 1 };
}

function defaultFiles(request: GenerationRequest): ProviderFile[] {
  if (request.model.kind === 'video') {
    return [{ url: 'fake://video', mimeType: 'video/mp4', width: 1280, height: 720, durationMs: (request.durationSeconds ?? 5) * 1000 }];
  }
  return Array.from({ length: request.count }, () => fakeImageFile());
}

/** The fake catalogue entry used by tests so no real provider model id is ever needed. */
export const FAKE_IMAGE_MODEL: GenerationModel = {
  id: 'quick_picture', provider: 'fake', provider_model: 'fake/image', kind: 'image', label: 'Fake image', friendlyLabel: 'Quick Picture', help: '', icon: 'model-image',
  capabilities: { reference_images: true, start_frame: false, end_frame: false, audio: false, multi_shot: false, image_to_video: false, text_to_video: false },
  aspect_ratios: ['16:9', '9:16', '1:1'], resolutions: ['1024'], duration_seconds: null, max_reference_images: 2, max_prompt_length: 2000,
  unit: 'image', unit_cost_pence: 5, request_shape: { prompt: 'prompt', count: 'num_images', reference_images: 'image_urls' }, result_shape: { files: 'images' }, enabled: true,
};
export const FAKE_VIDEO_MODEL: GenerationModel = {
  id: 'clip_low', provider: 'fake', provider_model: 'fake/video', kind: 'video', tier: 'low', label: 'Fake video', friendlyLabel: 'Low cost', help: '', icon: 'model-video',
  capabilities: { reference_images: false, start_frame: false, end_frame: false, audio: false, multi_shot: false, image_to_video: false, text_to_video: true },
  aspect_ratios: ['16:9', '9:16'], resolutions: ['720p'], duration_seconds: { min: 5, max: 10, step: 5 }, max_reference_images: 0, max_prompt_length: 2000,
  unit: 'second', unit_cost_pence: 2, request_shape: { prompt: 'prompt', duration: 'duration', duration_format: 'string_seconds' }, result_shape: { files: 'video' }, enabled: true,
};
export const FAKE_VIDEO_HIGH_MODEL: GenerationModel = {
  id: 'clip_high', provider: 'fake', provider_model: 'fake/video-high', kind: 'video', tier: 'high', label: 'Fake video high', friendlyLabel: 'High', help: '', icon: 'model-video',
  capabilities: { reference_images: false, start_frame: false, end_frame: false, audio: true, multi_shot: false, image_to_video: false, text_to_video: true },
  aspect_ratios: ['16:9', '9:16'], resolutions: ['720p'], duration_seconds: { min: 4, max: 8, step: 2 }, max_reference_images: 0, max_prompt_length: 2000,
  unit: 'second', unit_cost_pence: 20, request_shape: { prompt: 'prompt', duration: 'duration', duration_format: 'string_seconds_suffix', audio: 'generate_audio' }, result_shape: { files: 'video' }, enabled: true,
};
export const FAKE_VIDEO_MEDIUM_MODEL: GenerationModel = {
  ...FAKE_VIDEO_MODEL, id: 'clip_medium', provider_model: 'fake/video-medium', tier: 'medium',
  label: 'Fake video medium', friendlyLabel: 'Medium', unit_cost_pence: 4,
  duration_seconds: { min: 6, max: 10, step: 4 },
};
/** Development fake of a reference-to-video endpoint (Seedance-like), for clips with characters. */
export const FAKE_REF_VIDEO_MODEL: GenerationModel = {
  id: 'seedance_25_refs', provider: 'fake', provider_model: 'fake/refs', kind: 'video', tier: 'high', label: 'Fake reference video', friendlyLabel: 'With your characters', help: 'Uses the chosen pictures of the characters.', icon: 'model-video',
  capabilities: { reference_images: true, requires_reference_images: true, start_frame: false, end_frame: false, audio: true, multi_shot: false, image_to_video: false, text_to_video: false },
  aspect_ratios: ['16:9', '9:16'], resolutions: ['720p'], duration_seconds: { min: 4, max: 30, step: 1 }, max_reference_images: 6, max_prompt_length: 2000,
  unit: 'second', unit_cost_pence: 5, request_shape: { prompt: 'prompt', reference_images: 'image_urls', reference_token_prefix: '@Image', duration: 'duration', duration_format: 'string_seconds', audio: 'generate_audio' },
  result_shape: { files: 'video' }, enabled: true, video: { family: 'fake_refs', categories: ['recommended', 'references'], documentation: 'development fake' },
};
/** Development fake of a start/end-picture endpoint (Seedance image-to-video-like). */
export const FAKE_FRAMES_MODEL: GenerationModel = {
  ...FAKE_REF_VIDEO_MODEL, id: 'seedance_25_i2v', provider_model: 'fake/i2v', label: 'Fake start/end video', friendlyLabel: 'From a picture', help: 'Starts from a picture.', max_reference_images: 0,
  capabilities: { reference_images: false, start_frame: true, end_frame: true, audio: true, multi_shot: false, image_to_video: true, text_to_video: false },
  request_shape: { prompt: 'prompt', start_frame: 'image_url', end_frame: 'end_image_url', duration: 'duration', duration_format: 'string_seconds', audio: 'generate_audio' },
  video: { family: 'fake_frames', categories: ['recommended'], documentation: 'development fake' },
};
/** An image-to-video model kept for the Advanced path, so the start-frame code still has a test. */
export const FAKE_I2V_MODEL: GenerationModel = {
  id: 'move_maker', provider: 'fake', provider_model: 'fake/video', kind: 'video', tier: 'medium', label: 'Fake i2v', friendlyLabel: 'Move Maker', help: '', icon: 'model-video',
  capabilities: { reference_images: false, start_frame: true, end_frame: false, audio: true, multi_shot: false, image_to_video: true, text_to_video: false },
  aspect_ratios: ['16:9', '9:16'], resolutions: ['720p'], duration_seconds: { min: 5, max: 10, step: 5 }, max_reference_images: 0, max_prompt_length: 2000,
  unit: 'second', unit_cost_pence: 20, request_shape: { prompt: 'prompt', start_frame: 'image_url', duration: 'duration', duration_format: 'string_seconds', audio: 'generate_audio' }, result_shape: { files: 'video' }, enabled: true,
};
