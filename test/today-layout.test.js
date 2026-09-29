import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const todayPage = mainSource.slice(mainSource.indexOf('function todayPlanner()'), mainSource.indexOf('function masterProjectList()'));

test('every application shell uses the supplied black WebP logo asset', async () => {
  assert.match(mainSource, /new URL\('\.\/assets\/images\/doAbl_logo_black\.webp', import\.meta\.url\)\.href/);
  assert.match(mainSource, /src="\$\{doablLogoBlack\}"/);
  assert.match(mainSource, /const brand = `<a class="app-brand"/);
  assert.match(mainSource, /class="auth-brand"><img src="\$\{doablLogoBlack\}"/);
  const logo = await readFile(new URL('../src/assets/images/doAbl_logo_black.webp', import.meta.url));
  assert.equal(logo.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(logo.subarray(8, 12).toString('ascii'), 'WEBP');
});

test('Today remains a read-only schedule while offering presentation controls', () => {
  assert.match(todayPage, /getScheduleForDate\(toDateKey\(now\)\)/);
  assert.match(todayPage, /<h2>TODAY<\/h2>/);
  assert.match(todayPage, /What am I doing today\?/);
  assert.match(todayPage, /TODAY’S SCHEDULE/);
  assert.doesNotMatch(todayPage, /<(?:input|select|textarea)\b/);
  assert.match(todayPage, /data-today-presentation="standard"/);
  assert.match(todayPage, /data-today-presentation="three-d"/);
  assert.match(todayPage, /aria-pressed/);
});

test('Today 3D mode uses a native-scroll perspective track and selectable cards', () => {
  assert.match(todayPage, /perspective-viewport today-3d-track/);
  assert.match(todayPage, /perspective-item/);
  assert.match(todayPage, /data-today-index/);
  assert.match(todayPage, /aria-expanded/);
});

test('Today shows project, calculated start and end times, and duration', () => {
  assert.match(todayPage, /block\.project/);
  assert.match(todayPage, /formatTime\(block\.time\)/);
  assert.match(todayPage, /endTime = getNextStartTime\(block\)/);
  assert.match(todayPage, /formatTime\(endTime\)/);
  assert.match(todayPage, /formatMinutes\(duration\)/);
  assert.match(todayPage, /<dt>Start:<\/dt>/);
  assert.match(todayPage, /<dt>End:<\/dt>/);
  assert.match(todayPage, /<dt>Duration:<\/dt>/);
});

test('Today has the requested simple empty state', () => {
  assert.match(todayPage, /Nothing scheduled for today\./);
});
