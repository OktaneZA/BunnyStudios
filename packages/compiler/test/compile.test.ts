import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compileShot,
  promptBudget,
  STANDARD_NEGATIVE,
  TEMPLATE_VERSION,
  type CompileInput,
} from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');

interface Fixture {
  input: CompileInput;
  expected: { prompt: string; negativePrompt: string; characterCount: number };
}

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as Fixture;
}

const fixtureNames = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

describe('golden fixtures', () => {
  const required = [
    'advanced-full.json',
    'simple-scene.json',
    'duplicate-characters.json',
    'lighting-1-shot-override.json',
    'lighting-2-scene-preset.json',
    'lighting-3-scene-text.json',
    'lighting-4-location-default.json',
    'lighting-5-bible-default.json',
    'time-unspecified.json',
    'unknown-values-ignored.json',
    'style-override.json',
  ];
  for (const name of required) {
    test(`fixture ${name} exists`, () => {
      assert.ok(fixtureNames.includes(name), `missing fixture ${name}`);
    });
  }

  for (const name of fixtureNames) {
    test(name, () => {
      const { input, expected } = loadFixture(name);
      const result = compileShot(input);
      assert.equal(result.prompt, expected.prompt);
      assert.equal(result.negativePrompt, expected.negativePrompt);
      assert.equal(result.characterCount, expected.characterCount);
      assert.equal(result.templateVersion, TEMPLATE_VERSION);
    });
  }
});

describe('paragraph hygiene', () => {
  for (const name of fixtureNames) {
    test(`${name} has no stray separators or whitespace`, () => {
      const { prompt } = compileShot(loadFixture(name).input);
      assert.equal(prompt, prompt.trim(), 'leading/trailing whitespace');
      assert.doesNotMatch(prompt, /  /, 'double space');
      assert.doesNotMatch(prompt, /\.\./, 'double full stop');
      assert.doesNotMatch(prompt, /\. \./, 'empty section');
      assert.doesNotMatch(prompt, /^[.,;:]/, 'leading separator');
      assert.doesNotMatch(prompt, /[,;:]\./, 'dangling separator before a full stop');
      assert.doesNotMatch(prompt, /\n/, 'newline');
      if (prompt !== '') assert.match(prompt, /[^.]\.$/, 'ends with exactly one full stop');
    });
  }
});

