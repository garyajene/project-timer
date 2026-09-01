import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule } from '../src/schedulerEngine.js';

const days = Object.fromEntries(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => [day, { enabled: !['Saturday', 'Sunday'].includes(day), type: 'normal', start: '09:00', end: '17:00', blocks: 3, breakEnabled: false, breakStart: '12:00', breakEnd: '13:00' }]));

test('priority determines frequency and the same seed reproduces placement', () => {
  const input = { weekStart: '2026-08-24', dayRules: days, projects: [{ name: 'Highest', priority: 1, duration: 60 }, { name: 'Middle', priority: 3, duration: 60 }, { name: 'Lowest', priority: 5, duration: 60 }], seed: 'repeatable' };
  const first = generateSchedule(input);
  const second = generateSchedule(input);
  assert.deepEqual(first.schedules, second.schedules);
  assert.ok(first.counts.Highest > first.counts.Middle);
  assert.ok(first.counts.Middle > first.counts.Lowest);
});

test('blackouts are applied before project placement', () => {
  const result = generateSchedule({ weekStart: '2026-08-24', dayRules: days, blackouts: [{ date: '2026-08-24', start: '09:00', end: '12:00' }], projects: [{ name: 'Work', priority: 1, duration: 60 }], seed: 'blackout' });
  assert.equal(result.schedules['2026-08-24'][0].time, '12:00');
});

test('project durations determine block lengths and blocks receive an automatic hour between them', () => {
  const mondayOnly = structuredClone(days);
  Object.entries(mondayOnly).forEach(([day, rule]) => { rule.enabled = day === 'Monday'; });
  const result = generateSchedule({ weekStart: '2026-08-24', dayRules: mondayOnly, projects: [{ name: 'Short', priority: 1, duration: 30 }], seed: 'spacing' });
  const blocks = result.schedules['2026-08-24'];
  assert.deepEqual(blocks.map((block) => block.duration), [30, 30, 30]);
  assert.deepEqual(blocks.map((block) => block.time), ['09:00', '10:30', '12:00']);
});

test('a custom daily break prevents blocks from overlapping the user-selected interval', () => {
  const mondayOnly = structuredClone(days);
  Object.entries(mondayOnly).forEach(([day, rule]) => { rule.enabled = day === 'Monday'; });
  mondayOnly.Monday = { ...mondayOnly.Monday, blocks: 2, breakEnabled: true, breakStart: '10:00', breakEnd: '13:15' };
  const result = generateSchedule({ weekStart: '2026-08-24', dayRules: mondayOnly, projects: [{ name: 'Work', priority: 1, duration: 60 }], seed: 'custom-break' });
  assert.deepEqual(result.schedules['2026-08-24'].map((block) => block.time), ['09:00', '13:15']);
});


test('a custom end date controls the exact generated date range', () => {
  const everyDay = structuredClone(days);
  Object.values(everyDay).forEach((rule) => { rule.enabled = true; rule.blocks = 1; });
  const result = generateSchedule({
    weekStart: '2026-08-31',
    rangeEnd: '2026-09-02',
    dayRules: everyDay,
    projects: [{ name: 'Work', priority: 1, duration: 60 }],
    seed: 'custom-range',
  });
  assert.deepEqual(Object.keys(result.schedules), ['2026-08-31', '2026-09-01', '2026-09-02']);
});
