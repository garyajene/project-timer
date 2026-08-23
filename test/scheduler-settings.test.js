import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('Scheduler replaces daily duration and gap inputs with a custom break toggle and times', () => {
  const schedulerPage = mainSource.slice(mainSource.indexOf('function schedulerPage()'), mainSource.indexOf('function notesAndReview'));
  assert.doesNotMatch(schedulerPage, /scheduler-duration|scheduler-gap/);
  assert.match(schedulerPage, /scheduler-break-enabled/);
  assert.match(schedulerPage, /scheduler-break-start/);
  assert.match(schedulerPage, /scheduler-break-end/);
});

test('Scheduler presents four day columns with each day’s controls stacked vertically', () => {
  assert.match(styles, /\.scheduler-days \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.scheduler-day \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.scheduler-break-times \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
});
