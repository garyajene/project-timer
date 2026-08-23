import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('account mode confirms a session before loading or rendering a workspace', () => {
  const sessionCheck = source.indexOf("fetch('/api/auth/session'");
  const stateLoad = source.indexOf('state = await loadState();', sessionCheck);
  assert.ok(sessionCheck > -1 && stateLoad > sessionCheck);
  assert.match(source, /registrationEnabled = session\.registrationEnabled === true/);
  assert.match(source, /name="action" value="register".*disabled aria-disabled/);
  assert.match(source, /Registration is closed; existing users can still log in\./);
  assert.match(source, /id="auth-error" class="auth-error" role="alert" aria-live="polite"><\/p>/);
  assert.match(source, /if \(!currentUser\) return;/);
  assert.match(source, /if \(authEnabled && !currentUser\)/);
});

test('account mode never writes the shared browser workspace cache', () => {
  assert.match(source, /if \(!authEnabled\) localStorage\.setItem\(STORAGE_KEY/);
  assert.match(source, /if \(authEnabled\) throw error;/);
});

test('logout and same-browser account switching invalidate queued saves and clear private memory', () => {
  assert.match(source, /const generation = accountGeneration;/);
  assert.match(source, /generation !== accountGeneration/);
  assert.match(source, /accountGeneration \+= 1;\s+currentUser = null;\s+stateRevision = 0;\s+state = structuredClone\(defaultState\);/);
  assert.match(source, /quickTask = null;\s+zenBreak = null;/);
});
