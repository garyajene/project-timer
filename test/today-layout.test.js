import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const todayPage = mainSource.slice(mainSource.indexOf('function todayPlanner()'), mainSource.indexOf('function masterProjectList()'));

test('Today is a read-only overview backed by today’s saved schedule', () => {
  assert.match(todayPage, /getScheduleForDate\(toDateKey\(now\)\)/);
  assert.match(todayPage, /<h2>TODAY<\/h2>/);
  assert.match(todayPage, /What am I doing today\?/);
  assert.match(todayPage, /TODAY’S SCHEDULE/);
  assert.doesNotMatch(todayPage, /button|input|select|textarea/);
});

test('Today shows project, optional task, and calculated start and end times', () => {
  assert.match(todayPage, /block\.project/);
  assert.match(todayPage, /block\.title \?/);
  assert.match(todayPage, /formatTime\(block\.time\)/);
  assert.match(todayPage, /formatTime\(getNextStartTime\(block\)\)/);
});

test('Today highlights only the current scheduled block and has a simple empty state', () => {
  assert.match(todayPage, /currentMinutes >= startMinutes && currentMinutes < endMinutes/);
  assert.match(todayPage, /today-current-block/);
  assert.match(todayPage, /No projects scheduled for today\./);
});
