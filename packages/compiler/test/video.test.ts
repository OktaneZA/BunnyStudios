import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ART_STYLE, CAMERA_MOVEMENT, VIDEO_DIRECTION } from '@storyboard/vocabularies';
import { compileShot, compileVideoShot, STANDARD_NEGATIVE, VIDEO_TEMPLATE_VERSION, type CompileInput, type VideoCompileInput } from '../src/index.ts';

const base: CompileInput = {
  bible: { artStyle: '2d_flat_vector', lineTreatment: 'thick outlines', defaultLighting: '', renderQualityTokens: '', negativePrompt: '', colourPalette: [] },
  scene: {
    description: 'Bunny hops onto the log and waves at Griggs.', sceneryDescription: '', cameraAngle: 'eye_level', timeOfDay: 'morning', weather: null,
    moodAtmosphere: null, lightingPreset: null, lighting: '', styleOverride: null, locationName: 'The pond', locationDescription: 'a lily pond', locationDefaultLighting: '',
  },
  shot: {
    shotType: 'wide', lensFocalLength: null, depthOfField: null, subjectPlacement: '', actionBeat: '', expressionNote: '', lightingOverride: null, userPromptAddendum: '',
    characters: [{ name: 'Bunny', description: 'a small white rabbit', costume: 'a blue scarf' }, { name: 'Griggs', description: 'a grumpy frog', costume: '' }],
    propTokens: [],
  },
};
const input = (video: Partial<VideoCompileInput['video']> = {}): VideoCompileInput => ({
  ...structuredClone(base),
  video: { cameraMovement: null, characterTokens: [], styleToken: '', negative: 'field', audio: false, ...video },
});
const say = (list: readonly { value: string; prompt_phrase: string }[], value: string) => list.find((o) => o.value === value)!.prompt_phrase;

test('the video prompt leads with who is in it and what happens, and ends with the look', () => {
  const r = compileVideoShot(input());
  assert.ok(r.prompt.startsWith('Bunny: a small white rabbit, wearing a blue scarf; Griggs: a grumpy frog. Bunny hops onto the log'));
  assert.ok(r.prompt.endsWith(`${say(ART_STYLE, '2d_flat_vector')}, thick outlines.`));
  assert.equal(r.templateVersion, VIDEO_TEMPLATE_VERSION);
  assert.equal(r.negativePrompt, STANDARD_NEGATIVE);
  assert.equal(r.characterCount, 2);
});

test('picture tokens sit inline next to each character, in the order the server gives', () => {
  const r = compileVideoShot(input({ characterTokens: [{ name: 'Griggs', tokens: ['@Image3'] }, { name: 'Bunny', tokens: ['@Image1', '@Image2'] }] }));
  assert.ok(r.prompt.startsWith('Bunny (@Image1, @Image2): a small white rabbit, wearing a blue scarf; Griggs (@Image3): a grumpy frog.'));
  // A character with no pictures keeps plain words.
  const partly = compileVideoShot(input({ characterTokens: [{ name: 'Bunny', tokens: ['Image 1'] }] }));
  assert.ok(partly.prompt.includes('Bunny (Image 1): a small white rabbit') && partly.prompt.includes('; Griggs: a grumpy frog'));
});

test('camera movement appears only in the video prompt (PC-2c)', () => {
  const r = compileVideoShot(input({ cameraMovement: 'dolly_in' }));
  assert.ok(r.prompt.includes(say(CAMERA_MOVEMENT, 'dolly_in')));
  const still = compileShot(base);
  for (const option of CAMERA_MOVEMENT) assert.ok(!still.prompt.includes(option.prompt_phrase));
  assert.ok(!compileVideoShot(input({ cameraMovement: 'not_a_move' })).prompt.includes('undefined'));
});

