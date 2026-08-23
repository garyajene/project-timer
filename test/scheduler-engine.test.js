import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule } from '../src/schedulerEngine.js';

const days = Object.fromEntries(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => [day, { enabled: !['Saturday', 'Sunday'].includes(day), type: 'normal', start: '09:00', end: '17:00', blocks: 3, duration: 60, gap: 15 }]));

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
