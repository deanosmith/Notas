#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const envFile = resolve(rootDir, '.env');
const indexFile = resolve(rootDir, 'index.html');

const firebaseEnvNames = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_MEASUREMENT_ID'
];

const requiredFirebaseEnvNames = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_APP_ID'
];

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp'
};

let lastConfigStatus = '';

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

function loadLocalEnv() {
  if (!existsSync(envFile)) {
    return {
      env: {},
      error: `Missing ${envFile}. Copy .env.example to .env and fill in Firebase values.`
    };
  }

  return {
    env: parseEnv(readFileSync(envFile, 'utf8')),
    error: ''
  };
}

function injectFirebaseConfig(html, env) {
  let output = html;
  const missingTokens = [];

  for (const name of firebaseEnvNames) {
    const token = `"__${name}__"`;
    if (!output.includes(token)) {
      missingTokens.push(token);
      continue;
    }
    output = output.replaceAll(token, JSON.stringify(env[name] || ''));
  }

  if (missingTokens.length) {
    throw new Error(`index.html is missing Firebase config token(s): ${missingTokens.join(', ')}`);
  }

  return output;
}

function reportConfigStatus(env, error) {
  const missing = requiredFirebaseEnvNames.filter(name => !env[name]);
  const status = error || (missing.length ? `Missing required Firebase values in .env: ${missing.join(', ')}` : 'Firebase config loaded from .env.');
  if (status === lastConfigStatus) return;

  lastConfigStatus = status;
  if (error || missing.length) console.warn(status);
  else console.log(status);
}

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function isHiddenPath(pathname) {
  return pathname.split('/').some(part => part.startsWith('.') && part !== '');
}

function serveIndex(res) {
  const { env, error } = loadLocalEnv();
  reportConfigStatus(env, error);
  const html = injectFirebaseConfig(readFileSync(indexFile, 'utf8'), env);
  send(res, 200, html, mimeTypes['.html']);
}

function serveStatic(pathname, res) {
  if (isHiddenPath(pathname)) {
    send(res, 404, 'Not found');
    return;
  }

  const filePath = resolve(rootDir, `.${pathname}`);
  if (!filePath.startsWith(`${rootDir}/`) || !existsSync(filePath)) {
    send(res, 404, 'Not found');
    return;
  }

  const ext = extname(filePath).toLowerCase();
  send(res, 200, readFileSync(filePath), mimeTypes[ext] || 'application/octet-stream');
}

const portArg = process.argv.find(arg => arg.startsWith('--port='));
const port = Number(portArg ? portArg.slice('--port='.length) : process.env.PORT || 8000);
const host = process.env.HOST || '127.0.0.1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${port}`);
  process.exit(1);
}

const server = createServer((req, res) => {
  try {
    const { pathname } = new URL(req.url || '/', `http://${req.headers.host || host}`);
    const decodedPathname = decodeURIComponent(pathname);

    if (decodedPathname === '/' || decodedPathname === '/index.html') {
      serveIndex(res);
      return;
    }

    serveStatic(decodedPathname, res);
  } catch (error) {
    console.error(error);
    send(res, 500, 'Internal server error');
  }
});

server.on('error', error => {
  console.error(error.message);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Notas local server: http://${host}:${port}/`);
});
