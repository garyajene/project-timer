import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { createAppServer } from '../server.js';
import { StateStore } from '../src/server/stateStore.js';
import { LUNA, WHISPER, replicateClient } from '../src/server/replicate.js';

async function setup(t, run, env = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'doabl-executive-'));
  const store = new StateStore(join(directory, 'state.sqlite'));
  await store.initialize();
  const server = createAppServer(store, { executive: { run, env: { REPLICATE_API_TOKEN: 'test-token', ...env } } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function account(name) {
    const user = await store.register(name + '@example.com', 'test password 123');
    const cookie = 'project_timer_session=' + await store.createSession(user.id);
    return { ...user, cookie };
  }
  function request(path, user, body, requestId = randomUUID(), contentType = 'application/json') {
    return fetch(base + '/api/executive/' + path, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'X-Executive-Request': requestId, ...(user ? { Cookie: user.cookie } : {}) },
      body: contentType === 'application/json' ? JSON.stringify(body) : body,
    });
  }
  return { store, directory, account, request };
}

const say = (text) => ({ messages: [{ role: 'user', text }] });

test('Executive validates proposals, scopes approval to the owner, and changes Projects only after approval', async (t) => {
  const { store, account, request } = await setup(t, async (model, input, timeout, recordId) => {
    assert.equal(model, LUNA);
    assert.equal(input.verbosity, 'low');
    assert.match(input.system_prompt, /executive dysfunction/i);
    assert.equal(input.max_completion_tokens, 999);
    assert.deepEqual(JSON.parse(input.prompt).conversation.map(({ content }) => content), ['Prioritize and break down the launch']);
    await recordId('chat123');
    return { id: 'chat123', output: [JSON.stringify({
      reply: 'Start with a 20-minute checklist.',
      suggestions: [
        { action: 'add', name: 'Launch', priority: 1, minutes: 40, deadline: '2026-12-15' },
        { action: 'add', name: 'Write checklist', parent: 'Launch', minutes: 20 },
        { action: 'add', name: 'Invalid duration', minutes: -1 },
        { action: 'add', name: 'Invalid deadline', deadline: '2026-02-30' },
        { action: 'update', name: 'Another account project', priority: 1 },
      ],
    })], metrics: { input_tokens: 100, output_tokens: 50 } };
  }, { EXECUTIVE_CONTEXT_MESSAGES: '1', EXECUTIVE_OUTPUT_TOKENS: '999' });
  const a = await account('alex');
  const b = await account('blair');
  const bWorkspace = await store.loadUserState(b.id);
  bWorkspace.state.projects.push('Another account project');
  await store.saveUserState(b.id, bWorkspace.state, bWorkspace.revision);

  assert.equal((await request('chat', null, say('Hi'))).status, 401);
  const chat = await request('chat', a, { includeProjects: true, messages: [
    { role: 'user', text: 'Older context' }, { role: 'assistant', text: 'OK' },
    { role: 'user', text: 'Prioritize and break down the launch' },
  ] });
  assert.equal(chat.status, 200);
  const { proposalId, suggestions } = await chat.json();
  assert.equal(suggestions.length, 2);
  assert.deepEqual((await store.loadUserState(a.id)).state.projects, []);
  assert.equal((await request('approve', b, { proposalId, revision: 1 })).status, 404);
  assert.equal((await request('approve', a, { proposalId, revision: 99 })).status, 409);
  assert.equal((await request('approve', a, { proposalId, revision: 0 })).status, 200);
  const { state } = await store.loadUserState(a.id);
  assert.deepEqual(state.projects, ['Launch', 'Write checklist']);
  assert.equal(state.projectSettings.Launch.deadline, '2026-12-15');
  assert.equal(state.projectSettings.Launch.priority, 1);
  assert.equal(state.projectSettings['Write checklist'].parent, 'Launch');
  assert.equal(state.projectSettings['Write checklist'].defaultDuration, 20);
  assert.deepEqual(state.schedule, []);
  assert.deepEqual((await store.loadUserState(b.id)).state.projects, ['Another account project']);
  assert.equal((await request('approve', a, { proposalId, revision: 1 })).status, 404);
  assert.equal(await store.query("SELECT prediction_id FROM executive_usage WHERE status='succeeded'"), 'chat123');
  assert.equal(JSON.parse(await store.query('SELECT metrics_json FROM executive_usage')).estimatedUsd, 0.0004);
});

