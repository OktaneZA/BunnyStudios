/**
 * The fal.ai adapter (plan D27/D28) over its queue REST API.
 *
 *   POST https://queue.fal.run/{provider_model}                       -> { request_id, ... }
 *   GET  https://queue.fal.run/{app_id}/requests/{id}/status          -> { status, queue_position? }
 *   GET  https://queue.fal.run/{app_id}/requests/{id}                 -> the model's output object
 *   PUT  https://queue.fal.run/{app_id}/requests/{id}/cancel
 *
 * `app_id` is the first two path segments of the provider model, so a namespaced model such
 * as `fal-ai/kling-video/v2.1/standard/image-to-video` polls at `fal-ai/kling-video/requests/…`.
 *
 * Upstream response bodies are never reflected into error messages (they may echo the prompt,
 * reference-image data or the key). Every failure is a ProviderError with a user-safe message
 * written for the teenager and a stable code the runner uses to decide whether to retry.
 */
import type { GenerationModel } from '@storyboard/models';
import {
  providerError, shapeRequest, shapeResult,
  type BinaryImage, type GenerationProvider, type ProviderFile, type ProviderJobStatus,
} from './provider.ts';

export const FAL_QUEUE_BASE = 'https://queue.fal.run';

const MESSAGES = {
  disabled: 'The picture maker is not switched on yet. Ask a grown-up to add its key.',
  auth: 'The picture maker needs its key checked by a grown-up.',
  invalid: 'The picture maker could not use this request. Try a simpler wording.',
  busy: 'The picture maker is busy. Please try again in a minute.',
  rejected: 'The picture maker would not make this one. Try different wording.',
  empty: 'The picture maker finished but sent nothing back. Try again with different wording.',
  unknownJob: 'That request is no longer known to the picture maker.',
} as const;

export interface FalSettings {
  apiKey: string;
}

/** The queue app id fal routes status, result and cancel calls through. */
export function falAppId(providerModel: string): string {
  const segments = providerModel.split('/').filter(Boolean);
  return segments.slice(0, 2).join('/');
}

export function falUrls(model: GenerationModel, requestId: string) {
  const app = `${FAL_QUEUE_BASE}/${falAppId(model.provider_model)}/requests/${encodeURIComponent(requestId)}`;
  return {
    submit: `${FAL_QUEUE_BASE}/${model.provider_model}`,
    status: `${app}/status`,
    result: app,
    cancel: `${app}/cancel`,
  };
}

/** fal accepts data URIs wherever it takes an image URL, so no upload step is needed. */
export function imageToDataUrl(image: BinaryImage): string {
  return `data:${image.mimeType};base64,${image.bytes.toString('base64')}`;
}

