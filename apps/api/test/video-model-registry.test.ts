import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_MODELS, createVideoModelRegistry, VIDEO_MODEL_REGISTRY, type GenerationModel } from '@storyboard/models';
import { createCatalogue } from '../src/generation/catalogue.ts';
import { createFakeProvider, FAKE_IMAGE_MODEL, FAKE_I2V_MODEL } from '../src/generation/fake.ts';

test('registry derives video definitions from the single catalogue, including disabled endpoints', () => {
  assert.deepEqual(VIDEO_MODEL_REGISTRY.definitions.map((m) => m.id), ALL_MODELS.filter((m) => m.kind === 'video').map((m) => m.id));
  assert.equal(VIDEO_MODEL_REGISTRY.get('quick_picture'), undefined);
  assert.equal(VIDEO_MODEL_REGISTRY.get('unknown'), undefined);
});

test('native duration selection never pretends an assembled 30-second clip is native', () => {
  assert.ok(VIDEO_MODEL_REGISTRY.matching({ nativeDurationSeconds: 30 }).some((m) => m.id === 'seedance_25'));
  assert.equal(VIDEO_MODEL_REGISTRY.matching({ nativeDurationSeconds: 30 }).some((m) => m.id === 'clip_low'), false);
  assert.ok(VIDEO_MODEL_REGISTRY.matching({ task: 'text-to-video', nativeDurationSeconds: 10 }).some((m) => m.id === 'clip_medium'));
  assert.equal(VIDEO_MODEL_REGISTRY.matching({ task: 'text-to-video', nativeDurationSeconds: 5 }).some((m) => m.id === 'clip_medium'), false);
});

test('reference and end-frame requirements cannot fall back to text-only models', () => {
  const reference: GenerationModel = {
    ...FAKE_I2V_MODEL,
    capabilities: { ...FAKE_I2V_MODEL.capabilities, reference_images: true, requires_reference_images: true, end_frame: true },
    max_reference_images: 2,
  };
  const registry = createVideoModelRegistry([reference]);
  assert.equal(registry.matching({ task: 'reference-to-video', referenceImageCount: 2, endFrame: true }).length, 1);
  for (const referenceImageCount of [0, 3, -1, 0.5, NaN]) {
    assert.equal(registry.matching({ referenceImageCount }).length, 0);
  }
  const endFrames = VIDEO_MODEL_REGISTRY.matching({ endFrame: true });
  assert.deepEqual(endFrames.map((m) => m.id), ['seedance_25_i2v', 'wan_30_i2v']);
  assert.ok(endFrames.every((m) => m.capabilities.end_frame && m.capabilities.start_frame));
  assert.ok(VIDEO_MODEL_REGISTRY.matching({ task: 'reference-to-video' }).every((m) => m.capabilities.reference_images));
});

test('selection respects audio, resolution, aspect, task and tier together', () => {
  const candidates = VIDEO_MODEL_REGISTRY.matching({ task: 'text-to-video', tier: 'high', audio: true, resolution: '720p', aspectRatio: '16:9' });
  assert.ok(candidates.some((m) => m.id === 'clip_high'));
  assert.ok(candidates.every((m) => m.capabilities.audio && m.resolutions.includes('720p') && m.capabilities.text_to_video));
  assert.equal(VIDEO_MODEL_REGISTRY.matching({ resolution: 'unsupported' }).length, 0);
  assert.equal(VIDEO_MODEL_REGISTRY.matching({ multiShot: true }).length, 0);
});

test('deployment catalogue hides disabled models and unavailable providers', () => {
  const disabled = { ...FAKE_I2V_MODEL, enabled: false };
  assert.equal(createCatalogue([createFakeProvider()], [disabled, FAKE_IMAGE_MODEL]).videoModels().length, 0);
  assert.equal(createCatalogue([], [FAKE_I2V_MODEL]).videoModels().length, 0);
  assert.equal(createCatalogue([createFakeProvider()], [FAKE_I2V_MODEL]).videoModels({ task: 'image-to-video' }).length, 1);
});

test('invalid ranges and duplicate registrations fail before selection', () => {
  assert.throws(() => createVideoModelRegistry([FAKE_I2V_MODEL, FAKE_I2V_MODEL]), /Duplicate/);
  assert.throws(() => createVideoModelRegistry([{ ...FAKE_I2V_MODEL, duration_seconds: { min: 5, max: 10, step: 0 } }]), /Invalid/);
});
