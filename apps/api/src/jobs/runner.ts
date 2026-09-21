/**
 * The generation job runner (plan D30, DM-20).
 *
 * `generation_jobs` is the queue. A runner claims rows with UPDATE … RETURNING and
 * heartbeats `claimed_at` while it works, so a claim that goes silent (a container that
 * died mid-job) is free again after the timeout and the next runner carries on from the
 * stored `provider_job_id` rather than paying for the work twice.
 *
 * Money rules (D31): a job retries at most twice, only on a provider error, never on a
 * content rejection; anything that ends without a result refunds the reservation.
 */
import { and, eq, inArray, isNull, lt, or, sql as raw } from 'drizzle-orm';
import { setTimeout as delay } from 'node:timers/promises';
import type { GenerationModel } from '@storyboard/models';
import { db, schema } from '../db/client.ts';
import { config } from '../config.ts';
import type { Catalogue } from '../generation/catalogue.ts';
import { isProviderError, type BinaryImage, type GenerationRequest } from '../generation/provider.ts';
import type { ReviewProvider } from '../generation/review.ts';
import { refund, settle } from '../generation/budget.ts';
import { posterFrame, probeDurationMs } from '../generation/media.ts';
import type { ObjectStore } from '../storage/objectStore.ts';

export type Job = typeof schema.generationJobs.$inferSelect;

/** What a route stores on a job. Asset ids only; the runner loads bytes when it runs. */
export interface JobRequest {
  prompt: string;
  negativePrompt: string;
  referenceAssetIds: string[];
  startFrameAssetId: string | null;
  aspectRatio: '16:9' | '9:16' | '1:1';
  count: number;
  durationSeconds: number | null;
  audio: boolean;
  resolution: string;
  /** Teen policy (D16/D32): gate 1 and gate 3 are mandatory and fail closed. */
  constrained: boolean;
  /** Which kind of asset the results become. */
  assetKind: 'generated_output' | 'character_ref';
}

export interface RunnerDeps {
  catalogue: Catalogue;
  store: ObjectStore;
  review: ReviewProvider;
  /** Renders a timeline job; injected so the runner stays free of timeline knowledge. */
  render?: (job: Job, deps: RunnerDeps, signal: AbortSignal) => Promise<{ assetId: string }>;
  instanceId?: string;
  log?: { info: (msg: string) => void; error: (msg: string) => void };
  /** Test hook: how long to wait between polls. */
  pollMs?: number;
}

const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set(['unavailable', 'timeout']);
const ACTIVE: Job['status'][] = ['queued', 'submitted', 'running', 'reviewing'];

export function userSafeError(error: unknown): { code: string; detail: string } {
  if (isProviderError(error)) return { code: error.code, detail: error.message };
  if (error instanceof Error && error.message === 'review-unavailable') {
    return { code: 'review_unavailable', detail: 'The safety checker is not available right now, so nothing was made. Please try again later.' };
  }
  if (error instanceof Error && error.name === 'AbortError') return { code: 'timeout', detail: 'The picture maker took too long. Please try again.' };
  return { code: 'internal', detail: 'Something went wrong while making this. Please try again.' };
}

