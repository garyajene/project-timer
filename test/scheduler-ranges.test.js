import test from 'node:test';
import assert from 'node:assert/strict';
import { planningRange, repeatWeek, generateSchedule } from '../src/schedulerEngine.js';

const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const rules = Object.fromEntries(names.map(name => [name, {enabled: true, start: '09:00', end: '17:00', cushion: 'tight'}]));
const block = {time: '09:00', project: 'Work', title: 'Focus', duration: 60, done: true};

test('month planning covers the remaining actual month including leap years', () => {
  assert.deepEqual(planningRange('month', '2026-10-13'), {start: '2026-10-13', end: '2026-10-31'});
  assert.equal(planningRange('month', '2026-04-15').end, '2026-04-30');
  assert.equal(planningRange('month', '2028-02-15').end, '2028-02-29');
  assert.equal(planningRange('month', '2026-02-15').end, '2026-02-28');
});

test('rolling schedule includes exactly 30 days across month and year boundaries', () => {
  assert.equal(planningRange('30-days', '2026-10-15').end, '2026-11-13');
  assert.equal(planningRange('30-days', '2026-12-20').end, '2027-01-18');
  assert.equal(planningRange('week', '2026-10-12').end, '2026-10-18');
});

test('generation applies weekday settings only inside the chosen month range', () => {
  const range = planningRange('month', '2026-10-13');
  const dayRules = structuredClone(rules);
  Object.values(dayRules).forEach(rule => {rule.blocks = 1;});
  dayRules.Wednesday.enabled = false;
  const result = generateSchedule({weekStart: range.start, rangeEnd: range.end, dayRules, projects: [{name: 'Work', priority: 1, duration: 60}], seed: 'month'});
  const dates = Object.keys(result.schedules);
  assert.equal(dates[0], range.start);
  assert.equal(dates.at(-1), range.end);
  assert.ok(dates.every(date => new Date(`${date}T12:00:00`).getDay() !== 3));
});

test('repeat preserves weekday, time, project and duration across years, resets done, and leaves source untouched', () => {
  const schedules = {'2026-12-28': [block], '2027-01-03': [{...block, project: 'Sunday'}]};
  const before = structuredClone(schedules);
  const result = repeatWeek({sourceStart: '2026-12-28', rangeEnd: '2027-01-13', schedules, dayRules: rules});
  assert.deepEqual(Object.keys(result.schedules), ['2027-01-04', '2027-01-10', '2027-01-11']);
  assert.deepEqual(result.schedules['2027-01-04'][0], {...block, done: false});
  assert.deepEqual(schedules, before);
  assert.equal(result.unfilled.length, 0);
});

test('repetition reports off days, breaks, blackouts, insufficient cushion and late finishes', () => {
  const dayRules = structuredClone(rules);
  dayRules.Tuesday.enabled = false;
  Object.assign(dayRules.Wednesday, {breakEnabled: true, breakStart: '09:30', breakEnd: '10:30'});
  dayRules.Friday.end = '09:30';
  const schedules = Object.fromEntries(['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16'].map(date => [date, [block]]));
  schedules['2026-10-17'] = [block, {...block, time: '10:00'}];
  const result = repeatWeek({sourceStart: '2026-10-12', rangeEnd: '2026-10-25', schedules, dayRules, blackouts: [{date: '2026-10-22', start: '09:00', end: '10:00'}]});
  assert.equal(result.unfilled.reduce((n, day) => n + day.missingBlocks, 0), 5);
  assert.deepEqual(Object.keys(result.schedules), ['2026-10-19', '2026-10-24']);
});

test('repeat rejects an empty source and a target ending before the next week', () => {
  assert.throws(() => repeatWeek({sourceStart: '2026-10-12', rangeEnd: '2026-10-25', schedules: {}, dayRules: rules}), /no scheduled blocks/);
  assert.throws(() => repeatWeek({sourceStart: '2026-10-12', rangeEnd: '2026-10-18', schedules: {'2026-10-12': [block]}, dayRules: rules}), /after the source week/);
});
