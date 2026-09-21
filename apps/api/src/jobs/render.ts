/**
 * Turns a timeline into one MP4 (plan D36, D40, DM-23/DM-24).
 *
 * The plan is built at run time from the timeline rows, so a render always reflects the
 * latest picks. Items resolve in the DM-24 order: the picked clip, the picked picture, the
 * scene's sketch, else the scene is skipped.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, schema } from '../db/client.ts';
import { ffmpegAvailable, render, type RenderItem, type RenderPlan } from '../generation/media.ts';
import { providerError } from '../generation/provider.ts';
import type { Job, RunnerDeps } from './runner.ts';

export const STILL_HOLD_MS = 5000;

type Asset = typeof schema.assets.$inferSelect;

export interface ResolvedItem {
  itemId: string;
  sceneId: string;
  sceneNumber: number;
  sceneTitle: string;
  asset: Asset | null;
  /** 'video' | 'picture' | 'sketch' | 'empty' */
  source: 'video' | 'picture' | 'sketch' | 'empty';
  durationMs: number;
  transitionOut: 'cut' | 'fade' | 'slide';
}

/** Make sure every live scene has a timeline item, in story order unless hand-edited. */
export async function ensureTimeline(accountId: string, projectId: string) {
  return db.transaction(async (tx) => {
    let [timeline] = await tx.select().from(schema.timelines).where(and(eq(schema.timelines.projectId, projectId), eq(schema.timelines.accountId, accountId))).for('update');
    if (!timeline) [timeline] = await tx.insert(schema.timelines).values({ accountId, projectId }).returning();
    const scenes = await tx.select().from(schema.scenes).where(and(eq(schema.scenes.projectId, projectId), eq(schema.scenes.accountId, accountId), isNull(schema.scenes.deletedAt))).orderBy(asc(schema.scenes.sortOrder), asc(schema.scenes.id));
    const items = await tx.select().from(schema.timelineItems).where(and(eq(schema.timelineItems.timelineId, timeline!.id), isNull(schema.timelineItems.deletedAt)));
    const bySceneId = new Map(items.map((i) => [i.sceneId, i]));
    for (const s of scenes) if (!bySceneId.has(s.id)) {
      const [row] = await tx.insert(schema.timelineItems).values({ accountId, timelineId: timeline!.id, sceneId: s.id, sortOrder: s.sortOrder }).returning();
      bySceneId.set(s.id, row!);
    }
    // Items for binned scenes hide with them; they come back when the scene is restored.
    if (!timeline!.handEdited) {
      for (const s of scenes) {
        const item = bySceneId.get(s.id)!;
        if (item.sortOrder !== s.sortOrder) await tx.update(schema.timelineItems).set({ sortOrder: s.sortOrder }).where(eq(schema.timelineItems.id, item.id));
      }
    }
    return timeline!;
  });
}

export async function resolveItems(accountId: string, projectId: string, hideRejected: boolean): Promise<ResolvedItem[]> {
  const timeline = await ensureTimeline(accountId, projectId);
  const rows = await db.select({ item: schema.timelineItems, scene: schema.scenes }).from(schema.timelineItems)
    .innerJoin(schema.scenes, eq(schema.scenes.id, schema.timelineItems.sceneId))
    .where(and(eq(schema.timelineItems.timelineId, timeline.id), isNull(schema.timelineItems.deletedAt), isNull(schema.scenes.deletedAt)))
    .orderBy(asc(schema.timelineItems.sortOrder), asc(schema.scenes.sortOrder));
  const shots = rows.length ? await db.select().from(schema.shots).where(and(eq(schema.shots.accountId, accountId), inArray(schema.shots.sceneId, rows.map((r) => r.scene.id)))).orderBy(asc(schema.shots.sortOrder)) : [];
  const assetIds = new Set<string>();
  for (const r of rows) if (r.item.assetId) assetIds.add(r.item.assetId);
  for (const s of shots) { if (s.heroVideoAssetId) assetIds.add(s.heroVideoAssetId); if (s.heroAssetId) assetIds.add(s.heroAssetId); }
  for (const r of rows) if (r.scene.thumbnailAssetId) assetIds.add(r.scene.thumbnailAssetId);
  const assets = assetIds.size ? await db.select().from(schema.assets).where(and(inArray(schema.assets.id, [...assetIds]), eq(schema.assets.accountId, accountId), isNull(schema.assets.deletedAt))) : [];
  const usable = (id: string | null | undefined) => {
    if (!id) return null;
    const a = assets.find((x) => x.id === id);
    if (!a || (hideRejected && a.reviewStatus === 'rejected') || a.reviewStatus === 'rejected') return null;
    return a;
  };
  return rows.map(({ item, scene }) => {
    const shot = shots.find((s) => s.sceneId === scene.id) ?? null;
    let asset = usable(item.assetId);
    let source: ResolvedItem['source'] = asset ? (asset.mimeType.startsWith('video/') ? 'video' : 'picture') : 'empty';
    if (!asset) { asset = usable(shot?.heroVideoAssetId); if (asset) source = 'video'; }
    if (!asset) { asset = usable(shot?.heroAssetId); if (asset) source = 'picture'; }
    if (!asset) { asset = usable(scene.thumbnailAssetId); if (asset) source = 'sketch'; }
    const durationMs = source === 'video' ? Math.max(0, (asset?.durationMs ?? STILL_HOLD_MS) - item.trimInMs - (item.trimOutMs ?? 0)) : source === 'empty' ? 0 : STILL_HOLD_MS;
    return { itemId: item.id, sceneId: scene.id, sceneNumber: scene.sceneNumber, sceneTitle: scene.title, asset, source, durationMs, transitionOut: item.transitionOut };
  });
}