export function createRunner(deps: RunnerDeps) {
  const instanceId = deps.instanceId ?? `runner-${process.pid}`;
  const log = deps.log ?? { info: () => {}, error: () => {} };
  const pollMs = deps.pollMs ?? config.GENERATION_POLL_MS;
  const running = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  async function heartbeat(jobId: string) {
    await db.update(schema.generationJobs).set({ claimedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.generationJobs.id, jobId), eq(schema.generationJobs.claimedBy, instanceId)));
  }

  /** Re-read the job; null when it was cancelled or taken over. */
  async function current(jobId: string): Promise<Job | null> {
    const [job] = await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, jobId));
    if (!job || job.status === 'cancelled' || job.claimedBy !== instanceId) return null;
    return job;
  }

  async function setStatus(jobId: string, patch: Partial<typeof schema.generationJobs.$inferInsert>) {
    await db.update(schema.generationJobs).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(schema.generationJobs.id, jobId), eq(schema.generationJobs.claimedBy, instanceId), inArray(schema.generationJobs.status, ACTIVE)));
  }

  async function loadImage(assetId: string, accountId: string): Promise<BinaryImage | null> {
    const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, assetId), eq(schema.assets.accountId, accountId), isNull(schema.assets.deletedAt)));
    if (!asset || !asset.mimeType.startsWith('image/')) return null;
    if (asset.thumbnailSvg) return { bytes: Buffer.from(asset.thumbnailSvg), mimeType: 'image/svg+xml' };
    return { bytes: await deps.store.get(asset.storageKey), mimeType: asset.mimeType };
  }

  async function buildRequest(job: Job, model: GenerationModel): Promise<GenerationRequest> {
    const r = job.request as JobRequest;
    const references: BinaryImage[] = [];
    if (model.capabilities.reference_images) {
      for (const id of r.referenceAssetIds.slice(0, model.max_reference_images)) {
        const image = await loadImage(id, job.accountId);
        if (image && image.mimeType !== 'image/svg+xml') references.push(image);
      }
    }
    const startFrame = model.capabilities.start_frame && r.startFrameAssetId ? await loadImage(r.startFrameAssetId, job.accountId) : null;
    return {
      model, prompt: r.prompt, negativePrompt: r.negativePrompt, referenceImages: references, startFrame,
      aspectRatio: r.aspectRatio, count: r.count, durationSeconds: r.durationSeconds, audio: r.audio && model.capabilities.audio,
      resolution: r.resolution, strictSafety: r.constrained,
    };
  }

  async function reviewBytes(bytes: Buffer, mimeType: string, constrained: boolean, signal: AbortSignal) {
    if (!constrained && !deps.review.enabled) return { status: 'not_required' as const, reason: null };
    const verdict = await deps.review.reviewImage({ bytes, mimeType }, constrained, signal);
    return { status: verdict.allowed ? 'allowed' as const : 'rejected' as const, reason: verdict.allowed ? null : verdict.reason };
  }

  async function generate(job: Job, signal: AbortSignal) {
    const model = deps.catalogue.find(job.modelId);
    const provider = model && deps.catalogue.providerFor(model);
    if (!model || !provider) throw Object.assign(new Error('That picture maker is not available any more.'), { name: 'ProviderError', code: 'invalid' });
    const r = job.request as JobRequest;

    let providerJobId = job.providerJobId;
    if (!providerJobId) {
      // Gate 1: the prompt, before any money leaves.
      if (r.constrained || deps.review.enabled) {
        const verdict = await deps.review.reviewPrompt(`${r.prompt}\n\nNegative: ${r.negativePrompt}`, r.constrained, signal);
        if (!verdict.allowed) throw Object.assign(new Error('The safety checker did not allow this wording. Try describing the scene differently.'), { name: 'ProviderError', code: 'rejected', reason: verdict.reason });
      }
      const request = await buildRequest(job, model);
      const submitted = await provider.submit(request, signal);
      providerJobId = submitted.providerJobId;
      await setStatus(job.id, { providerJobId, status: 'submitted' });
    }

    const deadline = Date.now() + config.GENERATION_CLAIM_TIMEOUT_MS;
    for (;;) {
      if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      const status = await provider.poll(providerJobId, model, signal);
      if (status.state === 'completed') break;
      if (status.state === 'failed') throw Object.assign(new Error(status.message), { name: 'ProviderError', code: 'invalid' });
      if (status.state === 'running') await setStatus(job.id, { status: 'running' });
      await heartbeat(job.id);
      if (!(await current(job.id))) { await provider.cancel(providerJobId, model, signal).catch(() => {}); return; }
      if (Date.now() > deadline) throw Object.assign(new Error('The picture maker took too long. Please try again.'), { name: 'ProviderError', code: 'timeout' });
      await delay(pollMs, undefined, { signal });
    }

    await setStatus(job.id, { status: 'reviewing' });
    const files = await provider.fetchResult(providerJobId, model, signal);
    const assetIds: string[] = [];
    const scope = { accountId: job.accountId, projectId: job.projectId };
    for (const [index, file] of files.entries()) {
      const bytes = await provider.download(file, signal);
      const isVideo = file.mimeType.startsWith('video/');
      const extension = isVideo ? 'mp4' : file.mimeType === 'image/jpeg' ? 'jpg' : file.mimeType === 'image/webp' ? 'webp' : 'png';
      const stored = await deps.store.put(bytes, extension, scope);
      let posterAssetId: string | null = null;
      let review: { status: 'not_required' | 'allowed' | 'rejected'; reason: string | null };
      let durationMs = file.durationMs ?? null;
      if (isVideo) {
        durationMs = (await probeDurationMs(bytes)) ?? durationMs ?? (r.durationSeconds ? r.durationSeconds * 1000 : null);
        const frames = [0, durationMs ? Math.floor(durationMs / 2) : 0];
        review = { status: r.constrained || deps.review.enabled ? 'allowed' : 'not_required', reason: null };
        for (const at of frames) {
          const frame = await posterFrame(bytes, at);
          if (!frame) {
            // No ffmpeg: a constrained account cannot be shown an unreviewed clip.
            if (r.constrained) review = { status: 'rejected', reason: 'The clip could not be checked because the video tools are missing on the server.' };
            break;
          }
          if (at === 0) {
            const poster = await deps.store.put(frame, 'jpg', scope);
            const [row] = await db.insert(schema.assets).values({
              accountId: job.accountId, projectId: job.projectId, ownerEntityType: job.targetEntityType, ownerEntityId: job.targetEntityId,
              kind: 'poster', filename: `poster-${index}.jpg`, mimeType: 'image/jpeg', sizeBytes: poster.sizeBytes, storageKey: poster.key,
              width: file.width ?? null, height: file.height ?? null, generationJobId: job.id, modelId: model.id, reviewStatus: 'not_required',
            }).returning({ id: schema.assets.id });
            posterAssetId = row!.id;
          }
          const verdict = await reviewBytes(frame, 'image/jpeg', r.constrained, signal);
          if (verdict.status === 'rejected') { review = verdict; break; }
        }
      } else {
        review = await reviewBytes(bytes, file.mimeType, r.constrained, signal);
      }
      const [asset] = await db.insert(schema.assets).values({
        accountId: job.accountId, projectId: job.projectId, ownerEntityType: job.targetEntityType, ownerEntityId: job.targetEntityId,
        kind: r.assetKind, filename: `${job.id}-${index}.${extension}`, mimeType: file.mimeType, sizeBytes: stored.sizeBytes, storageKey: stored.key,
        width: file.width ?? null, height: file.height ?? null, durationMs, posterAssetId,
        generationJobId: job.id, modelId: model.id, reviewStatus: review.status, reviewReason: review.reason,
      }).returning({ id: schema.assets.id });
      assetIds.push(asset!.id);
    }
    if (!(await current(job.id))) return;
    await db.transaction(async (tx) => {
      await tx.update(schema.generationJobs).set({ status: 'ready', resultAssetIds: assetIds, finishedAt: new Date(), updatedAt: new Date(), claimedBy: null })
        .where(and(eq(schema.generationJobs.id, job.id), eq(schema.generationJobs.claimedBy, instanceId)));
      await settle(job.id, null, tx);
      if (job.targetEntityType === 'shot') {
        await tx.update(schema.shots).set({ generatedAssetIds: raw`array_cat(${schema.shots.generatedAssetIds}, ${raw.raw(`ARRAY[${assetIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})`, updatedAt: new Date() })
          .where(and(eq(schema.shots.id, job.targetEntityId), eq(schema.shots.accountId, job.accountId)));
      }
    });
  }

  async function fail(job: Job, error: unknown) {
    const safe = userSafeError(error);
    const reason = (error as { reason?: string }).reason;
    const retry = RETRYABLE.has(safe.code) && job.attempt < MAX_ATTEMPTS;
    log.error(`job ${job.id} ${retry ? 'will retry' : 'failed'}: ${safe.code}`);
    if (retry) {
      // Guarded on ACTIVE so a job cancelled while we were waiting is never revived.
      await db.update(schema.generationJobs).set({ status: job.providerJobId ? 'submitted' : 'queued', claimedBy: null, claimedAt: null, errorCode: safe.code, errorDetail: safe.detail, updatedAt: new Date() })
        .where(and(eq(schema.generationJobs.id, job.id), eq(schema.generationJobs.claimedBy, instanceId), inArray(schema.generationJobs.status, ACTIVE)));
      return;
    }
    await db.transaction(async (tx) => {
      await tx.update(schema.generationJobs).set({ status: 'failed', claimedBy: null, errorCode: safe.code, errorDetail: reason ? `${safe.detail} (${reason})` : safe.detail, finishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.generationJobs.id, job.id), eq(schema.generationJobs.claimedBy, instanceId), inArray(schema.generationJobs.status, ACTIVE)));
      await refund(job.id, tx);
    });
  }

  async function processJob(job: Job) {
    const controller = new AbortController();
    const promise = (async () => {
      try {
        if (job.kind === 'render') {
          if (!deps.render) throw new Error('render not configured');
          const result = await deps.render(job, deps, controller.signal);
          await db.transaction(async (tx) => {
            await tx.update(schema.generationJobs).set({ status: 'ready', resultAssetIds: [result.assetId], finishedAt: new Date(), updatedAt: new Date(), claimedBy: null })
              .where(and(eq(schema.generationJobs.id, job.id), eq(schema.generationJobs.claimedBy, instanceId)));
            await settle(job.id, 0, tx);
          });
        } else {
          await generate(job, controller.signal);
        }
      } catch (error) {
        await fail(job, error).catch((e) => log.error(`job ${job.id} could not be marked failed: ${String(e)}`));
      } finally {
        running.delete(job.id);
      }
    })();
    running.set(job.id, { controller, promise });
    return promise;
  }

  /** Claim and process up to `limit` jobs. Returns how many were claimed. */
  async function tick(limit = 2): Promise<number> {
    if (stopped) return 0;
    const stale = new Date(Date.now() - config.GENERATION_CLAIM_TIMEOUT_MS);
    const claimed = await db.transaction(async (tx) => {
      const candidates = await tx.select({ id: schema.generationJobs.id }).from(schema.generationJobs)
        .where(and(inArray(schema.generationJobs.status, ACTIVE), or(isNull(schema.generationJobs.claimedBy), lt(schema.generationJobs.claimedAt, stale))))
        .orderBy(schema.generationJobs.createdAt).limit(Math.max(0, limit - running.size)).for('update', { skipLocked: true });
      if (!candidates.length) return [] as Job[];
      return tx.update(schema.generationJobs).set({ claimedBy: instanceId, claimedAt: new Date(), attempt: raw`${schema.generationJobs.attempt} + 1`, updatedAt: new Date() })
        .where(inArray(schema.generationJobs.id, candidates.map((c) => c.id))).returning();
    });
    for (const job of claimed) void processJob(job);
    return claimed.length;
  }

  /** Cancel a job this instance is running (the route has already set the row to cancelled). */
  function abort(jobId: string) { running.get(jobId)?.controller.abort(); }

  function start() {
    if (timer) return;
    stopped = false;
    const loop = async () => { try { await tick(); } catch (e) { log.error(`runner tick failed: ${String(e)}`); } };
    timer = setInterval(() => { void loop(); }, pollMs);
    timer.unref();
    void loop();
  }

  async function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    for (const r of running.values()) r.controller.abort();
    await Promise.allSettled([...running.values()].map((r) => r.promise));
  }

  /** Test helper: run until no active jobs remain or the deadline passes. */
  async function drain(timeoutMs = 10_000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      await tick();
      if (running.size) await Promise.allSettled([...running.values()].map((r) => r.promise));
      const [pending] = await db.select({ n: raw<number>`count(*)::int` }).from(schema.generationJobs).where(inArray(schema.generationJobs.status, ACTIVE));
      if (!pending?.n) return;
      await delay(20);
    }
  }

  return { tick, start, stop, abort, drain, instanceId, running };
}

export type Runner = ReturnType<typeof createRunner>;
