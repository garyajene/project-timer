import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

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


test('Calendar can clear the selected day, week, or month after confirmation', () => {
  const calendar = mainSource.slice(mainSource.indexOf('function calendarSection()'), mainSource.indexOf('function schedulerPage()'));
  const handlers = mainSource.slice(mainSource.indexOf("if (document.querySelector('#calendar'))"), mainSource.indexOf("if (document.querySelector('#save-today'))"));

  assert.match(calendar, /data-clear-schedule="day"/);
  assert.match(calendar, /data-clear-schedule="week"/);
  assert.match(calendar, /data-clear-schedule="month"/);
  assert.match(handlers, /data-clear-schedule[\s\S]*window\.confirm/);
  assert.match(handlers, /calendarClearDates\(scope, calendarDate\)/);
  assert.match(handlers, /dates\.forEach\(\(date\) => setScheduleForDate\(date, \[\]\)\)/);
  assert.match(handlers, /previousSchedules[\s\S]*if \(!saved\)/);
});

test('Calendar offers independent Standard and 3D presentation modes', () => {
  const calendar = mainSource.slice(mainSource.indexOf('function calendarSection()'), mainSource.indexOf('function calendarClearDates('));
  assert.match(calendar, /calendarPresentation === 'three-d'/);
  assert.match(calendar, /data-calendar-presentation="standard"/);
  assert.match(calendar, /data-calendar-presentation="three-d"/);
  assert.match(calendar, /aria-pressed/);
});

test('3D month and week views retain semantic date buttons and details', () => {
  const perspective = mainSource.slice(mainSource.indexOf('function calendarDetailsPanel('), mainSource.indexOf('function calendarTimeSelector('));
  assert.match(perspective, /function perspectiveMonthView/);
  assert.match(perspective, /function perspectiveWeekView/);
  assert.match(perspective, /class="calendar-cube/);
  assert.match(perspective, /data-calendar-date/);
  assert.match(perspective, /calendarDetailsPanel/);
  assert.match(perspective, /perspective-viewport/);
});

test('3D calendar uses a foreshortened three-quarter scene with an anchored detail callout', () => {
  const perspective = mainSource.slice(mainSource.indexOf('function calendarDetailsPanel('), mainSource.indexOf('function calendarTimeSelector('));

  assert.match(perspective, /calendar-callout-pin/);
  assert.match(perspective, /--scene-row:/);
  assert.match(stylesSource, /\.calendar-cube-row[\s\S]*rotateX\(15deg\)[\s\S]*rotateY\(-11deg\)/);
  assert.match(stylesSource, /\.calendar-callout-pin::after/);
  assert.match(stylesSource, /\.calendar-cube\.is-selected[\s\S]*translate3d\(0,-10px,38px\)/);
});

test('foreshortened calendar has mobile and reduced-motion treatments', () => {
  assert.match(stylesSource, /@media \(max-width: 560px\)[\s\S]*\.calendar-cube-row/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.calendar-cube-row/);
});

test('3D calendar reads left to right, uses project colors, and emphasizes the selected week', () => {
  const perspective = mainSource.slice(mainSource.indexOf('function calendarDetailsPanel('), mainSource.indexOf('function calendarTimeSelector('));

  assert.match(perspective, /calendar-color-\$\{projectColor\}/);
  assert.match(perspective, /is-focused-week/);
  assert.match(perspective, /is-background-week/);
  assert.match(stylesSource, /\.month-3d-track, \.week-3d-track, \.calendar-cube-row \{ direction: ltr; \}/);
  assert.match(stylesSource, /\.week-3d-track \.week-cube-row\.is-background-week[\s\S]*grayscale/);
  assert.match(stylesSource, /\.week-3d-track \.week-cube-row\.is-focused-week[\s\S]*scale\(1\.14\)/);
});
