import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('Calendar shows the calculated end time underneath Block Length', () => {
  const planner = mainSource.slice(mainSource.indexOf('function calendarPlanner()'), mainSource.indexOf('function calendarSection()'));
  const blockLengthPosition = planner.indexOf('Block Length');
  const endsAtPosition = planner.indexOf('calendar-ends-at');

  assert.ok(blockLengthPosition >= 0, 'Block Length remains in the Calendar card');
  assert.ok(endsAtPosition > blockLengthPosition, 'Ends At follows Block Length in the timing summary');
  assert.match(planner, /formatTime\(getNextStartTime\(block\)\)/);
});

test('Calendar refreshes Ends At when start time or Block Length changes', () => {
  const handlers = mainSource.slice(mainSource.indexOf("if (document.querySelector('#calendar'))"), mainSource.indexOf("if (document.querySelector('#save-today'))"));

  assert.match(handlers, /calendar-duration[\s\S]*updateCalendarEndTime\(index\)/);
  assert.match(handlers, /const updateCalendarTime[\s\S]*updateCalendarEndTime\(index\)/);
});

test('Week view lays Monday through Sunday across a vertical time axis', () => {
  const week = mainSource.slice(mainSource.indexOf('function weekView('), mainSource.indexOf('function monthView('));

  assert.match(week, /weekDays\.map/);
  assert.match(week, /week-header/);
  assert.match(week, /week-time-axis/);
  assert.match(week, /week-day-column/);
  assert.match(week, /--task-top/);
});
