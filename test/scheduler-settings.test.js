import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('Scheduler replaces daily duration and gap inputs with a custom break toggle and times', () => {
  const schedulerPage = mainSource.slice(mainSource.indexOf('function schedulerDayCard('), mainSource.indexOf('function notesAndReview'));
  assert.doesNotMatch(schedulerPage, /scheduler-duration|scheduler-gap/);
  assert.match(schedulerPage, /scheduler-break-enabled/);
  assert.match(schedulerPage, /scheduler-break-start/);
  assert.match(schedulerPage, /scheduler-break-end/);
});

test('Scheduler shows Monday through Friday across while each day stacks its controls vertically', () => {
  assert.match(styles, /\.scheduler-days \{ grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.scheduler-day \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.scheduler-break-times \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
});


test('Scheduler rereads visible work-day and cushion settings immediately before generation', () => {
  const bindEvents = mainSource.slice(mainSource.indexOf('function bindEvents()'), mainSource.indexOf('async function initializeApp'));
  assert.match(mainSource, /function synchronizeSchedulerDayRules\(\)/);
  assert.match(bindEvents, /generate-schedule[\s\S]*synchronizeSchedulerDayRules\(\)/);
});

 test('Scheduler exposes work-day, cushion and a finish cutoff without day types', () => {
  const page = mainSource.slice(mainSource.indexOf('function schedulerDayCard('), mainSource.indexOf('function notesAndReview'));
  assert.doesNotMatch(page, /Day type|scheduler-type|Latest project start/);
  assert.match(page, /scheduler-enabled/);
  assert.match(page, /scheduler-cushion/);
  assert.match(page, /Latest project finish/);
 });

test('saved legacy Off days and cushion preferences survive normalization', () => {
  const start = mainSource.indexOf('function normalizeSchedulerSettings(');
  const end = mainSource.indexOf('function normalizeProjectSettings(', start);
  const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const context = vm.createContext({ structuredClone, weekDays, defaultState: { schedulerSettings: {days: Object.fromEntries(weekDays.map(day => [day, {enabled: true, cushion: 'medium'}])), blackouts: [], lastSeed: null} } });
  vm.runInContext(mainSource.slice(start, end), context);
  const result = context.normalizeSchedulerSettings({days: {Monday: {enabled: true, type: 'Off'}, Tuesday: {enabled: true, type: 'light', cushion: 'tight'}, Wednesday: {enabled: false, type: 'normal'}, Thursday: {enabled: true, cushion: 'invalid'}}});
  assert.equal(result.days.Monday.enabled, false);
  assert.equal(result.days.Tuesday.enabled, true);
  assert.equal(result.days.Tuesday.cushion, 'tight');
  assert.equal(result.days.Wednesday.enabled, false);
  assert.equal(result.days.Thursday.cushion, 'medium');
  assert.equal('type' in result.days.Tuesday, false);
});
