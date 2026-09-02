const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MINIMUM_BLOCK_GAP_MINUTES = 60;
const START_WINDOW_MINUTES = 30;
const MINIMUM_FINAL_START_BUFFER_MINUTES = 60;
const MAXIMUM_FINAL_START_BUFFER_MINUTES = 120;

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

    const requestedBlocks = Math.max(0, Number(rule.blocks) || 0);
    const earliestStart = minutes(rule.start);
    const latestStart = minutes(rule.end);
    if (!requestedBlocks || !eligible.length || earliestStart > latestStart) continue;

    const scheduledBreak = rule.breakEnabled ? [{ start: rule.breakStart, end: rule.breakEnd }] : [];
    const dayBlackouts = [
      ...blackouts.filter((item) => item.date === dateValue || (item.recurring && item.days?.includes(DAY_NAMES[date.getDay()]))),
      ...scheduledBreak,
    ]
      .filter((item) => item.start && item.end && minutes(item.end) > minutes(item.start))
      .sort((a, b) => minutes(a.start) - minutes(b.start));

    const startWindow = Math.min(START_WINDOW_MINUTES, Math.max(0, latestStart - earliestStart));
    const firstTarget = earliestStart + (random() < 0.5 ? 0 : startWindow);
    const averageDuration = eligible.reduce((sum, project) => sum + Number(project.duration), 0) / eligible.length;
    const finalStartBuffer = Math.min(
      MAXIMUM_FINAL_START_BUFFER_MINUTES,
      Math.max(MINIMUM_FINAL_START_BUFFER_MINUTES, Math.round(averageDuration / 30) * 30),
    );
    const finalTarget = requestedBlocks === 1
      ? firstTarget
      : Math.max(firstTarget, latestStart - finalStartBuffer);
    const targetStep = requestedBlocks > 1 ? (finalTarget - firstTarget) / (requestedBlocks - 1) : 0;
    let previousEnd = null;

    for (let index = 0; index < requestedBlocks; index += 1) {
      const target = firstTarget + (targetStep * index);
      const minimumStart = previousEnd === null ? earliestStart : previousEnd + MINIMUM_BLOCK_GAP_MINUTES;
      const ranked = eligible.map((project) => ({
        project,
        score: (counts[project.name] + 1) / (6 - project.priority),
        tie: random(),
      })).sort((a, b) => a.score - b.score || a.tie - b.tie);

      let placement = null;
      for (const { project } of ranked) {
        const duration = Number(project.duration);
        let blockStart = findAvailableStart(target, duration, minimumStart, latestStart, dayBlackouts);
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
          time: time(Math.min(latestStart, Math.max(earliestStart, Math.round(target)))),
          capacity: Math.max(0, latestStart - minimumStart),
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
  assertMinimumSpacing(schedules);
  return { schedules, counts, unfilled, seed: String(seed) };
}
