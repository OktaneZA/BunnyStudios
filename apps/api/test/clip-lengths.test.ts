import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_MODELS, CLIP_LENGTHS, clipPlan, durationOptions, estimatePence } from '@storyboard/models';
import { resolveOptions } from '../src/routes/director.ts';

test('every cost tier can assemble the four clip lengths and charges all generated seconds', () => {
  const models = ALL_MODELS.filter((m) => m.enabled && m.tier && m.capabilities.text_to_video && !m.pricing);
  assert.equal(models.length, 3);
  for (const model of models) for (const length of CLIP_LENGTHS) {
    const parts = clipPlan(model, length);
    assert.ok(parts.every((n) => durationOptions(model).includes(n)));
    const generated = parts.reduce((sum, n) => sum + n, 0);
    assert.ok(generated >= length);
    assert.equal(estimatePence(model, { durationSeconds: length }), Math.ceil(generated * model.unit_cost_pence));
    assert.equal(resolveOptions(model, { kind: 'video', model_id: model.id, duration_seconds: length }, '16:9').durationSeconds, length);
  }
  assert.deepEqual(clipPlan(models.find((m) => m.tier === 'medium')!, 15), [10, 6]);
  assert.deepEqual(clipPlan(models.find((m) => m.tier === 'high')!, 5), [6]);
});