/** Total running time given the D40 overlap between joined items. */
export function totalMs(items: ResolvedItem[], transitionMs = 500): number {
  const playing = items.filter((i) => i.durationMs > 0);
  let total = 0;
  playing.forEach((item, i) => {
    total += item.durationMs;
    if (i > 0 && playing[i - 1]!.transitionOut !== 'cut') total -= transitionMs;
  });
  return Math.max(0, total);
}

export async function renderTimeline(job: Job, deps: RunnerDeps, signal: AbortSignal): Promise<{ assetId: string }> {
  if (!(await ffmpegAvailable())) throw providerError('unavailable', 'The video tools are missing on the server, so the cartoon cannot be put together yet. Ask a grown-up.');
  const [timeline] = await db.select().from(schema.timelines).where(and(eq(schema.timelines.id, job.targetEntityId), eq(schema.timelines.accountId, job.accountId)));
  if (!timeline) throw providerError('invalid', 'The timeline is missing.');
  const items = (await resolveItems(job.accountId, job.projectId, true)).filter((i) => i.durationMs > 0 && i.asset);
  if (!items.length) throw providerError('invalid', 'There is nothing to put together yet. Make a picture for a scene first.');
  const dir = await mkdtemp(join(tmpdir(), 'timeline-'));
  try {
    const materialise = async (asset: Asset, name: string) => {
      const local = deps.store.localPath(asset.storageKey);
      if (asset.thumbnailSvg) {
        // ffmpeg reads SVG through librsvg when present; a PNG is safer, so rasterise via ffmpeg itself if possible.
        const path = join(dir, `${name}.svg`);
        await writeFile(path, asset.thumbnailSvg);
        return path;
      }
      if (local) return local;
      const path = join(dir, `${name}.${asset.mimeType.startsWith('video/') ? 'mp4' : asset.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`);
      await writeFile(path, await deps.store.get(asset.storageKey));
      return path;
    };
    const renderItems: RenderItem[] = [];
    for (const [i, item] of items.entries()) {
      renderItems.push({ path: await materialise(item.asset!, `item${i}`), isVideo: item.source === 'video', holdMs: item.durationMs, transitionOut: item.transitionOut });
    }
    let music: RenderPlan['music'] = null;
    if (timeline.musicAssetId) {
      const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, timeline.musicAssetId), eq(schema.assets.accountId, job.accountId), isNull(schema.assets.deletedAt)));
      if (asset) music = { path: await materialise(asset, 'music'), volume: timeline.musicVolume, fadeInMs: timeline.musicFadeInMs, fadeOutMs: timeline.musicFadeOutMs };
    }
    const voiceRows = await db.select().from(schema.timelineVoiceovers).where(and(eq(schema.timelineVoiceovers.timelineId, timeline.id), isNull(schema.timelineVoiceovers.deletedAt))).orderBy(asc(schema.timelineVoiceovers.startMs));
    const voiceovers: RenderPlan['voiceovers'] = [];
    for (const [i, v] of voiceRows.entries()) {
      const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, v.assetId), eq(schema.assets.accountId, job.accountId), isNull(schema.assets.deletedAt)));
      if (asset) voiceovers.push({ path: await materialise(asset, `voice${i}`), startMs: v.startMs, volume: v.volume });
    }
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, job.projectId));
    const [bible] = await db.select({ aspectRatio: schema.seriesBibles.aspectRatio }).from(schema.seriesBibles).where(eq(schema.seriesBibles.projectId, job.projectId));
    const portrait = bible?.aspectRatio === '9:16';
    const square = bible?.aspectRatio === '1:1';
    const plan: RenderPlan = { items: renderItems, music, voiceovers, width: portrait ? 720 : square ? 1080 : 1280, height: portrait ? 1280 : square ? 1080 : 720 };
    if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    const bytes = await render(plan);
    const stored = await deps.store.put(bytes, 'mp4', { accountId: job.accountId, projectId: job.projectId });
    const [asset] = await db.insert(schema.assets).values({
      accountId: job.accountId, projectId: job.projectId, ownerEntityType: 'timeline', ownerEntityId: timeline.id, kind: 'final_render',
      filename: `${project?.title ?? 'cartoon'}.mp4`.replace(/[^\w.\- ]+/g, '_'), mimeType: 'video/mp4', sizeBytes: stored.sizeBytes, storageKey: stored.key,
      width: plan.width, height: plan.height, durationMs: totalMs(items), generationJobId: job.id, reviewStatus: 'not_required',
    }).returning();
    await db.update(schema.timelines).set({ renderAssetId: asset!.id, updatedAt: new Date() }).where(eq(schema.timelines.id, timeline.id));
    return { assetId: asset!.id };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
