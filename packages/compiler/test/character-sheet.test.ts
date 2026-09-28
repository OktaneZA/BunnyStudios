import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_VIEW, ART_STYLE } from '@storyboard/vocabularies';
import { compileCharacterSheet, CHARACTER_SHEET_VERSION, STANDARD_NEGATIVE, type CharacterSheetInput } from '../src/index.ts';

const bunny: CharacterSheetInput = {
  artStyle: '2d_flat_vector', styleOverride: '', lineTreatment: 'thick outlines', view: 'side',
  character: { name: 'Bunny', description: 'a small white rabbit', species: 'rabbit', build: 'round', colours: 'white fur, pink ears', features: 'a torn left ear', costume: 'a blue scarf' },
  note: '',
};
const phraseOf = (view: string) => REFERENCE_VIEW.find((v) => v.value === view)!.prompt_phrase;

test('a character sheet reads style, the vocabulary view, visual traits, then the note', () => {
  const r = compileCharacterSheet({ ...bunny, note: 'Looking surprised.' });
  const style = ART_STYLE.find((s) => s.value === '2d_flat_vector')!.prompt_phrase;
  assert.equal(r.prompt, `${style}, thick outlines. ${phraseOf('side')}. Bunny: a small white rabbit, rabbit, round, white fur, pink ears, a torn left ear, wearing a blue scarf. Looking surprised.`);
  assert.equal(r.negativePrompt, STANDARD_NEGATIVE);
  assert.equal(r.version, CHARACTER_SHEET_VERSION);
});

test('same input, byte-identical output; a style override replaces the art style', () => {
  assert.equal(compileCharacterSheet(bunny).prompt, compileCharacterSheet(structuredClone(bunny)).prompt);
  const r = compileCharacterSheet({ ...bunny, styleOverride: 'chalk drawing', lineTreatment: '' });
  assert.ok(r.prompt.startsWith('chalk drawing. '));
});

test('empty traits and an unknown view contribute nothing; an all-empty sheet is empty', () => {
  const r = compileCharacterSheet({ ...bunny, view: 'no_such_view', character: { name: 'Bunny', description: '', species: '', build: '', colours: '', features: '', costume: '' } });
  assert.ok(!r.prompt.includes('undefined'));
  assert.ok(r.prompt.endsWith('. Bunny.'));
  const empty = compileCharacterSheet({ artStyle: '', styleOverride: '', lineTreatment: '', view: '', note: '', character: { name: '', description: '', species: '', build: '', colours: '', features: '', costume: '' } });
  assert.equal(empty.prompt, '');
});

test('personality is not part of the input, so it can never reach the picture', () => {
  const keys = Object.keys(bunny.character).sort();
  assert.deepEqual(keys, ['build', 'colours', 'costume', 'description', 'features', 'name', 'species']);
});
