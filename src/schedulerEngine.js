const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MINIMUM_BLOCK_GAP_MINUTES = 60;
const PREFERRED_BLOCK_GAP_MINUTES = 120;

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

const minutes = (time) => { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute; };
const time = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function availableMinutes(start, end, unavailable) {
  if (start >= end) return 0;
  let available = end - start;
  unavailable.forEach((item) => {
    const overlapStart = Math.max(start, minutes(item.start));
    const overlapEnd = Math.min(end, minutes(item.end));
    if (overlapEnd > overlapStart) available -= overlapEnd - overlapStart;
  });
  return Math.max(0, available);
}

function assertMinimumSpacing(schedules) {
  Object.entries(schedules).forEach(([date, blocks]) => {
    const ordered = [...blocks].sort((a, b) => a.time.localeCompare(b.time));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const previousEnd = minutes(previous.time) + Number(previous.duration);
      const gap = minutes(current.time) - previousEnd;
      if (gap < MINIMUM_BLOCK_GAP_MINUTES) {
        throw new Error(`Generated schedule failed spacing validation on ${date}. Every work block requires at least one hour between blocks.`);
      }
    }
  });
}

export function generateSchedule({ weekStart, rangeEnd = null, dayRules, blackouts = [], projects, seed = Date.now() }) {
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
    const rule = dayRules[DAY_NAMES[date.getDay()]];
    if (!rule?.enabled || rule.type === 'off') continue;
    let cursor = minutes(rule.start);
    const dayEnd = minutes(rule.end);
    const scheduledBreak = rule.breakEnabled ? [{ start: rule.breakStart, end: rule.breakEnd }] : [];
    const dayBlackouts = [...blackouts.filter((item) => item.date === dateValue || (item.recurring && item.days?.includes(DAY_NAMES[date.getDay()]))), ...scheduledBreak]
      .filter((item) => item.start && item.end && minutes(item.end) > minutes(item.start))
      .sort((a, b) => minutes(a.start) - minutes(b.start));
    for (let index = 0; index < Number(rule.blocks) && cursor < dayEnd;) {
      const activeBlackout = dayBlackouts.find((item) => cursor >= minutes(item.start) && cursor < minutes(item.end));
      if (activeBlackout) { cursor = minutes(activeBlackout.end); continue; }

      const nextBlackout = dayBlackouts.find((item) => minutes(item.start) > cursor);
      const availableUntil = Math.min(dayEnd, nextBlackout ? minutes(nextBlackout.start) : dayEnd);
      const candidates = eligible.filter((project) => cursor + Number(project.duration) <= availableUntil);
      if (!candidates.length) {
        if (nextBlackout) { cursor = minutes(nextBlackout.end); continue; }
        unfilled.push({ date: dateValue, time: time(cursor), capacity: Math.max(0, dayEnd - cursor) });
        break;
      }
      const ranked = candidates.map((project) => ({
        project,
        score: (counts[project.name] + 1) / (6 - project.priority),
        tie: random(),
      })).sort((a, b) => a.score - b.score || a.tie - b.tie);
      const chosen = ranked[0].project;
      counts[chosen.name] += 1;
      (schedules[dateValue] ||= []).push({ time: time(cursor), project: chosen.name, title: '', duration: chosen.duration, done: false });
      const chosenEnd = cursor + Number(chosen.duration);
      const remainingBlocks = Math.max(0, Number(rule.blocks) - (index + 1));
      const minimumProjectDuration = eligible.length ? Math.min(...eligible.map((project) => Number(project.duration))) : 0;
      const minimumFutureWork = (remainingBlocks * minimumProjectDuration) + (Math.max(0, remainingBlocks - 1) * MINIMUM_BLOCK_GAP_MINUTES);
      const preferredNextStart = chosenEnd + PREFERRED_BLOCK_GAP_MINUTES;
      const canUsePreferredGap = remainingBlocks > 0 && availableMinutes(preferredNextStart, dayEnd, dayBlackouts) >= minimumFutureWork;
      cursor = chosenEnd + (canUsePreferredGap ? PREFERRED_BLOCK_GAP_MINUTES : MINIMUM_BLOCK_GAP_MINUTES);
      index += 1;
    }
  }
  Object.values(schedules).forEach((blocks) => blocks.sort((a, b) => a.time.localeCompare(b.time)));
  assertMinimumSpacing(schedules);
  return { schedules, counts, unfilled, seed: String(seed) };
}
