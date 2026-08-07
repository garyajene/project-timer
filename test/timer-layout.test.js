import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('Timer page keeps all duration and task controls connected to the main timer', () => {
  const timerPage = mainSource.slice(mainSource.indexOf('function timerPage()'), mainSource.indexOf('function timerSchedule()'));
  const orderedMarkers = ['class="timer-shell"', '${quickTaskNameField()}', '${presets}', 'id="quick-task-button"', 'class="actions timer-actions"', "primaryNavigation('timer-nav')", 'class="dashboard-grid"', 'class="auto-start-control"'];
  const positions = orderedMarkers.map((marker) => timerPage.indexOf(marker));

  assert.ok(positions.every((position) => position >= 0), 'all Timer page layout regions are present');
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
});

test('main timer is editable only before a timer session starts', () => {
  assert.match(mainSource, /id="timer-display"[^>]+\$\{hasTimerStarted \? 'disabled' : ''\}/);
  assert.match(mainSource, /#timer-display'\)\?\.addEventListener\('change'/);
  assert.match(mainSource, /configuredDurationSeconds = \(Number\(match\[1\]\) \* 3600\)/);
  assert.match(mainSource, /hasTimerStarted = true/);
  assert.match(mainSource, /hasTimerStarted = false/);
});

test('Quick Task uses only a name and the shared timer duration controls', () => {
  const quickTaskField = mainSource.slice(mainSource.indexOf('function quickTaskNameField()'), mainSource.indexOf('function timerPage()'));
  assert.match(quickTaskField, /Quick Task Name/);
  assert.doesNotMatch(quickTaskField, /Project|Duration|Start Now/);
  assert.match(mainSource, /#quick-task-button'\)\?\.addEventListener\('click', activateQuickTask\)/);
  assert.match(mainSource, /if \(quickTask\?\.active\) quickTask\.duration = configuredDurationSeconds \/ 60/);
});

test('Timer navigation keeps all existing destinations and is moved rather than duplicated', () => {
  assert.match(mainSource, /\['Today', 'Timer', 'Projects', 'Calendar', 'Notes'\]/);
  assert.match(mainSource, /href="#\$\{route\}"/);
  assert.match(mainSource, /getRoute\(\) === 'timer' \? '' : primaryNavigation\(\)/);
  assert.match(mainSource, /primaryNavigation\('timer-nav'\)/);
});

test('all four Timer controls retain their existing event handlers', () => {
  assert.match(mainSource, /#start-button'\)\?\.addEventListener\('click', startTimer\)/);
  assert.match(mainSource, /#stop-button'\)\?\.addEventListener\('click', stopTimer\)/);
  assert.match(mainSource, /#reset-button'\)\?\.addEventListener\('click', resetTimer\)/);
  assert.match(mainSource, /#skip-button'\)\?\.addEventListener\('click', advanceBlock\)/);
});
