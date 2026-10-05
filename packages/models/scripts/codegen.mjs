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
  if (m.kind === 'video' && m.enabled && !['low', 'medium', 'high'].includes(m.tier)) errors.push(`${at}: an enabled video model needs tier low, medium or high`);
  if (m.kind === 'image' && m.tier !== undefined) errors.push(`${at}: only video models carry a tier`);

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
    if (!m.capabilities.image_to_video && !m.capabilities.text_to_video && !m.capabilities.reference_images) errors.push(`${at}: a video model must support a video task`);
    if (m.capabilities.image_to_video !== m.capabilities.start_frame) errors.push(`${at}: image_to_video and start_frame must agree`);
    if (m.capabilities.start_frame && !m.request_shape.start_frame) errors.push(`${at}: start_frame needs request_shape.start_frame`);
    if (m.capabilities.audio && !m.request_shape.audio && m.video?.audio_mode !== 'always') errors.push(`${at}: audio needs request_shape.audio`);
    if (m.capabilities.reference_images && !m.request_shape.reference_images) errors.push(`${at}: references need a payload field`);
    if (m.capabilities.end_frame && !m.request_shape.end_frame) errors.push(`${at}: end frame needs a payload field`);
    if (m.video && (!m.video.family || !m.video.documentation || !m.video.categories?.length || m.video.categories.some((c) => !['recommended', 'fast', 'cinematic', 'references', 'more'].includes(c)))) errors.push(`${at}: invalid video presentation`);
    if (m.video?.rollout !== undefined && !['production', 'advanced'].includes(m.video.rollout)) errors.push(`${at}: rollout must be production or advanced`);
    if (m.video?.rollout === 'production' && m.video.verified_live !== true) errors.push(`${at}: a production rollout needs verified_live: true`);
    if (m.pricing) {
      const p = m.pricing;
      if (!['per_second', 'per_clip', 'video_tokens'].includes(p.strategy) || !Number.isFinite(p.pence_per_usd) || p.pence_per_usd <= 0 || !p.source || !p.verified_on) errors.push(`${at}: invalid pricing metadata`);
      const keys = p.strategy === 'per_clip' ? Array.from({ length: Math.floor((d.max - d.min) / d.step) + 1 }, (_, i) => String(d.min + i * d.step)) : m.resolutions;
      if (keys.some((k) => !Number.isFinite(p.rates?.[k]) || p.rates[k] < 0)) errors.push(`${at}: missing or invalid price`);
      if (p.strategy === 'video_tokens' && (!Number.isFinite(p.fps) || p.fps <= 0 || m.resolutions.some((r) => !Number.isFinite(p.pixels_per_frame?.[r]) || p.pixels_per_frame[r] <= 0))) errors.push(`${at}: invalid token dimensions`);
    }
  }
}

// The catalogue against fal's own input schemas (fal-schemas.json, refreshed by
// scripts/fal-schemas.mjs). Offline: a wrong field name, an unsupported length or size, or a
// provider prompt rewriter left on fails here rather than on a paid request.
const REWRITERS = { prompt_optimizer: false, enable_prompt_expansion: false, prompt_expansion_mode: 'disabled', auto_fix: false };
const MAPPED = ['prompt', 'negative_prompt', 'count', 'reference_images', 'start_frame', 'end_frame', 'duration', 'aspect_ratio', 'audio', 'resolution', 'safety', 'seed', 'camera_motion'];
let schemas = {};
try { schemas = JSON.parse(readFileSync(join(root, 'fal-schemas.json'), 'utf8')).endpoints; } catch { errors.push('fal-schemas.json is missing: run npm run schemas:refresh -w @storyboard/models'); }
for (const m of doc.models.filter((x) => x.provider === 'fal')) {
  const at = `models.${m.id}`;
  const schema = schemas[m.provider_model];
  if (!schema) { if (Object.keys(schemas).length) errors.push(`${at}: ${m.provider_model} is not in fal-schemas.json (run npm run schemas:refresh -w @storyboard/models)`); continue; }
  const s = m.request_shape;
  for (const key of MAPPED) if (s[key] && !schema.fields[s[key]]) errors.push(`${at}: request_shape.${key} "${s[key]}" is not an input of ${m.provider_model}`);
  for (const key of Object.keys(s.defaults ?? {})) if (!schema.fields[key]) errors.push(`${at}: default "${key}" is not an input of ${m.provider_model}`);
  for (const [field, off] of Object.entries(REWRITERS)) {
    if (schema.fields[field] && s.defaults?.[field] !== off) errors.push(`${at}: ${field} rewrites the reviewed prompt; set request_shape.defaults.${field} to ${JSON.stringify(off)}`);
  }
  for (const field of schema.required) {
    if (!Object.values(s).includes(field) && !(field in (s.defaults ?? {}))) errors.push(`${at}: ${m.provider_model} requires "${field}", which nothing sends`);
  }
  const allowed = (field) => schema.fields[field]?.enum?.map(String);
  if (m.kind === 'video' && s.duration && allowed(s.duration) && m.duration_seconds) {
    const d = m.duration_seconds;
    for (let n = d.min; n <= d.max; n += d.step) {
      const sent = s.duration_format === 'string_seconds_suffix' ? `${n}s` : String(n);
      if (!allowed(s.duration).includes(sent)) errors.push(`${at}: ${m.provider_model} cannot make ${n} seconds`);
    }
  }
  if (s.resolution && allowed(s.resolution)) for (const r of m.resolutions) if (!allowed(s.resolution).includes(r)) errors.push(`${at}: ${m.provider_model} has no resolution "${r}"`);
  if (s.aspect_ratio && allowed(s.aspect_ratio) && s.aspect_ratio_format !== 'flux_size') {
    for (const a of m.aspect_ratios) if (!allowed(s.aspect_ratio).includes(a)) errors.push(`${at}: ${m.provider_model} has no aspect ratio "${a}"`);
  }
  const motion = s.camera_motion && allowed(s.camera_motion);
  for (const [move, value] of Object.entries(m.video?.camera_motion_map ?? {})) {
    if (!motion || !motion.includes(value)) errors.push(`${at}: camera_motion_map.${move} "${value}" is not a camera_motion of ${m.provider_model}`);
  }
  const cap = s.reference_images && schema.fields[s.reference_images]?.max_items;
  if (cap && m.max_reference_images > cap) errors.push(`${at}: ${m.provider_model} takes at most ${cap} reference pictures`);
  const longest = schema.fields[s.prompt]?.max_length;
  if (longest && m.max_prompt_length > longest) errors.push(`${at}: ${m.provider_model} takes prompts up to ${longest} characters`);
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
