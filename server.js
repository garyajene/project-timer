import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';
import { StateStore } from './src/server/stateStore.js';

const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const root = resolve(process.env.STATIC_DIR ?? (existsSync('dist') ? 'dist' : '.'));
const store = new StateStore(resolve(process.env.DATA_DIR ?? '.data', 'project-timer.sqlite'));

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function safePath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const normalizedPath = normalize(decodedPath).replace(/^[/\\]+/, '');
  const filePath = resolve(join(root, normalizedPath || 'index.html'));

  if (!filePath.startsWith(root)) {
    return null;
  }

  return filePath;
}

function sendFile(response, filePath) {
  const extension = extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': mimeTypes[extension] ?? 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createAppServer(stateStore = store) {
  return createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/api/state') {
      try {
        if (request.method === 'GET') return sendJson(response, 200, await stateStore.load());
        if (request.method === 'PUT') return sendJson(response, 200, await stateStore.save(await readJson(request)));
        response.setHeader('Allow', 'GET, PUT');
        return sendJson(response, 405, { error: 'Method not allowed' });
      } catch (error) {
        const status = error instanceof SyntaxError || error instanceof TypeError || error.message === 'Request body is too large' ? 400 : 500;
        console.error('State API failed.', error);
        return sendJson(response, status, { error: status === 400 ? error.message : 'Persistence unavailable' });
      }
    }
    const requestedPath = safePath(request.url ?? '/');

  if (!requestedPath) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Bad request');
    return;
  }

  const filePath = existsSync(requestedPath) && statSync(requestedPath).isDirectory()
    ? join(requestedPath, 'index.html')
    : requestedPath;

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(response, filePath);
    return;
  }

  const fallbackPath = join(root, 'index.html');
  if (existsSync(fallbackPath)) {
    sendFile(response, fallbackPath);
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
  });
}

if (process.env.NODE_ENV !== 'test') {
  await store.initialize();
  createAppServer().listen(port, '0.0.0.0', () => console.log(`Project Timer is running on port ${port}`));
}
