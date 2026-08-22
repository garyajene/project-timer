import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StateStore } from './src/server/stateStore.js';
import { authenticate, clearSessionCookie, hashPassword, hashSessionToken, issueSession, normalizeEmail, parseCookies, SESSION_COOKIE, sessionCookie, verifyPassword } from './src/server/auth.js';

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

function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320; }
function sameOrigin(request) {
  if (!request.headers.origin) return true;
  const protocol = request.headers['x-forwarded-proto'] || 'http';
  return request.headers.origin === `${protocol}://${request.headers.host}`;
}

export function createAppServer(stateStore = store, { allowRegistration = process.env.ALLOW_REGISTRATION === 'true' } = {}) {
  return createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/') && ['POST', 'PUT', 'DELETE'].includes(request.method) && !sameOrigin(request)) return sendJson(response, 403, { error: 'Cross-origin request rejected' });
    if (pathname === '/api/auth/session' && request.method === 'GET') {
      const session = await authenticate(request, stateStore);
      return session ? sendJson(response, 200, { authenticated: true, user: { id: session.userId, email: session.email } }) : sendJson(response, 401, { authenticated: false });
    }
    if (pathname === '/api/auth/register' && request.method === 'POST') {
      try {
        if (!allowRegistration) return sendJson(response, 403, { error: 'Registration is currently disabled' });
        const body = await readJson(request);
        const emailNormalized = normalizeEmail(body.email);
        if (!validEmail(emailNormalized)) return sendJson(response, 400, { error: 'Enter a valid email address' });
        if (body.password !== body.confirmPassword) return sendJson(response, 400, { error: 'Passwords do not match' });
        const id = randomUUID();
        const user = await stateStore.createUser({ id, email: String(body.email).trim(), emailNormalized, passwordHash: await hashPassword(body.password) });
        const token = await issueSession(stateStore, id);
        response.setHeader('Set-Cookie', sessionCookie(token));
        return sendJson(response, 201, { user });
      } catch (error) {
        if (/UNIQUE constraint failed/i.test(error.message)) return sendJson(response, 409, { error: 'An account with that email already exists' });
        const status = error instanceof SyntaxError || error instanceof TypeError ? 400 : 500;
        return sendJson(response, status, { error: status === 400 ? error.message : 'Registration failed' });
      }
    }
    if (pathname === '/api/auth/login' && request.method === 'POST') {
      try {
        const body = await readJson(request);
        const user = await stateStore.findUserByEmail(normalizeEmail(body.email));
        if (!user || user.disabledAt || !await verifyPassword(body.password, user.passwordHash)) return sendJson(response, 401, { error: 'Invalid email or password' });
        const token = await issueSession(stateStore, user.id);
        response.setHeader('Set-Cookie', sessionCookie(token));
        return sendJson(response, 200, { user: { id: user.id, email: user.email } });
      } catch (error) {
        const status = error instanceof SyntaxError ? 400 : 500;
        return sendJson(response, status, { error: status === 400 ? error.message : 'Login failed' });
      }
    }
    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
      if (token) await stateStore.revokeSession(hashSessionToken(token));
      response.setHeader('Set-Cookie', clearSessionCookie());
      return sendJson(response, 200, { authenticated: false });
    }
    if (pathname === '/api/state') {
      try {
        const session = await authenticate(request, stateStore);
        if (!session) return sendJson(response, 401, { error: 'Authentication required' });
        if (request.method === 'GET') return sendJson(response, 200, await stateStore.loadForUser(session.userId));
        if (request.method === 'PUT') {
          const body = await readJson(request);
          const saved = await stateStore.saveForUser(session.userId, body.state, body.revision);
          return saved ? sendJson(response, 200, saved) : sendJson(response, 409, { error: 'State changed in another tab. Reload before saving again.' });
        }
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
