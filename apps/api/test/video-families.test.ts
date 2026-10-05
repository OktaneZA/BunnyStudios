import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_MODELS, modelById, estimatePence, clipPlan } from '@storyboard/models';
import { shapeRequest, type GenerationRequest } from '../src/generation/provider.ts';
import { resolveOptions } from '../src/routes/director.ts';

function request(id: string): GenerationRequest {
  const model = modelById(id)!;
  return { model, prompt: 'Pip runs towards Biscuit.', negativePrompt: '', referenceImages: [], startFrame: null, aspectRatio: '16:9', count: 1, durationSeconds: 10, audio: true, resolution: model.resolutions[0]!, strictSafety: true };
}
const url = () => 'data:image/png;base64,aQ==';

test('six distinct families are categorised; the live-checked Wan 3.0 family is the recommended one (V3)', () => {
  assert.equal(new Set(ALL_MODELS.filter((m) => m.video).map((m) => m.video!.family)).size, 6);
  assert.ok(modelById('wan_30_refs')!.video!.categories.includes('recommended'));
  assert.equal(modelById('wan_30_refs')!.video!.verified_live, true);
  assert.ok(!modelById('seedance_25')!.video!.categories.includes('recommended'), 'Seedance is four times the price and not yet live-checked');
  assert.deepEqual(modelById('hailuo_23')!.video!.categories, ['more']);
});

test('endpoint payloads use the verified names, value types and safe defaults', () => {
  const seedance = shapeRequest(request('seedance_25'), url);
  assert.equal(seedance.duration, '10');
  assert.equal(seedance.generate_audio, true);
  assert.equal(seedance.draft, false);
  assert.equal(seedance.codec, 'H264');
  const wan = shapeRequest(request('wan_30_prime'), url);
  assert.equal(wan.duration, 10);
  assert.equal(wan.audio, true);
  assert.equal(wan.enable_prompt_expansion, false);
  assert.equal(wan.enable_safety_checker, true);
  const h3 = shapeRequest(request('minimax_h3_max'), url);
  assert.equal(h3.resolution, '768P');
  assert.equal(h3.prompt_expansion_mode, 'disabled');
  assert.equal('generate_audio' in h3, false);
  assert.equal(resolveOptions(modelById('minimax_h3_max')!, { kind: 'video', model_id: 'minimax_h3_max', audio: false }, '16:9').audio, true);
  for (const id of ['ltx_25_fast', 'ltx_25_pro']) {
    assert.equal(shapeRequest(request(id), url).fps, 25);
    assert.equal(shapeRequest(request(id), url).duration, '10');
  }
  const hailuo = shapeRequest(request('hailuo_23'), url);
  assert.equal(hailuo.prompt_optimizer, false);
  assert.equal('resolution' in hailuo, false);
  assert.equal('generate_audio' in hailuo, false);
  assert.equal(shapeRequest(request('flux_3_video'), url).safety_tolerance, 0);
});

test('cast references retain names and order, with endpoint-specific tokens', () => {
  for (const [id, key, token] of [['seedance_25_refs', 'image_urls', '@Image'], ['wan_30_refs', 'reference_image_urls', 'Image ']]) {
    const r = request(id!);
    r.referenceImages = [{ bytes: Buffer.from('one'), mimeType: 'image/png' }, { bytes: Buffer.from('two'), mimeType: 'image/png' }];
    r.referenceNames = ['Pip', 'Biscuit'];
    const body = shapeRequest(r, (image) => image.bytes.toString());
    assert.deepEqual(body[key!], ['one', 'two']);
    assert.ok(String(body.prompt).endsWith(`${token}1: Pip\n${token}2: Biscuit`));
    assert.throws(() => shapeRequest({ ...r, referenceImages: [] }, url), /needs character/);
    assert.throws(() => shapeRequest({ ...r, referenceImages: Array(31).fill(r.referenceImages[0]) }, url), /Too many/);
  }
});

test('pricing uses generated parts, resolution and the declared billing method', () => {
  assert.equal(estimatePence(modelById('wan_30')!, { durationSeconds: 30, resolution: '720p' }), 300);
  assert.equal(estimatePence(modelById('wan_30')!, { durationSeconds: 30, resolution: '1080p' }), 600);
  assert.equal(estimatePence(modelById('seedance_25')!, { durationSeconds: 10 }), 463);
  assert.equal(estimatePence(modelById('seedance_25')!, { durationSeconds: 10, resolution: '1080p' }), 1138);
  assert.equal(estimatePence(modelById('hailuo_23')!, { durationSeconds: 5 }), 28);
  assert.equal(estimatePence(modelById('hailuo_23')!, { durationSeconds: 10 }), 56);
  assert.deepEqual(clipPlan(modelById('ltx_25_pro')!, 15), [10, 6]);
  assert.equal(estimatePence(modelById('ltx_25_pro')!, { durationSeconds: 15 }), 192);
  assert.throws(() => estimatePence(modelById('wan_30')!, { durationSeconds: 10, resolution: '4K' }), /Unsupported/);
});
