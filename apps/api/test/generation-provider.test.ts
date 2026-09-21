/**
 * Contract tests for the generation provider seam (GP-1). No database, no app: each adapter is
 * driven through a scripted `fetch`, so the suite runs anywhere and never touches fal.ai.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { GenerationModel } from '@storyboard/models';
import { isProviderError, type GenerationProvider, type GenerationRequest, type ProviderError } from '../src/generation/provider.ts';
import { createFakeProvider, FAKE_IMAGE_MODEL, FAKE_I2V_MODEL as FAKE_VIDEO_MODEL, TINY_PNG } from '../src/generation/fake.ts';
import { createFalProvider, falAppId, falUrls } from '../src/generation/fal.ts';

const signal = () => new AbortController().signal;

const PNG_DATA_URL = `data:image/png;base64,${TINY_PNG.toString('base64')}`;

function imageRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    model: FAKE_IMAGE_MODEL, prompt: 'a rabbit on a bicycle', negativePrompt: '',
    referenceImages: [{ bytes: TINY_PNG, mimeType: 'image/png' }, { bytes: Buffer.from('jpeg-bytes'), mimeType: 'image/jpeg' }],
    startFrame: null, aspectRatio: '16:9', count: 2, durationSeconds: null, audio: false, resolution: '1024', strictSafety: true,
    ...overrides,
  };
}

function videoRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    model: FAKE_VIDEO_MODEL, prompt: 'the rabbit pedals away', negativePrompt: '',
    referenceImages: [], startFrame: { bytes: TINY_PNG, mimeType: 'image/png' },
    aspectRatio: '16:9', count: 1, durationSeconds: 5, audio: true, resolution: '720p', strictSafety: true,
    ...overrides,
  };
}

/** Kling-style namespaced id: the queue app id is only the first two segments. */
const NAMESPACED_VIDEO_MODEL: GenerationModel = { ...FAKE_VIDEO_MODEL, provider: 'fal', provider_model: 'fal-ai/kling-video/v2.1/standard/image-to-video' };

interface RecordedRequest { method: string; url: string; headers: Headers; body: unknown }

/**
 * A scripted fetch. `script` maps a method+URL pattern to a response factory; unmatched
 * requests fail the test loudly. Every request is recorded for assertions.
 */
