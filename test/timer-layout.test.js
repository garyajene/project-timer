import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('Timer page presents controls, navigation, and block cards in the requested order', () => {
  const timerPage = mainSource.slice(mainSource.indexOf('function timerPage()'), mainSource.indexOf('function timerSchedule()'));
  const orderedMarkers = ['class="timer-shell"', 'class="actions timer-actions"', "primaryNavigation('timer-nav')", 'class="dashboard-grid"', 'class="auto-start-control"', 'class="quick-task-panel"'];
  const positions = orderedMarkers.map((marker) => timerPage.indexOf(marker));

  assert.ok(positions.every((position) => position >= 0), 'all Timer page layout regions are present');
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
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
