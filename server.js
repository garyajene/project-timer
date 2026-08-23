import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';
import { StateStore } from './src/server/stateStore.js';

const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const root = resolve(process.env.STATIC_DIR ?? (existsSync('dist') ? 'dist' : '.'));
const store = new StateStore(resolve(process.env.DATA_DIR ?? '.data', 'project-timer.sqlite'));
const SESSION_COOKIE = 'project_timer_session';

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

function flag(value) { return String(value ?? '').toLowerCase() === 'true'; }
function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie ?? '').split(';').map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key).map(([key, value]) => [key, decodeURIComponent(value ?? '')]));
}
function sessionCookie(token, request, maxAge = 60 * 60 * 24 * 30) {
  const production = process.env.NODE_ENV === 'production' || request.headers['x-forwarded-proto'] === 'https';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${production ? '; Secure' : ''}`;
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

export function createAppServer(stateStore = store, options = {}) {
  // Account protection is the production default. Tests and explicit legacy
  // integrations can still opt out through the programmatic server option.
  const authEnabled = options.authEnabled ?? true;
  const registrationEnabled = options.registrationEnabled ?? flag(process.env.REGISTRATION_ENABLED);
  const ownerEmail = options.ownerEmail ?? process.env.OWNER_EMAIL ?? '';
  return createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/auth/')) {
      try {
        if (!authEnabled) return sendJson(response, 404, { error: 'Authentication is disabled' });
        const token = cookies(request)[SESSION_COOKIE];
        if (pathname === '/api/auth/session' && request.method === 'GET') {
          const user = await stateStore.sessionUser(token);
          const registration = { registrationEnabled };
          return user
            ? sendJson(response, 200, { authenticated: true, user, ...registration })
            : sendJson(response, 401, { authenticated: false, ...registration });
        }
        if (pathname === '/api/auth/logout' && request.method === 'POST') {
          await stateStore.deleteSession(token);
          response.setHeader('Set-Cookie', sessionCookie('', request, 0));
          return sendJson(response, 200, { authenticated: false });
        }
        if (pathname === '/api/auth/register' && request.method === 'POST') {
          if (!registrationEnabled) return sendJson(response, 403, { error: 'Registration is closed' });
          const body = await readJson(request);
          const user = await stateStore.register(body.email, body.password, { ownerEmail });
          const newToken = await stateStore.createSession(user.id);
          response.setHeader('Set-Cookie', sessionCookie(newToken, request));
          return sendJson(response, 201, { authenticated: true, user: { id: user.id, email: user.email }, ownerClaimed: user.ownerClaimed });
        }
        if (pathname === '/api/auth/login' && request.method === 'POST') {
          const body = await readJson(request);
          const user = await stateStore.authenticate(body.email, body.password);
          if (!user) return sendJson(response, 401, { error: 'Invalid email or password' });
          const newToken = await stateStore.createSession(user.id);
          response.setHeader('Set-Cookie', sessionCookie(newToken, request));
          return sendJson(response, 200, { authenticated: true, user });
        }
        return sendJson(response, 405, { error: 'Method not allowed' });
      } catch (error) {
        const status = error.code === 'EMAIL_EXISTS' ? 409 : (error instanceof TypeError || error instanceof SyntaxError ? 400 : 500);
        console.error('Auth API failed.', error);
        return sendJson(response, status, { error: status === 500 ? 'Authentication unavailable' : (error.code === 'EMAIL_EXISTS' ? 'Email is already registered' : error.message) });
      }
    }
    if (pathname === '/api/state') {
      try {
        if (!authEnabled) {
          if (request.method === 'GET') return sendJson(response, 200, await stateStore.load());
          if (request.method === 'PUT') return sendJson(response, 200, await stateStore.save(await readJson(request)));
        } else {
          const user = await stateStore.sessionUser(cookies(request)[SESSION_COOKIE]);
          if (!user) return sendJson(response, 401, { error: 'Authentication required' });
          if (request.method === 'GET') return sendJson(response, 200, await stateStore.loadUserState(user.id));
          if (request.method === 'PUT') {
            const body = await readJson(request);
            return sendJson(response, 200, await stateStore.saveUserState(user.id, body.state, body.revision));
          }
        }
        response.setHeader('Allow', 'GET, PUT');
        return sendJson(response, 405, { error: 'Method not allowed' });
      } catch (error) {
        const status = error.code === 'STALE_REVISION' ? 409 : (error instanceof SyntaxError || error instanceof TypeError || error.message === 'Request body is too large' ? 400 : 500);
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

if (process.env.NODE_ENV !== 'test' && resolve(process.argv[1] ?? '') === resolve(new URL(import.meta.url).pathname)) {
  await store.initialize();
  createAppServer().listen(port, '0.0.0.0', () => console.log(`Project Timer is running on port ${port}`));
}
