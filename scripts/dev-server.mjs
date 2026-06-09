import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve('.');
const port = Number(process.env.PORT || 5173);

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
  const { pathname } = new URL(url, `http://localhost:${port}`);
  const decodedPath = decodeURIComponent(pathname);
  const requestPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const filePath = normalize(join(root, requestPath));

  if (!filePath.startsWith(root)) return null;
  return filePath;
}

const server = createServer(async (req, res) => {
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

server.listen(port, () => {
  console.log(`Notas dev server: http://localhost:${port}`);
});
