import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppServer } from '../server.js';
import { EMPTY_STATE, normalizeState } from '../src/server/stateStore.js';
import { remainingFromTimerState } from '../src/timerPersistence.js';

process.env.NODE_ENV = 'test';

class MemoryStore {
  constructor() { this.users = new Map(); this.sessions = new Map(); this.states = new Map(); }
  async createUser(user) {
    if ([...this.users.values()].some((item) => item.emailNormalized === user.emailNormalized)) { const error = new Error('unique'); error.code = '23505'; throw error; }
    this.users.set(user.id, { ...user }); this.states.set(user.id, { state: structuredClone(EMPTY_STATE), revision: 1 });
    return { id: user.id, email: user.email };
  }
  async findUserByEmail(email) { return [...this.users.values()].find((user) => user.emailNormalized === email) || null; }
  async createSession(session) { this.sessions.set(session.tokenHash, { ...session }); }
  async getSession(hash) { const session = this.sessions.get(hash); if (!session || session.revoked || Date.parse(session.expiresAt) <= Date.now()) return null; const user = this.users.get(session.userId); return { id: session.id, userId: user.id, email: user.email }; }
  async revokeSession(hash) { const session = this.sessions.get(hash); if (session) session.revoked = true; }
  async loadForUser(userId) { return structuredClone(this.states.get(userId)); }
  async saveForUser(userId, state, revision) { const current = this.states.get(userId); if (current.revision !== revision) return null; const saved = { state: normalizeState(state), revision: revision + 1 }; this.states.set(userId, structuredClone(saved)); return saved; }
  async replaceOwnerState(userId, state) { const current = this.states.get(userId); this.states.set(userId, { state: normalizeState(state), revision: current.revision + 1 }); }
}

async function fixture(t) {
  const store = new MemoryStore(); const server = createAppServer(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { store, base: `http://127.0.0.1:${server.address().port}` };
}

async function auth(base, path, body, cookie = '') {
  const response = await fetch(`${base}/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

const account = (email) => ({ email, password: 'correct horse battery staple', confirmPassword: 'correct horse battery staple' });
const markers = (letter) => ({
  ...structuredClone(EMPTY_STATE), projects: [`Project ${letter}`],
  schedule: [{ time: '09:00', project: `Project ${letter}`, title: `Schedule ${letter}`, duration: 120, zenBreakMinutes: letter === 'A' ? 5 : 2 }],
  schedules: { '2026-08-22': [{ time: '09:00', project: `Project ${letter}`, title: `Schedule ${letter}`, duration: 120 }] },
  autoStartNextTask: letter === 'A', notes: { parkingLot: `Notes ${letter}`, general: `General ${letter}` },
  timerState: { status: 'paused', mode: 'quick', configuredDurationSeconds: 7200, remainingSecondsWhenPaused: 7100, quickTask: { active: true, title: `Quick ${letter}`, project: 'Quick Start', duration: 120 }, activeBlockIdentity: null },
});

test('registration hashes passwords, session persists, and logout revokes it', async (t) => {
  const { base, store } = await fixture(t); const registered = await auth(base, 'register', account('A@Example.test'));
  assert.equal(registered.response.status, 201); assert.match(registered.response.headers.get('set-cookie'), /HttpOnly.*SameSite=Lax/);
  assert.notEqual([...store.users.values()][0].passwordHash, account('').password);
  assert.match([...store.users.values()][0].passwordHash, /^scrypt\$/);
  assert.equal((await fetch(`${base}/api/auth/session`, { headers: { Cookie: registered.cookie } })).status, 200);
  assert.equal((await auth(base, 'logout', {}, registered.cookie)).response.status, 200);
  assert.equal((await fetch(`${base}/api/auth/session`, { headers: { Cookie: registered.cookie } })).status, 401);
  const loggedIn = await auth(base, 'login', { email: 'a@example.test', password: account('').password });
  assert.equal(loggedIn.response.status, 200);
});

test('state is authenticated, isolated by session, ignores forged IDs, and detects stale revisions', async (t) => {
  const { base } = await fixture(t);
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  const a = await auth(base, 'register', account('a@example.test')); const b = await auth(base, 'register', account('b@example.test'));
  const put = (cookie, state, revision, extra = {}) => fetch(`${base}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-User-ID': extra.forged || '' }, body: JSON.stringify({ state, revision, user_id: extra.forged }) });
  assert.equal((await put(a.cookie, markers('A'), 1, { forged: 'user-b' })).status, 200);
  assert.equal((await put(b.cookie, markers('B'), 1)).status, 200);
  const stateA = await (await fetch(`${base}/api/state`, { headers: { Cookie: a.cookie } })).json();
  const stateB = await (await fetch(`${base}/api/state`, { headers: { Cookie: b.cookie } })).json();
  assert.deepEqual(stateA.state.projects, ['Project A']); assert.equal(stateA.state.notes.parkingLot, 'Notes A'); assert.equal(stateA.state.timerState.quickTask.title, 'Quick A');
  assert.deepEqual(stateB.state.projects, ['Project B']); assert.equal(stateB.state.notes.parkingLot, 'Notes B'); assert.equal(stateB.state.timerState.quickTask.title, 'Quick B');
  assert.equal((await put(a.cookie, markers('stale'), 1)).status, 409);
});

test('legacy state gains backward-compatible private fields and owner copy leaves source unchanged', async () => {
  const legacy = { projects: ['Legacy'], schedule: [], schedules: {}, activeIndex: 0, autoStartNextTask: true };
  const source = JSON.stringify(legacy); const migrated = normalizeState(JSON.parse(source));
  assert.deepEqual(migrated.notes, { parkingLot: '', general: '' }); assert.equal(migrated.timerState.status, 'idle'); assert.equal(JSON.stringify(legacy), source);
});

test('running and paused scheduled or Quick Task timers restore from persisted timestamps only', () => {
  const now = Date.parse('2026-08-22T12:00:00Z');
  assert.equal(remainingFromTimerState({ status: 'running', endsAt: '2026-08-22T13:59:50Z', remainingSecondsWhenPaused: 7200 }, now), 7190);
  assert.equal(remainingFromTimerState({ status: 'paused', endsAt: '2026-08-22T13:59:50Z', remainingSecondsWhenPaused: 4321 }, now), 4321);
  assert.equal(remainingFromTimerState({ status: 'running', mode: 'quick', endsAt: '2026-08-22T12:10:00Z' }, now), 600);
});
