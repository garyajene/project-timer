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
