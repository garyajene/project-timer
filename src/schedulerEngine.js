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

function overlaps(start, end, blackout) {
  return start < minutes(blackout.end) && end > minutes(blackout.start);
}

export function generateSchedule({ weekStart, dayRules, blackouts = [], projects, seed = Date.now() }) {
  const random = seededRandom(seed);
  const slots = [];
  const startDate = new Date(`${weekStart}T12:00:00`);
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(startDate); date.setDate(date.getDate() + offset);
    const dateValue = dateKey(date);
    const rule = dayRules[DAY_NAMES[date.getDay()]];
    if (!rule?.enabled || rule.type === 'off') continue;
    let cursor = minutes(rule.start);
    const duration = Number(rule.duration);
    const dayBlackouts = blackouts.filter((item) => item.date === dateValue || (item.recurring && item.days?.includes(DAY_NAMES[date.getDay()])));
    for (let index = 0; index < Number(rule.blocks); index += 1) {
      while (dayBlackouts.some((item) => overlaps(cursor, cursor + duration, item))) {
        cursor = Math.max(...dayBlackouts.filter((item) => overlaps(cursor, cursor + duration, item)).map((item) => minutes(item.end)));
      }
      if (cursor + duration > minutes(rule.end)) break;
      slots.push({ date: dateValue, time: time(cursor), capacity: duration });
      cursor += duration + Number(rule.gap || 0);
    }
  }

  const eligible = projects.filter((project) => project.name && project.duration > 0 && slots.some((slot) => project.duration <= slot.capacity));
  const counts = Object.fromEntries(eligible.map((project) => [project.name, 0]));
  const unfilled = [];
  const orderedSlots = [...slots].sort((a, b) => a.capacity - b.capacity || random() - .5);
  for (const slot of orderedSlots) {
    const candidates = eligible.filter((project) => project.duration <= slot.capacity);
    if (!candidates.length) { unfilled.push(slot); continue; }
    const ranked = candidates.map((project) => ({
      project,
      score: (counts[project.name] + 1) / (6 - project.priority),
      tie: random(),
    })).sort((a, b) => a.score - b.score || a.tie - b.tie);
    const chosen = ranked[0].project;
    counts[chosen.name] += 1;
    slot.block = { time: slot.time, project: chosen.name, title: '', duration: chosen.duration, done: false };
  }

  const schedules = {};
  for (const slot of slots) {
    if (!slot.block) continue;
    (schedules[slot.date] ||= []).push(slot.block);
  }
  Object.values(schedules).forEach((blocks) => blocks.sort((a, b) => a.time.localeCompare(b.time)));
  return { schedules, counts, unfilled, seed: String(seed) };
}
