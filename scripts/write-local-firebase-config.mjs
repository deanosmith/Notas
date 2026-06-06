#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), process.argv[2] || '.env');
const outputFile = resolve(process.cwd(), 'firebase-config.local.js');

const requiredNames = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_APP_ID'
];

const configNames = [
  ...requiredNames,
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_MEASUREMENT_ID'
];

function parseEnv(source) {
  const env = {};

  for (const rawLine of source.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

if (!existsSync(envFile)) {
  console.error(`Missing ${envFile}. Copy .env.example to .env and fill in the Firebase values first.`);
  process.exit(1);
}

const env = parseEnv(readFileSync(envFile, 'utf8'));
const missing = requiredNames.filter(name => !env[name]);

if (missing.length) {
  console.error(`Missing required Firebase values in ${envFile}: ${missing.join(', ')}`);
  process.exit(1);
}

const maxNameLength = Math.max(...configNames.map(name => name.length));
const lines = [
  'window.__env = {',
  ...configNames.map((name, index) => {
    const comma = index === configNames.length - 1 ? '' : ',';
    return `  ${name.padEnd(maxNameLength)}: ${JSON.stringify(env[name] || '')}${comma}`;
  }),
  '};',
  ''
];

writeFileSync(outputFile, lines.join('\n'));
console.log(`Wrote ${outputFile}`);
