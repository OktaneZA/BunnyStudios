import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSketch, type Sketch } from '../src/thumbnails/sketch.ts';
import { createClaudeThumbnailProvider } from '../src/thumbnails/provider.ts';
import { createClaudeSceneImprover } from '../src/scenes/improver.ts';
import { sceneDescription } from '../src/scenes/description.ts';

export const testSketch: Sketch = {
  description: 'A small character beside a parcel on a porch.', background: '#f6f0e5',
  shapes: [
    { type: 'rect', x: 0, y: 290, width: 640, height: 70, fill: '#b8a18a', stroke: '#403b38', strokeWidth: 3, path: '' },
    { type: 'ellipse', x: 235, y: 100, width: 65, height: 65, fill: '#edca9c', stroke: '#403b38', strokeWidth: 3, path: '' },
    { type: 'path', x: 0, y: 0, width: 0, height: 0, fill: 'none', stroke: '#403b38', strokeWidth: 5, path: 'M 235 135 L 235 235 M 190 170 L 280 170 M 235 235 L 195 290 M 235 235 L 275 290' },
    { type: 'rect', x: 310, y: 215, width: 100, height: 75, fill: '#c6a46c', stroke: '#403b38', strokeWidth: 3, path: '' },
  ],
};

test('renderer permits only validated drawing primitives, never active SVG', () => {
  const result = renderSketch(testSketch);
  assert.match(result.svg, /viewBox="0 0 640 360"/);
  assert.doesNotMatch(result.svg, /<script|href|foreignObject|<text/);
  for (const patch of [ { fill: 'url(https://attacker.invalid)' }, { path: '\"/><script>alert(1)</script>' }, { x: Infinity }, { type: 'image' }, { onload: 'alert(1)' } ]) {
    assert.throws(() => renderSketch({ ...testSketch, shapes: [{ ...testSketch.shapes[0], ...patch }] }));
  }
});

function reply(value: unknown, stop = 'end_turn') {
  return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }], stop_reason: stop, usage: { input_tokens: 10, output_tokens: 20 } }));
}

test('Claude requests use server credentials, bounded structured outputs, and a policy review', async () => {
  const requests: { system: string; output_config: unknown; max_tokens: number }[] = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(new Headers(init?.headers).get('x-api-key'), 'test-key');
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return reply(requests.length === 1 ? testSketch : { allowed: true });
  };
  const provider = createClaudeThumbnailProvider({ apiKey: 'test-key', model: 'test-model' }, fakeFetch);
  const result = await provider.generate({ source: { action: 'Boy finds parcel' }, constrained: true }, new AbortController().signal);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((r) => r.system.includes('viewer is a child')));
  assert.ok(requests.every((r) => r.output_config));
  assert.equal(result.inputTokens, 20);
  assert.equal(result.outputTokens, 40);
});

test('provider failures do not expose upstream secrets or silently retry paid requests', async () => {
  let calls = 0;
  const provider = createClaudeThumbnailProvider({ apiKey: 'test-key', model: 'test-model' }, async () => {
    calls++; return new Response('secret upstream body', { status: 401 });
  });
  await assert.rejects(provider.generate({ source: {}, constrained: false }, new AbortController().signal), (err: Error) => {
    assert.doesNotMatch(err.message, /secret upstream body|test-key/); return true;
  });
  assert.equal(calls, 1);
});

test('a refused policy review or truncated drawing never becomes a preview', async () => {
  let calls = 0;
  let knownInputTokens = 0;
  const denied = createClaudeThumbnailProvider({ apiKey: 'test-key', model: 'test-model' }, async () => reply(++calls === 1 ? testSketch : { allowed: false }));
  await assert.rejects(denied.generate({ source: {}, constrained: true }, new AbortController().signal, (input) => { knownInputTokens += input; }), /gentler/);
  assert.equal(knownInputTokens, 20, 'refused output still reports known usage');
  const truncated = createClaudeThumbnailProvider({ apiKey: 'test-key', model: 'test-model' }, async () => reply(testSketch, 'max_tokens'));
  await assert.rejects(truncated.generate({ source: {}, constrained: false }, new AbortController().signal), /complete thumbnail/);
});

test('scene improver requests environment, action and character detail with a policy review', async () => {
  const requests: { system: string }[] = [];
  const provider = createClaudeSceneImprover({ apiKey: 'test-key', model: 'test-model' }, async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return reply(requests.length === 1 ? { text: 'Two dogs skid around a kitchen table in warm morning light.' } : { allowed: true });
  });
  const result = await provider.generate({ source: { action: 'Two dogs chase a biscuit.' }, constrained: true }, new AbortController().signal);
  assert.match(requests[0]!.system, /environment/);
  assert.match(requests[0]!.system, /selected_settings take precedence/);
  assert.match(requests[0]!.system, /night selection replaces midday sunshine/);
  assert.match(requests[0]!.system, /actions/);
  assert.match(requests[0]!.system, /people or animals/);
  assert.match(requests[0]!.system, /do not invent new characters/);
  assert.ok(requests.every((request) => request.system.includes('viewer is a child')));
  assert.match(result.text, /Two dogs/);
  assert.equal(result.inputTokens, 20);
});

test('an explicitly cleared description does not revive legacy text', () => {
  const scene = { description: null, sceneIntent: 'Same text', actionDescription: 'Same text', sceneryDescription: 'A kitchen' };
  assert.equal(sceneDescription(scene), 'Same text\n\nA kitchen');
  assert.equal(sceneDescription({ ...scene, description: '' }), '');
});
