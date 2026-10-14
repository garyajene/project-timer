const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CUSHION_RANGES = { tight: [15, 30], medium: [45, 90], loose: [90, 120] };
const cushionRange = (rule) => CUSHION_RANGES[rule.cushion] || CUSHION_RANGES.medium;

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const minutes = (time) => { const [hour, minute] = String(time || '').split(':').map(Number); return hour * 60 + minute; };
const time = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const isOffDay = (rule) => !rule?.enabled || String(rule.type).toLowerCase() === 'off';

function findAvailableStart(target, duration, minimumStart, latestStart, unavailable) {
  let candidate = Math.max(Math.round(target), minimumStart);
  while (candidate <= latestStart) {
    const conflict = unavailable.find((item) => (
      candidate < minutes(item.end)
      && candidate + duration > minutes(item.start)
    ));
    if (!conflict) return candidate;
    candidate = Math.max(candidate, minutes(conflict.end));
  }
  return null;
}

function assertMinimumSpacing(schedules, dayRules, dateRules = {}) {
  Object.entries(schedules).forEach(([date, blocks]) => {
    const ordered = [...blocks].sort((a, b) => a.time.localeCompare(b.time));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const previousEnd = minutes(previous.time) + Number(previous.duration);
      const gap = minutes(current.time) - previousEnd;
      if (gap < cushionRange(dateRules[date] || dayRules[DAY_NAMES[new Date(`${date}T12:00:00`).getDay()]])[0]) {
        throw new Error(`Generated schedule failed spacing validation on ${date}. Work blocks must respect the selected cushion.`);
      }
    }
  });
}

function assertNoOffDayBlocks(schedules, dayRules, dateRules = {}) {
  Object.keys(schedules).forEach((dateValue) => {
    const date = new Date(`${dateValue}T12:00:00`);
    const dayName = DAY_NAMES[date.getDay()];
    if (isOffDay(dateRules[dateValue] || dayRules[dayName])) {
      throw new Error(`Generated schedule failed work-day validation on ${dateValue}. Off days cannot contain work blocks.`);
    }
  });
}

export function generateSchedule({ weekStart, rangeEnd = null, dayRules, dateRules = {}, blackouts = [], projects, seed = Date.now() }) {
  const random = seededRandom(seed);
  const schedules = {};
  const eligible = projects.filter((project) => project.name && project.duration > 0);
  const counts = Object.fromEntries(eligible.map((project) => [project.name, 0]));
  const unfilled = [];
  const startDate = new Date(`${weekStart}T12:00:00`);
  const endDate = rangeEnd ? new Date(`${rangeEnd}T12:00:00`) : new Date(startDate);
  if (!rangeEnd) endDate.setDate(endDate.getDate() + 6);

  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    const dateValue = dateKey(date);
    const rule = dateRules[dateValue] || dayRules[DAY_NAMES[date.getDay()]];
    if (isOffDay(rule)) continue;

    const requestedBlocks = Math.max(0, Number(rule.blocks) || 0);
    const earliestStart = minutes(rule.start);
    const latestFinish = rule.end === '00:00' ? 24 * 60 : minutes(rule.end);
    if (!requestedBlocks) continue;
    if (!Number.isFinite(earliestStart) || !Number.isFinite(latestFinish) || earliestStart >= latestFinish) {
      throw new Error(`Review ${DAY_NAMES[date.getDay()]}: latest project finish must be later than earliest start.`);
    }

    if (rule.breakEnabled && !(minutes(rule.breakEnd) > minutes(rule.breakStart))) {
      throw new Error(`Review ${DAY_NAMES[date.getDay()]}: break ends must be later than break starts.`);
    }
    const scheduledBreak = rule.breakEnabled ? [{ start: rule.breakStart, end: rule.breakEnd }] : [];
    const dayBlackouts = [
      ...blackouts.filter((item) => item.date === dateValue || (item.recurring && item.days?.includes(DAY_NAMES[date.getDay()]))),
      ...scheduledBreak,
    ]
      .filter((item) => item.start && item.end && minutes(item.end) > minutes(item.start))
      .sort((a, b) => minutes(a.start) - minutes(b.start));

    const [minimumGap, maximumGap] = cushionRange(rule);
    let previousEnd = null;

    for (let index = 0; index < requestedBlocks; index += 1) {
      const minimumStart = previousEnd === null ? earliestStart : previousEnd + minimumGap;
      const target = previousEnd === null ? earliestStart
        : previousEnd + minimumGap + Math.floor(random() * ((maximumGap - minimumGap) / 15 + 1)) * 15;
      const ranked = eligible.map((project) => ({
        project,
        score: (counts[project.name] + 1) / (6 - project.priority),
        tie: random(),
      })).sort((a, b) => a.score - b.score || a.tie - b.tie);

      let placement = null;
      for (const { project } of ranked) {
        const duration = Number(project.duration);
        const latestStart = latestFinish - duration;
        const shortestDuration = Math.min(...eligible.map((item) => Number(item.duration)));
        const reserve = (requestedBlocks - index - 1) * (shortestDuration + minimumGap);
        const preferredTarget = Math.max(minimumStart, Math.min(target, latestStart - reserve));
        let blockStart = findAvailableStart(preferredTarget, duration, minimumStart, latestStart, dayBlackouts);
        if (blockStart === null && target > minimumStart) {
          blockStart = findAvailableStart(minimumStart, duration, minimumStart, Math.min(latestStart, Math.floor(target)), dayBlackouts);
        }
        if (blockStart !== null) {
          placement = { project, duration, start: blockStart };
          break;
        }
      }

      if (!placement) {
        unfilled.push({
          date: dateValue,
          time: time(Math.min(latestFinish, Math.max(earliestStart, Math.round(target)))),
          capacity: Math.max(0, latestFinish - minimumStart),
          missingBlocks: requestedBlocks - index,
        });
        break;
      }

      counts[placement.project.name] += 1;
      (schedules[dateValue] ||= []).push({
        time: time(placement.start),
        project: placement.project.name,
        title: '',
        duration: placement.duration,
        done: false,
      });
      previousEnd = placement.start + placement.duration;
    }
  }

  Object.values(schedules).forEach((blocks) => blocks.sort((a, b) => a.time.localeCompare(b.time)));
  assertMinimumSpacing(schedules, dayRules, dateRules);
  assertNoOffDayBlocks(schedules, dayRules, dateRules);
  return { schedules, counts, unfilled, seed: String(seed) };
}

