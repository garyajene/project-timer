import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { StateStore, EMPTY_STATE, normalizeState } from '../src/server/stateStore.js';
import { remainingFromTimerState } from '../src/timerPersistence.js';

process.env.NODE_ENV = 'test';
const execFileAsync = promisify(execFile);
const password = 'correct horse battery staple';

const workspace = (letter) => ({
  ...structuredClone(EMPTY_STATE),
  projects: [`Project ${letter}`],
  schedule: [{ time: '09:00', project: `Project ${letter}`, title: `Schedule ${letter}`, duration: 120, zenBreakMinutes: letter === 'A' ? 5 : 2 }],
  schedules: { '2026-08-22': [{ time: '09:00', project: `Project ${letter}`, title: `Schedule ${letter}`, duration: 120 }] },
  autoStartNextTask: letter === 'A',
  notes: { parkingLot: `Notes ${letter}`, general: `General ${letter}` },
  timerState: { status: 'paused', mode: 'quick', configuredDurationSeconds: 7200, remainingSecondsWhenPaused: 7100, startedAt: '2026-08-22T10:00:00.000Z', endsAt: null, activeIndex: null, quickTask: { active: true, project: 'Quick Start', title: `Quick ${letter}`, duration: 120, zenBreakMinutes: 5, zenBreakTiming: 'midpoint' }, zenBreak: null },
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'project-timer-accounts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new StateStore(join(directory, 'project-timer.sqlite'));
  await store.initialize();
  const { createAppServer } = await import('../server.js');
  const server = createAppServer(store, { allowRegistration: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { store, base: `http://127.0.0.1:${server.address().port}`, directory };
}

async function auth(base, route, body = {}, cookie = '') {
  const response = await fetch(`${base}/api/auth/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

const registration = (email) => ({ email, password, confirmPassword: password });

test('legacy workspaces gain private fields without losing existing data', () => {
  const normalized = normalizeState({ projects: ['Existing'], schedule: [], schedules: {}, activeIndex: 0, autoStartNextTask: false });
  assert.deepEqual(normalized.projects, ['Existing']);
  assert.deepEqual(normalized.notes, { parkingLot: '', general: '' });
  assert.equal(normalized.timerState.status, 'idle');
});

test('registration hashes passwords, sessions persist, login works, and logout revokes the session', async (t) => {
  const { store, base } = await fixture(t);
  const registered = await auth(base, 'register', registration('Owner@Example.test'));
  assert.equal(registered.response.status, 201);
  assert.match(registered.response.headers.get('set-cookie'), /HttpOnly.*SameSite=Lax/);
  const user = await store.findUserByEmail('owner@example.test');
  assert.notEqual(user.passwordHash, password);
  assert.match(user.passwordHash, /^scrypt\$/);
  assert.equal((await fetch(`${base}/api/auth/session`, { headers: { Cookie: registered.cookie } })).status, 200);
  assert.equal((await auth(base, 'logout', {}, registered.cookie)).response.status, 200);
  assert.equal((await fetch(`${base}/api/auth/session`, { headers: { Cookie: registered.cookie } })).status, 401);
  const loggedIn = await auth(base, 'login', { email: 'owner@example.test', password });
  assert.equal(loggedIn.response.status, 200);
});

test('state API rejects anonymous access, isolates two users, ignores forged IDs, and rejects stale writes', async (t) => {
  const { base } = await fixture(t);
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  const a = await auth(base, 'register', registration('a@example.test'));
  const b = await auth(base, 'register', registration('b@example.test'));
  const put = (cookie, state, revision, forged = '') => fetch(`${base}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-User-ID': forged }, body: JSON.stringify({ state, revision, user_id: forged }) });
  assert.equal((await put(a.cookie, workspace('A'), 1, 'user-b')).status, 200);
  assert.equal((await put(b.cookie, workspace('B'), 1)).status, 200);
  const stateA = await (await fetch(`${base}/api/state`, { headers: { Cookie: a.cookie } })).json();
  const stateB = await (await fetch(`${base}/api/state`, { headers: { Cookie: b.cookie } })).json();
  assert.deepEqual(stateA.state.projects, ['Project A']);
  assert.equal(stateA.state.notes.parkingLot, 'Notes A');
  assert.equal(stateA.state.timerState.quickTask.title, 'Quick A');
  assert.deepEqual(stateB.state.projects, ['Project B']);
  assert.equal(stateB.state.notes.parkingLot, 'Notes B');
  assert.equal(stateB.state.timerState.quickTask.title, 'Quick B');
  assert.equal((await put(a.cookie, workspace('stale'), 1)).status, 409);
});

test('unsafe cross-origin state writes are rejected', async (t) => {
  const { base } = await fixture(t);
  const account = await auth(base, 'register', registration('origin@example.test'));
  const response = await fetch(`${base}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: account.cookie, Origin: 'https://attacker.example' }, body: JSON.stringify({ state: workspace('X'), revision: 1 }) });
  assert.equal(response.status, 403);
});

test('owner bootstrap backs up SQLite, copies legacy state, verifies it, and retains app_state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'project-timer-owner-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new StateStore(join(directory, 'project-timer.sqlite'));
  await store.initialize();
  await store.save(workspace('OWNER'));
  const { stdout } = await execFileAsync(process.execPath, ['scripts/bootstrap-owner.js'], { cwd: process.cwd(), env: { ...process.env, DATA_DIR: directory, OWNER_EMAIL: 'owner@example.test', OWNER_PASSWORD: password, CONFIRM_OWNER_BOOTSTRAP: 'copy-and-retain' } });
  const result = JSON.parse(stdout.trim());
  assert.equal(result.verified, true);
  assert.equal(result.legacyStateRetained, true);
  assert.ok((await readdir(directory)).some((name) => name.endsWith('.bak')));
  const owner = await store.findUserByEmail('owner@example.test');
  assert.deepEqual((await store.loadForUser(owner.id)).state, workspace('OWNER'));
  assert.deepEqual(normalizeState(JSON.parse(await store.query('SELECT state_json FROM app_state WHERE id=1;'))), workspace('OWNER'));
});

test('running and paused timers restore from actual timestamps', () => {
  const now = Date.parse('2026-08-22T10:00:10.000Z');
  assert.equal(remainingFromTimerState({ status: 'running', endsAt: '2026-08-22T12:00:00.000Z', remainingSecondsWhenPaused: 7200 }, now), 7190);
  assert.equal(remainingFromTimerState({ status: 'paused', remainingSecondsWhenPaused: 4312 }, now), 4312);
});
