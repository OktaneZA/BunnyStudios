/**
 * Snapshot of fal's public input schemas for every fal model in models.json
 * (docs/video-optimisation-plan.md §4 step 1).
 *
 *   node scripts/fal-schemas.mjs            refresh fal-schemas.json from the network
 *   node scripts/fal-schemas.mjs --check    fail if fal's live schemas drifted from the snapshot
 *
 * Reading a schema is free and runs no generation; no key is sent. The committed snapshot is
 * what codegen validates the catalogue against, so `npm test` never touches the network.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = join(root, 'fal-schemas.json');
const doc = JSON.parse(readFileSync(join(root, 'models.json'), 'utf8'));
const endpoints = [...new Set(doc.models.filter((m) => m.provider === 'fal').map((m) => m.provider_model))].sort();

async function inputSchema(endpoint) {
  const response = await fetch(`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(endpoint)}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
  const openapi = await response.json();
  const schemas = openapi.components?.schemas ?? {};
  const input = Object.entries(schemas).find(([name]) => /Input$/.test(name))?.[1];
  if (!input?.properties) throw new Error(`${endpoint}: no input schema`);
  const fields = {};
  for (const name of Object.keys(input.properties).sort()) {
    const p = input.properties[name];
    const v = p.anyOf ? { ...p, ...p.anyOf.find((x) => x.type && x.type !== 'null') } : p;
    const field = {};
    if (Array.isArray(v.enum)) field.enum = v.enum;
    const fallback = p.default ?? v.default;
    if (fallback !== undefined) field.default = fallback;
    if (Number.isFinite(v.maxLength)) field.max_length = v.maxLength;
    if (Number.isFinite(v.maxItems)) field.max_items = v.maxItems;
    fields[name] = field;
  }
  return { required: [...(input.required ?? [])].sort(), fields };
}

const live = {};
for (const endpoint of endpoints) live[endpoint] = await inputSchema(endpoint);

if (process.argv.includes('--check')) {
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')).endpoints;
  const drift = [];
  for (const endpoint of endpoints) {
    if (!snapshot[endpoint]) { drift.push(`${endpoint}: not in the snapshot`); continue; }
    if (JSON.stringify(snapshot[endpoint]) !== JSON.stringify(live[endpoint])) drift.push(`${endpoint}: schema changed`);
  }
  if (drift.length) {
    console.error(`fal schemas drifted (${drift.length}):\n  - ${drift.join('\n  - ')}\nReview, then run: npm run schemas:refresh -w @storyboard/models`);
    process.exit(1);
  }
  console.log(`fal schemas match the snapshot (${endpoints.length} endpoints)`);
} else {
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(snapshotPath, `${JSON.stringify({ fetched_on: today, source: 'https://fal.ai/api/openapi/queue/openapi.json', endpoints: live }, null, 2)}\n`);
  console.log(`wrote ${snapshotPath} (${endpoints.length} endpoints)`);
}
