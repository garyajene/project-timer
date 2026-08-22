import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { StateStore } from '../src/server/stateStore.js';

process.env.NODE_ENV = 'test';

const sampleState = {
  projects: ['Alpha'],
  schedule: [{ time: '09:00', project: 'Alpha', title: 'Plan', duration: 30 }],
  schedules: { '2026-08-03': [{ time: '10:00', project: 'Alpha', title: 'Build', duration: 60 }] },
  activeIndex: 0,
  autoStartNextTask: true,
};

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
  const url = `http://127.0.0.1:${server.address().port}/api/state`;

  const saveResponse = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sampleState) });
  assert.equal(saveResponse.status, 200);
  const independentClientResponse = await fetch(url, { cache: 'no-store' });
  assert.equal(independentClientResponse.status, 200);
  assert.deepEqual(await independentClientResponse.json(), sampleState);
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
  const url = `http://127.0.0.1:${server.address().port}/api/state`;
  const put = (body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const reload = async () => (await (await fetch(url, { cache: 'no-store' })).json());

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

  const persistedJson = await store.query('SELECT state_json FROM app_state WHERE id = 1;');
  assert.deepEqual(JSON.parse(persistedJson), deleted, 'the committed database row contains the final state');
});
