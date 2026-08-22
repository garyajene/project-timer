import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { StateStore, normalizeState } from '../src/server/stateStore.js';
import { remainingFromTimerState } from '../src/timerPersistence.js';

process.env.NODE_ENV = 'test';

const sampleState = {
  projects: ['Alpha'],
  schedule: [{ time: '09:00', project: 'Alpha', title: 'Plan', duration: 30 }],
  schedules: { '2026-08-03': [{ time: '10:00', project: 'Alpha', title: 'Build', duration: 60 }] },
  activeIndex: 0,
  autoStartNextTask: true,
  notes: { parkingLot: 'Later idea', general: 'Project context' },
  timerState: {
    status: 'paused', mode: 'quick', configuredDurationSeconds: 7200, remainingSecondsWhenPaused: 4312,
    startedAt: '2026-08-03T10:00:00.000Z', endsAt: null, activeIndex: null,
    quickTask: { active: true, project: 'Quick Start', title: 'Urgent task', duration: 120, zenBreakMinutes: 5, zenBreakTiming: 'midpoint' },
    zenBreak: null,
  },
};

test('legacy workspaces receive empty Notes and an idle timer without losing existing data', () => {
  const legacy = { projects: ['Existing'], schedule: [], schedules: {}, activeIndex: 0, autoStartNextTask: false };
  const normalized = normalizeState(legacy);
  assert.deepEqual(normalized.projects, ['Existing']);
  assert.deepEqual(normalized.notes, { parkingLot: '', general: '' });
  assert.equal(normalized.timerState.status, 'idle');
});

test('StateStore persists projects and dated schedules across instances', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'project-timer-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.sqlite');
  const firstProcess = new StateStore(file);
  await firstProcess.initialize();
  await firstProcess.save(sampleState);
  const secondProcess = new StateStore(file);
  assert.deepEqual(await secondProcess.load(), sampleState);
});

test('state API shares saved data with independent clients', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'project-timer-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new StateStore(join(directory, 'state.sqlite'));
  await store.initialize();
  const { createAppServer } = await import('../server.js');
  const server = createAppServer(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const registration = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'shared@example.com', password: 'correct horse battery staple' }) });
  const cookie = registration.headers.get('set-cookie').split(';')[0];
  const url = `${baseUrl}/api/state`;

  const saveResponse = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ state: sampleState, revision: 0 }) });
  assert.equal(saveResponse.status, 200);
  const independentClientResponse = await fetch(url, { cache: 'no-store', headers: { Cookie: cookie } });
  assert.equal(independentClientResponse.status, 200);
  assert.deepEqual((await independentClientResponse.json()).state, sampleState);
});

test('state API persists create, edit, multiple-block, and delete operations', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'project-timer-lifecycle-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.sqlite');
  const store = new StateStore(file);
  await store.initialize();
  const { createAppServer } = await import('../server.js');
  const server = createAppServer(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const registration = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'lifecycle@example.com', password: 'correct horse battery staple' }) });
  const cookie = registration.headers.get('set-cookie').split(';')[0];
  const url = `${baseUrl}/api/state`;
  let revision = 0;
  const put = async (state) => {
    const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ state, revision }) });
    if (response.ok) revision = (await response.json()).revision;
    return response;
  };
  const reload = async () => (await (await fetch(url, { cache: 'no-store', headers: { Cookie: cookie } })).json()).state;

  assert.equal((await put(sampleState)).status, 200);
  assert.deepEqual(await reload(), sampleState, 'new block survives an independent reload');

  const edited = structuredClone(sampleState);
  edited.schedule[0].title = 'Edited plan';
  edited.schedules['2026-08-03'][0].title = 'Edited build';
  assert.equal((await put(edited)).status, 200);
  assert.deepEqual(await reload(), edited, 'edits survive reload');

  const multiple = structuredClone(edited);
  multiple.schedule.push({ time: '09:30', project: 'Alpha', title: 'Second block', duration: 45 });
  assert.equal((await put(multiple)).status, 200);
  assert.deepEqual((await reload()).schedule, multiple.schedule, 'multiple blocks survive reload');

  const deleted = { ...multiple, schedule: [], schedules: {} };
  assert.equal((await put(deleted)).status, 200);
  assert.deepEqual(await reload(), deleted, 'deleted blocks remain deleted after reload');

  const persistedJson = await store.query("SELECT state_json FROM user_states JOIN users ON users.id=user_states.user_id WHERE users.email='lifecycle@example.com';");
  assert.deepEqual(JSON.parse(persistedJson), deleted, 'the committed database row contains the final state');
});

test('running and paused timers restore from actual saved timer timestamps', () => {
  const now = Date.parse('2026-08-03T10:00:10.000Z');
  assert.equal(remainingFromTimerState({ status: 'running', endsAt: '2026-08-03T12:00:00.000Z', remainingSecondsWhenPaused: 7200 }, now), 7190);
  assert.equal(remainingFromTimerState({ status: 'paused', endsAt: null, remainingSecondsWhenPaused: 4312 }, now), 4312);
});
