const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

export function generateSchedule({ weekStart, dayRules, blackouts = [], projects, seed = Date.now() }) {
  const random = seededRandom(seed);
  const schedules = {};
  const eligible = projects.filter((project) => project.name && project.duration > 0);
  const counts = Object.fromEntries(eligible.map((project) => [project.name, 0]));
  const unfilled = [];
  const startDate = new Date(`${weekStart}T12:00:00`);
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(startDate); date.setDate(date.getDate() + offset);
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
      cursor += Number(chosen.duration) + 60;
      index += 1;
    }
  }
  Object.values(schedules).forEach((blocks) => blocks.sort((a, b) => a.time.localeCompare(b.time)));
  return { schedules, counts, unfilled, seed: String(seed) };
}