function addDateDays(value, offset) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return dateKey(date);
}

export function planningRange(mode, start) {
  if (mode === 'month') {
    const date = new Date(`${start}T12:00:00`);
    date.setMonth(date.getMonth() + 1, 0);
    return { start, end: dateKey(date) };
  }
  return { start, end: addDateDays(start, mode === '30-days' ? 29 : 6) };
}

export function repeatWeek({ sourceStart, rangeEnd, schedules, dayRules, dateRules = {}, draftSchedules = {}, blackouts = [] }) {
  const targetStart = addDateDays(sourceStart, 7);
  if (!rangeEnd || rangeEnd < targetStart) throw new Error('Choose a repeat end date after the source week.');
  const result = { schedules: {}, unfilled: [], seed: null };
  let sourceCount = 0;
  for (let offset = 0; offset < 7; offset += 1) sourceCount += (schedules[addDateDays(sourceStart, offset)] || []).length;
  if (!sourceCount) throw new Error('The selected source week has no scheduled blocks to repeat.');
  for (let date = targetStart, offset = 0; date <= rangeEnd; date = addDateDays(date, 1), offset += 1) {
    const source = draftSchedules[date] || schedules[addDateDays(sourceStart, offset % 7)] || [];
    const day = DAY_NAMES[new Date(`${date}T12:00:00`).getDay()];
    const rule = dateRules[date] || dateRules[addDateDays(sourceStart, offset % 7)] || dayRules[day];
    const blocks = [];
    let missingBlocks = 0;
    const unavailable = blackouts.filter(item => item.date === date || (item.recurring && item.days?.includes(day)));
    if (rule?.breakEnabled) unavailable.push({ start: rule.breakStart, end: rule.breakEnd });
    for (const block of [...source].sort((a, b) => minutes(a.time) - minutes(b.time))) {
      const start = minutes(block.time);
      const duration = Number(block.duration);
      const end = start + duration;
      const finish = rule?.end === '00:00' ? 1440 : minutes(rule?.end);
      const previous = blocks.at(-1);
      const conflict = unavailable.some(item => start < minutes(item.end) && end > minutes(item.start));
      if (isOffDay(rule) || !Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0
        || !Number.isFinite(finish) || !Number.isFinite(minutes(rule.start))
        || start < minutes(rule.start) || end > finish || conflict
        || (previous && start < minutes(previous.time) + previous.duration + cushionRange(rule)[0])) {
        missingBlocks += 1;
        continue;
      }
      blocks.push({ time: block.time, project: block.project, title: block.title || '', duration, done: false });
    }
    if (blocks.length) result.schedules[date] = blocks;
    if (missingBlocks) result.unfilled.push({ date, missingBlocks });
  }
  return result;
}
