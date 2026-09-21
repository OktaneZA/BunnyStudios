/**
 * Generates src/generated.ts from models.json, validating as it goes (plan D27, DM-1).
 *
 * This script is the enforcement point: `--check` fails if the committed generated file
 * has drifted from the JSON, and any structural mistake in the catalogue fails here rather
 * than at runtime inside an adapter.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const jsonPath = join(root, 'models.json');
const outPath = join(root, 'src', 'generated.ts');

const doc = JSON.parse(readFileSync(jsonPath, 'utf8'));
const errors = [];
const PROVIDERS = new Set(['fal', 'fake']);
const KINDS = new Set(['image', 'video']);
const CAPS = ['reference_images', 'start_frame', 'end_frame', 'audio', 'multi_shot', 'image_to_video', 'text_to_video'];
const ASPECTS = new Set(['16:9', '9:16', '1:1']);
const seen = new Set();

for (const m of doc.models) {
  const at = `models.${m.id ?? '?'}`;
  if (!m.id || !/^[a-z][a-z0-9_]*$/.test(m.id)) errors.push(`${at}: id must be a snake_case identifier`);
  if (seen.has(m.id)) errors.push(`${at}: duplicate id`);
  seen.add(m.id);
  if (!PROVIDERS.has(m.provider)) errors.push(`${at}: unknown provider "${m.provider}"`);
  if (!m.provider_model) errors.push(`${at}: provider_model is required`);
  if (!KINDS.has(m.kind)) errors.push(`${at}: kind must be image or video`);
  for (const field of ['label', 'friendlyLabel', 'help', 'icon']) {
    if (!m[field] || String(m[field]).trim() === '') errors.push(`${at}: missing ${field}`);
  }
  for (const cap of CAPS) if (typeof m.capabilities?.[cap] !== 'boolean') errors.push(`${at}: capabilities.${cap} must be a boolean`);
  if (m.capabilities?.requires_reference_images && !m.capabilities.reference_images) errors.push(`${at}: requires_reference_images needs reference_images`);
  if (!Array.isArray(m.aspect_ratios) || !m.aspect_ratios.length || m.aspect_ratios.some((a) => !ASPECTS.has(a))) errors.push(`${at}: aspect_ratios must list 16:9, 9:16 and/or 1:1`);
  if (!Array.isArray(m.resolutions) || !m.resolutions.length) errors.push(`${at}: resolutions must be a non-empty list`);
  if (!Number.isInteger(m.max_reference_images) || m.max_reference_images < 0) errors.push(`${at}: max_reference_images must be a non-negative integer`);
  if (!Number.isInteger(m.max_prompt_length) || m.max_prompt_length < 200) errors.push(`${at}: max_prompt_length must be an integer of at least 200`);
  if (typeof m.unit_cost_pence !== 'number' || m.unit_cost_pence < 0) errors.push(`${at}: unit_cost_pence must be a non-negative number`);
  if (typeof m.enabled !== 'boolean') errors.push(`${at}: enabled must be a boolean`);
  if (!m.request_shape?.prompt) errors.push(`${at}: request_shape.prompt is required`);
  if (!m.result_shape?.files) errors.push(`${at}: result_shape.files is required`);

  if (m.kind === 'image') {
    if (m.duration_seconds !== null) errors.push(`${at}: an image model cannot have duration_seconds`);
    if (m.unit !== 'image') errors.push(`${at}: an image model is priced per image`);
    if (m.capabilities.start_frame || m.capabilities.end_frame || m.capabilities.audio || m.capabilities.image_to_video || m.capabilities.text_to_video) {
      errors.push(`${at}: an image model cannot declare video capabilities`);
    }
    if (m.capabilities.reference_images !== (m.max_reference_images > 0)) errors.push(`${at}: reference_images must agree with max_reference_images`);
    if (m.capabilities.reference_images && !m.request_shape.reference_images) errors.push(`${at}: reference_images needs request_shape.reference_images`);
  } else {
    const d = m.duration_seconds;
    if (!d || !Number.isInteger(d.min) || !Number.isInteger(d.max) || !Number.isInteger(d.step) || d.min < 1 || d.max < d.min || d.step < 1) {
      errors.push(`${at}: a video model needs duration_seconds {min, max, step}`);
    }
    if (m.unit !== 'second') errors.push(`${at}: a video model is priced per second`);
    if (!m.capabilities.image_to_video && !m.capabilities.text_to_video) errors.push(`${at}: a video model must support image_to_video or text_to_video`);
    if (m.capabilities.image_to_video !== m.capabilities.start_frame) errors.push(`${at}: image_to_video and start_frame must agree`);
    if (m.capabilities.start_frame && !m.request_shape.start_frame) errors.push(`${at}: start_frame needs request_shape.start_frame`);
    if (m.capabilities.audio && !m.request_shape.audio) errors.push(`${at}: audio needs request_shape.audio`);
  }
}

if (errors.length > 0) {
  console.error(`models.json failed validation (${errors.length} problem(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const banner = `// GENERATED FILE — do not edit.
// Source: packages/models/models.json
// Regenerate with: npm run codegen -w @storyboard/models
`;
const body = `${banner}
export const MODELS = ${JSON.stringify(doc.models, null, 2)} as const;

export type ModelId = (typeof MODELS)[number]['id'];
export type ProviderName = (typeof MODELS)[number]['provider'];
`;

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(outPath, 'utf8'); } catch { /* missing counts as drift */ }
  if (current !== body) {
    console.error('src/generated.ts is out of date with models.json — run: npm run codegen -w @storyboard/models');
    process.exit(1);
  }
  console.log(`models.json OK (${doc.models.length} models)`);
} else {
  writeFileSync(outPath, body);
  console.log(`wrote ${outPath} (${doc.models.length} models)`);
}