function scriptedFetch(script: Array<[method: string, pattern: RegExp | string, reply: (req: RecordedRequest) => Response]>) {
  const requests: RecordedRequest[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const req: RecordedRequest = { method, url, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    requests.push(req);
    const match = script.find(([m, p]) => m === method && (typeof p === 'string' ? p === url : p.test(url)));
    if (!match) throw new Error(`unscripted ${method} ${url}`);
    return match[2](req);
  };
  return { fetcher, requests };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A minimal in-memory fal queue: accepts any submit, completes after `pollsBeforeDone` status
 * checks, and answers results in the shape the catalogue's result_shape expects.
 */
function fakeFalServer(pollsBeforeDone = 1) {
  const polls = new Map<string, number>();
  let nextId = 0;
  return scriptedFetch([
    ['POST', /^https:\/\/queue\.fal\.run\/[^/]+\/[^/]+(\/|$)/, () => {
      const id = `req-${++nextId}`;
      polls.set(id, 0);
      return json({ request_id: id, status_url: '', response_url: '', cancel_url: '' });
    }],
    ['GET', /\/requests\/([^/]+)\/status$/, (req) => {
      const id = /\/requests\/([^/]+)\/status$/.exec(req.url)?.[1] ?? '';
      const n = (polls.get(id) ?? 0) + 1;
      polls.set(id, n);
      return json(n > pollsBeforeDone ? { status: 'COMPLETED' } : n === pollsBeforeDone ? { status: 'IN_PROGRESS' } : { status: 'IN_QUEUE', queue_position: 3 });
    }],
    ['GET', /\/requests\/[^/]+$/, (req) => json(req.url.includes('/fake/video/') || req.url.includes('kling')
      ? { video: { url: 'https://v3.fal.media/files/out.mp4', content_type: 'video/mp4' } }
      : { images: [{ url: PNG_DATA_URL, width: 1, height: 1, content_type: 'image/png' }, { url: PNG_DATA_URL, width: 1, height: 1, content_type: 'image/png' }] })],
    ['PUT', /\/cancel$/, () => json({ status: 'CANCELLATION_REQUESTED' }, 202)],
    ['GET', 'https://v3.fal.media/files/out.mp4', () => new Response(Buffer.from('mp4-bytes'))],
  ]);
}

function providerContract(name: string, makeProvider: () => GenerationProvider) {
  describe(`${name} provider contract`, () => {
    test('is enabled and named', () => {
      const p = makeProvider();
      assert.equal(p.enabled, true);
      assert.equal(typeof p.name, 'string');
    });

    test('submit returns a job id, poll reaches completed, fetchResult yields downloadable files', async () => {
      const p = makeProvider();
      const { providerJobId } = await p.submit(imageRequest(), signal());
      assert.ok(providerJobId.length > 0);
      let status = await p.poll(providerJobId, FAKE_IMAGE_MODEL, signal());
      for (let i = 0; i < 10 && status.state !== 'completed'; i += 1) {
        assert.ok(['queued', 'running'].includes(status.state), `unexpected state ${status.state}`);
        status = await p.poll(providerJobId, FAKE_IMAGE_MODEL, signal());
      }
      assert.equal(status.state, 'completed');
      const files = await p.fetchResult(providerJobId, FAKE_IMAGE_MODEL, signal());
      assert.equal(files.length, 2);
      for (const file of files) {
        assert.equal(typeof file.url, 'string');
        assert.equal(file.mimeType, 'image/png');
        const bytes = await p.download(file, signal());
        assert.ok(Buffer.isBuffer(bytes));
        assert.ok(bytes.length > 0);
      }
    });

    test('a video request completes with a single video file', async () => {
      const p = makeProvider();
      const { providerJobId } = await p.submit(videoRequest(), signal());
      let status = await p.poll(providerJobId, FAKE_VIDEO_MODEL, signal());
      for (let i = 0; i < 10 && status.state !== 'completed'; i += 1) status = await p.poll(providerJobId, FAKE_VIDEO_MODEL, signal());
      const files = await p.fetchResult(providerJobId, FAKE_VIDEO_MODEL, signal());
      assert.equal(files.length, 1);
      assert.equal(files[0]?.mimeType, 'video/mp4');
    });

    test('download decodes a data: URL locally', async () => {
      const p = makeProvider();
      const bytes = await p.download({ url: PNG_DATA_URL, mimeType: 'image/png' }, signal());
      assert.deepEqual(bytes, TINY_PNG);
    });

    test('cancel resolves for a submitted job', async () => {
      const p = makeProvider();
      const { providerJobId } = await p.submit(imageRequest(), signal());
      await p.cancel(providerJobId, FAKE_IMAGE_MODEL, signal());
    });
  });
}

providerContract('fake', () => createFakeProvider({ pollsBeforeDone: 1 }));
providerContract('fal', () => createFalProvider({ apiKey: 'test' }, fakeFalServer(1).fetcher));

describe('fal adapter', () => {
  test('derives the queue app id from the first two path segments', () => {
    assert.equal(falAppId('fal-ai/flux/schnell'), 'fal-ai/flux');
    assert.equal(falAppId('fal-ai/kling-video/v2.1/standard/image-to-video'), 'fal-ai/kling-video');
    assert.equal(falAppId('fake/image'), 'fake/image');
    const urls = falUrls(NAMESPACED_VIDEO_MODEL, 'abc');
    assert.equal(urls.submit, 'https://queue.fal.run/fal-ai/kling-video/v2.1/standard/image-to-video');
    assert.equal(urls.status, 'https://queue.fal.run/fal-ai/kling-video/requests/abc/status');
    assert.equal(urls.result, 'https://queue.fal.run/fal-ai/kling-video/requests/abc');
    assert.equal(urls.cancel, 'https://queue.fal.run/fal-ai/kling-video/requests/abc/cancel');
  });

  test('submit posts the shaped image body with the key header and data-URI references', async () => {
    const { fetcher, requests } = scriptedFetch([['POST', 'https://queue.fal.run/fake/image', () => json({ request_id: 'img-1' })]]);
    const p = createFalProvider({ apiKey: 'secret-key' }, fetcher);
    const { providerJobId } = await p.submit(imageRequest(), signal());
    assert.equal(providerJobId, 'img-1');
    assert.equal(requests.length, 1);
    const [req] = requests;
    assert.equal(req?.method, 'POST');
    assert.equal(req?.headers.get('authorization'), 'Key secret-key');
    assert.equal(req?.headers.get('content-type'), 'application/json');
    assert.deepEqual(req?.body, {
      prompt: 'a rabbit on a bicycle',
      num_images: 2,
      image_urls: [PNG_DATA_URL, `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`],
    });
  });

  test('submit posts the shaped video body: start frame, string duration and audio flag', async () => {
    const { fetcher, requests } = scriptedFetch([['POST', 'https://queue.fal.run/fake/video', () => json({ request_id: 'vid-1' })]]);
    const p = createFalProvider({ apiKey: 'k' }, fetcher);
    await p.submit(videoRequest(), signal());
    assert.deepEqual(requests[0]?.body, { prompt: 'the rabbit pedals away', image_url: PNG_DATA_URL, duration: '5', generate_audio: true });
  });

  test('status, result and cancel for a namespaced model use the app id', async () => {
    const { fetcher, requests } = scriptedFetch([
      ['POST', 'https://queue.fal.run/fal-ai/kling-video/v2.1/standard/image-to-video', () => json({ request_id: 'k-9' })],
      ['GET', 'https://queue.fal.run/fal-ai/kling-video/requests/k-9/status', () => json({ status: 'IN_QUEUE', queue_position: 2 })],
      ['GET', 'https://queue.fal.run/fal-ai/kling-video/requests/k-9', () => json({ video: { url: 'https://v3.fal.media/x.mp4' } })],
      ['PUT', 'https://queue.fal.run/fal-ai/kling-video/requests/k-9/cancel', () => json({}, 202)],
    ]);
    const p = createFalProvider({ apiKey: 'k' }, fetcher);
    const { providerJobId } = await p.submit(videoRequest({ model: NAMESPACED_VIDEO_MODEL }), signal());
    assert.equal(providerJobId, 'k-9');
    assert.deepEqual(await p.poll(providerJobId, NAMESPACED_VIDEO_MODEL, signal()), { state: 'queued', position: 2 });
    assert.equal((await p.fetchResult(providerJobId, NAMESPACED_VIDEO_MODEL, signal()))[0]?.url, 'https://v3.fal.media/x.mp4');
    await p.cancel(providerJobId, NAMESPACED_VIDEO_MODEL, signal());
    assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), [
      'POST https://queue.fal.run/fal-ai/kling-video/v2.1/standard/image-to-video',
      'GET https://queue.fal.run/fal-ai/kling-video/requests/k-9/status',
      'GET https://queue.fal.run/fal-ai/kling-video/requests/k-9',
      'PUT https://queue.fal.run/fal-ai/kling-video/requests/k-9/cancel',
    ]);
    for (const r of requests) assert.equal(r.headers.get('authorization'), 'Key k');
  });

  test('poll maps fal statuses onto job states', async () => {
    const replies = [{ status: 'IN_QUEUE', queue_position: 4 }, { status: 'IN_QUEUE' }, { status: 'IN_PROGRESS', logs: [] }, { status: 'COMPLETED' }];
    let i = 0;
    const { fetcher } = scriptedFetch([['GET', /\/status$/, () => json(replies[i++])]]);
    const p = createFalProvider({ apiKey: 'k' }, fetcher);
    assert.deepEqual(await p.poll('j', FAKE_IMAGE_MODEL, signal()), { state: 'queued', position: 4 });
    assert.deepEqual(await p.poll('j', FAKE_IMAGE_MODEL, signal()), { state: 'queued' });
    assert.deepEqual(await p.poll('j', FAKE_IMAGE_MODEL, signal()), { state: 'running' });
    assert.deepEqual(await p.poll('j', FAKE_IMAGE_MODEL, signal()), { state: 'completed' });
  });

  test('fetchResult shapes an images list and a single video object', async () => {
    const { fetcher } = scriptedFetch([
      ['GET', 'https://queue.fal.run/fake/image/requests/a', () => json({ images: [
        { url: 'https://v3.fal.media/1.png', width: 1024, height: 576, content_type: 'image/png' },
        { url: 'https://v3.fal.media/2.jpg', width: 1024, height: 576, content_type: 'image/jpeg' },
        { not_a_file: true },
      ], seed: 7 })],
      ['GET', 'https://queue.fal.run/fake/video/requests/b', () => json({ video: { url: 'https://v3.fal.media/clip.mp4', duration: 5.04 } })],
    ]);
    const p = createFalProvider({ apiKey: 'k' }, fetcher);
    assert.deepEqual(await p.fetchResult('a', FAKE_IMAGE_MODEL, signal()), [
      { url: 'https://v3.fal.media/1.png', mimeType: 'image/png', width: 1024, height: 576 },
      { url: 'https://v3.fal.media/2.jpg', mimeType: 'image/jpeg', width: 1024, height: 576 },
    ]);
    assert.deepEqual(await p.fetchResult('b', FAKE_VIDEO_MODEL, signal()), [
      { url: 'https://v3.fal.media/clip.mp4', mimeType: 'video/mp4', durationMs: 5040 },
    ]);
  });

  test('a completed job with no files is an invalid result', async () => {
    const { fetcher } = scriptedFetch([['GET', /\/requests\/[^/]+$/, () => json({ images: [], seed: 1 })]]);
    const p = createFalProvider({ apiKey: 'k' }, fetcher);
    await assertProviderError(() => p.fetchResult('x', FAKE_IMAGE_MODEL, signal()), 'invalid');
  });

  test('download fetches a remote file without the key and decodes data: URLs locally', async () => {
    const { fetcher, requests } = scriptedFetch([['GET', 'https://v3.fal.media/files/out.png', () => new Response(Buffer.from('png-bytes'))]]);
    const p = createFalProvider({ apiKey: 'k' }, fetcher);
    assert.deepEqual(await p.download({ url: 'https://v3.fal.media/files/out.png', mimeType: 'image/png' }, signal()), Buffer.from('png-bytes'));
    assert.equal(requests[0]?.headers.get('authorization'), null);
    assert.deepEqual(await p.download({ url: PNG_DATA_URL, mimeType: 'image/png' }, signal()), TINY_PNG);
    assert.equal(requests.length, 1);
  });

  describe('HTTP error mapping never leaks the upstream body', () => {
    const SENTINEL = 'UPSTREAM_SECRET_BODY_7f3a';
    const cases: Array<[status: number, body: unknown, code: ProviderError['code']]> = [
      [401, { detail: `Unauthorized ${SENTINEL}` }, 'auth'],
      [403, { detail: `Forbidden ${SENTINEL}` }, 'auth'],
      [400, { detail: `Bad request ${SENTINEL}` }, 'invalid'],
      [422, { detail: [{ loc: ['body', 'prompt'], msg: `field required ${SENTINEL}`, type: 'value_error.missing' }] }, 'invalid'],
      [422, { detail: `Content policy violation: ${SENTINEL}` }, 'rejected'],
      [422, { detail: [{ msg: `Rejected by safety checker ${SENTINEL}`, type: 'content_policy_violation' }] }, 'rejected'],
      [429, { detail: `Rate limited ${SENTINEL}` }, 'unavailable'],
      [500, `<html>${SENTINEL}</html>`, 'unavailable'],
      [503, { detail: `Overloaded ${SENTINEL}` }, 'unavailable'],
    ];
    for (const [status, body, code] of cases) {
      test(`${status} ${JSON.stringify(body).slice(0, 40)} -> ${code}`, async () => {
        const reply = () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
        const { fetcher } = scriptedFetch([['POST', /./, reply], ['GET', /./, reply], ['PUT', /./, reply]]);
        const p = createFalProvider({ apiKey: 'k' }, fetcher);
        const err = await assertProviderError(() => p.submit(imageRequest(), signal()), code);
        assert.ok(!err.message.includes(SENTINEL), 'message reflected the upstream body');
        assert.ok(!err.message.includes(String(status)), 'message exposed the HTTP status');
        assert.ok(/[.!]$/.test(err.message) && /try|grown-up/i.test(err.message), 'message should tell the user what to do next');
        const pollErr = await assertProviderError(() => p.poll('j', FAKE_IMAGE_MODEL, signal()), code);
        assert.ok(!pollErr.message.includes(SENTINEL));
        const resultErr = await assertProviderError(() => p.fetchResult('j', FAKE_IMAGE_MODEL, signal()), code);
        assert.ok(!resultErr.message.includes(SENTINEL));
      });
    }

    test('a network failure is unavailable; an abort is a timeout', async () => {
      const failing: typeof fetch = async () => { throw new TypeError(`fetch failed ${SENTINEL}`); };
      const p = createFalProvider({ apiKey: 'k' }, failing);
      const err = await assertProviderError(() => p.submit(imageRequest(), signal()), 'unavailable');
      assert.ok(!err.message.includes(SENTINEL));
      const aborting: typeof fetch = async (_url, init) => { throw init?.signal?.reason ?? new Error('aborted'); };
      const controller = new AbortController();
      controller.abort();
      await assertProviderError(() => createFalProvider({ apiKey: 'k' }, aborting).poll('j', FAKE_IMAGE_MODEL, controller.signal), 'timeout');
    });
  });

  test('cancel issues a PUT and tolerates a job that already finished', async () => {
    const { fetcher, requests } = scriptedFetch([
      ['PUT', 'https://queue.fal.run/fake/image/requests/done/cancel', () => json({ detail: 'Request already completed' }, 400)],
      ['PUT', 'https://queue.fal.run/fake/image/requests/live/cancel', () => json({ status: 'CANCELLATION_REQUESTED' }, 202)],
    ]);
    const p = createFalProvider({ apiKey: 'k' }, fetcher);
    await p.cancel('live', FAKE_IMAGE_MODEL, signal());
    await p.cancel('done', FAKE_IMAGE_MODEL, signal());
    assert.deepEqual(requests.map((r) => r.method), ['PUT', 'PUT']);
  });

  test('every fetch carries the caller abort signal', async () => {
    const seen: AbortSignal[] = [];
    const { fetcher } = scriptedFetch([
      ['POST', /./, () => json({ request_id: 'r' })], ['GET', /status$/, () => json({ status: 'COMPLETED' })],
      ['GET', /requests\/r$/, () => json({ images: [{ url: 'https://v3.fal.media/f.png' }] })],
      ['PUT', /./, () => json({}, 202)], ['GET', 'https://v3.fal.media/f.png', () => new Response('x')],
    ]);
    const spy: typeof fetch = (input, init) => { seen.push(init?.signal as AbortSignal); return fetcher(input, init); };
    const p = createFalProvider({ apiKey: 'k' }, spy);
    const s = signal();
    await p.submit(imageRequest(), s);
    await p.poll('r', FAKE_IMAGE_MODEL, s);
    const files = await p.fetchResult('r', FAKE_IMAGE_MODEL, s);
    await p.cancel('r', FAKE_IMAGE_MODEL, s);
    await p.download(files[0]!, s);
    assert.equal(seen.length, 5);
    for (const got of seen) assert.equal(got, s);
  });

  test('a blank key disables the provider and every method throws unavailable', async () => {
    const { fetcher, requests } = scriptedFetch([]);
    for (const p of [createFalProvider({ apiKey: '' }, fetcher), createFalProvider({ apiKey: '   ' }, fetcher)]) {
      assert.equal(p.enabled, false);
      await assertProviderError(() => p.submit(imageRequest(), signal()), 'unavailable');
      await assertProviderError(() => p.poll('j', FAKE_IMAGE_MODEL, signal()), 'unavailable');
      await assertProviderError(() => p.fetchResult('j', FAKE_IMAGE_MODEL, signal()), 'unavailable');
      await assertProviderError(() => p.cancel('j', FAKE_IMAGE_MODEL, signal()), 'unavailable');
      await assertProviderError(() => p.download({ url: 'https://v3.fal.media/f.png', mimeType: 'image/png' }, signal()), 'unavailable');
    }
    assert.equal(requests.length, 0, 'a disabled provider must never call out');
  });
});

async function assertProviderError(run: () => Promise<unknown>, code: ProviderError['code']): Promise<ProviderError> {
  try {
    await run();
  } catch (error) {
    assert.ok(isProviderError(error), `expected a ProviderError, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected a ProviderError with code ${code}`);
}
