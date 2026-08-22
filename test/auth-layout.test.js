import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('private workspace waits for server-confirmed session and never uses browser workspace storage', () => {
  assert.match(source, /fetch\('\/api\/auth\/session'/);
  assert.match(source, /if \(!response\.ok\) \{ renderAuth\(\); return; \}/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test('login, registration, and logout controls are available', () => {
  assert.match(source, /name="email"[^>]+type="email"/);
  assert.match(source, /name="password"[^>]+type="password"/);
  assert.match(source, /name="confirmPassword"/);
  assert.match(source, /id="logout-button"/);
  assert.match(source, /fetch\('\/api\/auth\/logout'/);
});

test('logout clears all private in-memory workspace and timer state', () => {
  const signedOut = source.slice(source.indexOf('async function handleSignedOut()'), source.indexOf('async function logout()'));
  assert.match(signedOut, /state = structuredClone\(defaultState\)/);
  assert.match(signedOut, /quickTask = null/);
  assert.match(signedOut, /zenBreak = null/);
  assert.match(signedOut, /renderAuth\(\)/);
});
