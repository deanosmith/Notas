#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFirebaseConfig,
  describeFirebaseConfigProblems,
  getFirebaseConfigProblems,
  parseDotEnv,
  renderFirebaseConfigErrorScript,
  renderFirebaseConfigScript
} from './firebase-config.mjs';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const envFile = resolve(rootDir, '.env');
const indexFile = resolve(rootDir, 'index.html');

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

function loadLocalEnv() {
  if (!existsSync(envFile)) {
    return {
      env: {},
      error: `Missing ${envFile}. Copy .env.example to .env and fill in Firebase values.`
    };
  }

  return {
    env: parseDotEnv(readFileSync(envFile, 'utf8')),
    error: ''
  };
}

function reportConfigStatus(env, error) {
  const config = createFirebaseConfig(env);
  const problems = getFirebaseConfigProblems(config);
  const status = error || describeFirebaseConfigProblems(problems) || 'Firebase config loaded from .env.';
  if (status === lastConfigStatus) return;

  lastConfigStatus = status;
  if (error || problems.missing.length || problems.malformed.length) console.warn(status);
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
  send(res, 200, readFileSync(indexFile, 'utf8'), mimeTypes['.html']);
}

function serveFirebaseConfig(res) {
  const { env, error } = loadLocalEnv();
  reportConfigStatus(env, error);

  if (error) {
    send(res, 200, renderFirebaseConfigErrorScript(error, { source: 'local-env' }), mimeTypes['.js']);
    return;
  }

  try {
    const config = createFirebaseConfig(env);
    send(res, 200, renderFirebaseConfigScript(config, { source: 'local-env' }), mimeTypes['.js']);
  } catch (configError) {
    send(res, 200, renderFirebaseConfigErrorScript(configError.message, { source: 'local-env' }), mimeTypes['.js']);
  }
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

    if (decodedPathname === '/firebase-config.js') {
      serveFirebaseConfig(res);
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