describe('assembly rules', () => {
  test('Simple mode compiles to a clean paragraph from just description, camera, time and mood', () => {
    const { input, expected } = loadFixture('simple-scene.json');
    assert.equal(input.shot.actionBeat, '');
    assert.equal(input.bible.artStyle, '');
    const { prompt } = compileShot(input);
    assert.equal(prompt, expected.prompt);
    assert.ok(prompt.includes(input.scene.description), 'scene description stands in for the action beat');
    assert.equal(prompt.split('. ').length, 4);
  });

  test('duplicate characters contribute exactly once (PC-3)', () => {
    const { input } = loadFixture('duplicate-characters.json');
    const { prompt, characterCount } = compileShot(input);
    assert.equal(input.shot.characters.length, 4);
    assert.equal(characterCount, 2);
    assert.equal(prompt.split('Bunny:').length - 1, 1);
    assert.equal(prompt.split('Fox:').length - 1, 1);
  });

  test('the lighting fallback matrix picks the highest non-empty level', () => {
    const wins: Record<string, string> = {
      'lighting-1-shot-override.json': 'a torch under the blanket',
      'lighting-2-scene-preset.json': 'flickering warm candlelight, small pool of light',
      'lighting-3-scene-text.json': 'a bedside lamp glow',
      'lighting-4-location-default.json': 'grey light from a skylight',
      'lighting-5-bible-default.json': 'flat bright studio light',
    };
    const all = Object.values(wins);
    for (const [name, winner] of Object.entries(wins)) {
      const { prompt } = compileShot(loadFixture(name).input);
      assert.ok(prompt.includes(winner), `${name} should contain "${winner}"`);
      for (const other of all) {
        if (other !== winner) assert.ok(!prompt.includes(other), `${name} must not contain "${other}"`);
      }
    }
  });

  test('time_of_day unspecified emits nothing', () => {
    const { input } = loadFixture('time-unspecified.json');
    const { prompt } = compileShot(input);
    assert.doesNotMatch(prompt, /unspecified/);
    assert.ok(prompt.includes('pouring rain'));
  });

  test('unknown vocabulary values are ignored, never thrown', () => {
    const { input } = loadFixture('unknown-values-ignored.json');
    assert.doesNotThrow(() => compileShot(input));
    const { prompt } = compileShot(input);
    for (const bad of ['not_a_style', 'from_the_moon', 'teatime', 'grumpy', 'disco', 'selfie', '1mm', 'blurry_everything']) {
      assert.ok(!prompt.includes(bad), `"${bad}" leaked into the prompt`);
    }
  });

  test('style override beats the art style verbatim', () => {
    const { input } = loadFixture('style-override.json');
    const { prompt } = compileShot(input);
    assert.ok(prompt.startsWith('hand-painted gouache storybook style, soft pencil lines'));
    assert.ok(!prompt.includes('pixel'));
  });

  test('negative prompt joins the bible exclusions with the standard ones', () => {
    assert.equal(
      STANDARD_NEGATIVE,
      'text, watermark, signature, extra limbs, deformed hands, photorealistic, blurry',
    );
    const withBible = compileShot(loadFixture('advanced-full.json').input).negativePrompt;
    assert.equal(withBible, `gore, scary faces, ${STANDARD_NEGATIVE}`);
    const withoutBible = compileShot(loadFixture('all-empty.json').input).negativePrompt;
    assert.equal(withoutBible, STANDARD_NEGATIVE);
  });

  test('camera movement never appears (D6)', () => {
    const { prompt } = compileShot(loadFixture('advanced-full.json').input);
    assert.doesNotMatch(prompt, /pan|dolly|tracking|motion/i);
  });
});

describe('determinism (PC-1)', () => {
  test('compiling the same fixture 100 times yields byte-identical output', () => {
    const { input } = loadFixture('advanced-full.json');
    const first = compileShot(input);
    const firstBytes = Buffer.from(JSON.stringify(first));
    for (let i = 0; i < 100; i++) {
      const again = Buffer.from(JSON.stringify(compileShot(structuredClone(input))));
      assert.ok(firstBytes.equals(again), `run ${i} differed`);
    }
  });

  test('the compiler does not mutate its input', () => {
    const { input } = loadFixture('advanced-full.json');
    const snapshot = JSON.stringify(input);
    compileShot(input);
    assert.equal(JSON.stringify(input), snapshot);
  });

  test('source imports only the vocabulary package and uses no clock, randomness or locale', () => {
    const source = readFileSync(join(here, '..', 'src', 'index.ts'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';?$/gm)].map((m) => m[1]);
    assert.deepEqual(imports, ['@storyboard/vocabularies']);
    for (const forbidden of [/\bDate\b/, /Math\.random/, /toLocale/, /\bIntl\b/, /\brequire\(/, /process\./, /\bfetch\(/]) {
      assert.doesNotMatch(source, forbidden);
    }
  });
});

describe('promptBudget (PC-5, D11)', () => {
  test('74% is neither a warning nor over', () => {
    assert.deepEqual(promptBudget('x'.repeat(74), 100), { length: 74, max: 100, over: false, warning: false });
  });
  test('75% is a warning but not over', () => {
    assert.deepEqual(promptBudget('x'.repeat(75), 100), { length: 75, max: 100, over: false, warning: true });
  });
  test('100% is a warning but not over', () => {
    assert.deepEqual(promptBudget('x'.repeat(100), 100), { length: 100, max: 100, over: false, warning: true });
  });
  test('101% is over', () => {
    assert.deepEqual(promptBudget('x'.repeat(101), 100), { length: 101, max: 100, over: true, warning: true });
  });
});
