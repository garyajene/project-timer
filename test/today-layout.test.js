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
