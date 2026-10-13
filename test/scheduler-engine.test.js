import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule } from '../src/schedulerEngine.js';

const days = Object.fromEntries(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => [day, { enabled: !['Saturday', 'Sunday'].includes(day), cushion: 'medium', start: '09:00', end: '17:00', blocks: 3, breakEnabled: false, breakStart: '12:00', breakEnd: '13:00' }]));

const toMinutes = (value) => {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours * 60) + minutes;
};

function assertMinimumCushionGaps(blocks) {
  for (let index = 1; index < blocks.length; index += 1) {
    const previousEnd = toMinutes(blocks[index - 1].time) + blocks[index - 1].duration;
    assert.ok(toMinutes(blocks[index].time) - previousEnd >= 45);
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

test('an off day never receives generated work even when it is otherwise enabled', () => {
  const rules = structuredClone(days);
  rules.Wednesday = { ...rules.Wednesday, enabled: true, type: 'off', blocks: 12 };
  const result = generateSchedule({ weekStart: '2026-08-24', dayRules: rules, projects: [{ name: 'Work', priority: 1, duration: 60 }], seed: 'off-day' });
  assert.equal(result.schedules['2026-08-26'], undefined);
});

test('off day matching is tolerant of legacy capitalization', () => {
  const rules = structuredClone(days);
  rules.Wednesday = { ...rules.Wednesday, enabled: true, type: 'Off', blocks: 12 };
  const result = generateSchedule({ weekStart: '2026-08-24', dayRules: rules, projects: [{ name: 'Work', priority: 1, duration: 60 }], seed: 'legacy-off-day' });
  assert.equal(result.schedules['2026-08-26'], undefined);
});

test('project durations are preserved and long days do not anchor the final block at night', () => {
  const rules = structuredClone(days);
  rules.Monday = { ...rules.Monday, start: '10:30', end: '23:30', blocks: 3, cushion: 'tight' };
  const result = generateSchedule({ weekStart: '2026-08-24', dayRules: rules, projects: [{ name: 'Work', priority: 1, duration: 90 }], seed: 'spacing' });
  const blocks = result.schedules['2026-08-24'];
  assert.deepEqual(blocks.map((block) => block.duration), [90, 90, 90]);
  assert.equal(blocks[0].time, '10:30');
  assert.ok(toMinutes(blocks.at(-1).time) <= toMinutes('14:30'));
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

for (const [cushion, minimum, maximum] of [['tight', 15, 30], ['medium', 45, 90], ['loose', 90, 120]]) {
  test(`${cushion} cushion stays within its range across seeds`, () => {
    const rules = structuredClone(days);
    rules.Monday = { ...rules.Monday, start: '09:00', end: '23:30', blocks: 4, cushion };
    for (let seed = 0; seed < 50; seed += 1) {
      const result = generateSchedule({ weekStart: '2026-08-24', rangeEnd: '2026-08-24', dayRules: rules, projects: [{ name: 'Work', priority: 1, duration: 60 }], seed });
      const blocks = result.schedules['2026-08-24'];
      assert.equal(blocks.length, 4);
      for (let index = 1; index < blocks.length; index += 1) {
        const gap = toMinutes(blocks[index].time) - toMinutes(blocks[index - 1].time) - blocks[index - 1].duration;
        assert.ok(gap >= minimum && gap <= maximum);
      }
    }
  });
}

test('latest finish prevents overruns and reports every missing block', () => {
  const rules = structuredClone(days);
  rules.Monday = { ...rules.Monday, start: '09:00', end: '10:00', blocks: 3 };
  const result = generateSchedule({ weekStart: '2026-08-24', rangeEnd: '2026-08-24', dayRules: rules, projects: [{ name: 'Long', priority: 1, duration: 180 }], seed: 'finish' });
  assert.equal(result.schedules['2026-08-24'], undefined);
  assert.equal(result.unfilled[0].missingBlocks, 3);
});

test('blocks can finish exactly at the cutoff and tight capacity uses minimum cushion', () => {
  const rules = structuredClone(days);
  rules.Monday = { ...rules.Monday, start: '09:00', end: '11:15', blocks: 2, cushion: 'tight' };
  const result = generateSchedule({ weekStart: '2026-08-24', rangeEnd: '2026-08-24', dayRules: rules, projects: [{ name: 'Work', priority: 1, duration: 60 }], seed: 'exact-fit' });
  assert.deepEqual(result.schedules['2026-08-24'].map(block => block.time), ['09:00', '10:15']);
  assert.equal(result.unfilled.length, 0);
});

test('breaks and blackouts may extend cushion but never allow finish overruns', () => {
  const rules = structuredClone(days);
  rules.Monday = { ...rules.Monday, start: '09:00', end: '14:00', blocks: 3, cushion: 'tight', breakEnabled: true, breakStart: '10:00', breakEnd: '12:00' };
  const result = generateSchedule({ weekStart: '2026-08-24', rangeEnd: '2026-08-24', dayRules: rules, blackouts: [{date: '2026-08-24', start: '13:00', end: '13:30'}], projects: [{ name: 'Work', priority: 1, duration: 60 }], seed: 'protected' });
  assert.deepEqual(result.schedules['2026-08-24'].map(block => block.time), ['09:00', '12:00']);
  assert.equal(result.unfilled[0].missingBlocks, 1);
});

test('invalid working hours and break intervals explain the problem', () => {
  const input = { weekStart: '2026-08-24', rangeEnd: '2026-08-24', dayRules: structuredClone(days), projects: [{name: 'Work', priority: 1, duration: 60}] };
  input.dayRules.Monday.end = '08:00';
  assert.throws(() => generateSchedule(input), /latest project finish/);
  input.dayRules.Monday.end = '17:00';
  Object.assign(input.dayRules.Monday, { breakEnabled: true, breakStart: '13:00', breakEnd: '12:00' });
  assert.throws(() => generateSchedule(input), /break ends/);
});

test('midnight finish means the end of the day without overflowing into tomorrow', () => {
  const rules = structuredClone(days);
  rules.Monday = {...rules.Monday, start: '22:30', end: '00:00', blocks: 2, cushion: 'tight'};
  const result = generateSchedule({weekStart: '2026-08-24', rangeEnd: '2026-08-24', dayRules: rules, projects: [{name: 'Work', priority: 1, duration: 90}], seed: 'midnight'});
  assert.equal(result.schedules['2026-08-24'][0].time, '22:30');
  assert.equal(result.unfilled[0].missingBlocks, 1);
});
