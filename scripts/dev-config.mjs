import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const envPath = resolve('.env');
const outputPath = resolve('firebase-config.local.js');

const requiredKeys = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_MEASUREMENT_ID'
];

const optionalKeys = [
  'NOTAS_ENABLE_TEST_PASSWORD_AUTH',
  'NOTAS_TEST_PASSWORD_AUTH_DOMAIN'
];

function parseEnv(source) {
  const env = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

const env = parseEnv(await readFile(envPath, 'utf8'));
const missing = requiredKeys.filter((key) => !env[key]);

if (missing.length) {
  console.error(`Missing required .env keys: ${missing.join(', ')}`);
  process.exit(1);
}

const invalid = [];
if (!env.FIREBASE_API_KEY.startsWith('AIza')) invalid.push('FIREBASE_API_KEY');
if (!env.FIREBASE_AUTH_DOMAIN.includes('.firebaseapp.com')) invalid.push('FIREBASE_AUTH_DOMAIN');
if (env.FIREBASE_PROJECT_ID.includes('.')) invalid.push('FIREBASE_PROJECT_ID');
if (!/\.(appspot|firebasestorage)\.com$|\.firebasestorage\.app$/.test(env.FIREBASE_STORAGE_BUCKET)) {
  invalid.push('FIREBASE_STORAGE_BUCKET');
}
if (!/^\d+$/.test(env.FIREBASE_MESSAGING_SENDER_ID)) invalid.push('FIREBASE_MESSAGING_SENDER_ID');
if (!/^1:\d+:web:[a-f0-9]+$/i.test(env.FIREBASE_APP_ID)) invalid.push('FIREBASE_APP_ID');
if (!/^G-[A-Z0-9]+$/.test(env.FIREBASE_MEASUREMENT_ID)) invalid.push('FIREBASE_MEASUREMENT_ID');

if (invalid.length) {
  console.error(`Invalid-looking Firebase .env values: ${invalid.join(', ')}`);
  console.error('Check that each value is assigned to the matching Firebase key.');
  process.exit(1);
}

const payload = Object.fromEntries(requiredKeys.map((key) => [key, env[key]]));
for (const key of optionalKeys) {
  if (env[key]) payload[key] = env[key];
}
const file = `window.__env = ${JSON.stringify(payload, null, 2)};\n`;

await writeFile(outputPath, file, 'utf8');
console.log(`Wrote ${outputPath}`);
