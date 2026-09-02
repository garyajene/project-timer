import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule } from '../src/schedulerEngine.js';

const days = Object.fromEntries(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => [day, { enabled: !['Saturday', 'Sunday'].includes(day), type: 'normal', start: '09:00', end: '17:00', blocks: 3, breakEnabled: false, breakStart: '12:00', breakEnd: '13:00' }]));

const toMinutes = (value) => {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours * 60) + minutes;
};

function assertMinimumHourGaps(blocks) {
  for (let index = 1; index < blocks.length; index += 1) {
    const previousEnd = toMinutes(blocks[index - 1].time) + blocks[index - 1].duration;
    assert.ok(toMinutes(blocks[index].time) - previousEnd >= 60);
  }
}

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

test('project durations determine block lengths and blocks spread across the available day', () => {
  const mondayOnly = structuredClone(days);
  Object.entries(mondayOnly).forEach(([day, rule]) => { rule.enabled = day === 'Monday'; });
  const result = generateSchedule({ weekStart: '2026-08-24', dayRules: mondayOnly, projects: [{ name: 'Short', priority: 1, duration: 30 }], seed: 'spacing' });
  const blocks = result.schedules['2026-08-24'];
  assert.deepEqual(blocks.map((block) => block.duration), [30, 30, 30]);
  assert.ok(['09:00', '09:30'].includes(blocks[0].time));
  assert.ok(toMinutes(blocks.at(-1).time) >= toMinutes('15:30'));
  assertMinimumHourGaps(blocks);
});

test('a custom daily break prevents blocks from overlapping the user-selected interval', () => {
  const mondayOnly = structuredClone(days);
  Object.entries(mondayOnly).forEach(([day, rule]) => { rule.enabled = day === 'Monday'; });
  mondayOnly.Monday = { ...mondayOnly.Monday, blocks: 2, breakEnabled: true, breakStart: '10:00', breakEnd: '13:15' };
  const result = generateSchedule({ weekStart: '2026-08-24', dayRules: mondayOnly, projects: [{ name: 'Work', priority: 1, duration: 60 }], seed: 'custom-break' });
  const blocks = result.schedules['2026-08-24'];
  assert.equal(blocks.length, 2);
  blocks.forEach((block) => {
    const start = toMinutes(block.time);
    const end = start + block.duration;
    assert.ok(end <= toMinutes('10:00') || start >= toMinutes('13:15'));
  });
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

test('generated work blocks use the morning, afternoon, and evening on a long day', () => {
  const mondayOnly = structuredClone(days);
  Object.entries(mondayOnly).forEach(([day, rule]) => { rule.enabled = day === 'Monday'; });
  mondayOnly.Monday = { ...mondayOnly.Monday, start: '10:30', end: '23:00', blocks: 3 };
  const result = generateSchedule({ weekStart: '2026-08-24', dayRules: mondayOnly, projects: [{ name: 'Work', priority: 1, duration: 60 }], seed: 'full-day-spacing' });
  const blocks = result.schedules['2026-08-24'];
  assert.equal(blocks.length, 3);
  assert.ok(['10:30', '11:00'].includes(blocks[0].time));
  assert.ok(toMinutes(blocks[1].time) >= toMinutes('15:00'));
  assert.ok(toMinutes(blocks[2].time) >= toMinutes('20:00'));
  assertMinimumHourGaps(blocks);
});

test('the daily ending time is the latest allowed start, not a required finish time', () => {
  const mondayOnly = structuredClone(days);
  Object.entries(mondayOnly).forEach(([day, rule]) => { rule.enabled = day === 'Monday'; });
  mondayOnly.Monday = { ...mondayOnly.Monday, start: '09:00', end: '10:00', blocks: 1 };
  const result = generateSchedule({ weekStart: '2026-08-24', dayRules: mondayOnly, projects: [{ name: 'Long work', priority: 1, duration: 180 }], seed: 'past-latest-start' });
  const block = result.schedules['2026-08-24'][0];
  assert.ok(toMinutes(block.time) <= toMinutes('10:00'));
  assert.ok(toMinutes(block.time) + block.duration > toMinutes('10:00'));
});

test('generated work blocks never violate the one-hour minimum gap', () => {
  const mondayOnly = structuredClone(days);
  Object.entries(mondayOnly).forEach(([day, rule]) => { rule.enabled = day === 'Monday'; });
  mondayOnly.Monday = { ...mondayOnly.Monday, start: '09:00', end: '13:00', blocks: 3 };
  const result = generateSchedule({ weekStart: '2026-08-24', dayRules: mondayOnly, projects: [{ name: 'Long work', priority: 1, duration: 120 }], seed: 'minimum-spacing' });
  const blocks = result.schedules['2026-08-24'];
  assert.ok(blocks.length >= 1);
  assert.ok(blocks.length < 3);
  assert.equal(result.unfilled.length, 1);
  assertMinimumHourGaps(blocks);
});