test('without a negative field the keep-outs are said in the prompt, and the negative is empty', () => {
  const r = compileVideoShot(input({ negative: 'fold' }));
  assert.ok(r.prompt.endsWith(`${say(VIDEO_DIRECTION, 'keep_out')}.`));
  assert.equal(r.negativePrompt, '');
  assert.ok(!compileVideoShot(input()).prompt.includes(say(VIDEO_DIRECTION, 'keep_out')));
});

test('sound asks for effects only; the style picture is named in the look', () => {
  const r = compileVideoShot(input({ audio: true, styleToken: '@Image4' }));
  assert.ok(r.prompt.includes(say(VIDEO_DIRECTION, 'ambient_sound')));
  assert.ok(r.prompt.includes(`${say(VIDEO_DIRECTION, 'style_reference')} @Image4`));
});

test('a scene style override and the bible look both reach the video prompt', () => {
  const i = input();
  i.scene.styleOverride = 'chalk drawing';
  i.bible.colourPalette = ['teal', 'cream'];
  i.bible.negativePrompt = 'scary';
  const r = compileVideoShot(i);
  assert.ok(r.prompt.includes('chalk drawing, thick outlines, colour palette: teal, cream'));
  assert.equal(r.negativePrompt, `scary, ${STANDARD_NEGATIVE}`);
});

test('every section is optional; the same input gives byte-identical output', () => {
  const empty: VideoCompileInput = {
    bible: { artStyle: '', lineTreatment: '', defaultLighting: '', renderQualityTokens: '', negativePrompt: '', colourPalette: [] },
    scene: { description: '', sceneryDescription: '', cameraAngle: null, timeOfDay: '', weather: null, moodAtmosphere: null, lightingPreset: null, lighting: '', styleOverride: null, locationName: '', locationDescription: '', locationDefaultLighting: '' },
    shot: { shotType: null, lensFocalLength: null, depthOfField: null, subjectPlacement: '', actionBeat: '', expressionNote: '', lightingOverride: null, userPromptAddendum: '', characters: [], propTokens: [] },
    video: { cameraMovement: null, characterTokens: [], styleToken: '', negative: 'field', audio: false },
  };
  assert.equal(compileVideoShot(empty).prompt, '');
  const full = input({ cameraMovement: 'pan_left', characterTokens: [{ name: 'Bunny', tokens: ['@Image1'] }], styleToken: '@Image2', negative: 'fold', audio: true });
  full.shot.userPromptAddendum = 'Bubbles float past.';
  full.shot.expressionNote = 'Bunny grins';
  full.shot.subjectPlacement = 'left of frame';
  full.scene.weather = 'light rain';
  full.scene.lighting = 'soft glow';
  full.scene.moodAtmosphere = 'whimsical';
  full.bible.renderQualityTokens = 'crisp';
  full.shot.propTokens = ['a red kite'];
  full.scene.sceneryDescription = 'reeds';
  assert.equal(compileVideoShot(full).prompt, compileVideoShot(structuredClone(full)).prompt);
  assert.ok(compileVideoShot(full).prompt.includes('Bubbles float past'));
});

test('two characters with the same name each keep their own words and pictures when ids are given', () => {
  const i = input({ characterTokens: [{ id: 'a', name: 'Bunny', tokens: ['@Image1'] }, { id: 'b', name: 'Bunny', tokens: ['@Image2'] }] });
  i.shot.characters = [{ id: 'a', name: 'Bunny', description: 'a white rabbit', costume: '' }, { id: 'b', name: 'Bunny', description: 'a brown rabbit', costume: '' }];
  const r = compileVideoShot(i);
  assert.ok(r.prompt.startsWith('Bunny (@Image1): a white rabbit; Bunny (@Image2): a brown rabbit.'));
  assert.equal(r.characterCount, 2);
  // Without ids the old rule holds: one name, one character.
  i.shot.characters = i.shot.characters.map(({ id: _id, ...c }) => c);
  assert.equal(compileVideoShot(i).characterCount, 1);
});
