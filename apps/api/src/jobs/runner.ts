/**
 * The generation job runner (plan D30, DM-20; Character Studio MG-06–MG-08).
 *
 * `generation_jobs` is the queue. A runner claims rows with UPDATE … RETURNING and
 * heartbeats `claimed_at` while it works, so a claim that goes silent (a container that
 * died mid-job) is free again after the timeout and the next runner carries on from the
 * stored `provider_job_id` rather than paying for the work twice.
 *
 * Every state change is fenced to the current claim and to an active status, so a stale
 * worker can never settle, refund or revive a job another worker (or a cancel) now owns.
 *
 * Money rules (D31, MB-04, MG-08):
 *   - nothing reached the provider             → refund (not incurred)
 *   - a result came back                       → settle (estimate, or the actual when known)
 *   - work was submitted but no usable result  → keep the estimate, marked unknown
 *   - the submit itself was ambiguous          → no automatic retry; marked uncertain (MG-07)
 * A job retries at most twice, only on a transient provider error, never on a rejection.
 */
import { and, eq, inArray, isNull, lt, lte, notInArray, or, sql as raw } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { clipPlan, CLIP_LENGTHS, type GenerationModel } from '@storyboard/models';
import { VIDEO_TEMPLATE_VERSION } from '@storyboard/compiler';
import { db, schema } from '../db/client.ts';
import { config } from '../config.ts';
import type { Catalogue } from '../generation/catalogue.ts';
import { isProviderError, providerError, type BinaryImage, type GenerationRequest, type ProviderResultMeta } from '../generation/provider.ts';
import type { ReviewProvider } from '../generation/review.ts';
import { keepAsUnknown, reachedProvider, refund, settle, type Tx } from '../generation/budget.ts';
import { posterFrame, probeDurationMs, joinClipParts, ffmpegAvailable } from '../generation/media.ts';
import type { ObjectStore } from '../storage/objectStore.ts';
import type { CreativeVideoSnapshot } from '../video/creativeVideoRequest.ts';

export type Job = typeof schema.generationJobs.$inferSelect;

/** What a new character picture becomes when it comes back (CS-04): always a candidate. */
export interface CandidateIntent {
  viewRole: 'main' | 'front' | 'three_quarter' | 'side' | 'back' | 'full_body' | 'expression';
  source: 'generated' | 'refinement';
  sourceVisualVersionId: string | null;
  parentCandidateId: string | null;
}

