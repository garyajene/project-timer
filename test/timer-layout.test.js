import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('Timer page keeps all duration and task controls connected to the main timer', () => {
  const timerPage = mainSource.slice(mainSource.indexOf('function timerPage()'), mainSource.indexOf('function timerSchedule()'));
  const orderedMarkers = ['class="timer-shell"', '${quickTaskControls}', '${timerActions}', '${quickTaskButton}', "primaryNavigation('timer-nav')", 'class="dashboard-grid"'];
  const positions = orderedMarkers.map((marker) => timerPage.indexOf(marker));

  assert.ok(positions.every((position) => position >= 0), 'all Timer page layout regions are present');
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
});

test('Quick Task fields and duration presets render only while Quick Task is active', () => {
  const timerPage = mainSource.slice(mainSource.indexOf('function timerPage()'), mainSource.indexOf('function timerSchedule()'));
  assert.match(timerPage, /const quickTaskControls = quickTask\?\.active \?/);
  assert.match(timerPage, /const quickTaskButton = quickTask\?\.active \? ''/);
  assert.match(timerPage, /quickTaskNameField\(\).*timer-presets/);
});

test('Auto-Start is a compact Timer control without a separate explanation card', () => {
  const timerPage = mainSource.slice(mainSource.indexOf('function timerPage()'), mainSource.indexOf('function timerSchedule()'));
  assert.match(timerPage, /timer-actions.*\$\{autoStartControl\}/);
  assert.doesNotMatch(timerPage, /Begin the next scheduled task|<small>/);
});

test('Zen Break is restored as a compact, collapsed Timer control', () => {
  const timerPage = mainSource.slice(mainSource.indexOf('function zenBreakControl('), mainSource.indexOf('function timerSchedule()'));
  assert.match(timerPage, /class="zen-break-control"/);
  assert.match(timerPage, /id="zen-break-enabled"[^>]+role="switch"/);
  assert.match(timerPage, /<details class="zen-break-menu"/);
  assert.doesNotMatch(timerPage, /<details class="zen-break-menu"[^>]+open/);
  assert.match(mainSource, /#timer-zen-break-duration/);
  assert.match(mainSource, /#timer-zen-break-timing/);
});

test('main timer is editable only before a timer session starts', () => {
  assert.match(mainSource, /id="timer-display"[^>]+\$\{hasTimerStarted \? 'disabled' : ''\}/);
  assert.match(mainSource, /#timer-display'\)\?\.addEventListener\('change'/);
  assert.match(mainSource, /configuredDurationSeconds = \(Number\(match\[1\]\) \* 3600\)/);
  assert.match(mainSource, /hasTimerStarted = true/);
  assert.match(mainSource, /hasTimerStarted = false/);
});

test('Quick Task uses only a name and the shared timer duration controls', () => {
  const quickTaskField = mainSource.slice(mainSource.indexOf('function quickTaskNameField()'), mainSource.indexOf('function zenBreakControl('));
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

test('Reset stops the shared timer and clears both timer values to zero', () => {
  const resetTimer = mainSource.slice(mainSource.indexOf('function resetTimer()'), mainSource.indexOf('function activateQuickTask()'));
  assert.match(resetTimer, /isRunning = false/);
  assert.match(resetTimer, /clearInterval\(timerId\)/);
  assert.match(resetTimer, /configuredDurationSeconds = 0/);
  assert.match(resetTimer, /remainingSeconds = 0/);
  assert.doesNotMatch(resetTimer, /resetCurrentDuration|getBlockDurationSeconds/);
});

test('selecting a scheduled block replaces Quick Task and pauses a freshly loaded duration', () => {
  const selectActiveBlock = mainSource.slice(mainSource.indexOf('function selectActiveBlock('), mainSource.indexOf('function handleProjectSelectChange'));
  assert.match(selectActiveBlock, /isRunning = false/);
  assert.match(selectActiveBlock, /clearInterval\(timerId\)/);
  assert.match(selectActiveBlock, /quickTask = null/);
  assert.match(selectActiveBlock, /state\.activeIndex = nextIndex/);
  assert.match(selectActiveBlock, /resetCurrentDuration\(\)/);
  assert.match(selectActiveBlock, /hasTimerStarted = false/);
  assert.doesNotMatch(selectActiveBlock, /quickTask\?\.active.*return/);
});

test('creating a Quick Task pauses the timer and loads its configured duration', () => {
  const activateQuickTask = mainSource.slice(mainSource.indexOf('function activateQuickTask()'), mainSource.indexOf('function selectActiveBlock('));
  assert.match(activateQuickTask, /isRunning = false/);
  assert.match(activateQuickTask, /clearInterval\(timerId\)/);
  assert.match(activateQuickTask, /remainingSeconds = configuredDurationSeconds/);
  assert.match(activateQuickTask, /hasTimerStarted = false/);
});

test('Next Block and saved schedule blocks use the same selection behavior', () => {
  assert.match(mainSource, /data-select-block="\$\{selectIndex\}"/);
  assert.match(mainSource, /projectCard\('Next Block'.*next \? nextIndex : null\)/);
  assert.match(mainSource, /document\.querySelectorAll\('\[data-select-block\]'\)/);
  assert.match(mainSource, /document\.querySelectorAll\('\.time-block'\)/);
});

test('block navigation exposes both adjacent scheduled blocks', () => {
  const timerPage = mainSource.slice(mainSource.indexOf('function timerPage()'), mainSource.indexOf('function timerSchedule()'));
  assert.match(timerPage, /const previousIndex = quickTask\?\.active \? null : state\.activeIndex - 1/);
  assert.match(timerPage, /projectCard\('Previous Block'.*previous \? previousIndex : null\)/);
  assert.match(timerPage, /projectCard\('Next Block'.*next \? nextIndex : null\)/);
  assert.match(timerPage, /block-navigation/);
});
