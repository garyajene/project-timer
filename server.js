import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const root = resolve(process.env.STATIC_DIR ?? (existsSync('dist') ? 'dist' : '.'));

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

const server = createServer((request, response) => {
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

server.listen(port, '0.0.0.0', () => {
  console.log(`Project Timer is running on port ${port}`);
});