/** What a route stores on a job. Asset ids only; the runner loads bytes when it runs. */
export interface JobRequest {
  /** Persist every submitted part so retries resume instead of buying it again. */
  partJobIds?: string[];
  prompt: string;
  negativePrompt: string;
  referenceAssetIds: string[];
  referenceNames?: string[];
  /** CS-10/CR-03: the hash each reference had when the request was made. Checked before use. */
  referenceHashes?: string[];
  startFrameAssetId: string | null;
  endFrameAssetId?: string | null;
  aspectRatio: '16:9' | '9:16' | '1:1';
  count: number;
  durationSeconds: number | null;
  audio: boolean;
  resolution: string;
  /** One native generation of exactly this length: never planned as joined parts. */
  native?: boolean;
  /** Teen policy (D16/D32): gate 1 and gate 3 are mandatory and fail closed. */
  constrained: boolean;
  /** Which kind of asset the results become. */
  assetKind: 'generated_output' | 'character_ref';
  /** Character pictures only: how results enter Studio. */
  candidate?: CandidateIntent;
  /** Production video only: the immutable creative snapshot (MG-01, MG-05). */
  creative?: CreativeVideoSnapshot;
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
/** Time limits for single network calls, so a hung connection becomes a logged timeout, not silence. */
const CALL_MS = { submit: 60_000, poll: 30_000, result: 60_000, download: 5 * 60_000, review: 90_000 };
const HEARTBEAT_MS = 10_000;
/** Native drafts can be completed for this long (fal: "within seven days"). */
const DRAFT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const SHUTDOWN = 'runner-shutdown';
const limit = (signal: AbortSignal, ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);
const secs = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * One step in a job's trail. `say` is child-safe and shown on the clip card; `detail` and `raw`
 * are for the adult's clip log and the server log only.
 */
export interface JobEvent { at: string; say: string; detail?: string; raw?: string; part?: number; parts?: number }
const RETRYABLE = new Set(['unavailable', 'timeout']);
const ACTIVE: Job['status'][] = ['queued', 'submitted', 'running', 'reviewing'];

/** MG-07: the submit may have been accepted (and billed) even though we got no answer. */
function uncertainSubmission(): Error {
  return Object.assign(new Error('The clip maker did not answer while taking the request, so it may or may not have started.'), { name: 'ProviderError', code: 'uncertain' });
}

export function userSafeError(error: unknown): { code: string; detail: string } {
  if ((error as { code?: string }).code === 'uncertain') {
    return { code: 'uncertain', detail: 'We could not tell if the clip maker got your request. Ask a grown-up to check the clip log before you try again.' };
  }
  if (isProviderError(error)) return { code: error.code, detail: error.message };
  if (error instanceof Error && error.message === 'review-auth') {
    return { code: 'review_unavailable', detail: 'The safety checker’s Claude key was rejected, so nothing was made. A grown-up needs to check ANTHROPIC_API_KEY.' };
  }
  if (error instanceof Error && error.message === 'review-unavailable') {
    return { code: 'review_unavailable', detail: 'The safety checker is not available right now, so nothing was made. Please try again later.' };
  }
  if (error instanceof Error && error.name === 'AbortError') return { code: 'timeout', detail: 'The picture maker took too long. Please try again.' };
  return { code: 'internal', detail: 'Something went wrong while making this. Please try again.' };
}

export function createRunner(deps: RunnerDeps) {
  // pid alone repeats across containers; the suffix keeps claim fencing meaningful between them.
  const instanceId = deps.instanceId ?? `runner-${process.pid}-${randomUUID().slice(0, 8)}`;
  const log = deps.log ?? { info: () => {}, error: () => {} };
  const pollMs = deps.pollMs ?? config.GENERATION_POLL_MS;
  const running = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  /** What each running job is doing right now, so a failure can say where it happened. */
  const stage = new Map<string, string>();

  /** Add a step to the job's trail and the server log. Never throws: logging must not break a job. */
  async function note(jobId: string, say: string, extra: Omit<JobEvent, 'at' | 'say'> = {}, database: typeof db | Tx = db) {
    const event: JobEvent = { at: new Date().toISOString(), say, ...extra };
    stage.set(jobId, extra.detail ? `${say} (${extra.detail})` : say);
    log.info(`job ${jobId.slice(0, 8)} ${say}${extra.detail ? ` · ${extra.detail}` : ''}${extra.raw ? ` · ${extra.raw}` : ''}`);
    await database.update(schema.generationJobs).set({ events: raw`${schema.generationJobs.events} || ${JSON.stringify([event])}::jsonb` })
      .where(eq(schema.generationJobs.id, jobId)).catch(() => {});
  }

  /** Fence: only the claim holder, and only while the job is still active. */
  const mine = (jobId: string) => and(eq(schema.generationJobs.id, jobId), eq(schema.generationJobs.claimedBy, instanceId), inArray(schema.generationJobs.status, ACTIVE));

  async function heartbeat(jobId: string) {
    await db.update(schema.generationJobs).set({ claimedAt: new Date(), updatedAt: new Date() }).where(mine(jobId));
  }

  /** Re-read the job; null when it was cancelled or taken over. */
  async function current(jobId: string): Promise<Job | null> {
    const [job] = await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, jobId));
    if (!job || !ACTIVE.includes(job.status) || job.claimedBy !== instanceId) return null;
    return job;
  }

  /** Returns false when the fence did not match (cancelled, or another worker owns it now). */
  async function setStatus(jobId: string, patch: Partial<typeof schema.generationJobs.$inferInsert>): Promise<boolean> {
    const rows = await db.update(schema.generationJobs).set({ ...patch, updatedAt: new Date() }).where(mine(jobId)).returning({ id: schema.generationJobs.id });
    return rows.length > 0;
  }

  /**
   * Load an owned image for a provider. With an expected hash (a pinned reference or frame), the
   * bytes must still be exactly the ones that were approved (CS-10). A rejected picture is never
   * sent; on a constrained account the picture must have passed review (MB-05).
   */
  async function loadImage(assetId: string, accountId: string, constrained: boolean, expectedHash?: string): Promise<BinaryImage> {
    const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, assetId), eq(schema.assets.accountId, accountId)));
    if (!asset || !asset.mimeType.startsWith('image/') || asset.thumbnailSvg) throw providerError('invalid', 'A picture for this clip is no longer available.', true);
    if (asset.deletedAt) throw providerError('invalid', 'A picture for this clip is in the bin. Put it back, or choose a different look.', true);
    if (asset.reviewStatus === 'rejected' || (constrained && asset.reviewStatus !== 'allowed')) throw providerError('invalid', 'A picture for this clip has not passed the safety check.', true);
    const bytes = await deps.store.get(asset.storageKey);
    if (expectedHash && sha256(bytes) !== expectedHash) throw providerError('invalid', 'A picture for this clip has changed since it was chosen.', true);
    return { bytes, mimeType: asset.mimeType };
  }

  async function buildRequest(job: Job, model: GenerationModel): Promise<GenerationRequest> {
    const r = job.request as JobRequest;
    // MG-03: a request never loses a required input. A model that cannot take one is an error,
    // never a quiet drop to a text-only generation.
    if (r.referenceAssetIds.length && !model.capabilities.reference_images) throw providerError('invalid', 'This maker cannot use character pictures.', true);
    if (r.referenceAssetIds.length > model.max_reference_images) throw providerError('invalid', 'Too many character pictures for this maker.', true);
    if (r.startFrameAssetId && !model.capabilities.start_frame) throw providerError('invalid', 'This maker cannot start from a picture.', true);
    if (r.endFrameAssetId && !model.capabilities.end_frame) throw providerError('invalid', 'This maker cannot end on a picture.', true);
    const references: BinaryImage[] = [];
    for (const [i, id] of r.referenceAssetIds.entries()) references.push(await loadImage(id, job.accountId, r.constrained, r.referenceHashes?.[i]));
    const creative = r.creative;
    const startFrame = r.startFrameAssetId ? await loadImage(r.startFrameAssetId, job.accountId, r.constrained, creative?.startFrame?.contentHash) : null;
    const endFrame = r.endFrameAssetId ? await loadImage(r.endFrameAssetId, job.accountId, r.constrained, creative?.endFrame?.contentHash) : null;
    return {
      model, prompt: r.prompt, negativePrompt: r.negativePrompt, referenceImages: references, ...(r.referenceNames ? { referenceNames: r.referenceNames } : {}), startFrame, endFrame,
      aspectRatio: r.aspectRatio, count: r.count, durationSeconds: r.durationSeconds, audio: r.audio && model.capabilities.audio,
      resolution: r.resolution, strictSafety: r.constrained,
      ...(creative ? { seed: creative.seed ?? null, cameraMovement: creative.cameraMovement ?? null, tokensInline: creative.compilerVersion === VIDEO_TEMPLATE_VERSION } : {}),
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
    if (!model || !provider) throw providerError('invalid', 'That picture maker is not available any more.', true);
    const r = job.request as JobRequest;
    // Safety gate policy is a property of the account, never of the model (MB-05).
    if (r.constrained && !deps.review.enabled) throw new Error('review-unavailable');

    const lengths = !r.native && model.kind === 'video' && model.capabilities.text_to_video && r.durationSeconds && CLIP_LENGTHS.includes(r.durationSeconds)
      ? clipPlan(model, r.durationSeconds) : [r.durationSeconds];
    const assembling = lengths.length > 1 || lengths[0] !== r.durationSeconds;
    if (assembling && !(await ffmpegAvailable())) throw new Error('Video tools are required to join clips');
    const partJobIds = r.partJobIds ?? (job.providerJobId ? [job.providerJobId] : []);
    if (!partJobIds.length) {
      // Gate 1: the prompt and the names the adapter will add, before any money leaves (MB-06).
      if (r.constrained || deps.review.enabled) {
        await note(job.id, 'Checking the words');
        const verdict = await deps.review.reviewPrompt(`${r.prompt}\n${(r.referenceNames ?? []).join('\n')}\n\nNegative: ${r.negativePrompt}`, r.constrained, limit(signal, CALL_MS.review));
        if (!verdict.allowed) throw Object.assign(new Error('The safety checker did not allow this wording. Try describing the scene differently.'), { name: 'ProviderError', code: 'rejected', reason: verdict.reason });
        // The words are fine for the child, but the maker's own filter would refuse them: stop here,
        // before anything is paid for, and say what to change.
        if (verdict.maker_will_refuse && model.kind === 'video') {
          const tip = verdict.suggestion?.trim();
          throw Object.assign(new Error(`The clip maker would say no to this wording, so nothing was made or paid for.${tip ? ` ${tip}` : ' Try leaving out anything like weapons, blood or real people.'}`), { name: 'ProviderError', code: 'rejected', notAccepted: true, reason: verdict.reason });
        }
      }
    }
    const downloaded: { file: Awaited<ReturnType<typeof provider.fetchResult>>[number]; bytes: Buffer }[] = [];
    const reviewFrames: number[] = [];
    let meta: ProviderResultMeta | undefined;
    let elapsed = 0;
    const parts = lengths.length;
    const what = model.kind === 'video' ? 'clip' : 'picture';
    const partWords = (i: number) => parts > 1 ? `part ${i + 1} of ${parts}` : `your ${what}`;
    for (const [partIndex, length] of lengths.entries()) {
      if (!(await current(job.id))) return;
      const tag = { part: partIndex + 1, parts };
      let providerJobId = partJobIds[partIndex];
      if (!providerJobId) {
        const request = await buildRequest(job, model);
        request.durationSeconds = length;
        await note(job.id, `Sending ${partWords(partIndex)} to the ${what} maker`, { ...tag, detail: `${model.id}${length ? `, ${length} s` : ''}` });
        // Written before the call, so a crash inside the call is visible afterwards (MG-07).
        if (!(await setStatus(job.id, { submissionState: 'submitting' }))) return;
        try {
          const submitted = await provider.submit(request, limit(signal, CALL_MS.submit));
          providerJobId = submitted.providerJobId;
        } catch (error) {
          if (isProviderError(error) && error.notAccepted) {
            await setStatus(job.id, { submissionState: partJobIds.length ? 'accepted' : 'not_submitted' });
            throw error;
          }
          // No answer, a timeout or a 5xx: fal may have taken it. Never resubmit blind.
          await setStatus(job.id, { submissionState: 'uncertain' });
          throw Object.assign(uncertainSubmission(), { raw: error instanceof Error ? error.message : String(error) });
        }
        partJobIds.push(providerJobId);
        r.partJobIds = partJobIds;
        await setStatus(job.id, { providerJobId, request: r, status: 'submitted', submissionState: 'accepted' });
        await note(job.id, `Waiting for ${partWords(partIndex)}`, { ...tag, detail: `provider request ${providerJobId}` });
      } else {
        await note(job.id, `Carrying on with ${partWords(partIndex)}`, { ...tag, detail: `provider request ${providerJobId}, already paid for` });
      }
      const partStarted = Date.now();
      const deadline = partStarted + config.GENERATION_JOB_TIMEOUT_MS;
      let lastState = '';
      for (;;) {
        if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        const status = await provider.poll(providerJobId, model, limit(signal, CALL_MS.poll));
        if (status.state !== lastState) {
          lastState = status.state;
          if (status.state === 'queued') await note(job.id, `Waiting in line for ${partWords(partIndex)}`, { ...tag, ...(status.position !== undefined ? { detail: `queue position ${status.position}` } : {}) });
          if (status.state === 'running') await note(job.id, `Making ${partWords(partIndex)}`, tag);
        }
        if (status.state === 'completed') break;
        if (status.state === 'failed') throw Object.assign(new Error(status.message), { name: 'ProviderError', code: 'invalid' });
        if (status.state === 'running') await setStatus(job.id, { status: 'running' });
        await setStatus(job.id, { nextPollAt: new Date(Date.now() + pollMs) });
        await heartbeat(job.id);
        if (!(await current(job.id))) { await provider.cancel(providerJobId, model, limit(signal, CALL_MS.poll)).catch(() => {}); return; }
        if (Date.now() > deadline) throw Object.assign(new Error(`${partWords(partIndex)} was not ready after ${secs(Date.now() - partStarted)}`), { name: 'ProviderError', code: 'timeout' });
        await delay(pollMs, undefined, { signal });
      }
      await note(job.id, `Made ${partWords(partIndex)}`, { ...tag, detail: `${secs(Date.now() - partStarted)} at the provider` });

      const results = await provider.fetchResult(providerJobId, model, limit(signal, CALL_MS.result));
      if (!results.length) throw new Error('Clip maker returned no files');
      meta ??= results[0]?.meta;
      for (const file of results) {
        const t0 = Date.now();
        await note(job.id, `Fetching ${partWords(partIndex)}`, tag);
        const bytes = await provider.download(file, limit(signal, CALL_MS.download));
        downloaded.push({ file, bytes });
        await note(job.id, `Fetched ${partWords(partIndex)}`, { ...tag, detail: `${(bytes.length / 1_048_576).toFixed(1)} MB in ${secs(Date.now() - t0)}` });
      }
      if (length) {
        const visible = Math.min(length, (r.durationSeconds ?? length) - elapsed);
        reviewFrames.push(elapsed * 1000, (elapsed + visible / 2) * 1000);
        elapsed += length;
      }
    }
    if (assembling) {
      if (downloaded.length !== lengths.length) throw new Error('Unexpected number of clip parts');
      const portrait = r.aspectRatio === '9:16';
      await note(job.id, `Joining ${lengths.length} parts into one clip`);
      const t0 = Date.now();
      const bytes = await joinClipParts(downloaded.map((part, i) => ({ bytes: part.bytes, seconds: lengths[i]! })), r.durationSeconds!, portrait);
      await note(job.id, 'Joined the parts', { detail: `${(bytes.length / 1_048_576).toFixed(1)} MB in ${secs(Date.now() - t0)}` });
      downloaded.splice(0, downloaded.length, { bytes, file: { url: '', mimeType: 'video/mp4', width: portrait ? 720 : 1280, height: portrait ? 1280 : 720, durationMs: r.durationSeconds! * 1000 } });
    }
    if (!(await setStatus(job.id, { status: 'reviewing' }))) return;
    await note(job.id, r.constrained || deps.review.enabled ? `Checking your ${what} is OK` : `Saving your ${what}`);
    // Stored and reviewed first, attached in one transaction at the end: a retry after a failure
    // here re-downloads rather than duplicating takes in the media bin.
    const pending: (typeof schema.assets.$inferInsert)[] = [];
    const posters: (typeof schema.assets.$inferInsert)[] = [];
    const scope = { accountId: job.accountId, projectId: job.projectId };
    for (const [index, { file, bytes }] of downloaded.entries()) {
      const isVideo = file.mimeType.startsWith('video/');
      const extension = isVideo ? 'mp4' : file.mimeType === 'image/jpeg' ? 'jpg' : file.mimeType === 'image/webp' ? 'webp' : 'png';
      const stored = await deps.store.put(bytes, extension, scope);
      const assetId = randomUUID();
      let posterAssetId: string | null = null;
      let review: { status: 'not_required' | 'allowed' | 'rejected'; reason: string | null };
      let durationMs = file.durationMs ?? null;
      if (isVideo) {
        durationMs = (await probeDurationMs(bytes)) ?? durationMs ?? (r.durationSeconds ? r.durationSeconds * 1000 : null);
        const frames = assembling ? reviewFrames : [0, durationMs ? Math.floor(durationMs / 2) : 0];
        review = { status: r.constrained || deps.review.enabled ? 'allowed' : 'not_required', reason: null };
        let poster: Buffer | null = null;
        for (const at of frames) {
          const frame = await posterFrame(bytes, at);
          if (!frame) {
            // No ffmpeg: nothing unreviewed is shown to a constrained account, or marked checked.
            review = r.constrained ? { status: 'rejected', reason: 'The clip could not be checked because the video tools are missing on the server.' } : { status: 'not_required', reason: null };
            break;
          }
          if (at === 0) poster = frame;
          const verdict = await reviewBytes(frame, 'image/jpeg', r.constrained, limit(signal, CALL_MS.review));
          if (verdict.status === 'rejected') { review = verdict; break; }
        }
        if (poster) {
          // The poster carries the clip's verdict, so a held-back clip never has a visible poster.
          const saved = await deps.store.put(poster, 'jpg', scope);
          posterAssetId = randomUUID();
          posters.push({
            id: posterAssetId, accountId: job.accountId, projectId: job.projectId, ownerEntityType: job.targetEntityType, ownerEntityId: job.targetEntityId,
            kind: 'poster', filename: `poster-${index}.jpg`, mimeType: 'image/jpeg', sizeBytes: saved.sizeBytes, storageKey: saved.key, contentSha256: saved.sha256,
            width: file.width ?? null, height: file.height ?? null, generationJobId: job.id, modelId: model.id, reviewStatus: review.status, reviewReason: review.reason,
          });
        }
      } else {
        review = await reviewBytes(bytes, file.mimeType, r.constrained, limit(signal, CALL_MS.review));
      }
      pending.push({
        id: assetId, accountId: job.accountId, projectId: job.projectId, ownerEntityType: job.targetEntityType, ownerEntityId: job.targetEntityId,
        kind: r.assetKind, filename: `${job.id}-${index}.${extension}`, mimeType: file.mimeType, sizeBytes: stored.sizeBytes, storageKey: stored.key, contentSha256: stored.sha256,
        width: file.width ?? null, height: file.height ?? null, durationMs, posterAssetId,
        generationJobId: job.id, modelId: model.id, reviewStatus: review.status, reviewReason: review.reason,
      });
    }
    const assetIds = pending.map((a) => a.id!);
    const providerResult = meta ? { ...(meta.seed !== undefined ? { seed: meta.seed } : {}), ...(meta.expandedPrompt ? { expanded_prompt: meta.expandedPrompt } : {}), ...(meta.draftId ? { draft_id: meta.draftId, draft_expires_at: new Date(Date.now() + DRAFT_LIFETIME_MS).toISOString() } : {}) } : null;
    const done = await db.transaction(async (tx) => {
      // Fenced: a job cancelled or taken over in the meantime is never turned into "ready".
      const updated = await tx.update(schema.generationJobs).set({ status: 'ready', resultAssetIds: assetIds, finishedAt: new Date(), updatedAt: new Date(), claimedBy: null, ...(providerResult ? { providerResult } : {}) })
        .where(mine(job.id)).returning({ id: schema.generationJobs.id });
      if (!updated.length) return false;
      if (posters.length) await tx.insert(schema.assets).values(posters);
      await tx.insert(schema.assets).values(pending);
      await settle(job.id, null, tx);
      const usable = pending.filter((a) => a.reviewStatus === 'allowed' || a.reviewStatus === 'not_required');
      if (job.targetEntityType === 'character' && r.assetKind === 'character_ref' && usable.length) {
        // CS-04: a finished picture is a candidate. Nothing about the approved look changes.
        const c = r.candidate ?? { viewRole: 'main' as const, source: 'generated' as const, sourceVisualVersionId: null, parentCandidateId: null };
        await tx.insert(schema.characterReferenceCandidates).values(usable.map((a) => ({
          accountId: job.accountId, characterId: job.targetEntityId, assetId: a.id!, viewRole: c.viewRole, source: c.source,
          sourceVisualVersionId: c.sourceVisualVersionId, parentCandidateId: c.parentCandidateId, generationJobId: job.id,
        })));
      }
      if (job.targetEntityType === 'shot') {
        await tx.update(schema.shots).set({ generatedAssetIds: raw`array_cat(${schema.shots.generatedAssetIds}, ${raw.raw(`ARRAY[${assetIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})`, updatedAt: new Date() })
          .where(and(eq(schema.shots.id, job.targetEntityId), eq(schema.shots.accountId, job.accountId)));
        // A finished clip fills an empty slot in the story order; it never replaces a chosen clip (DF-02).
        const first = model.kind === 'video' ? usable[0] : undefined;
        if (first) await tx.update(schema.shots).set({ heroVideoAssetId: first.id!, generationStatus: 'generated', version: raw`${schema.shots.version} + 1`, updatedAt: new Date() })
          .where(and(eq(schema.shots.id, job.targetEntityId), eq(schema.shots.accountId, job.accountId), isNull(schema.shots.heroVideoAssetId)));
      }
      return true;
    });
    if (done) await note(job.id, 'Ready', { detail: `${secs(Date.now() - job.createdAt.getTime())} from asking to ready` });
  }

  async function fail(job: Job, error: unknown) {
    const safe = userSafeError(error);
    const reason = (error as { reason?: string }).reason;
    const retry = RETRYABLE.has(safe.code) && job.attempt < MAX_ATTEMPTS;
    // The raw error goes to the trail (adult only) and the server log; the child sees the safe detail.
    const rawText = [(error as { raw?: string }).raw, error instanceof Error ? error.message : String(error), reason ? `reviewer: ${reason}` : '']
      .filter(Boolean).join(' · ').slice(0, 800);
    const where = stage.get(job.id);
    log.error(`job ${job.id} ${retry ? 'will retry' : 'failed'}: ${safe.code}: ${rawText}${where ? ` (during: ${where})` : ''}`);
    await note(job.id, retry ? 'Something went wrong, trying again' : 'Stopped: it did not work', {
      detail: `${safe.code}${where ? `, during: ${where}` : ''}`, raw: rawText,
    });
    if (retry) {
      // Back off before the next claim, durably: a restart does not reset the wait.
      const wait = Math.min(60_000, pollMs * 2 ** job.attempt);
      await db.update(schema.generationJobs).set({ status: job.providerJobId ? 'submitted' : 'queued', claimedBy: null, claimedAt: null, nextPollAt: new Date(Date.now() + wait), errorCode: safe.code, errorDetail: safe.detail, updatedAt: new Date() })
        .where(mine(job.id));
      return;
    }
    await db.transaction(async (tx) => {
      const [latest] = await tx.update(schema.generationJobs).set({ status: 'failed', claimedBy: null, errorCode: safe.code, errorDetail: safe.detail, finishedAt: new Date(), updatedAt: new Date() })
        .where(mine(job.id)).returning();
      // Only the owner that actually ended the job touches the money, exactly once.
      if (!latest) return;
      if (reachedProvider(latest)) await keepAsUnknown(job.id, tx);
      else await refund(job.id, tx);
    });
  }

  /** A shutdown is not a failed attempt: hand the claim back so the next runner resumes it. */
  async function release(job: Job) {
    await db.update(schema.generationJobs).set({ claimedBy: null, claimedAt: null, attempt: raw`GREATEST(${schema.generationJobs.attempt} - 1, 0)`, updatedAt: new Date() })
      .where(mine(job.id)).catch(() => {});
    log.info(`job ${job.id.slice(0, 8)} handed back on shutdown`);
  }

  async function processJob(job: Job) {
    const controller = new AbortController();
    // Heartbeat on a timer, not only while polling, so a long download or join never looks dead.
    const beat = setInterval(() => { void heartbeat(job.id).catch(() => {}); }, HEARTBEAT_MS);
    beat.unref();
    const promise = (async () => {
      try {
        await note(job.id, job.attempt > 1 ? 'Picked up again' : 'Started', {
          detail: `attempt ${job.attempt} on ${instanceId}${(job.request as JobRequest | null)?.partJobIds?.length ? `, ${(job.request as JobRequest).partJobIds!.length} part(s) already sent` : ''}`,
        });
        // A previous worker died inside a submit call, or was shut down after an unanswered one:
        // the provider may have the request, so it is never sent again (MG-07).
        if (job.submissionState === 'submitting' || job.submissionState === 'uncertain') {
          await db.update(schema.generationJobs).set({ submissionState: 'uncertain' }).where(mine(job.id));
          throw uncertainSubmission();
        }
        if (job.kind === 'render') {
          if (!deps.render) throw new Error('render not configured');
          await note(job.id, 'Putting your cartoon together');
          const t0 = Date.now();
          const result = await deps.render(job, deps, controller.signal);
          await db.transaction(async (tx) => {
            const updated = await tx.update(schema.generationJobs).set({ status: 'ready', resultAssetIds: [result.assetId], finishedAt: new Date(), updatedAt: new Date(), claimedBy: null })
              .where(mine(job.id)).returning({ id: schema.generationJobs.id });
            if (updated.length) await settle(job.id, 0, tx);
          });
          await note(job.id, 'Ready', { detail: `rendered in ${secs(Date.now() - t0)}` });
        } else {
          await generate(job, controller.signal);
        }
      } catch (error) {
        if (controller.signal.reason === SHUTDOWN) await release(job);
        else await fail(job, error).catch((e) => log.error(`job ${job.id} could not be marked failed: ${String(e)}`));
      } finally {
        clearInterval(beat);
        stage.delete(job.id);
        running.delete(job.id);
      }
    })();
    running.set(job.id, { controller, promise });
    return promise;
  }

  /**
   * A job nobody picked up (runner off, provider renamed, container gone) would hold its
   * reservation for ever. Any job still waiting after the queue timeout, with nothing sent to
   * the provider, is stopped and its money put back. Runs for every provider on purpose: a
   * job whose provider no longer exists is exactly the one that needs sweeping.
   */
  async function sweep(): Promise<number> {
    const cutoff = new Date(Date.now() - config.GENERATION_QUEUE_TIMEOUT_MS);
    const stale = new Date(Date.now() - config.GENERATION_CLAIM_TIMEOUT_MS);
    return db.transaction(async (tx) => {
      const rows = await tx.update(schema.generationJobs).set({
        status: 'failed', claimedBy: null, errorCode: 'stale', errorDetail: 'That took too long to start, so it was stopped. Nothing was spent.', finishedAt: new Date(), updatedAt: new Date(),
      }).where(and(
        eq(schema.generationJobs.status, 'queued'), eq(schema.generationJobs.submissionState, 'not_submitted'), isNull(schema.generationJobs.providerJobId),
        lt(schema.generationJobs.createdAt, cutoff), or(isNull(schema.generationJobs.claimedBy), lt(schema.generationJobs.claimedAt, stale)),
        ...(running.size ? [notInArray(schema.generationJobs.id, [...running.keys()])] : []),
      )).returning({ id: schema.generationJobs.id, request: schema.generationJobs.request });
      for (const row of rows) {
        // Parts already sent are money that may be billed; never refund those.
        if (((row.request as JobRequest | null)?.partJobIds ?? []).length) await keepAsUnknown(row.id, tx);
        else await refund(row.id, tx);
        await note(row.id, 'Stopped: it waited too long. Nothing was spent.', { detail: 'stale' }, tx);
        log.info(`job ${row.id.slice(0, 8)} swept after waiting too long; money put back`);
      }
      return rows.length;
    });
  }

  let lastSweep = 0;
  /** Claim and process up to `limit` jobs. Returns how many were claimed. */
  async function tick(limit = 2): Promise<number> {
    if (stopped) return 0;
    if (Date.now() - lastSweep > 60_000) { lastSweep = Date.now(); await sweep(); }
    const stale = new Date(Date.now() - config.GENERATION_CLAIM_TIMEOUT_MS);
    const claimed = await db.transaction(async (tx) => {
      // Only jobs for providers this runner holds: a development server sharing the database
      // with the test suite must never pick up (and pay for) a test's fake-provider jobs.
      const providers = [...deps.catalogue.providers.keys(), ...(deps.render ? ['ffmpeg'] : [])];
      const candidates = await tx.select({ id: schema.generationJobs.id }).from(schema.generationJobs)
        .where(and(inArray(schema.generationJobs.status, ACTIVE), inArray(schema.generationJobs.provider, providers), or(isNull(schema.generationJobs.claimedBy), lt(schema.generationJobs.claimedAt, stale)),
          // Durable scheduling: a job backing off after a transient failure waits its turn.
          or(isNull(schema.generationJobs.nextPollAt), lte(schema.generationJobs.nextPollAt, new Date())),
          ...(running.size ? [notInArray(schema.generationJobs.id, [...running.keys()])] : [])))
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
    for (const r of running.values()) r.controller.abort(SHUTDOWN);
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

  return { tick, sweep, start, stop, abort, drain, instanceId, running };
}

export type Runner = ReturnType<typeof createRunner>;
