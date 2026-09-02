import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'dotenv';

import { ENV_KEYS } from '../src/config/env.schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const envExamplePath = join(here, '..', '.env.example');
const schemaKeys = ENV_KEYS.map(String).sort();
const fileKeys = Object.keys(parse(readFileSync(envExamplePath))).sort();
const missing = schemaKeys.filter((k) => !fileKeys.includes(k));
const extra = fileKeys.filter((k) => !schemaKeys.includes(k));

if (missing.length || extra.length) {
  console.error('.env.example is out of sync with src/config/env.schema.ts:');

  if (missing.length) console.error(`  - missing from .env.example: ${missing.join(', ')}`);
  if (extra.length) console.error(`  - not defined in schema:     ${extra.join(', ')}`);

  process.exit(1);
}

console.log(`.env.example is in sync with the env schema (${schemaKeys.length} variables).`);