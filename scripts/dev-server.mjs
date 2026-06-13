import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve('.');
const defaultPort = 5173;
const preferredPort = Number(process.env.PORT || defaultPort);
const maxPortAttempts = Number(process.env.PORT_ATTEMPTS || 25);

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.icns': 'image/x-icns',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function resolveRequestPath(url) {
  const { pathname } = new URL(url, 'http://localhost');
  const decodedPath = decodeURIComponent(pathname);
  const requestPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const filePath = normalize(join(root, requestPath));

  if (!filePath.startsWith(root)) return null;
  return filePath;
}

function createDevServer() {
  return createServer(async (req, res) => {
    const filePath = resolveRequestPath(req.url || '/');

    if (!filePath) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('Not a file');

      res.writeHead(200, {
        'Content-Type': types[extname(filePath)] || 'application/octet-stream'
      });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
}

function listen(port, attemptsLeft = maxPortAttempts) {
  if (port > 65535 || attemptsLeft < 1) {
    console.error(`Could not start Notas dev server: no available port found from ${preferredPort}.`);
    process.exit(1);
  }

  const server = createDevServer();

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 1) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is already in use; trying ${nextPort}...`);
      listen(nextPort, attemptsLeft - 1);
      return;
    }

    console.error(`Could not start Notas dev server on port ${port}: ${err.message}`);
    process.exit(1);
  });

  server.listen(port, () => {
    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Notas dev server: http://localhost:${boundPort}`);
  });
}

if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
  console.error(`Invalid PORT value: ${process.env.PORT}`);
  process.exit(1);
}

if (!Number.isInteger(maxPortAttempts) || maxPortAttempts < 1) {
  console.error(`Invalid PORT_ATTEMPTS value: ${process.env.PORT_ATTEMPTS}`);
  process.exit(1);
}

listen(preferredPort);
