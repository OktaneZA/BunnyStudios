/**
 * Generates src/generated.ts from vocabularies.json, validating as it goes.
 *
 * This script IS the CV-1 / CV-2 / D12 enforcement point. It runs in prebuild and in CI;
 * `--check` mode fails if the committed generated file has drifted from the JSON.
 *
 * Requirements enforced:
 *   CV-1  one machine-readable fixture, imported everywhere — nothing hard-codes a phrase
 *   CV-2  every prompt vocabulary option resolves to exactly one non-empty prompt_phrase
 *   D12   every option also carries friendlyLabel, help and icon for the visual pickers
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const jsonPath = join(root, 'vocabularies.json');
const outPath = join(root, 'src', 'generated.ts');

const doc = JSON.parse(readFileSync(jsonPath, 'utf8'));
const errors = [];

/** Options that are injected into prompts, and so must satisfy CV-2. */
const promptVocabs = doc.vocabularies;
/** Options that are never injected into prompts (§4.9) and so are exempt from CV-2. */
const nonPromptVocabs = Object.fromEntries(
  Object.entries(doc.nonPromptVocabularies).filter(([k]) => k !== 'note'),
);

for (const [name, vocab] of Object.entries(promptVocabs)) {
  const seen = new Set();
  for (const opt of vocab.options) {
    const at = `${name}.${opt.value}`;

    if (seen.has(opt.value)) errors.push(`${at}: duplicate value`);
    seen.add(opt.value);

    // CV-2. `unspecified` (§4.6) is the one sanctioned empty phrase: it must declare
    // emitsNothing so that "empty" is always a deliberate choice and never an omission.
    const empty = !opt.prompt_phrase || opt.prompt_phrase.trim() === '';
    if (empty && opt.emitsNothing !== true) {
      errors.push(`${at}: empty prompt_phrase without emitsNothing:true (CV-2)`);
    }
    if (!empty && opt.emitsNothing === true) {
      errors.push(`${at}: emitsNothing:true but prompt_phrase is not empty`);
    }
    if (opt.prompt_phrase === undefined) {
      errors.push(`${at}: prompt_phrase is absent (CV-2)`);
    }

    // D12 — the presentation layer the visual pickers depend on.
    for (const field of ['label', 'friendlyLabel', 'help', 'icon']) {
      if (!opt[field] || String(opt[field]).trim() === '') {
        errors.push(`${at}: missing ${field} (D12)`);
      }
    }
  }
}

for (const [name, vocab] of Object.entries(nonPromptVocabs)) {
  for (const opt of vocab.options) {
    if ('prompt_phrase' in opt) {
      errors.push(`${name}.${opt.value}: non-prompt vocabulary must not carry a prompt_phrase`);
    }
    for (const field of ['label', 'friendlyLabel', 'icon']) {
      if (!opt[field]) errors.push(`${name}.${opt.value}: missing ${field} (D12)`);
    }
  }
}

if (errors.length > 0) {
  console.error(`vocabularies.json failed validation (${errors.length} problem(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const banner = `// GENERATED FILE — do not edit.
// Source: packages/vocabularies/vocabularies.json
// Regenerate with: npm run codegen -w @storyboard/vocabularies
`;

const lines = [banner];
lines.push(`export const SCHEMA_VERSION = ${JSON.stringify(doc.schemaVersion)} as const;\n`);

const allVocabs = { ...promptVocabs, ...nonPromptVocabs };

for (const [name, vocab] of Object.entries(allVocabs)) {
  const type = name
    .split('_')
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('');
  const values = vocab.options.map((o) => JSON.stringify(o.value)).join(' | ');
  lines.push(`export type ${type} = ${values};`);
  lines.push(
    `export const ${name.toUpperCase()}_VALUES = [${vocab.options
      .map((o) => JSON.stringify(o.value))
      .join(', ')}] as const satisfies readonly ${type}[];`,
  );
  lines.push(
    `export const ${name.toUpperCase()} = ${JSON.stringify(vocab.options, null, 2)} as const;\n`,
  );
}

const generated = lines.join('\n');

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(outPath, 'utf8');
  } catch {
    console.error('generated.ts is missing. Run: npm run codegen -w @storyboard/vocabularies');
    process.exit(1);
  }
  if (current !== generated) {
    console.error('generated.ts is out of date with vocabularies.json.');
    console.error('Run: npm run codegen -w @storyboard/vocabularies');
    process.exit(1);
  }
  console.log('vocabularies: valid and up to date.');
} else {
  writeFileSync(outPath, generated, 'utf8');
  const count = Object.values(allVocabs).reduce((n, v) => n + v.options.length, 0);
  console.log(
    `vocabularies: validated and generated ${count} options across ${Object.keys(allVocabs).length} vocabularies.`,
  );
}