test('Executive rejects duplicate requests, caps per-user provider usage and hides provider errors', async (t) => {
  let calls = 0;
  const { account, request } = await setup(t, async () => {
    calls++;
    throw new Error('private upstream response');
  }, { EXECUTIVE_REQUESTS_PER_HOUR: '1' });
  const a = await account('alex');
  const b = await account('blair');
  const id = randomUUID();
  const error = await request('chat', a, say('Hi'), id);
  assert.equal(error.status, 502);
  assert.doesNotMatch(await error.text(), /private upstream/);
  assert.equal((await request('chat', a, say('Hi'), id)).status, 409);
  assert.equal((await request('chat', a, say('Hi'))).status, 429);
  assert.equal((await request('chat', b, say('Hi'), id)).status, 502);
  assert.equal(calls, 2);
});

test('Whisper validates actual audio and duration, then returns editable text without a recording file', async (t) => {
  const { store, directory, account, request } = await setup(t, async (model, input, timeout, recordId) => {
    assert.equal(model, WHISPER);
    assert.match(input.audio, /^data:audio\/mpeg;base64,/);
    await recordId('voice123');
    return { id: 'voice123', output: { text: 'Start a checklist.' } };
  }, { EXECUTIVE_RECORDING_SECONDS: '1' });
  const user = await account('alex');
  const files = await readdir(directory);
  const voice = (seconds, format, codec, flags = []) => execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
    `sine=frequency=440:duration=${seconds}`, '-c:a', codec, ...flags, '-f', format, 'pipe:1']);
  const send = (body, type) => request('transcribe', user, body, randomUUID(), type);
  assert.equal((await send(Buffer.from('invalid'), 'audio/webm')).status, 422);
  assert.equal((await send(Buffer.from('invalid'), 'audio/flac')).status, 415);
  assert.equal((await send(voice(1.4, 'webm', 'libopus'), 'audio/webm')).status, 422);
  for (const [format, codec, flags] of [['webm', 'libopus', []], ['mp4', 'aac', ['-movflags', 'frag_keyframe+empty_moov']]]) {
    const response = await send(voice(0.3, format, codec, flags), 'audio/' + format);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: 'Start a checklist.' });
  }
  const metrics = JSON.parse(await store.query("SELECT metrics_json FROM executive_usage WHERE status='succeeded' LIMIT 1"));
  assert.ok(metrics.audioSeconds >= 0.25 && metrics.audioSeconds <= 0.5);
  assert.deepEqual(await readdir(directory), files);
});

test('Replicate uses bearer auth and creates a version-pinned Whisper prediction', async () => {
  const run = replicateClient('mock-token', async (url, options) => {
    assert.equal(url, 'https://api.replicate.com/v1/predictions');
    assert.equal(options.headers.Authorization, 'Bearer mock-token');
    assert.equal(options.headers['Cancel-After'], '5s');
    assert.deepEqual(JSON.parse(options.body), { version: WHISPER.split(':')[1], input: { audio: 'mock' } });
    return Response.json({ status: 'succeeded', id: 'p123', output: { text: 'Hello' } });
  });
  assert.equal((await run(WHISPER, { audio: 'mock' }, 2500, (id) => assert.equal(id, 'p123'))).output.text, 'Hello');
});

test('Replicate bounds pending predictions and sends a cancellation without creating another prediction', async () => {
  const calls = [];
  const run = replicateClient('mock-token', async (url, options) => {
    calls.push([url, options.method]);
    return Response.json({ status: 'starting', id: 'pending1' });
  });
  await assert.rejects(run(LUNA, { prompt: 'Hello' }, 25, () => {}), { status: 504 });
  assert.deepEqual(calls, [
    ['https://api.replicate.com/v1/models/openai/gpt-5.6-luna/predictions', 'POST'],
    ['https://api.replicate.com/v1/predictions/pending1/cancel', 'POST'],
  ]);
});

test('Replicate billing errors reach Executive without including private provider details', async () => {
  const run = replicateClient('mock-token', async () => Response.json({ detail: 'private' }, { status: 402 }));
  await assert.rejects(run(WHISPER, {}, 50000, () => {}), {
    status: 502, message: 'Replicate requires billing credit before it can process requests.',
  });
});

test('Replicate validation identifies an invalid audio URI without echoing submitted audio', async () => {
  const run = replicateClient('mock-token', async () => Response.json({
    detail: [{ loc: ['body', 'input', 'audio'], msg: 'Invalid URI', input: 'private recording' }],
  }, { status: 422 }));
  await assert.rejects(run(WHISPER, {}, 5000, () => {}), {
    message: 'Replicate rejected the file address supplied for the recording.',
  });
});
