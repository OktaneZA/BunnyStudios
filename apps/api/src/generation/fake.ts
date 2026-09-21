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
  id: 'move_maker', provider: 'fake', provider_model: 'fake/video', kind: 'video', label: 'Fake video', friendlyLabel: 'Move Maker', help: '', icon: 'model-video',
  capabilities: { reference_images: false, start_frame: true, end_frame: false, audio: true, multi_shot: false, image_to_video: true, text_to_video: false },
  aspect_ratios: ['16:9', '9:16'], resolutions: ['720p'], duration_seconds: { min: 5, max: 10, step: 5 }, max_reference_images: 0, max_prompt_length: 2000,
  unit: 'second', unit_cost_pence: 20, request_shape: { prompt: 'prompt', start_frame: 'image_url', duration: 'duration', duration_format: 'string_seconds', audio: 'generate_audio' }, result_shape: { files: 'video' }, enabled: true,
};