/** True when a 4xx body looks like a content-policy refusal. Reads the shape, never the text. */
function looksLikePolicyRejection(body: unknown): boolean {
  const detail = (body as { detail?: unknown } | null)?.detail;
  const texts: string[] = [];
  if (typeof detail === 'string') texts.push(detail);
  else if (Array.isArray(detail)) {
    for (const item of detail) {
      if (typeof item === 'string') texts.push(item);
      else if (item && typeof item === 'object') {
        const { msg, type } = item as { msg?: unknown; type?: unknown };
        if (typeof msg === 'string') texts.push(msg);
        if (typeof type === 'string') texts.push(type);
      }
    }
  }
  return texts.some((t) => /content|safety|nsfw|policy|moderat/i.test(t));
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

export function createFalProvider(
  settings: FalSettings = { apiKey: process.env.FAL_KEY ?? '' },
  fetcher: typeof fetch = fetch,
): GenerationProvider {
  const apiKey = settings.apiKey.trim();
  const enabled = apiKey.length > 0;

  function requireEnabled() {
    if (!enabled) throw providerError('unavailable', MESSAGES.disabled, true);
  }

  /** Performs one request and maps every failure class onto a ProviderError. */
  async function call(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init, signal,
        headers: { Accept: 'application/json', Authorization: `Key ${apiKey}`, ...(init.headers ?? {}) },
      });
    } catch {
      if (signal.aborted) throw providerError('timeout', MESSAGES.busy);
      throw providerError('unavailable', MESSAGES.busy);
    }
    if (response.ok) return response;
    const status = response.status;
    // A 4xx is fal answering "no": nothing was accepted, so nothing can be billed (MG-07).
    if (status === 401 || status === 403) throw providerError('auth', MESSAGES.auth, true);
    if (status === 400 || status === 422) {
      const body = await readJson(response);
      // Server log only, never a user message: the detail names the field the catalogue got wrong.
      console.warn(`[fal] ${status} validation detail: ${JSON.stringify((body as { detail?: unknown })?.detail ?? body).slice(0, 600)}`);
      if (looksLikePolicyRejection(body)) throw providerError('rejected', MESSAGES.rejected, true);
      throw providerError('invalid', MESSAGES.invalid, true);
    }
    if (status === 404) throw providerError('invalid', MESSAGES.unknownJob, true);
    if (status === 429) throw providerError('unavailable', MESSAGES.busy, true);
    // 5xx and anything unexpected: the runner may retry later, but on submit it is ambiguous.
    throw providerError('unavailable', MESSAGES.busy);
  }

  return {
    name: 'fal',
    enabled,

    async submit(request, signal) {
      requireEnabled();
      const body = shapeRequest(request, imageToDataUrl);
      const response = await call(falUrls(request.model, '').submit, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }, signal);
      const json = await readJson(response) as { request_id?: unknown } | null;
      if (typeof json?.request_id !== 'string' || !json.request_id) throw providerError('unavailable', MESSAGES.busy);
      return { providerJobId: json.request_id };
    },

    async poll(providerJobId, model, signal): Promise<ProviderJobStatus> {
      requireEnabled();
      const response = await call(falUrls(model, providerJobId).status, { method: 'GET' }, signal);
      const json = await readJson(response) as { status?: unknown; queue_position?: unknown } | null;
      switch (json?.status) {
        case 'IN_QUEUE':
          return typeof json.queue_position === 'number' ? { state: 'queued', position: json.queue_position } : { state: 'queued' };
        case 'IN_PROGRESS':
          return { state: 'running' };
        case 'COMPLETED':
          return { state: 'completed' };
        default:
          throw providerError('unavailable', MESSAGES.busy);
      }
    },

    async fetchResult(providerJobId, model, signal): Promise<ProviderFile[]> {
      requireEnabled();
      const response = await call(falUrls(model, providerJobId).result, { method: 'GET' }, signal);
      const files = shapeResult(model, await readJson(response));
      if (files.length === 0) throw providerError('invalid', MESSAGES.empty);
      return files;
    },

    async cancel(providerJobId, model, signal) {
      requireEnabled();
      try {
        await call(falUrls(model, providerJobId).cancel, { method: 'PUT' }, signal);
      } catch (error) {
        // A job that already finished cannot be cancelled; that is not a failure for the caller.
        if ((error as { code?: string }).code === 'invalid') return;
        throw error;
      }
    },

    async download(file, signal) {
      if (file.url.startsWith('data:')) {
        const comma = file.url.indexOf(',');
        if (comma < 0) throw providerError('invalid', MESSAGES.empty);
        const head = file.url.slice(0, comma);
        const payload = file.url.slice(comma + 1);
        return /;base64$/i.test(head) ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
      }
      requireEnabled();
      let response: Response;
      try {
        // Result files live on fal's CDN and need no key; never send it to a third-party host.
        response = await fetcher(file.url, { method: 'GET', signal });
      } catch {
        if (signal.aborted) throw providerError('timeout', MESSAGES.busy);
        throw providerError('unavailable', MESSAGES.busy);
      }
      if (!response.ok) throw providerError('unavailable', MESSAGES.busy);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
