/**
 * Composition root for Director Mode: providers, catalogue, object store, review, cast
 * finder and the job runner. Tests build their own with fakes; production reads config.
 */
import { config } from './config.ts';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createCatalogue, type Catalogue } from './generation/catalogue.ts';
import { createFalProvider } from './generation/fal.ts';
import { createClaudeReview, noReview, type ReviewProvider } from './generation/review.ts';
import type { GenerationProvider } from './generation/provider.ts';
import { createDiskStore, type ObjectStore } from './storage/objectStore.ts';
import { createClaudeCastFinder, type CastFinder } from './cast/finder.ts';
import { createRunner, type Runner } from './jobs/runner.ts';
import { renderTimeline } from './jobs/render.ts';
import type { GenerationModel } from '@storyboard/models';
import { createFakeProvider, FAKE_IMAGE_MODEL, FAKE_VIDEO_MODEL, FAKE_VIDEO_MEDIUM_MODEL, FAKE_VIDEO_HIGH_MODEL, FAKE_REF_VIDEO_MODEL, FAKE_FRAMES_MODEL, TINY_PNG } from './generation/fake.ts';
import { makeTestClip, makeTestImage } from './generation/media.ts';

export interface DirectorServices {
  catalogue: Catalogue;
  store: ObjectStore;
  review: ReviewProvider;
  finder: CastFinder;
  runner: Runner;
}

export interface DirectorOverrides {
  providers?: GenerationProvider[];
  models?: GenerationModel[];
  store?: ObjectStore;
  review?: ReviewProvider;
  finder?: CastFinder;
  log?: { info: (msg: string) => void; error: (msg: string) => void };
  pollMs?: number;
}

/** The runner's log: the console, plus a file you can open when the console is not visible. */
function fileLog() {
  const file = config.GENERATION_LOG_FILE && config.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT ? resolve(config.GENERATION_LOG_FILE) : '';
  let ready: Promise<unknown> | null = file ? mkdir(dirname(file), { recursive: true }).catch(() => {}) : null;
  const write = (level: string, m: string) => {
    const line = `${new Date().toISOString()} ${level} ${m}`;
    (level === 'ERROR' ? console.error : console.log)(`[runner] ${m}`);
    if (ready) ready = ready.then(() => appendFile(file, `${line}\n`)).catch(() => {});
  };
  return { info: (m: string) => write('INFO ', m), error: (m: string) => write('ERROR', m) };
}

export function createDirectorServices(overrides: DirectorOverrides = {}): DirectorServices {
  const fake = config.GENERATION_FAKE === 'on' && !config.isProduction;
  if (config.GENERATION_FAKE === 'on' && config.isProduction) throw new Error('GENERATION_FAKE cannot be on in production');
  const colours = ['goldenrod', 'steelblue', 'seagreen', 'tomato', 'orchid', 'slategray'];
  let colourIndex = 0;
  const providers = overrides.providers ?? (fake ? [createFakeProvider({ pollsBeforeDone: 2, bytesFor: async (file) => {
    // Plain coloured stand-ins so the whole flow, including posters and the render, can be seen.
    const colour = colours[colourIndex++ % colours.length]!;
    if (file.mimeType.startsWith('video/')) return (await makeTestClip(Math.max(1, Math.round((file.durationMs ?? 5000) / 1000)), colour)) ?? Buffer.alloc(0);
    return (await makeTestImage(colour)) ?? TINY_PNG;
  } })] : [createFalProvider({ apiKey: config.FAL_KEY })]);
  const catalogue = overrides.models ? createCatalogue(providers, overrides.models) : fake ? createCatalogue(providers, [FAKE_IMAGE_MODEL, FAKE_VIDEO_MODEL, FAKE_VIDEO_MEDIUM_MODEL, FAKE_VIDEO_HIGH_MODEL, FAKE_REF_VIDEO_MODEL, FAKE_FRAMES_MODEL]) : createCatalogue(providers);
  const store = overrides.store ?? createDiskStore(config.STORAGE_ROOT);
  const review = overrides.review ?? (fake ? { ...noReview, enabled: true } : config.ANTHROPIC_API_KEY ? createClaudeReview() : noReview);
  const finder = overrides.finder ?? createClaudeCastFinder();
  const runner = createRunner({ catalogue, store, review, render: renderTimeline, log: overrides.log ?? fileLog(), ...(overrides.pollMs ? { pollMs: overrides.pollMs } : {}) });
  return { catalogue, store, review, finder, runner };
}
