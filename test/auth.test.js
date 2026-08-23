import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { StateStore, EMPTY_STATE } from '../src/server/stateStore.js';
import { createAppServer } from '../server.js';

process.env.NODE_ENV = 'test';
const password = 'correct horse battery staple';
const richState = {
  projects: ['Private'], schedule: [{ time: '08:00', project: 'Private', title: 'Secret', duration: 45, zenBreakMinutes: 5 }],
  schedules: { '2026-08-22': [{ time: '08:00', project: 'Private', title: 'Secret', duration: 45 }] }, activeIndex: 0,
  autoStartNextTask: true, notes: { parkingLot: 'private parking', general: 'private notes' },
  timerState: { status: 'paused', mode: 'quick', configuredDurationSeconds: 2700, remainingSecondsWhenPaused: 1200, startedAt: '2026-08-22T08:00:00.000Z', endsAt: null, activeIndex: null, quickTask: { active: true, project: 'Quick Start', title: 'Private quick task', duration: 45, zenBreakMinutes: 5, zenBreakTiming: 'random' }, zenBreak: { active: true } },
};

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'project-timer-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new StateStore(join(directory, 'state.sqlite'));
  await store.initialize();
  const server = createAppServer(store, { authEnabled: true, registrationEnabled: true, ownerEmail: 'owner@example.com', ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { store, url: `http://127.0.0.1:${server.address().port}` };
}

async function post(url, path, body, cookie = '') {
  const response = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  return response;
}
const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];

test('authentication is enabled by default', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'project-timer-auth-default-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new StateStore(join(directory, 'state.sqlite'));
  await store.initialize();
  const server = createAppServer(store, { registrationEnabled: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/session`);
  assert.equal(response.status, 401);
});

test('auth is closed unless registration is explicitly enabled', async (t) => {
  const { url } = await fixture(t, { registrationEnabled: false });
  assert.equal((await post(url, '/api/auth/register', { email: 'a@example.com', password })).status, 403);
});

test('registration, login, session restoration, logout, and password hashing work', async (t) => {
  const { store, url } = await fixture(t);
  const registration = await post(url, '/api/auth/register', { email: ' User@Example.com ', password });
  assert.equal(registration.status, 201);
  const cookie = cookieOf(registration);
  assert.match(registration.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(registration.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.equal((await (await fetch(url + '/api/auth/session', { headers: { Cookie: cookie } })).json()).user.email, 'user@example.com');
  const stored = await store.query("SELECT password_hash FROM users WHERE email='user@example.com';");
  assert.notEqual(stored, password);
  assert.match(stored, /^scrypt\$/);
  const login = await post(url, '/api/auth/login', { email: 'USER@example.com', password });
  assert.equal(login.status, 200);
  const loginCookie = cookieOf(login);
  assert.equal((await post(url, '/api/auth/logout', {}, loginCookie)).status, 200);
  assert.equal((await fetch(url + '/api/auth/session', { headers: { Cookie: loginCookie } })).status, 401);
});

test('state requires a session and is isolated by cookie identity with revision conflicts', async (t) => {
  const { url } = await fixture(t);
  assert.equal((await fetch(url + '/api/state')).status, 401);
  assert.equal((await fetch(url + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: richState, revision: 0 }) })).status, 401);
  const aCookie = cookieOf(await post(url, '/api/auth/register', { email: 'a@example.com', password }));
  const bCookie = cookieOf(await post(url, '/api/auth/register', { email: 'b@example.com', password }));
  const aInitial = await (await fetch(url + '/api/state', { headers: { Cookie: aCookie } })).json();
  assert.deepEqual(aInitial.state, EMPTY_STATE);
  const saveA = await fetch(url + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: aCookie }, body: JSON.stringify({ userId: 'forged-b-id', state: richState, revision: 0 }) });
  assert.equal(saveA.status, 200);
  assert.equal((await fetch(url + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: aCookie }, body: JSON.stringify({ state: richState, revision: 0 }) })).status, 409);
  const bState = await (await fetch(url + '/api/state', { headers: { Cookie: bCookie, 'X-User-Id': 'forged-a-id' } })).json();
  assert.deepEqual(bState.state, EMPTY_STATE);
  assert.equal(bState.revision, 0);
  assert.deepEqual((await (await fetch(url + '/api/state', { headers: { Cookie: aCookie } })).json()).state, richState);
});

test('owner gets a verified legacy copy while app_state stays untouched and others start empty', async (t) => {
  const { store, url } = await fixture(t);
  await store.save(richState);
  const legacyBefore = await store.query('SELECT state_json FROM app_state WHERE id=1;');
  const ownerCookie = cookieOf(await post(url, '/api/auth/register', { email: 'OWNER@example.com', password }));
  assert.deepEqual((await (await fetch(url + '/api/state', { headers: { Cookie: ownerCookie } })).json()).state, richState);
  assert.equal(await store.query('SELECT state_json FROM app_state WHERE id=1;'), legacyBefore);
  assert.equal((await post(url, '/api/auth/register', { email: 'owner@example.com', password })).status, 409);
  const newCookie = cookieOf(await post(url, '/api/auth/register', { email: 'new@example.com', password }));
  assert.deepEqual((await (await fetch(url + '/api/state', { headers: { Cookie: newCookie } })).json()).state, EMPTY_STATE);
  assert.equal(await store.query('SELECT state_json FROM app_state WHERE id=1;'), legacyBefore);
});
