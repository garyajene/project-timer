import { sounds } from './audio.js';
import { remainingFromTimerState } from './timerPersistence.js';
import { generateSchedule } from './schedulerEngine.js';
const STORAGE_KEY = 'project-timer-state-v1';
const DEFAULT_BLOCK_MINUTES = 30;
const DURATION_PRESETS = [5, 10, 15, 30, 45, 60, 120, 180, 240];
const CALENDAR_DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240];
const QUICK_START_PROJECT = 'Quick Start';
const ZEN_BREAK_PRESETS = [0, 2, 5, 10, 15];

const DEMO_PROJECTS = new Set(['Project Timer', 'Writing system', 'Portfolio refresh', 'Health tracker', 'Home admin', 'Morning setup', 'Daily review']);
const DEMO_TITLES = new Set(['Plan daily priorities', 'Use Project Timer', 'Review content backlog', 'Focused project block', 'Wrap-up and tomorrow setup']);

const defaultState = {
  projects: [],
  projectSettings: {},
  schedule: [],
  schedules: {},
  schedulerSettings: {
    days: Object.fromEntries(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => [day, { enabled: !['Saturday', 'Sunday'].includes(day), type: day === 'Wednesday' ? 'light' : 'normal', start: '10:30', end: day === 'Wednesday' ? '13:00' : '23:30', blocks: day === 'Wednesday' ? 2 : 3, breakEnabled: false, breakStart: '12:00', breakEnd: '13:00' }])),
    blackouts: [], lastSeed: null,
  },
  activeIndex: 0,
  autoStartNextTask: false,
  notes: { parkingLot: '', general: '' },
  timerState: { status: 'idle', mode: 'scheduled', configuredDurationSeconds: 1800, remainingSecondsWhenPaused: 1800, startedAt: null, endsAt: null, activeIndex: null, quickTask: null, zenBreak: null },
};

const icon = { clock: '◷', edit: '✎', trash: '⌫', plus: '+', check: '✓', next: '›' };
const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
let state = structuredClone(defaultState);
let todayDraft = [];
let calendarView = 'day';
let calendarDate = toDateKey(new Date());
let schedulerRangeStart = getWeekStart(toDateKey(new Date()));
let schedulerRangeEnd = addDays(schedulerRangeStart, 6);
let scheduleGenerationMessage = '';
let calendarDraft = [];
let isRunning = false;
let isUserPaused = false;
let remainingSeconds = DEFAULT_BLOCK_MINUTES * 60;
let configuredDurationSeconds = remainingSeconds;
let hasTimerStarted = false;
let lastTick = Date.now();
let timerStartedAt = null;
let timerId;
let zenBreakNotifiedKey = null;
let quickTask = null;
let zenBreak = null;
const zenBreakTriggers = new Map();
let pendingSave = Promise.resolve();
let projectSaveTimer;
let scheduleSaveMessage = '';
let viewedIndex = null;
let viewedBlockDraft = null;
let timerBlockSaveMessage = '';
let timerBlockConflictOpen = false;
let runningIndex = null;
let projectedEndTime = null;
let conflictModalOpen = false;
let pendingStart = false;
let pendingStartIndex = null;
let pendingStartDuration = 0;
let conflictIndexes = new Set();
let conflictPreviousCalendarDate = null;
let conflictPreviousCalendarDraft = null;
let authorityTimerId;
let noteSaveTimer;
let authEnabled = false;
let registrationEnabled = false;
let currentUser = null;
let stateRevision = 0;
let accountGeneration = 0;


function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 1);
}

function addDays(dateKey, days) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function addMonths(dateKey, months) {
  const date = parseDateKey(dateKey);
  date.setMonth(date.getMonth() + months, 1);
  return toDateKey(date);
}

function formatDateLabel(dateKey, options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) {
  return new Intl.DateTimeFormat(undefined, options).format(parseDateKey(dateKey));
}

function getWeekStart(dateKey) {
  const date = parseDateKey(dateKey);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return toDateKey(date);
}

function sortBlocks(blocks) {
  return cloneSchedule(blocks).sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

function getScheduleForDate(dateKey) {
  return sortBlocks(state.schedules?.[dateKey] || []);
}

function setScheduleForDate(dateKey, blocks) {
  if (!state.schedules) state.schedules = {};
  const cleanBlocks = sortBlocks(blocks).map(normalizeBlock);
  if (cleanBlocks.length) state.schedules[dateKey] = cleanBlocks;
  else delete state.schedules[dateKey];
  if (dateKey === toDateKey(new Date())) state.schedule = cloneSchedule(cleanBlocks);
}

function loadCachedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.projects) || !Array.isArray(saved.schedule)) return structuredClone(defaultState);
    const projects = saved.projects.filter(Boolean).filter((project) => !DEMO_PROJECTS.has(project));
    const cleanSchedule = (schedule = []) => schedule
      .map(normalizeBlock)
      .filter((block) => block.time && (block.project || block.title) && !DEMO_TITLES.has(block.title) && !DEMO_PROJECTS.has(block.project));
    const todayKey = toDateKey(new Date());
    const schedules = {};
    if (saved.schedules && typeof saved.schedules === 'object') {
      Object.entries(saved.schedules).forEach(([dateKey, blocks]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Array.isArray(blocks)) return;
        const schedule = cleanSchedule(blocks);
        if (schedule.length) schedules[dateKey] = schedule;
      });
    }
    const schedule = cleanSchedule(saved.schedule);
    if (schedule.length && !schedules[todayKey]) schedules[todayKey] = schedule;
    return {
      projects,
      projectSettings: normalizeProjectSettings(saved.projectSettings, projects),
      schedulerSettings: normalizeSchedulerSettings(saved.schedulerSettings),
      schedules,
      schedule: cloneSchedule(schedules[todayKey] || []),
      activeIndex: Number.isInteger(saved.activeIndex) ? saved.activeIndex : 0,
      autoStartNextTask: saved.autoStartNextTask === true,
      notes: { parkingLot: String(saved.notes?.parkingLot ?? ''), general: String(saved.notes?.general ?? '') },
      timerState: { ...structuredClone(defaultState.timerState), ...(saved.timerState || {}) },
    };
  } catch {
    return structuredClone(defaultState);
  }
}

async function loadState() {
  try {
    const response = await fetch('/api/state', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const payload = await response.json();
    const serverState = authEnabled ? payload.state : payload;
    if (authEnabled) stateRevision = payload.revision;
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(serverState));
    return sanitizeState(serverState);
  } catch (error) {
    if (authEnabled) throw error;
    console.warn('Server state is temporarily unavailable; using the browser cache.', error);
    return loadCachedState();
  }
}

function sanitizeState(saved) {
  if (!saved || !Array.isArray(saved.projects) || !Array.isArray(saved.schedule)) return structuredClone(defaultState);
  const projects = saved.projects.filter(Boolean).filter((project) => !DEMO_PROJECTS.has(project));
  const cleanSchedule = (schedule = []) => schedule.map(normalizeBlock)
    .filter((block) => block.time && (block.project || block.title) && !DEMO_TITLES.has(block.title) && !DEMO_PROJECTS.has(block.project));
  const todayKey = toDateKey(new Date());
  const schedules = {};
  if (saved.schedules && typeof saved.schedules === 'object') {
    Object.entries(saved.schedules).forEach(([dateKey, blocks]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Array.isArray(blocks)) return;
      const schedule = cleanSchedule(blocks);
      if (schedule.length) schedules[dateKey] = schedule;
    });
  }
  const schedule = cleanSchedule(saved.schedule);
  if (schedule.length && !schedules[todayKey]) schedules[todayKey] = schedule;
  return { projects, projectSettings: normalizeProjectSettings(saved.projectSettings, projects), schedulerSettings: normalizeSchedulerSettings(saved.schedulerSettings), schedules, schedule: cloneSchedule(schedules[todayKey] || []), activeIndex: Number.isInteger(saved.activeIndex) ? saved.activeIndex : 0, autoStartNextTask: saved.autoStartNextTask === true, notes: { parkingLot: String(saved.notes?.parkingLot ?? ''), general: String(saved.notes?.general ?? '') }, timerState: { ...structuredClone(defaultState.timerState), ...(saved.timerState || {}) } };
}

function normalizeSchedulerSettings(settings) {
  const normalized = structuredClone(defaultState.schedulerSettings);
  if (!settings || typeof settings !== 'object') return normalized;
  for (const day of weekDays) {
    const value = settings.days?.[day];
    if (!value) continue;
    normalized.days[day] = { ...normalized.days[day], ...value, enabled: value.enabled === true, blocks: Math.max(0, Number(value.blocks) || 0), breakEnabled: value.breakEnabled === true, breakStart: String(value.breakStart || '12:00'), breakEnd: String(value.breakEnd || '13:00') };
    delete normalized.days[day].duration;
    delete normalized.days[day].gap;
  }
  normalized.blackouts = Array.isArray(settings.blackouts) ? settings.blackouts : [];
  normalized.lastSeed = settings.lastSeed || null;
  return normalized;
}

function normalizeProjectSettings(settings, projects) {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  return Object.fromEntries(projects.map((name) => {
    const value = source[name] || {};
    const priority = Math.min(5, Math.max(1, Number(value.priority) || 3));
    const defaultDuration = value.defaultDuration == null ? null : Math.max(1, Number(value.defaultDuration) || DEFAULT_BLOCK_MINUTES);
    return [name, { priority, defaultDuration }];
  }));
}

function cloneSchedule(schedule) {
  return schedule.map((block) => ({ ...block }));
}

function normalizeBlock(block) {
  const isBreak = Boolean(block.isBreak);
  return {
    time: block.time ?? '09:00',
    title: block.title ?? (isBreak ? 'Break' : ''),
    project: block.project ?? '',
    duration: Number(block.duration) || DEFAULT_BLOCK_MINUTES,
    zenBreakMinutes: Number(block.zenBreakMinutes ?? block.breakMinutes) || 0,
    zenBreakTiming: ['midpoint', 'random'].includes(block.zenBreakTiming) ? block.zenBreakTiming : 'midpoint',
    isBreak,
    done: Boolean(block.done),
  };
}

function saveState() {
  state.activeIndex = clampActiveIndex(state.activeIndex);
  captureTimerState();
  const snapshot = structuredClone(state);
  if (!authEnabled) localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  const generation = accountGeneration;
  pendingSave = pendingSave.catch(() => {}).then(async () => {
    if (generation !== accountGeneration || (authEnabled && !currentUser)) return false;
    const response = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authEnabled ? { state: snapshot, revision: stateRevision } : snapshot),
      keepalive: true,
    });
    if (response.status === 409) throw new Error('This workspace changed in another tab. Reload before saving again.');
    if (!response.ok) throw new Error(`Server rejected state with status ${response.status}`);
    if (authEnabled) stateRevision = (await response.json()).revision;
    return true;
  }).catch((error) => {
    console.error('Could not save state to the server.', error);
    return false;
  });
  return pendingSave;
}

function captureTimerState() {
  const now = Date.now();
  state.timerState = {
    status: isRunning ? 'running' : (isUserPaused || zenBreak?.active ? 'paused' : 'idle'),
    mode: quickTask?.active ? 'quick' : 'scheduled',
    configuredDurationSeconds,
    remainingSecondsWhenPaused: Math.max(0, remainingSeconds),
    startedAt: hasTimerStarted && timerStartedAt ? new Date(timerStartedAt).toISOString() : null,
    endsAt: isRunning && projectedEndTime ? projectedEndTime.toISOString() : null,
    activeIndex: quickTask?.active ? null : (runningIndex ?? state.activeIndex),
    quickTask: quickTask?.active ? structuredClone(quickTask) : null,
    zenBreak: zenBreak?.active ? {
      active: true,
      endsAt: new Date(now + (zenBreak.remainingSeconds * 1000)).toISOString(),
      pausedRemainingSeconds: zenBreak.pausedRemainingSeconds,
      resumeOnCancel: zenBreak.resumeOnCancel,
    } : null,
  };
}

function restoreTimerState() {
  const saved = state.timerState || defaultState.timerState;
  quickTask = saved.quickTask?.active ? structuredClone(saved.quickTask) : null;
  configuredDurationSeconds = Number(saved.configuredDurationSeconds) || DEFAULT_BLOCK_MINUTES * 60;
  remainingSeconds = remainingFromTimerState(saved);
  runningIndex = saved.mode === 'scheduled' && Number.isInteger(saved.activeIndex) ? saved.activeIndex : null;
  hasTimerStarted = ['running', 'paused'].includes(saved.status);
  timerStartedAt = hasTimerStarted && saved.startedAt ? Date.parse(saved.startedAt) : null;
  isUserPaused = saved.status === 'paused';
  isRunning = saved.status === 'running' && remainingSeconds > 0;
  projectedEndTime = isRunning && saved.endsAt ? new Date(saved.endsAt) : null;

  if (saved.zenBreak?.active) {
    const breakRemaining = Math.max(0, (Date.parse(saved.zenBreak.endsAt) - Date.now()) / 1000);
    if (breakRemaining > 0) {
      isRunning = false;
      zenBreak = { active: true, remainingSeconds: breakRemaining, pausedRemainingSeconds: Number(saved.zenBreak.pausedRemainingSeconds) || remainingSeconds, resumeOnCancel: saved.zenBreak.resumeOnCancel === true, lastTick: Date.now() };
      timerId = setInterval(tickZenBreak, 250);
      return;
    }
  }

  if (isRunning) {
    lastTick = Date.now();
    timerId = setInterval(tick, 250);
  } else if (saved.status === 'running') {
    hasTimerStarted = false;
    timerStartedAt = null;
    remainingSeconds = 0;
  }
}

function clampActiveIndex(index) {
  if (state.schedule.length === 0) return 0;
  return Math.min(Math.max(index, 0), state.schedule.length - 1);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours * 60) + minutes;
}

function currentLocalMinutes(date = new Date()) {
  return (date.getHours() * 60) + date.getMinutes() + (date.getSeconds() / 60);
}

function getSchedulePosition(date = new Date()) {
  const minutes = currentLocalMinutes(date);
  let currentIndex = null;
  let previousIndex = null;
  let nextIndex = null;
  state.schedule.forEach((block, index) => {
    const start = timeToMinutes(block.time);
    const end = start + (Number(block.duration) || DEFAULT_BLOCK_MINUTES);
    if (minutes >= start && minutes < end) currentIndex = index;
    else if (end <= minutes) previousIndex = index;
    else if (start > minutes && nextIndex === null) nextIndex = index;
  });
  if (currentIndex !== null) {
    previousIndex = currentIndex > 0 ? currentIndex - 1 : null;
    nextIndex = currentIndex < state.schedule.length - 1 ? currentIndex + 1 : null;
  }
  return { currentIndex, previousIndex, nextIndex };
}

function findScheduleConflicts(blocks) {
  const conflicts = new Set();
  const sorted = blocks.map((block, index) => ({ index, start: timeToMinutes(block.time), end: timeToMinutes(block.time) + (Number(block.duration) || DEFAULT_BLOCK_MINUTES) })).sort((a, b) => a.start - b.start);
  for (let left = 0; left < sorted.length; left += 1) {
    for (let right = left + 1; right < sorted.length && sorted[right].start < sorted[left].end; right += 1) {
      conflicts.add(sorted[left].index);
      conflicts.add(sorted[right].index);
    }
  }
  return conflicts;
}

function getStartConflicts(durationSeconds, excludedIndex = null) {
  const start = currentLocalMinutes();
  const end = start + (Math.max(0, durationSeconds) / 60);
  return new Set(state.schedule
    .map((block, index) => ({ index, start: timeToMinutes(block.time), end: timeToMinutes(block.time) + (Number(block.duration) || DEFAULT_BLOCK_MINUTES) }))
    .filter((block) => block.index !== excludedIndex && start < block.end && end > block.start)
    .map((block) => block.index));
}

function minutesToTime(totalMinutes) {
  const minutesInDay = 24 * 60;
  const safeMinutes = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatMinutes(minutes) {
  if (minutes > 60 && minutes % 60 !== 0) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours} ${hours === 1 ? 'Hour' : 'Hours'} ${remainder} Minutes`;
  }
  if (minutes === 60) return '1 Hour';
  if (minutes > 60) return `${minutes / 60} Hours`;
  return `${minutes} Minutes`;
}

function getNextStartTime(block) {
  return minutesToTime(timeToMinutes(block.time) + (Number(block.duration) || DEFAULT_BLOCK_MINUTES));
}

function formatTime(time) {
  const [rawHours = 0, rawMinutes = 0] = String(time).split(':').map(Number);
  const period = rawHours >= 12 ? 'PM' : 'AM';
  const hours = rawHours % 12 || 12;
  return `${hours}:${String(rawMinutes).padStart(2, '0')} ${period}`;
}

function getTimeParts(time) {
  const [rawHours = 9, rawMinutes = 0] = String(time).split(':').map(Number);
  return {
    hour: rawHours % 12 || 12,
    minutes: Number.isInteger(rawMinutes) ? rawMinutes : 0,
    period: rawHours >= 12 ? 'PM' : 'AM',
  };
}

function timePartsToTime(hour, minutes, period) {
  const normalizedHour = Number(hour) % 12;
  const hours24 = period === 'PM' ? normalizedHour + 12 : normalizedHour;
  return `${String(hours24).padStart(2, '0')}:${String(Number(minutes)).padStart(2, '0')}`;
}

function timeSelector(block, index) {
  const { hour, minutes, period } = getTimeParts(block.time);
  const hourOptions = Array.from({ length: 12 }, (_, optionIndex) => optionIndex + 1)
    .map((value) => `<option value="${value}" ${value === hour ? 'selected' : ''}>${value}</option>`)
    .join('');
  const minuteOptions = Array.from({ length: 60 }, (_, optionIndex) => optionIndex)
    .map((value) => `<option value="${value}" ${value === minutes ? 'selected' : ''}>${String(value).padStart(2, '0')}</option>`)
    .join('');
  return `<div class="time-selector" role="group" aria-label="Start time"><label>Hour <select class="text-input time-hour" data-index="${index}">${hourOptions}</select></label><label>Minutes <select class="text-input time-minutes" data-index="${index}">${minuteOptions}</select></label><label>AM / PM <select class="text-input time-period" data-index="${index}"><option value="AM" ${period === 'AM' ? 'selected' : ''}>AM</option><option value="PM" ${period === 'PM' ? 'selected' : ''}>PM</option></select></label></div>`;
}

function createDraftBlock(time = '09:00') {
  return { time, title: '', project: '', duration: DEFAULT_BLOCK_MINUTES, zenBreakMinutes: 0, zenBreakTiming: 'midpoint', done: false };
}

function applyNextStartTimes(startIndex) {
  for (let index = Math.max(1, startIndex + 1); index < todayDraft.length; index += 1) {
    todayDraft[index].time = getNextStartTime(todayDraft[index - 1]);
  }
}

function buildSavedSchedule(draft) {
  return draft
    .filter((block) => block.project.trim())
    .map((block) => normalizeBlock({ ...block, title: block.title.trim(), isBreak: false }));
}

function getBlockDurationSeconds(index) {
  if (quickTask?.active && index === 'quick') return Math.max(Number(quickTask.duration), 1) * 60;
  const block = state.schedule[index];
  if (!block) return DEFAULT_BLOCK_MINUTES * 60;
  const nextBlock = state.schedule[index + 1];
  if (block.duration) return Math.max(Number(block.duration), 1) * 60;
  if (!nextBlock) return DEFAULT_BLOCK_MINUTES * 60;
  const diff = timeToMinutes(nextBlock.time) - timeToMinutes(block.time);
  return Math.max(diff, 1) * 60;
}

function formatSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function formatDate() {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date());
}

function section({ id, title, eyebrow, className = '', content }) {
  return `<section id="${id}" class="panel ${className}"><div class="section-heading"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h2>${title}</h2></div></div>${content}</section>`;
}

function projectCard(label, title, meta, active = false, selectIndex = null) {
  const selectionAttributes = selectIndex === null ? '' : ` data-select-block="${selectIndex}" role="button" tabindex="0" aria-label="View ${escapeHtml(title)}"`;
  return `<article class="project-card ${active ? 'active-card' : ''}"${selectionAttributes}><p class="eyebrow">${label}</p><h3 data-card-title>${escapeHtml(title)}</h3><p data-card-meta>${escapeHtml(meta)}</p></article>`;
}

function getNextScheduledBlock(date = new Date()) {
  const todayKey = toDateKey(date);
  const nowMinutes = currentLocalMinutes(date);
  const todayBlock = state.schedule.find((block) => timeToMinutes(block.time) > nowMinutes);
  if (todayBlock) {
    const minutesUntilStart = Math.ceil(timeToMinutes(todayBlock.time) - nowMinutes);
    return {
      label: 'Next Scheduled Block',
      title: todayBlock.project || todayBlock.title || 'Task',
      meta: minutesUntilStart <= 60
        ? `Starts in ${minutesUntilStart} ${minutesUntilStart === 1 ? 'minute' : 'minutes'}`
        : `Starts at ${formatTime(todayBlock.time)}`,
    };
  }

  const futureDateKey = Object.keys(state.schedules || {})
    .filter((dateKey) => dateKey > todayKey && getScheduleForDate(dateKey).length)
    .sort()[0];
  if (!futureDateKey) return null;

  const nextBlock = getScheduleForDate(futureDateKey)[0];
  const tomorrowKey = addDays(todayKey, 1);
  const dayLabel = formatDateLabel(futureDateKey, { weekday: 'long' });
  return {
    label: 'Next Scheduled Block',
    title: 'NO MORE BLOCKS TODAY',
    meta: futureDateKey === tomorrowKey
      ? `See you tomorrow at ${formatTime(nextBlock.time)}`
      : `Next block: ${dayLabel} at ${formatTime(nextBlock.time)}`,
  };
}

function activeBlockCard(current, selectIndex = null, date = new Date()) {
  const selectionAttributes = selectIndex === null ? '' : ` data-select-block="${selectIndex}" role="button" tabindex="0" aria-label="Edit selected project"`;
  if (!current) {
    const upcoming = getNextScheduledBlock(date);
    if (!upcoming) return projectCard('Current Scheduled Block', 'Nothing scheduled right now', 'No future saved blocks', true);
    return `<article class="project-card active-card"${selectionAttributes} data-upcoming-card><p class="eyebrow" data-upcoming-label>${escapeHtml(upcoming.label)}</p><h3 data-card-title>${escapeHtml(upcoming.title)}</h3><p data-card-meta>${escapeHtml(upcoming.meta)}</p></article>`;
  }
  const scheduledTimes = current.time ? `<div><dt>Start Time</dt><dd>${escapeHtml(formatTime(current.time))}</dd></div><div><dt>End Time</dt><dd>${escapeHtml(formatTime(getNextStartTime(current)))}</dd></div>` : '';
  const label = isRunning ? 'Running Timer' : (viewedIndex !== null ? 'Selected Project Block' : 'Current Scheduled Block');
  return `<article class="project-card active-card active-block-card"${selectionAttributes}><p class="eyebrow">${label}</p><h3 data-card-title>${escapeHtml(current.project || QUICK_START_PROJECT)}</h3><p data-card-meta>${escapeHtml(current.title || 'Untitled task')}</p><dl class="active-block-details"><div><dt>Duration</dt><dd>${escapeHtml(formatMinutes(current.duration || DEFAULT_BLOCK_MINUTES))}</dd></div>${scheduledTimes}</dl></article>`;
}

function viewedBlockCard(block) {
  if (!block) return '';
  const draft = viewedBlockDraft || block;
  const projectChoices = state.projects.map((project) => `<option value="${escapeHtml(project)}" ${project === draft.project ? 'selected' : ''}>${escapeHtml(project)}</option>`).join('');
  return `<article class="project-card viewed-block-card selected-block-editor"><div class="selected-block-heading"><div><p class="eyebrow">Edit Selected Project</p><h3>${escapeHtml(draft.project || 'Task')}</h3></div><label class="selected-done"><input id="selected-block-done" type="checkbox" ${draft.done ? 'checked' : ''} /> Completed</label></div><div class="selected-block-fields"><label>Project<select id="selected-block-project" class="text-input">${projectChoices}</select></label><label>Task<input id="selected-block-title" class="text-input" value="${escapeHtml(draft.title || '')}" placeholder="Task description" /></label><label>Start Time<input id="selected-block-time" class="text-input" type="time" value="${escapeHtml(draft.time)}" /></label><label>Timer Length<select id="selected-block-duration" class="text-input">${CALENDAR_DURATION_OPTIONS.map((minutes) => `<option value="${minutes}" ${Number(draft.duration) === minutes ? 'selected' : ''}>${formatMinutes(minutes)}</option>`).join('')}</select></label><label>Zen Break<select id="selected-block-zen-duration" class="text-input">${ZEN_BREAK_PRESETS.map((minutes) => `<option value="${minutes}" ${Number(draft.zenBreakMinutes) === minutes ? 'selected' : ''}>${minutes ? formatMinutes(minutes) : 'Off'}</option>`).join('')}</select></label>${zenBreakTimingControl({ value: draft.zenBreakTiming || 'midpoint', id: 'selected-block-zen-timing' })}</div><div class="selected-block-actions"><button id="save-selected-block" class="primary" type="button">Save Changes</button><p id="timer-block-save-status" class="helper-text" role="status" aria-live="polite">${escapeHtml(timerBlockSaveMessage)}</p></div></article>`;
}

function getTimerStatus(current) {
  if (!current) return state.schedule.length ? 'Nothing scheduled right now' : 'Add a schedule block to start timing';
  const paused = isUserPaused ? 'PAUSED · ' : '';
  const name = `${current.project}${current.title ? ` · ${current.title}` : ''}`;
  const actualEnd = hasTimerStarted && projectedEndTime
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(projectedEndTime)
    : null;
  const endTime = quickTask?.active && !actualEnd ? '' : ` · ENDS AT ${actualEnd || formatTime(getNextStartTime(current))}`;
  return `${paused}${name}${endTime}`;
}

function primaryNavigation(className = '') {
  return `<nav class="top-nav ${className}" aria-label="Primary navigation">${['Today', 'Timer', 'Projects', 'Scheduler', 'Calendar', 'Notes'].map((item) => { const route = item.toLowerCase().replaceAll(' ', '-'); return `<a href="#${route}" ${getRoute() === route ? 'aria-current="page"' : ''}>${item}</a>`; }).join('')}</nav>`;
}

function header() {
  return `<header class="app-header ${getRoute() === 'timer' ? 'timer-header' : ''}"><div><p class="eyebrow">Personal workspace</p><h1>Project Timer</h1></div><div class="header-meta" aria-label="Current date and time"><span>${icon.clock}</span><span>${formatDate()}</span>${authEnabled && currentUser ? `<span>${escapeHtml(currentUser.email)}</span><button id="logout-button">Log out</button>` : ''}</div>${getRoute() === 'timer' ? '' : primaryNavigation()}</header>`;
}

function getActiveBlock() {
  if (quickTask?.active) return quickTask;
  if (runningIndex !== null) return state.schedule[runningIndex];
  if (viewedIndex !== null) return viewedBlockDraft || state.schedule[viewedIndex];
  return state.schedule[getSchedulePosition().currentIndex];
}

function getActiveLabel() {
  return quickTask?.active ? 'Quick Task' : 'Active Block';
}

function quickTaskNameField() {
  if (!quickTask?.active) return '';
  return `<label class="quick-task-name">Quick Task Name<input class="text-input" id="quick-title" value="${escapeHtml(quickTask.title)}" placeholder="What are you working on?" required ${hasTimerStarted ? 'disabled' : ''} /></label>`;
}

function zenBreakControl(current) {
  const available = Boolean(current && !current.isBreak);
  const enabled = available && Number(current.zenBreakMinutes) > 0;
  const selectedMinutes = enabled ? Number(current.zenBreakMinutes) : 5;
  return `<div class="zen-break-control"><label class="zen-break-toggle"><span>Zen Break</span><input id="zen-break-enabled" type="checkbox" role="switch" aria-label="Enable Zen Break" ${enabled ? 'checked' : ''} ${available ? '' : 'disabled'} /></label><details class="zen-break-menu" ${available ? '' : 'aria-disabled="true"'}><summary aria-label="Zen Break options" title="Zen Break options">⌄</summary><div class="zen-break-options"><button id="close-zen-break-options" class="escape-close escape-close-small" type="button" aria-label="Close Zen Break options">×</button><label>Duration<select id="timer-zen-break-duration" class="text-input" ${available ? '' : 'disabled'}>${ZEN_BREAK_PRESETS.filter(Boolean).map((minutes) => `<option value="${minutes}" ${minutes === selectedMinutes ? 'selected' : ''}>${formatMinutes(minutes)}</option>`).join('')}</select></label>${zenBreakTimingControl({ value: current?.zenBreakTiming || 'midpoint', id: 'timer-zen-break-timing' })}</div></details></div>`;
}

function timerPage() {
  const current = getActiveBlock();
  const position = getSchedulePosition();
  // Once a block has been selected (or a timer session has been restored), the
  // navigation cards must be relative to that block rather than to wall-clock
  // time. Otherwise an early/late timer session can show the active block as
  // its own "Next Block" and hide the actual following block.
  const navigationIndex = quickTask?.active
    ? null
    : (viewedIndex ?? runningIndex ?? position.currentIndex);
  const activeCardIndex = quickTask?.active
    ? null
    : (viewedIndex ?? runningIndex ?? position.currentIndex ?? position.nextIndex);
  const previousIndex = navigationIndex === null
    ? position.previousIndex
    : (navigationIndex > 0 ? navigationIndex - 1 : null);
  const previous = previousIndex === null ? null : state.schedule[previousIndex];
  const nextIndex = navigationIndex === null
    ? position.nextIndex
    : (navigationIndex < state.schedule.length - 1 ? navigationIndex + 1 : null);
  const next = nextIndex === null ? null : state.schedule[nextIndex];
  const inspected = viewedIndex === null ? null : state.schedule[viewedIndex];
  const canStart = Boolean(quickTask?.active || inspected || current);
  const quickTaskControls = quickTask?.active ? `<div class="quick-task-setup"><button id="close-quick-task" class="escape-close" type="button" aria-label="Cancel and close Quick Task" aria-keyshortcuts="Escape" title="Cancel and close">×</button>${quickTaskNameField()}<fieldset class="preset-group timer-presets"><legend>Duration</legend>${DURATION_PRESETS.map((minutes) => `<button type="button" class="preset-button timer-duration-preset ${configuredDurationSeconds === minutes * 60 ? 'active-preset' : ''}" data-minutes="${minutes}" ${hasTimerStarted ? 'disabled' : ''}>${formatMinutes(minutes)}</button>`).join('')}</fieldset></div>` : '';
  const autoStartControl = `<label class="auto-start-control"><span>Auto-Start</span><input id="auto-start-next-task" type="checkbox" role="switch" aria-label="Auto-Start Next Task" ${state.autoStartNextTask ? 'checked' : ''} /></label>`;
  const timerActions = `<div class="actions timer-actions"><button id="start-button" class="primary" ${canStart ? '' : 'disabled'}>Start</button><button id="stop-button">Pause</button><button id="reset-button" ${canStart ? '' : 'disabled'} aria-label="Clear timer to zero">Reset</button><button id="skip-button">Skip</button>${autoStartControl}${zenBreakControl(inspected || current)}</div>`;
  const quickTaskButton = quickTask?.active ? '' : `<button id="quick-task-button" class="quick-task-button" ${hasTimerStarted ? 'disabled' : ''}>${icon.plus} Quick Task</button>`;
  return `${section({ id: 'timer', title: 'Timer', eyebrow: 'Execution only', className: 'hero-panel', content: `<div class="timer-control-area"><div class="timer-shell" data-inactive="${current ? 'false' : 'true'}" aria-label="Countdown timer"><input id="timer-display" value="${formatSeconds(remainingSeconds)}" aria-label="Timer duration in hours, minutes, and seconds" inputmode="numeric" pattern="[0-9]+:[0-5][0-9]:[0-5][0-9]" ${hasTimerStarted ? 'disabled' : ''} /><p id="timer-status">${escapeHtml(getTimerStatus(current))}</p></div>${quickTaskControls}${timerActions}${quickTaskButton}</div>${primaryNavigation('timer-nav')}<div class="block-navigation"><div class="dashboard-grid">${projectCard('Previous Block', previous ? `← ${previous.project}` : 'Start of schedule', previous?.title || 'No previous block', false, previous ? previousIndex : null)}${activeBlockCard(current, activeCardIndex)}${projectCard('Next Block', next ? `${next.project} →` : 'End of schedule', next?.title || 'No next block', false, next ? nextIndex : null)}</div>${viewedBlockCard(inspected)}</div>` })}${timerSchedule()}${timerBlockConflictDialog()}${conflictModal()}${zenBreakOverlay()}`;
}

function timerSchedule() {
  const currentIndex = getSchedulePosition().currentIndex;
  const selectedIndex = viewedIndex ?? currentIndex;
  const blocks = state.schedule.map((block, index) => {
    const displayBlock = index === viewedIndex && viewedBlockDraft ? viewedBlockDraft : block;
    return `<div class="time-block timer-block ${displayBlock.isBreak ? 'break-block' : ''} ${!quickTask?.active && index === selectedIndex ? 'active-task' : ''} ${displayBlock.done ? 'completed-task' : ''}" data-index="${index}" role="button" tabindex="0" aria-label="Edit ${escapeHtml(displayBlock.title || displayBlock.project)}"><input class="schedule-done" data-index="${index}" type="checkbox" ${displayBlock.done ? 'checked' : ''} aria-label="Mark ${escapeHtml(displayBlock.title || displayBlock.project)} complete" /><span class="time">${escapeHtml(formatTime(displayBlock.time))}</span><span class="task-copy"><strong>${escapeHtml(displayBlock.project || 'Task')}</strong><small>${escapeHtml([displayBlock.title || 'Task', formatMinutes(displayBlock.duration), displayBlock.zenBreakMinutes ? `Zen Break: ${formatMinutes(displayBlock.zenBreakMinutes)}` : ''].filter(Boolean).join(' · '))}</small></span></div>`;
  }).join('') || '<p class="empty-state">No saved schedule yet. Plan today on the Today page.</p>';
  return section({ id: 'timer-schedule', title: 'Today’s Saved Schedule', content: `<div class="schedule-list">${blocks}</div>` });
}

function timerBlockConflictDialog() {
  if (!timerBlockConflictOpen) return '';
  return `<div class="conflict-overlay" role="dialog" aria-modal="true" aria-labelledby="timer-block-conflict-title"><section class="conflict-dialog timer-block-conflict-dialog"><button id="close-timer-block-conflict" class="escape-close" type="button" aria-label="Close conflict warning" title="Close">×</button><p class="eyebrow">Schedule Conflict</p><h2 id="timer-block-conflict-title">This change overlaps another scheduled project.</h2><p>Change the start time or timer length, then save again.</p><button id="acknowledge-timer-block-conflict" class="primary" type="button">Go Back and Fix It</button></section></div>`;
}

function conflictModal() {
  if (!conflictModalOpen) return '';
  const rows = calendarDraft.map((block, index) => `<article class="calendar-block-card ${conflictIndexes.has(index) ? 'conflict-block' : ''}" data-index="${index}">${conflictIndexes.has(index) ? '<strong class="conflict-label">CONFLICT</strong>' : ''}<div class="calendar-card-fields"><label>Project<select class="text-input" disabled>${projectOptions(block.project)}</select></label><label>Task<input class="text-input" value="${escapeHtml(block.title)}" disabled /></label><fieldset><legend>Start Time</legend>${calendarTimeSelector(block, index).replaceAll('calendar-hour', 'conflict-hour').replaceAll('calendar-minute', 'conflict-minute').replaceAll('calendar-period', 'conflict-period')}</fieldset><div class="calendar-timing-summary"><label>Block Length<select class="text-input conflict-duration" data-index="${index}">${DURATION_PRESETS.map((minutes) => `<option value="${minutes}" ${Number(block.duration) === minutes ? 'selected' : ''}>${formatMinutes(minutes)}</option>`).join('')}</select></label><div class="calendar-ends-at"><span>Ends At</span><strong>${escapeHtml(formatTime(getNextStartTime(block)))}</strong></div></div></div><button class="conflict-delete-block" data-index="${index}" type="button">${icon.trash} Cancel block</button></article>`).join('');
  return `<div class="conflict-overlay" role="dialog" aria-modal="true" aria-labelledby="conflict-title"><section class="conflict-dialog"><button id="close-conflict" class="escape-close" type="button" aria-label="Cancel start and close schedule conflict" aria-keyshortcuts="Escape" title="Cancel and close">×</button><p class="eyebrow">Schedule Conflict</p><h2 id="conflict-title">This block conflicts with another scheduled block.</h2><p>Move a block, change its length, cancel a block, or close this window to keep the original schedule.</p><div class="conflict-schedule">${rows}</div><button id="conflict-save" class="primary">Save Schedule</button><p id="conflict-status" class="helper-text" role="status">${conflictIndexes.size ? 'Resolve every highlighted overlap.' : '✓ No conflicts'}</p></section></div>`;
}

function zenBreakOverlay() {
  if (!zenBreak?.active) return '';
  return `<div class="zen-break-overlay" role="dialog" aria-modal="true" aria-labelledby="zen-break-title"><div class="zen-break-dialog"><button id="close-zen-break" class="escape-close" type="button" aria-label="Cancel and close Zen Break" aria-keyshortcuts="Escape" title="Cancel and close">×</button><p class="eyebrow">Zen Break</p><h2 id="zen-break-title">Pause and reset</h2><span id="zen-break-countdown">${formatSeconds(zenBreak.remainingSeconds)}</span><div class="actions zen-break-actions"><button id="end-zen-break" type="button">End Break Now</button><button id="extend-zen-break" type="button" class="primary">Extend 2 Minutes</button></div></div></div>`;
}

function projectOptions(selectedProject, includeQuickStart = false) {
  const createOption = '<option value="__create_project__">+ Create New Project...</option>';
  const placeholder = `<option value="" ${selectedProject ? '' : 'selected'} disabled>Select project</option>`;
  const quickStartOption = includeQuickStart ? `<option value="${QUICK_START_PROJECT}" ${selectedProject === QUICK_START_PROJECT ? 'selected' : ''}>${QUICK_START_PROJECT} (No Project)</option>` : '';
  return quickStartOption + createOption + placeholder + state.projects.map((project) => `<option value="${escapeHtml(project)}" ${project === selectedProject ? 'selected' : ''}>${escapeHtml(project)}</option>`).join('');
}

function zenBreakTimingControl({ value = 'midpoint', className = '', index = '', id = '' } = {}) {
  return `<label class="zen-timing-control">Zen Break Timing <select class="text-input zen-timing-select ${className}" ${id ? `id="${id}"` : ''} ${index !== '' ? `data-index="${index}"` : ''} aria-label="Zen Break Timing"><option value="midpoint" ${value === 'midpoint' ? 'selected' : ''}>Midpoint</option><option value="random" ${value === 'random' ? 'selected' : ''}>Random</option></select></label>`;
}

function addProjectToMasterList(name) {
  const project = name.trim();
  if (!project) return '';
  if (!state.projects.includes(project)) {
    state.projects.push(project);
    state.projectSettings[project] = { priority: 3, defaultDuration: null };
  }
  return project;
}

function projectSettings(project) {
  return state.projectSettings[project] || { priority: 3, defaultDuration: null };
}

function saveStatus() {
  return `<p id="schedule-save-status" class="helper-text" role="status" aria-live="polite">${escapeHtml(scheduleSaveMessage)}</p>`;
}

function todayPlanner() {
  const now = new Date();
  const rows = getScheduleForDate(toDateKey(now)).map((block) => {
    const duration = Number(block.duration) || DEFAULT_BLOCK_MINUTES;
    const endTime = getNextStartTime(block);
    return `<article class="today-schedule-row"><h4>${escapeHtml(block.project || 'Task')}</h4><dl class="today-block-details"><div><dt>Start:</dt><dd><time datetime="${escapeHtml(block.time)}">${escapeHtml(formatTime(block.time))}</time></dd></div><div><dt>End:</dt><dd><time datetime="${escapeHtml(endTime)}">${escapeHtml(formatTime(endTime))}</time></dd></div><div><dt>Duration:</dt><dd>${escapeHtml(formatMinutes(duration))}</dd></div></dl></article>`;
  }).join('') || '<p class="empty-state today-empty-state">Nothing scheduled for today.</p>';
  return `<section id="today" class="panel today-overview"><header class="today-page-heading"><h2>TODAY</h2><p>What am I doing today?</p></header><div class="today-agenda"><h3>TODAY’S SCHEDULE</h3><div class="today-schedule-list">${rows}</div></div></section>`;
}


function masterProjectList() {
  return section({ id: 'projects', title: 'Master Project List', eyebrow: 'Backlog', content: `<div class="project-list">${state.projects.map((project, index) => {
    const settings = projectSettings(project);
    const priorities = [1, 2, 3, 4, 5].map((priority) => `<label class="priority-option"><input class="project-priority" data-index="${index}" type="radio" name="project-priority-${index}" value="${priority}" ${settings.priority === priority ? 'checked' : ''} required /><span>${priority}</span></label>`).join('');
    return `<div class="project-row"><div class="project-main"><input class="text-input project-name" data-index="${index}" value="${escapeHtml(project)}" aria-label="Project name" /><fieldset class="priority-control"><legend>Priority <small>1 highest · 5 lowest</small></legend><div>${priorities}</div></fieldset><label class="project-duration-field">Default block length<select class="text-input project-duration" data-index="${index}">${CALENDAR_DURATION_OPTIONS.map((minutes) => `<option value="${minutes}" ${settings.defaultDuration === minutes || (settings.defaultDuration === null && minutes === DEFAULT_BLOCK_MINUTES) ? 'selected' : ''}>${formatMinutes(minutes)}</option>`).join('')}</select></label></div><div class="row-actions"><button class="delete-project" data-index="${index}" aria-label="Delete ${escapeHtml(project)}">${icon.trash} Delete</button></div></div>`;
  }).join('') || '<p class="empty-state">No projects yet.</p>'}</div><button id="add-project" class="add-button"><span>${icon.plus}</span> Add Project</button>` });
}

function calendarTaskSummary(block) {
  return `<button type="button" class="calendar-task" data-calendar-task-time="${escapeHtml(block.time)}"><span class="time">${escapeHtml(formatTime(block.time))}</span><strong>${escapeHtml(block.project || 'Task')}</strong>${block.title ? `<small>${escapeHtml(block.title)}</small>` : ''}</button>`;
}

function getWeekTimelineBounds(days) {
  const blocks = days.flatMap((day) => day.blocks);
  if (!blocks.length) return { start: 8 * 60, end: 18 * 60 };
  const earliest = Math.min(...blocks.map((block) => timeToMinutes(block.time)));
  const latest = Math.max(...blocks.map((block) => timeToMinutes(getNextStartTime(block))));
  const start = Math.max(0, Math.floor(earliest / 60) * 60);
  return { start, end: Math.min(24 * 60, Math.max(Math.ceil(latest / 60) * 60, start + 60)) };
}

function dayView(dateKey) {
  return `<div class="day-view calendar-full-view"><div class="calendar-view-heading"><h3>${escapeHtml(formatDateLabel(dateKey))}</h3><div class="actions"><button id="calendar-prev">Previous Day</button><button id="calendar-next">Next Day</button></div></div>${calendarPlanner()}</div>`;
}

function weekView(dateKey) {
  const weekStart = getWeekStart(dateKey);
  const days = weekDays.map((day, index) => {
    const columnDate = addDays(weekStart, index);
    return { day, columnDate, blocks: getScheduleForDate(columnDate) };
  });
  const { start, end } = getWeekTimelineBounds(days);
  const hourCount = (end - start) / 60;
  const headers = days.map(({ day, columnDate }) => `<div class="week-day-heading"><strong>${day}</strong><small>${escapeHtml(formatDateLabel(columnDate, { month: 'short', day: 'numeric' }))}</small></div>`).join('');
  const times = Array.from({ length: hourCount + 1 }, (_, index) => `<time style="--hour-row: ${index + 1}">${escapeHtml(formatTime(minutesToTime(start + index * 60)))}</time>`).join('');
  const columns = days.map(({ day, blocks }) => `<div class="week-day-column" aria-label="${day}">${blocks.map((block) => {
    const blockStart = Math.max(start, timeToMinutes(block.time));
    const blockEnd = Math.min(end, timeToMinutes(getNextStartTime(block)));
    const top = ((blockStart - start) / (end - start)) * 100;
    const height = Math.max(((blockEnd - blockStart) / (end - start)) * 100, 2);
    return `<button type="button" class="calendar-task week-task" data-calendar-task-time="${escapeHtml(block.time)}" style="--task-top: ${top}%; --task-height: ${height}%" aria-label="${escapeHtml(`${block.project || 'Task'}, ${formatTime(block.time)}`)}"><span class="time">${escapeHtml(formatTime(block.time))}</span><strong>${escapeHtml(block.project || 'Task')}</strong>${block.title ? `<small>${escapeHtml(block.title)}</small>` : ''}</button>`;
  }).join('')}</div>`).join('');
  return `<div class="calendar-full-view"><div class="calendar-view-heading"><h3>Week of ${escapeHtml(formatDateLabel(weekStart, { month: 'long', day: 'numeric', year: 'numeric' }))}</h3><div class="actions"><button id="calendar-prev">Previous Week</button><button id="calendar-next">Next Week</button></div></div><div class="week-view" style="--week-hours: ${hourCount}"><div class="week-scroll"><div class="week-header"><span aria-hidden="true"></span>${headers}</div><div class="week-timeline"><div class="week-time-axis">${times}</div>${columns}</div></div></div></div>`;
}

function monthView(dateKey) {
  const date = parseDateKey(dateKey);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const gridStart = getWeekStart(toDateKey(first));
  const currentMonth = date.getMonth();
  const weekdayHeaders = weekDays.map((day) => `<div class="month-weekday">${escapeHtml(day)}</div>`).join('');
  const cells = Array.from({ length: 42 }, (_, index) => {
    const cellDate = addDays(gridStart, index);
    const parsed = parseDateKey(cellDate);
    const classes = [cellDate === toDateKey(new Date()) ? 'today-dot' : '', parsed.getMonth() !== currentMonth ? 'outside-month' : ''].filter(Boolean).join(' ');
    const blocks = getScheduleForDate(cellDate).map((block) => `<span class="month-task"><strong>${escapeHtml(block.project || 'Task')}</strong>${block.title ? ` <small>${escapeHtml(block.title)}</small>` : ''}</span>`).join('');
    return `<button type="button" class="month-day ${classes}" data-calendar-date="${cellDate}"><strong>${parsed.getDate()}</strong>${blocks || '<small class="empty-month-day">No tasks</small>'}</button>`;
  }).join('');
  return `<div class="calendar-full-view"><div class="calendar-view-heading"><h3>${escapeHtml(formatDateLabel(dateKey, { month: 'long', year: 'numeric' }))}</h3><div class="actions"><button id="calendar-prev">Previous Month</button><button id="calendar-next">Next Month</button></div></div><div class="month-view">${weekdayHeaders}${cells}</div></div>`;
}

function calendarTimeSelector(block, index) {
  const [hours24 = 9, minutes = 0] = String(block.time).split(':').map(Number);
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hour = hours24 % 12 || 12;
  const hourOptions = Array.from({ length: 12 }, (_, option) => option + 1).map((value) => `<option value="${value}" ${value === hour ? 'selected' : ''}>${value}</option>`).join('');
  const minuteOptions = Array.from({ length: 60 }, (_, value) => `<option value="${value}" ${value === minutes ? 'selected' : ''}>${String(value).padStart(2, '0')}</option>`).join('');
  return `<div class="calendar-time-selector" data-index="${index}"><label>Hour<select class="text-input calendar-hour" data-index="${index}" aria-label="Start time hour">${hourOptions}</select></label><span aria-hidden="true">:</span><label>Minute<select class="text-input calendar-minute" data-index="${index}" aria-label="Start time minute">${minuteOptions}</select></label><button type="button" class="calendar-period" data-index="${index}" data-period="${period}" aria-label="Start time ${period}; click to switch">${period}</button></div>`;
}

function calendarPlanner() {
  const draftConflicts = findScheduleConflicts(calendarDraft);
  const rows = calendarDraft.map((block, index) => {
    return `<article class="calendar-block-card ${draftConflicts.has(index) ? 'conflict-block' : ''}" data-index="${index}">${draftConflicts.has(index) ? '<strong class="conflict-label">OVERLAPS ANOTHER BLOCK</strong>' : ''}<div class="calendar-card-fields"><label>Project<select class="text-input calendar-project project-select" data-index="${index}" required>${projectOptions(block.project)}</select></label><label>Task <span class="optional-label">(optional)</span><input class="text-input calendar-title" data-index="${index}" value="${escapeHtml(block.title)}" placeholder="Task description" /></label><fieldset><legend>Start Time</legend>${calendarTimeSelector(block, index)}</fieldset><div class="calendar-timing-summary"><label>Block Length<select class="text-input calendar-duration" data-index="${index}" aria-label="Block Length">${CALENDAR_DURATION_OPTIONS.map((minutes) => `<option value="${minutes}" ${block.duration === minutes ? 'selected' : ''}>${formatMinutes(minutes)}</option>`).join('')}</select></label><div class="calendar-ends-at" aria-live="polite"><span>Ends At</span><strong data-calendar-end-time="${index}">${escapeHtml(formatTime(getNextStartTime(block)))}</strong></div></div></div><button class="calendar-delete-block" data-index="${index}" aria-label="Delete project block">${icon.trash} Delete</button></article>`;
  }).join('') || '<p class="empty-state">No blocks planned for this date.</p>';
  return `<div class="calendar-planner"><div class="schedule-list">${rows}</div><div class="calendar-editor-actions"><button id="calendar-add-block" class="add-button"><span>${icon.plus}</span> Add Project Block</button><button id="calendar-save" class="primary save-button">Save Schedule</button></div>${saveStatus()}</div>`;
}

function calendarSection() {
  const selectedView = calendarView === 'week' ? weekView(calendarDate) : calendarView === 'month' ? monthView(calendarDate) : dayView(calendarDate);
  const generationNotice = scheduleGenerationMessage ? `<p class="schedule-generation-notice" role="status">${escapeHtml(scheduleGenerationMessage)}</p>` : '';
  return section({ id: 'calendar', title: 'Calendar', eyebrow: 'Planning', content: `${generationNotice}<div class="calendar-controls"><label>Planning Date <input id="calendar-date" class="text-input" type="date" value="${calendarDate}" /></label></div><div class="calendar-tabs"><button class="${calendarView === 'day' ? 'active-tab' : ''}" data-calendar-view="day">Day</button><button class="${calendarView === 'week' ? 'active-tab' : ''}" data-calendar-view="week">Week</button><button class="${calendarView === 'month' ? 'active-tab' : ''}" data-calendar-view="month">Month</button></div><div class="calendar-layout single-calendar-view">${selectedView}</div>` });
}

function schedulerPage() {
  const settings = state.schedulerSettings;
  const weekStart = schedulerRangeStart || getWeekStart(toDateKey(new Date()));
  const weekEnd = schedulerRangeEnd || addDays(weekStart, 6);
  const dayRows = weekDays.map((day) => {
    const rule = settings.days[day];
    return `<article class="scheduler-day" data-day="${day}"><header><strong>${day}</strong></header><label>Day type<select class="text-input scheduler-type"><option value="normal" ${rule.type === 'normal' ? 'selected' : ''}>Normal</option><option value="light" ${rule.type === 'light' ? 'selected' : ''}>Light</option><option value="off" ${rule.type === 'off' ? 'selected' : ''}>Off</option></select></label><label>Earliest start<input class="text-input scheduler-start" type="time" value="${rule.start}"></label><label>Latest project start<input class="text-input scheduler-end" type="time" value="${rule.end}"></label><label>Blocks<input class="text-input scheduler-blocks" type="number" min="0" max="12" value="${rule.blocks}"></label><label class="scheduler-break-toggle"><input class="scheduler-break-enabled" type="checkbox" role="switch" ${rule.breakEnabled ? 'checked' : ''}> Add a break</label><div class="scheduler-break-times ${rule.breakEnabled ? '' : 'disabled-field'}"><label>Break starts<input class="text-input scheduler-break-start" type="time" value="${rule.breakStart}" ${rule.breakEnabled ? '' : 'disabled'}></label><label>Break ends<input class="text-input scheduler-break-end" type="time" value="${rule.breakEnd}" ${rule.breakEnabled ? '' : 'disabled'}></label></div></article>`;
  }).join('');
  const blackoutRows = settings.blackouts.map((item, index) => `<article class="blackout-row"><label>When<select class="text-input blackout-recurring" data-index="${index}"><option value="date" ${item.recurring ? '' : 'selected'}>This date</option><option value="daily" ${item.recurring ? 'selected' : ''}>Every day</option></select></label><label>Date<input class="text-input blackout-date" data-index="${index}" type="date" value="${escapeHtml(item.date || '')}" ${item.recurring ? 'disabled' : ''}></label><label>Starts<input class="text-input blackout-start" data-index="${index}" type="time" value="${escapeHtml(item.start || '16:00')}"></label><label>Ends<input class="text-input blackout-end" data-index="${index}" type="time" value="${escapeHtml(item.end || '19:00')}"></label><label>Name<input class="text-input blackout-name" data-index="${index}" value="${escapeHtml(item.name || '')}" placeholder="Food, trip, meeting…"></label><button class="delete-blackout" data-index="${index}">${icon.trash} Delete</button></article>`).join('') || '<p class="empty-state">No blackout dates yet.</p>';
  return `${section({ id: 'scheduler', title: 'Build My Week', eyebrow: 'You shape the time. The scheduler chooses the work.', content: `<p class="helper-text">Set each day before generating. Block lengths come from Projects, and the scheduler leaves at least one hour between blocks. Priority automatically means more often.</p><div class="scheduler-days">${dayRows}</div>` })}${section({ id: 'blackouts', title: 'Blackout Dates', eyebrow: 'Protected time', content: `<div class="blackout-list">${blackoutRows}</div><button id="add-blackout" class="add-button">${icon.plus} Add Blackout</button>` })}${section({ id: 'generate-week', title: 'Generate Schedule', eyebrow: 'Priority-weighted random picker', content: `<div class="generate-controls"><div class="scheduler-date-control"><label>Start date<input id="scheduler-week" class="text-input" type="date" value="${weekStart}"></label><button class="date-picker-button" type="button" data-date-picker="scheduler-week">Choose Start Date</button></div><div class="scheduler-date-control"><label>End date<input id="scheduler-week-end" class="text-input" type="date" value="${weekEnd}"></label><button class="date-picker-button" type="button" data-date-picker="scheduler-week-end">Choose End Date</button></div><button id="generate-schedule" class="primary">Make My Schedule</button></div><p id="scheduler-range-summary" class="helper-text">This schedule covers ${escapeHtml(formatDateLabel(weekStart, { month: 'long', day: 'numeric', year: 'numeric' }))} through ${escapeHtml(formatDateLabel(weekEnd, { month: 'long', day: 'numeric', year: 'numeric' }))}.</p><p id="scheduler-status" class="helper-text" role="status"></p>` })}`;
}

function notesAndReview() {
  return `<div class="notes-grid">${section({ id: 'parking', title: 'Parking Lot', eyebrow: 'Quick capture', content: `<textarea id="parking-lot-notes" aria-label="Parking lot notes">${escapeHtml(state.notes.parkingLot)}</textarea>` })}${section({ id: 'notes', title: 'Project Notes', eyebrow: 'Current project', content: `<textarea id="general-notes" aria-label="Project notes">${escapeHtml(state.notes.general)}</textarea>` })}${section({ id: 'end-day', title: 'End of Day', eyebrow: 'Review', content: '<div class="review-card"><span>✓</span><div><h3>Accomplishments</h3><p>Summarize completed work and lessons learned.</p></div></div><div class="review-card"><span>›</span><div><h3>First Task for tomorrow</h3><p>Choose the next focused starting point.</p></div></div>' })}</div>`;
}

function getRoute() {
  const route = window.location.hash.replace('#', '').toLowerCase();
  return route || 'today';
}

function mainContent() {
  const route = getRoute();
  if (route === 'projects') return masterProjectList();
  if (route === 'timer') return timerPage();
  if (route === 'scheduler') return schedulerPage();
  if (route === 'calendar') return calendarSection();
  if (route === 'notes') return notesAndReview();
  return todayPlanner();
}

function getAppElement() {
  return document.querySelector('#app');
}

function errorPanel(error) {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  return section({
    id: 'startup-error',
    title: 'Project Timer is available',
    eyebrow: 'Startup warning',
    className: 'startup-error-panel',
    content: `<p class="helper-text">One part of the application could not initialize, but the app shell is still available. Check the browser console for details.</p><pre>${escapeHtml(message)}</pre>`,
  });
}

function renderShell(content = '') {
  const app = getAppElement();
  if (!app) {
    console.error('Project Timer startup failed: #app container is missing.');
    return false;
  }
  app.innerHTML = `${header()}<main>${content}</main>`;
  return true;
}

function render() {
  try {
    if (authEnabled && !currentUser) {
      const app = getAppElement();
      const registrationMessage = registrationEnabled
        ? 'Registration is currently open.'
        : 'Registration is closed; existing users can still log in.';
      app.innerHTML = `<main class="auth-page"><section class="panel auth-panel"><p class="eyebrow">Private workspace</p><h1>Project Timer</h1><p class="helper-text">Log in to open your workspace.</p><form id="auth-form"><label>Email<input class="text-input" name="email" type="email" autocomplete="email" required /></label><label>Password<input class="text-input" name="password" type="password" autocomplete="current-password" minlength="12" required /></label><p class="auth-status">${registrationMessage}</p><p id="auth-error" class="auth-error" role="alert" aria-live="polite"></p><div class="actions"><button class="primary" name="action" value="login">Log in</button><button name="action" value="register"${registrationEnabled ? '' : ' disabled aria-disabled="true"'}>Register</button></div></form></section></main>`;
      bindAuthEvents();
      return;
    }
    if (!renderShell(mainContent())) return;
    bindEvents();
  } catch (error) {
    console.error('Project Timer render failed.', error);
    try {
      renderShell(errorPanel(error));
      bindGlobalEvents();
    } catch (shellError) {
      console.error('Project Timer shell render failed.', shellError);
    }
  }
}

function bindAuthEvents() {
  document.querySelector('#auth-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/auth/${submitter?.value === 'register' ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
    const payload = await response.json();
    if (!response.ok) { document.querySelector('#auth-error').textContent = payload.error || 'Authentication failed'; return; }
    accountGeneration += 1;
    currentUser = payload.user;
    state = await loadState();
    todayDraft = cloneSchedule(state.schedule.filter((block) => !block.isBreak));
    calendarDraft = cloneSchedule(getScheduleForDate(calendarDate).filter((block) => !block.isBreak));
    restoreTimerState();
    render();
  });
}

function updateTimerDisplay() {
  const display = document.querySelector('#timer-display');
  const status = document.querySelector('#timer-status');
  const current = getActiveBlock();
  if (display) display.value = formatSeconds(remainingSeconds);
  if (status) status.textContent = getTimerStatus(current);
  const upcomingCard = document.querySelector('[data-upcoming-card]');
  const upcoming = current ? null : getNextScheduledBlock();
  if (upcomingCard && upcoming) {
    upcomingCard.querySelector('[data-upcoming-label]').textContent = upcoming.label;
    upcomingCard.querySelector('[data-card-title]').textContent = upcoming.title;
    upcomingCard.querySelector('[data-card-meta]').textContent = upcoming.meta;
  }
}

function getZenBreakKey(index) {
  const block = index === 'quick' ? quickTask : state.schedule[index];
  if (!block) return null;
  return `${index}-${block.time || 'quick'}-${block.project}-${block.title}-${block.duration}-${block.zenBreakMinutes}-${block.zenBreakTiming}`;
}

function getZenBreakTriggerSecond(index, block, durationSeconds) {
  const key = getZenBreakKey(index);
  if (!key) return durationSeconds / 2;
  if (!zenBreakTriggers.has(key)) {
    const trigger = block.zenBreakTiming === 'random'
      ? durationSeconds * (0.25 + (Math.random() * 0.5))
      : durationSeconds / 2;
    zenBreakTriggers.set(key, trigger);
  }
  return zenBreakTriggers.get(key);
}

function startZenBreak(block) {
  const resumeOnCancel = isRunning;
  isRunning = false;
  clearInterval(timerId);
  sounds.zenBreak();
  zenBreak = {
    active: true,
    remainingSeconds: Math.max(Number(block.zenBreakMinutes), 1) * 60,
    pausedRemainingSeconds: remainingSeconds,
    resumeOnCancel,
    lastTick: Date.now(),
  };
  render();
  timerId = setInterval(tickZenBreak, 250);
  saveState();
}

function syncZenBreakCountdown() {
  if (!zenBreak?.active) return;
  const now = Date.now();
  zenBreak.remainingSeconds -= (now - zenBreak.lastTick) / 1000;
  zenBreak.lastTick = now;
}

function endZenBreakNow() {
  if (!zenBreak?.active) return;
  clearInterval(timerId);
  remainingSeconds = zenBreak.pausedRemainingSeconds;
  zenBreak = null;
  sounds.zenBreak();
  startTimer({ playStartSound: false });
  render();
}

function cancelZenBreak() {
  if (!zenBreak?.active) return;
  clearInterval(timerId);
  const resumeOnCancel = zenBreak.resumeOnCancel;
  remainingSeconds = zenBreak.pausedRemainingSeconds;
  zenBreak = null;
  isRunning = resumeOnCancel;
  if (isRunning) {
    lastTick = Date.now();
    timerId = setInterval(tick, 250);
  }
  render();
  saveState();
}

function cancelConflictStart() {
  if (!conflictModalOpen) return;
  conflictModalOpen = false;
  pendingStart = false;
  pendingStartIndex = null;
  pendingStartDuration = 0;
  conflictIndexes = new Set();
  if (conflictPreviousCalendarDate !== null) calendarDate = conflictPreviousCalendarDate;
  if (conflictPreviousCalendarDraft !== null) calendarDraft = conflictPreviousCalendarDraft;
  conflictPreviousCalendarDate = null;
  conflictPreviousCalendarDraft = null;
  render();
}

function extendZenBreak() {
  if (!zenBreak?.active) return;
  syncZenBreakCountdown();
  zenBreak.remainingSeconds += 120;
  const display = document.querySelector('#zen-break-countdown');
  if (display) display.textContent = formatSeconds(zenBreak.remainingSeconds);
  saveState();
}

function tickZenBreak() {
  if (!zenBreak?.active) return;
  syncZenBreakCountdown();
  const display = document.querySelector('#zen-break-countdown');
  if (display) display.textContent = formatSeconds(zenBreak.remainingSeconds);
  if (zenBreak.remainingSeconds <= 0) {
    remainingSeconds = zenBreak.pausedRemainingSeconds;
    zenBreak = null;
    sounds.zenBreak();
    startTimer({ playStartSound: false });
    render();
  }
}

function maybeNotifyZenBreak() {
  if (zenBreak?.active) return false;
  const index = quickTask?.active ? 'quick' : state.activeIndex;
  const block = quickTask?.active ? quickTask : state.schedule[state.activeIndex];
  if (!block?.zenBreakMinutes || block.isBreak) return false;
  const durationSeconds = getBlockDurationSeconds(index);
  const elapsedSeconds = durationSeconds - remainingSeconds;
  const key = getZenBreakKey(index);
  if (zenBreakNotifiedKey === key) return false;
  if (elapsedSeconds < getZenBreakTriggerSecond(index, block, durationSeconds)) return false;
  zenBreakNotifiedKey = key;
  startZenBreak(block);
  return true;
}

function advanceBlock({ completed = false } = {}) {
  const shouldContinue = completed && state.autoStartNextTask;
  if (completed) sounds.complete();
  isRunning = false;
  isUserPaused = false;
  hasTimerStarted = false;
  timerStartedAt = null;
  clearInterval(timerId);
  if (quickTask?.active) {
    quickTask = null;
    remainingSeconds = getBlockDurationSeconds(state.activeIndex);
    configuredDurationSeconds = remainingSeconds;
    const resumeSchedule = shouldContinue && Boolean(state.schedule[state.activeIndex]);
    lastTick = Date.now();
    saveState();
    render();
    if (resumeSchedule) {
      sounds.start();
      startTimer({ playStartSound: false });
    }
    return;
  }
  if (state.schedule[state.activeIndex]) state.schedule[state.activeIndex].done = true;
  if (state.activeIndex < state.schedule.length - 1) {
    state.activeIndex += 1;
    remainingSeconds = getBlockDurationSeconds(state.activeIndex);
    configuredDurationSeconds = remainingSeconds;
  } else {
    isRunning = false;
    clearInterval(timerId);
    remainingSeconds = 0;
  }
  saveState();
  render();
  if (shouldContinue && remainingSeconds > 0) {
    sounds.start();
    startTimer({ playStartSound: false });
  }
}

function tick() {
  if (!isRunning) return;
  const now = Date.now();
  remainingSeconds -= (now - lastTick) / 1000;
  lastTick = now;
  if (remainingSeconds <= 0) advanceBlock({ completed: true });
  else {
    if (!maybeNotifyZenBreak()) updateTimerDisplay();
  }
}

function startTimer({ playStartSound = true } = {}) {
  if (!quickTask?.active && !state.schedule.length) return;
  if (isRunning) return;
  if (viewedBlockHasUnsavedChanges()) {
    timerBlockSaveMessage = 'Save your changes before starting the timer.';
    render();
    return;
  }
  if (quickTask?.active && !quickTask.title.trim()) {
    document.querySelector('#quick-title')?.focus();
    return;
  }
  const currentIndex = getSchedulePosition().currentIndex;
  const requestedIndex = quickTask?.active ? null : (viewedIndex ?? currentIndex);
  const requestedDuration = hasTimerStarted
    ? remainingSeconds
    : (quickTask?.active ? configuredDurationSeconds : getBlockDurationSeconds(requestedIndex));
  const startConflicts = quickTask?.active ? getStartConflicts(requestedDuration) : getStartConflicts(requestedDuration, requestedIndex);
  if (startConflicts.size) {
    conflictPreviousCalendarDate = calendarDate;
    conflictPreviousCalendarDraft = cloneSchedule(calendarDraft);
    conflictModalOpen = true;
    pendingStart = true;
    pendingStartIndex = requestedIndex;
    pendingStartDuration = requestedDuration;
    calendarDate = toDateKey(new Date());
    calendarDraft = cloneSchedule(state.schedule.filter((block) => !block.isBreak));
    conflictIndexes = new Set([...findScheduleConflicts(calendarDraft), ...startConflicts]);
    render();
    return;
  }
  runningIndex = requestedIndex;
  configuredDurationSeconds = requestedDuration;
  remainingSeconds = requestedDuration;
  isRunning = true;
  isUserPaused = false;
  hasTimerStarted = true;
  if (!timerStartedAt) timerStartedAt = Date.now();
  projectedEndTime = new Date(Date.now() + (remainingSeconds * 1000));
  document.querySelectorAll('#timer-display, #quick-title, .timer-duration-preset, #quick-task-button').forEach((control) => { control.disabled = true; });
  if (playStartSound) sounds.start();
  lastTick = Date.now();
  clearInterval(timerId);
  timerId = setInterval(tick, 250);
  updateTimerDisplay();
  saveState();
}

function stopTimer() {
  if (!isRunning) return;
  isRunning = false;
  isUserPaused = true;
  projectedEndTime = null;
  clearInterval(timerId);
  updateTimerDisplay();
  saveState();
}

function resetCurrentDuration() {
  configuredDurationSeconds = getBlockDurationSeconds(quickTask?.active ? 'quick' : state.activeIndex);
  remainingSeconds = configuredDurationSeconds;
}

function resetTimer() {
  isRunning = false;
  isUserPaused = false;
  clearInterval(timerId);
  zenBreak = null;
  zenBreakNotifiedKey = null;
  hasTimerStarted = false;
  timerStartedAt = null;
  projectedEndTime = null;
  configuredDurationSeconds = 0;
  remainingSeconds = 0;
  render();
  saveState();
}

function activateQuickTask() {
  isRunning = false;
  isUserPaused = false;
  clearInterval(timerId);
  zenBreak = null;
  hasTimerStarted = false;
  timerStartedAt = null;
  if (configuredDurationSeconds <= 0) configuredDurationSeconds = DEFAULT_BLOCK_MINUTES * 60;
  quickTask = { active: true, project: QUICK_START_PROJECT, title: '', duration: configuredDurationSeconds / 60, zenBreakMinutes: 0, zenBreakTiming: 'midpoint' };
  viewedIndex = null;
  viewedBlockDraft = null;
  timerBlockSaveMessage = '';
  runningIndex = null;
  remainingSeconds = configuredDurationSeconds;
  zenBreakNotifiedKey = null;
  render();
  saveState();
  document.querySelector('#quick-title')?.focus();
}

function cancelQuickTask() {
  if (!quickTask?.active) return;
  isRunning = false;
  isUserPaused = false;
  clearInterval(timerId);
  zenBreak = null;
  quickTask = null;
  runningIndex = null;
  hasTimerStarted = false;
  timerStartedAt = null;
  projectedEndTime = null;
  zenBreakNotifiedKey = null;
  syncTimerToClock();
  render();
  saveState();
}

function selectActiveBlock(index) {
  const nextIndex = Number(index);
  if (!Number.isInteger(nextIndex) || !state.schedule[nextIndex]) return;
  isRunning = false;
  isUserPaused = false;
  clearInterval(timerId);
  zenBreak = null;
  quickTask = null;
  runningIndex = null;
  viewedIndex = nextIndex;
  viewedBlockDraft = { ...state.schedule[nextIndex] };
  timerBlockSaveMessage = '';
  timerBlockConflictOpen = false;
  state.activeIndex = nextIndex;
  hasTimerStarted = false;
  timerStartedAt = null;
  zenBreakNotifiedKey = null;
  lastTick = Date.now();
  syncTimerToClock();
  render();
}


function handleProjectSelectChange(event) {
  const select = event.target;
  if (select.value === '__create_project__') {
    showInlineProjectCreator(select);
    return;
  }
  if (select.classList.contains('schedule-project')) todayDraft[select.dataset.index].project = select.value;
  if (select.classList.contains('calendar-project')) {
    calendarDraft[select.dataset.index].project = select.value;
    const defaultDuration = projectSettings(select.value).defaultDuration;
    if (defaultDuration !== null) calendarDraft[select.dataset.index].duration = defaultDuration;
    render();
    return;
  }
  if (select.id === 'quick-project') quickTaskDraft.project = select.value;
}

function showInlineProjectCreator(select) {
  if (select.parentElement.querySelector('.inline-project-name')) return;
  select.hidden = true;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'text-input inline-project-name';
  input.placeholder = 'New project name';
  input.setAttribute('aria-label', 'New project name');
  select.insertAdjacentElement('afterend', input);
  input.focus();
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const project = addProjectToMasterList(input.value);
    if (!project) return;
    if (select.classList.contains('schedule-project')) todayDraft[select.dataset.index].project = project;
    if (select.classList.contains('calendar-project')) calendarDraft[select.dataset.index].project = project;
    if (select.id === 'quick-project') quickTaskDraft.project = project;
    saveState();
    render();
  });
  input.addEventListener('blur', () => {
    if (!input.value.trim()) render();
  });
}

function loadCalendarDraft(dateKey = calendarDate) {
  calendarDraft = cloneSchedule(getScheduleForDate(dateKey).filter((block) => !block.isBreak));
}

function shiftCalendarDate(amount) {
  if (calendarView === 'day') calendarDate = addDays(calendarDate, amount);
  if (calendarView === 'week') calendarDate = addDays(calendarDate, amount * 7);
  if (calendarView === 'month') calendarDate = addMonths(calendarDate, amount);
  loadCalendarDraft();
  render();
}

function bindGlobalEvents() {
  window.removeEventListener('hashchange', handleRouteChange);
  window.addEventListener('hashchange', handleRouteChange);
  window.removeEventListener('keydown', handleEscapeKey);
  window.addEventListener('keydown', handleEscapeKey);
  document.querySelector('#logout-button')?.addEventListener('click', async () => {
    accountGeneration += 1;
    currentUser = null;
    stateRevision = 0;
    state = structuredClone(defaultState);
    todayDraft = [];
    calendarDraft = [];
    quickTask = null;
    zenBreak = null;
    isRunning = false;
    clearInterval(timerId);
    render();
    await fetch('/api/auth/logout', { method: 'POST' });
  });
}

function handleEscapeKey(event) {
  if (event.key !== 'Escape') return;
  if (timerBlockConflictOpen) { timerBlockConflictOpen = false; render(); }
  else if (conflictModalOpen) cancelConflictStart();
  else if (zenBreak?.active) cancelZenBreak();
  else if (quickTask?.active) cancelQuickTask();
  else document.querySelector('.zen-break-menu[open]')?.removeAttribute('open');
}

function syncTimerToClock() {
  state.schedule = cloneSchedule(getScheduleForDate(toDateKey(new Date())));
  // A paused timer is still an active session. Clock synchronization is only
  // for loading an unstarted scheduled block; it must never replace saved
  // countdown progress while the user is paused or navigating between pages.
  if (isRunning || hasTimerStarted || quickTask?.active) return;
  const { currentIndex } = getSchedulePosition();
  const relevantIndex = viewedIndex ?? currentIndex;
  if (relevantIndex === null) {
    configuredDurationSeconds = 0;
    remainingSeconds = 0;
    return;
  }
  remainingSeconds = getBlockDurationSeconds(relevantIndex);
  configuredDurationSeconds = remainingSeconds;
}

function handleRouteChange() {
  viewedIndex = null;
  viewedBlockDraft = null;
  timerBlockSaveMessage = '';
  timerBlockConflictOpen = false;
  const route = getRoute();
  if (route === 'scheduler') {
    schedulerRangeStart = getWeekStart(toDateKey(new Date()));
    schedulerRangeEnd = addDays(schedulerRangeStart, 6);
  }
  if (route === 'timer') syncTimerToClock();
  render();
}

function validateProjectSelections(selector) {
  const missingProject = [...document.querySelectorAll(selector)].find((select) => !select.value || select.value === '__create_project__');
  if (!missingProject) return true;
  scheduleSaveMessage = 'Choose a project for every block before saving.';
  const status = document.querySelector('#schedule-save-status');
  if (status) status.textContent = scheduleSaveMessage;
  missingProject.setCustomValidity('Choose a project for this block.');
  missingProject.reportValidity();
  missingProject.addEventListener('change', () => missingProject.setCustomValidity(''), { once: true });
  return false;
}

async function persistSchedule(button) {
  scheduleSaveMessage = 'Saving schedule…';
  button.disabled = true;
  button.textContent = 'Saving…';
  const saved = await saveState();
  scheduleSaveMessage = saved ? 'Schedule saved.' : 'Schedule could not be saved. Your changes remain on this page; please try again.';
  return saved;
}

function markTimerBlockUnsaved() {
  timerBlockSaveMessage = 'Unsaved changes';
  const status = document.querySelector('#timer-block-save-status');
  if (status) status.textContent = timerBlockSaveMessage;
}

function viewedBlockHasUnsavedChanges() {
  if (viewedIndex === null || !viewedBlockDraft || !state.schedule[viewedIndex]) return false;
  return JSON.stringify(normalizeBlock(viewedBlockDraft)) !== JSON.stringify(normalizeBlock(state.schedule[viewedIndex]));
}

async function saveSelectedBlock() {
  if (viewedIndex === null || !viewedBlockDraft || !state.schedule[viewedIndex]) return;
  const savedBlock = normalizeBlock(viewedBlockDraft);
  const candidateSchedule = cloneSchedule(state.schedule);
  candidateSchedule[viewedIndex] = savedBlock;
  const conflicts = findScheduleConflicts(candidateSchedule);
  if (conflicts.has(viewedIndex)) {
    timerBlockConflictOpen = true;
    timerBlockSaveMessage = 'Not saved because this project overlaps another project.';
    render();
    return;
  }
  state.schedule = candidateSchedule;
  setScheduleForDate(toDateKey(new Date()), state.schedule);
  const savedIndex = state.schedule.findIndex((block) => block.time === savedBlock.time && block.project === savedBlock.project && block.title === savedBlock.title);
  viewedIndex = savedIndex < 0 ? viewedIndex : savedIndex;
  state.activeIndex = viewedIndex;
  viewedBlockDraft = { ...savedBlock };
  timerBlockConflictOpen = false;
  configuredDurationSeconds = savedBlock.duration * 60;
  remainingSeconds = configuredDurationSeconds;
  const saved = await saveState();
  timerBlockSaveMessage = saved ? '✓ Changes saved' : 'Could not save. Please try again.';
  render();
}

function bindEvents() {
  bindGlobalEvents();
  const saveNote = (key, value) => {
    state.notes[key] = value;
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(saveState, 300);
  };
  document.querySelector('#parking-lot-notes')?.addEventListener('input', (event) => saveNote('parkingLot', event.target.value));
  document.querySelector('#general-notes')?.addEventListener('input', (event) => saveNote('general', event.target.value));
  document.querySelector('#start-button')?.addEventListener('click', startTimer);
  document.querySelector('#stop-button')?.addEventListener('click', stopTimer);
  document.querySelector('#reset-button')?.addEventListener('click', resetTimer);
  document.querySelector('#skip-button')?.addEventListener('click', advanceBlock);
  document.querySelector('#auto-start-next-task')?.addEventListener('change', (event) => {
    state.autoStartNextTask = event.target.checked;
    saveState();
  });
  document.querySelector('#zen-break-enabled')?.addEventListener('change', (event) => {
    const block = getActiveBlock();
    if (!block || block.isBreak) return;
    const oldKey = getZenBreakKey(quickTask?.active ? 'quick' : state.activeIndex);
    block.zenBreakMinutes = event.target.checked ? Number(document.querySelector('#timer-zen-break-duration')?.value || 5) : 0;
    zenBreakTriggers.delete(oldKey);
    zenBreakNotifiedKey = null;
    if (viewedIndex !== null) {
      markTimerBlockUnsaved();
      render();
      return;
    }
    saveState();
    render();
  });
  document.querySelector('#timer-zen-break-duration')?.addEventListener('change', (event) => {
    const block = getActiveBlock();
    if (!block || block.isBreak) return;
    const oldKey = getZenBreakKey(quickTask?.active ? 'quick' : state.activeIndex);
    block.zenBreakMinutes = Number(event.target.value);
    zenBreakTriggers.delete(oldKey);
    zenBreakNotifiedKey = null;
    document.querySelector('#zen-break-enabled').checked = true;
    if (viewedIndex !== null) { markTimerBlockUnsaved(); return; }
    saveState();
  });
  document.querySelector('#timer-zen-break-timing')?.addEventListener('change', (event) => {
    const block = getActiveBlock();
    if (!block || block.isBreak) return;
    const oldKey = getZenBreakKey(quickTask?.active ? 'quick' : state.activeIndex);
    block.zenBreakTiming = event.target.value;
    zenBreakTriggers.delete(oldKey);
    zenBreakNotifiedKey = null;
    if (viewedIndex !== null) { markTimerBlockUnsaved(); return; }
    saveState();
  });
  document.querySelector('#end-zen-break')?.addEventListener('click', endZenBreakNow);
  document.querySelector('#extend-zen-break')?.addEventListener('click', extendZenBreak);
  document.querySelector('#close-zen-break')?.addEventListener('click', cancelZenBreak);
  document.querySelector('#close-zen-break-options')?.addEventListener('click', () => document.querySelector('.zen-break-menu')?.removeAttribute('open'));
  document.querySelector('#close-conflict')?.addEventListener('click', cancelConflictStart);
  const closeTimerBlockConflict = () => {
    timerBlockConflictOpen = false;
    render();
  };
  document.querySelector('#close-timer-block-conflict')?.addEventListener('click', closeTimerBlockConflict);
  document.querySelector('#acknowledge-timer-block-conflict')?.addEventListener('click', closeTimerBlockConflict);
  document.querySelector('#quick-task-button')?.addEventListener('click', activateQuickTask);
  document.querySelector('#close-quick-task')?.addEventListener('click', cancelQuickTask);
  document.querySelector('#quick-title')?.addEventListener('input', (event) => { quickTask.title = event.target.value; clearTimeout(noteSaveTimer); noteSaveTimer = setTimeout(saveState, 300); });
  const updateConflictTime = (index) => {
    const hour = Number(document.querySelector(`.conflict-hour[data-index="${index}"]`)?.value || 12);
    const minute = Number(document.querySelector(`.conflict-minute[data-index="${index}"]`)?.value || 0);
    const period = document.querySelector(`.conflict-period[data-index="${index}"]`)?.dataset.period || 'AM';
    calendarDraft[index].time = `${String((hour % 12) + (period === 'PM' ? 12 : 0)).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    conflictIndexes = findScheduleConflicts(calendarDraft);
    render();
  };
  document.querySelectorAll('.conflict-hour, .conflict-minute').forEach((input) => input.addEventListener('change', (event) => updateConflictTime(Number(event.target.dataset.index))));
  document.querySelectorAll('.conflict-period').forEach((button) => button.addEventListener('click', (event) => {
    event.currentTarget.dataset.period = event.currentTarget.dataset.period === 'AM' ? 'PM' : 'AM';
    updateConflictTime(Number(event.currentTarget.dataset.index));
  }));
  document.querySelectorAll('.conflict-duration').forEach((input) => input.addEventListener('change', (event) => {
    calendarDraft[Number(event.target.dataset.index)].duration = Number(event.target.value);
    conflictIndexes = findScheduleConflicts(calendarDraft);
    render();
  }));
  document.querySelectorAll('.conflict-delete-block').forEach((button) => button.addEventListener('click', (event) => {
    calendarDraft.splice(Number(event.currentTarget.dataset.index), 1);
    conflictIndexes = findScheduleConflicts(calendarDraft);
    render();
  }));
  document.querySelector('#conflict-save')?.addEventListener('click', async () => {
    conflictIndexes = findScheduleConflicts(calendarDraft);
    if (!conflictIndexes.size && pendingStart) {
      const start = currentLocalMinutes();
      const end = start + (pendingStartDuration / 60);
      calendarDraft.forEach((block, index) => {
        const blockStart = timeToMinutes(block.time);
        const blockEnd = blockStart + Number(block.duration);
        if (index !== pendingStartIndex && start < blockEnd && end > blockStart) conflictIndexes.add(index);
      });
    }
    if (conflictIndexes.size) { render(); return; }
    setScheduleForDate(toDateKey(new Date()), buildSavedSchedule(calendarDraft));
    await saveState();
    conflictModalOpen = false;
    conflictPreviousCalendarDate = null;
    conflictPreviousCalendarDraft = null;
    const shouldStart = pendingStart;
    pendingStart = false;
    viewedIndex = pendingStartIndex;
    pendingStartIndex = null;
    syncTimerToClock();
    render();
    if (shouldStart) startTimer();
  });
  document.querySelector('#selected-block-project')?.addEventListener('change', (event) => { viewedBlockDraft.project = event.target.value; markTimerBlockUnsaved(); });
  document.querySelector('#selected-block-title')?.addEventListener('input', (event) => { viewedBlockDraft.title = event.target.value; markTimerBlockUnsaved(); });
  document.querySelector('#selected-block-time')?.addEventListener('change', (event) => { viewedBlockDraft.time = event.target.value; markTimerBlockUnsaved(); });
  document.querySelector('#selected-block-duration')?.addEventListener('change', (event) => {
    viewedBlockDraft.duration = Number(event.target.value);
    configuredDurationSeconds = viewedBlockDraft.duration * 60;
    remainingSeconds = configuredDurationSeconds;
    markTimerBlockUnsaved();
    updateTimerDisplay();
  });
  document.querySelector('#selected-block-zen-duration')?.addEventListener('change', (event) => { viewedBlockDraft.zenBreakMinutes = Number(event.target.value); markTimerBlockUnsaved(); });
  document.querySelector('#selected-block-zen-timing')?.addEventListener('change', (event) => { viewedBlockDraft.zenBreakTiming = event.target.value; markTimerBlockUnsaved(); });
  document.querySelector('#selected-block-done')?.addEventListener('change', (event) => { viewedBlockDraft.done = event.target.checked; markTimerBlockUnsaved(); });
  document.querySelector('#save-selected-block')?.addEventListener('click', saveSelectedBlock);
  document.querySelector('#timer-display')?.addEventListener('change', (event) => {
    const match = event.target.value.trim().match(/^(\d+):([0-5]\d):([0-5]\d)$/);
    if (!match) { event.target.value = formatSeconds(remainingSeconds); return; }
    configuredDurationSeconds = (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
    remainingSeconds = configuredDurationSeconds;
    if (quickTask?.active) quickTask.duration = configuredDurationSeconds / 60;
    if (viewedBlockDraft) {
      viewedBlockDraft.duration = configuredDurationSeconds / 60;
      markTimerBlockUnsaved();
    }
    if (quickTask?.active) saveState();
    updateTimerDisplay();
  });
  document.querySelectorAll('.timer-duration-preset').forEach((button) => button.addEventListener('click', (event) => {
    configuredDurationSeconds = Number(event.currentTarget.dataset.minutes) * 60;
    remainingSeconds = configuredDurationSeconds;
    if (quickTask?.active) quickTask.duration = configuredDurationSeconds / 60;
    if (quickTask?.active) saveState();
    render();
  }));
  document.querySelector('#add-project')?.addEventListener('click', () => {
    let name = 'New Project';
    let suffix = 2;
    while (state.projects.includes(name)) name = `New Project ${suffix++}`;
    state.projects.push(name);
    state.projectSettings[name] = { priority: 3, defaultDuration: null };
    saveState();
    render();
    const input = document.querySelector(`.project-name[data-index="${state.projects.length - 1}"]`);
    input?.focus();
    input?.select();
  });
  document.querySelectorAll('.project-name').forEach((input) => {
    input.addEventListener('input', (event) => {
      const index = Number(event.target.dataset.index);
      const previousName = state.projects[index];
      const nextName = event.target.value;
      state.projects[index] = nextName;
      state.projectSettings[nextName] = state.projectSettings[previousName] || { priority: 3, defaultDuration: null };
      if (previousName !== nextName) delete state.projectSettings[previousName];
      state.schedule.forEach((block) => { if (block.project === previousName) block.project = nextName; });
      Object.values(state.schedules || {}).forEach((schedule) => schedule.forEach((block) => { if (block.project === previousName) block.project = nextName; }));
      todayDraft.forEach((block) => { if (block.project === previousName) block.project = nextName; });
      calendarDraft.forEach((block) => { if (block.project === previousName) block.project = nextName; });
      clearTimeout(projectSaveTimer);
      projectSaveTimer = setTimeout(saveState, 250);
    });
    input.addEventListener('blur', (event) => {
      if (!event.target.value.trim()) {
        event.target.value = 'Untitled Project';
        state.projects[Number(event.target.dataset.index)] = event.target.value;
      }
      clearTimeout(projectSaveTimer);
      saveState();
    });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') event.target.blur(); });
  });
  document.querySelectorAll('.project-priority').forEach((input) => input.addEventListener('change', (event) => {
    const project = state.projects[Number(event.target.dataset.index)];
    state.projectSettings[project] = { ...projectSettings(project), priority: Number(event.target.value) };
    saveState();
  }));
  document.querySelectorAll('.project-duration').forEach((input) => input.addEventListener('change', (event) => {
    const project = state.projects[Number(event.target.dataset.index)];
    state.projectSettings[project] = { ...projectSettings(project), defaultDuration: Number(event.target.value) };
    saveState();
  }));
  document.querySelectorAll('.delete-project').forEach((button) => button.addEventListener('click', (event) => {
    const index = Number(event.currentTarget.dataset.index);
    delete state.projectSettings[state.projects[index]];
    state.projects.splice(index, 1);
    saveState();
    render();
  }));
  if (document.querySelector('#scheduler')) {
    const saveDay = (row) => {
      const day = row.dataset.day;
      const type = row.querySelector('.scheduler-type').value;
      state.schedulerSettings.days[day] = { enabled: type !== 'off', type, start: row.querySelector('.scheduler-start').value, end: row.querySelector('.scheduler-end').value, blocks: Number(row.querySelector('.scheduler-blocks').value), breakEnabled: row.querySelector('.scheduler-break-enabled').checked, breakStart: row.querySelector('.scheduler-break-start').value, breakEnd: row.querySelector('.scheduler-break-end').value };
      saveState();
    };
    document.querySelectorAll('.scheduler-day').forEach((row) => row.querySelectorAll('input, select').forEach((input) => input.addEventListener('change', (event) => { saveDay(row); if (event.target.classList.contains('scheduler-break-enabled')) render(); })));
    document.querySelector('#add-blackout')?.addEventListener('click', () => { state.schedulerSettings.blackouts.push({ date: toDateKey(new Date()), start: '16:00', end: '19:00', name: '', recurring: false, days: [] }); saveState(); render(); });
    document.querySelectorAll('.blackout-row input, .blackout-row select').forEach((input) => input.addEventListener('change', (event) => { const item = state.schedulerSettings.blackouts[Number(event.target.dataset.index)]; const key = event.target.className.match(/blackout-(date|start|end|name|recurring)/)?.[1]; if (key === 'recurring') { item.recurring = event.target.value === 'daily'; item.days = item.recurring ? [...weekDays] : []; render(); } else if (key) item[key] = event.target.value; saveState(); }));
    document.querySelectorAll('.delete-blackout').forEach((button) => button.addEventListener('click', (event) => { state.schedulerSettings.blackouts.splice(Number(event.currentTarget.dataset.index), 1); saveState(); render(); }));
    document.querySelectorAll('[data-date-picker]').forEach((button) => button.addEventListener('click', () => {
      const input = document.querySelector(`#${button.dataset.datePicker}`);
      if (!input) return;
      input.focus();
      if (typeof input.showPicker === 'function') input.showPicker();
    }));
    const updateSchedulerRangeSummary = () => {
      const start = document.querySelector('#scheduler-week')?.value;
      const end = document.querySelector('#scheduler-week-end')?.value;
      const summary = document.querySelector('#scheduler-range-summary');
      if (summary && start && end) summary.textContent = `This schedule covers ${formatDateLabel(start, { month: 'long', day: 'numeric', year: 'numeric' })} through ${formatDateLabel(end, { month: 'long', day: 'numeric', year: 'numeric' })}.`;
    };
    document.querySelector('#scheduler-week')?.addEventListener('change', (event) => {
      schedulerRangeStart = event.target.value || getWeekStart(toDateKey(new Date()));
      schedulerRangeEnd = addDays(schedulerRangeStart, 6);
      const endInput = document.querySelector('#scheduler-week-end');
      if (endInput) endInput.value = schedulerRangeEnd;
      updateSchedulerRangeSummary();
    });
    document.querySelector('#scheduler-week-end')?.addEventListener('change', (event) => {
      schedulerRangeEnd = event.target.value || addDays(schedulerRangeStart, 6);
      updateSchedulerRangeSummary();
    });
    document.querySelector('#generate-schedule')?.addEventListener('click', async (event) => {
      const weekStart = document.querySelector('#scheduler-week').value;
      const weekEnd = document.querySelector('#scheduler-week-end').value;
      if (!weekStart || !weekEnd) {
        document.querySelector('#scheduler-status').textContent = 'Choose both a start date and an end date.';
        return;
      }
      if (weekEnd < weekStart) {
        document.querySelector('#scheduler-status').textContent = 'The end date must be the same as or later than the start date.';
        return;
      }
      schedulerRangeStart = weekStart;
      schedulerRangeEnd = weekEnd;
      if (!state.projects.length) { document.querySelector('#scheduler-status').textContent = 'Add at least one project first.'; return; }
      const rangeDates = [];
      for (let date = weekStart; date <= weekEnd; date = addDays(date, 1)) rangeDates.push(date);
      const existingDates = rangeDates.map((date) => ({ date, blocks: getScheduleForDate(date) })).filter((item) => item.blocks.length);
      if (existingDates.length) {
        const existingTotal = existingDates.reduce((sum, item) => sum + item.blocks.length, 0);
        const confirmed = window.confirm(`You are overriding an existing schedule. ${existingTotal} scheduled block${existingTotal === 1 ? '' : 's'} already exist${existingTotal === 1 ? 's' : ''} between ${formatDateLabel(weekStart, { month: 'long', day: 'numeric' })} and ${formatDateLabel(weekEnd, { month: 'long', day: 'numeric', year: 'numeric' })}. Replace them with a newly generated schedule?`);
        if (!confirmed) {
          const status = document.querySelector('#scheduler-status');
          if (status) status.textContent = 'Your existing schedule was kept. Nothing was changed.';
          return;
        }
      }
      const previousSchedules = Object.fromEntries(rangeDates.map((date) => [date, cloneSchedule(getScheduleForDate(date))]));
      const seed = `${Date.now()}-${Math.random()}`;
      let result;
      try {
        result = generateSchedule({ weekStart, rangeEnd: weekEnd, dayRules: state.schedulerSettings.days, blackouts: state.schedulerSettings.blackouts, projects: state.projects.map((name) => ({ name, priority: projectSettings(name).priority, duration: projectSettings(name).defaultDuration || DEFAULT_BLOCK_MINUTES })), seed });
      } catch (error) {
        const status = document.querySelector('#scheduler-status');
        if (status) status.textContent = error instanceof Error ? error.message : 'The schedule could not be generated safely. Please review your hours and try again.';
        return;
      }
      rangeDates.forEach((date) => setScheduleForDate(date, []));
      Object.entries(result.schedules).forEach(([date, blocks]) => setScheduleForDate(date, blocks));
      state.schedulerSettings.lastSeed = result.seed;
      const saved = await persistSchedule(event.currentTarget);
      const total = Object.values(result.schedules).reduce((sum, blocks) => sum + blocks.length, 0);
      if (!saved) {
        rangeDates.forEach((date) => setScheduleForDate(date, previousSchedules[date]));
        render();
        const status = document.querySelector('#scheduler-status');
        if (status) status.textContent = 'Your schedule was created on this page but could not be saved. Please try again.';
        return;
      }
      scheduleGenerationMessage = `Your schedule is ready: ${total} blocks created for ${formatDateLabel(weekStart, { month: 'long', day: 'numeric' })} through ${formatDateLabel(weekEnd, { month: 'long', day: 'numeric', year: 'numeric' })}.`;
      calendarDate = weekStart;
      calendarView = 'week';
      window.location.hash = 'calendar';
    });
    return;
  }
  if (document.querySelector('#calendar')) {
    document.querySelectorAll('[data-calendar-view]').forEach((button) => button.addEventListener('click', (event) => { calendarView = event.currentTarget.dataset.calendarView; render(); }));
    document.querySelector('#calendar-date')?.addEventListener('change', (event) => { calendarDate = event.target.value || toDateKey(new Date()); loadCalendarDraft(); render(); });
    document.querySelector('#calendar-prev')?.addEventListener('click', () => shiftCalendarDate(-1));
    document.querySelector('#calendar-next')?.addEventListener('click', () => shiftCalendarDate(1));
    document.querySelectorAll('.month-day').forEach((button) => button.addEventListener('click', (event) => { calendarDate = event.currentTarget.dataset.calendarDate; calendarView = 'day'; loadCalendarDraft(); render(); }));
    document.querySelector('#calendar-add-block')?.addEventListener('click', () => { const time = calendarDraft.length ? getNextStartTime(calendarDraft[calendarDraft.length - 1]) : '09:00'; calendarDraft.push(createDraftBlock(time)); render(); });
    document.querySelector('#calendar-save')?.addEventListener('click', async (event) => {
      if (!validateProjectSelections('.calendar-project')) return;
      const conflicts = findScheduleConflicts(calendarDraft);
      if (conflicts.size) {
        conflictIndexes = conflicts;
        scheduleSaveMessage = 'Resolve every highlighted overlap before saving.';
        render();
        return;
      }
      setScheduleForDate(calendarDate, buildSavedSchedule(calendarDraft)); state.activeIndex = clampActiveIndex(state.activeIndex); resetCurrentDuration();
      const saved = await persistSchedule(event.currentTarget);
      if (saved) loadCalendarDraft();
      render();
    });
    document.querySelectorAll('.calendar-project').forEach((input) => input.addEventListener('change', handleProjectSelectChange));
    document.querySelectorAll('.calendar-title').forEach((input) => input.addEventListener('input', (event) => { calendarDraft[event.target.dataset.index].title = event.target.value; }));
    const updateCalendarEndTime = (index) => {
      const endTime = document.querySelector(`[data-calendar-end-time="${index}"]`);
      if (endTime) endTime.textContent = formatTime(getNextStartTime(calendarDraft[index]));
    };
    document.querySelectorAll('.calendar-duration').forEach((input) => input.addEventListener('change', (event) => {
      const index = Number(event.target.dataset.index);
      calendarDraft[index].duration = Number(event.target.value);
      updateCalendarEndTime(index);
    }));
    document.querySelectorAll('.calendar-delete-block').forEach((button) => button.addEventListener('click', (event) => { calendarDraft.splice(Number(event.currentTarget.dataset.index), 1); render(); }));
    const updateCalendarTime = (index) => {
      const hour = Number(document.querySelector(`.calendar-hour[data-index="${index}"]`)?.value || 12);
      const minute = Number(document.querySelector(`.calendar-minute[data-index="${index}"]`)?.value || 0);
      const period = document.querySelector(`.calendar-period[data-index="${index}"]`)?.dataset.period || 'AM';
      calendarDraft[index].time = `${String((hour % 12) + (period === 'PM' ? 12 : 0)).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      updateCalendarEndTime(index);
    };
    document.querySelectorAll('.calendar-hour, .calendar-minute').forEach((input) => input.addEventListener('change', (event) => updateCalendarTime(Number(event.target.dataset.index))));
    document.querySelectorAll('.calendar-period').forEach((button) => button.addEventListener('click', (event) => {
      const periodButton = event.currentTarget;
      periodButton.dataset.period = periodButton.dataset.period === 'AM' ? 'PM' : 'AM';
      periodButton.textContent = periodButton.dataset.period;
      periodButton.setAttribute('aria-label', `Start time ${periodButton.dataset.period}; click to switch`);
      updateCalendarTime(Number(periodButton.dataset.index));
    }));
    return;
  }
  if (document.querySelector('#save-today')) {
    document.querySelector('#add-block')?.addEventListener('click', () => {
      const time = todayDraft.length ? getNextStartTime(todayDraft[todayDraft.length - 1]) : '09:00';
      todayDraft.push(createDraftBlock(time));
      render();
      document.querySelector(`.schedule-project[data-index="${todayDraft.length - 1}"]`)?.focus();
    });
    document.querySelector('#save-today')?.addEventListener('click', async (event) => {
      if (!validateProjectSelections('.schedule-project')) return;
      if (findScheduleConflicts(todayDraft).size) {
        scheduleSaveMessage = 'Resolve every schedule overlap before saving.';
        return render();
      }
      state.schedule = buildSavedSchedule(todayDraft);
      setScheduleForDate(toDateKey(new Date()), state.schedule);
      state.activeIndex = clampActiveIndex(state.activeIndex);
      resetCurrentDuration();
      await persistSchedule(event.currentTarget);
      render();
    });
    document.querySelectorAll('.time-hour, .time-minutes, .time-period').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.target.dataset.index); const row = event.target.closest('.planning-block'); const hour = row.querySelector('.time-hour').value; const minutes = row.querySelector('.time-minutes').value; const period = row.querySelector('.time-period').value; todayDraft[index].time = timePartsToTime(hour, minutes, period); applyNextStartTimes(index); render(); }));
    document.querySelectorAll('.schedule-title').forEach((input) => input.addEventListener('input', (event) => { todayDraft[event.target.dataset.index].title = event.target.value; }));
    document.querySelectorAll('.schedule-project').forEach((input) => input.addEventListener('change', handleProjectSelectChange));
    document.querySelectorAll('.duration-preset').forEach((button) => button.addEventListener('click', (event) => { const index = Number(event.currentTarget.dataset.index); todayDraft[index].duration = Number(event.currentTarget.dataset.minutes); applyNextStartTimes(index); render(); }));
    document.querySelectorAll('.zen-break-select').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.target.dataset.index); todayDraft[index].zenBreakMinutes = Number(event.target.value); if (!todayDraft[index].zenBreakTiming) todayDraft[index].zenBreakTiming = 'midpoint'; render(); }));
    document.querySelectorAll('.draft-zen-timing').forEach((input) => input.addEventListener('change', (event) => { todayDraft[event.target.dataset.index].zenBreakTiming = event.target.value; }));
    document.querySelectorAll('.move-block').forEach((button) => button.addEventListener('click', (event) => { const index = Number(event.currentTarget.dataset.index); const offset = event.currentTarget.dataset.direction === 'up' ? -1 : 1; const nextIndex = index + offset; if (!todayDraft[index] || !todayDraft[nextIndex]) return; const [block] = todayDraft.splice(index, 1); todayDraft.splice(nextIndex, 0, block); applyNextStartTimes(Math.min(index, nextIndex)); render(); }));
    document.querySelectorAll('.delete-block').forEach((button) => button.addEventListener('click', (event) => { const index = Number(event.currentTarget.dataset.index); todayDraft.splice(index, 1); applyNextStartTimes(Math.max(0, index - 1)); render(); }));
    return;
  }
  document.querySelectorAll('.time-block').forEach((block) => {
    block.addEventListener('click', (event) => {
      if (event.target.closest('.delete-block, .schedule-done')) return;
      selectActiveBlock(block.dataset.index);
    });
    block.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectActiveBlock(block.dataset.index);
      }
    });
  });
  document.querySelectorAll('[data-select-block]').forEach((card) => {
    card.addEventListener('click', () => selectActiveBlock(card.dataset.selectBlock));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectActiveBlock(card.dataset.selectBlock);
      }
    });
  });
  document.querySelectorAll('.schedule-done').forEach((input) => input.addEventListener('change', (event) => {
    const index = Number(event.target.dataset.index);
    const checked = event.target.checked;
    if (viewedIndex !== index) selectActiveBlock(index);
    if (!viewedBlockDraft) return;
    viewedBlockDraft.done = checked;
    markTimerBlockUnsaved();
    render();
  }));
  document.querySelectorAll('.zen-timing-select').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.target.dataset.index); state.schedule[index].zenBreakTiming = event.target.value; zenBreakTriggers.delete(getZenBreakKey(index)); zenBreakNotifiedKey = null; saveState(); render(); }));
  document.querySelectorAll('.time-input').forEach((input) => input.addEventListener('change', (event) => { state.schedule[event.target.dataset.index].time = event.target.value; resetCurrentDuration(); render(); }));
  document.querySelectorAll('.move-block').forEach((button) => button.addEventListener('click', (event) => { const index = Number(event.currentTarget.dataset.index); const offset = event.currentTarget.dataset.direction === 'up' ? -1 : 1; const nextIndex = index + offset; if (!state.schedule[index] || !state.schedule[nextIndex]) return; const [block] = state.schedule.splice(index, 1); state.schedule.splice(nextIndex, 0, block); state.activeIndex = nextIndex; resetCurrentDuration(); render(); }));
  document.querySelectorAll('.delete-block').forEach((button) => button.addEventListener('click', (event) => { state.schedule.splice(event.currentTarget.dataset.index, 1); state.activeIndex = clampActiveIndex(state.activeIndex); resetCurrentDuration(); render(); }));
}

async function initializeApp() {
  try {
    const sessionResponse = await fetch('/api/auth/session', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (sessionResponse.status !== 404) {
      authEnabled = true;
      const session = await sessionResponse.json();
      registrationEnabled = session.registrationEnabled === true;
      if (sessionResponse.ok) currentUser = session.user;
      if (!currentUser) return;
    }
    state = await loadState();
    todayDraft = cloneSchedule(state.schedule.filter((block) => !block.isBreak));
    calendarDraft = cloneSchedule(getScheduleForDate(calendarDate).filter((block) => !block.isBreak));
    restoreTimerState();
    syncTimerToClock();
    clearInterval(authorityTimerId);
    authorityTimerId = setInterval(() => {
      if (getRoute() !== 'timer' || isRunning || quickTask?.active) return;
      const wasShowingUpcoming = Boolean(document.querySelector('[data-upcoming-card]'));
      const before = getSchedulePosition().currentIndex;
      syncTimerToClock();
      const after = getSchedulePosition().currentIndex;
      if (before !== after || wasShowingUpcoming !== (after === null)) render();
      else updateTimerDisplay();
    }, 1000);
  } catch (error) {
    console.error('Project Timer startup failed while loading saved state.', error);
    if (authEnabled) currentUser = null;
    state = structuredClone(defaultState);
    todayDraft = [];
    remainingSeconds = DEFAULT_BLOCK_MINUTES * 60;
  } finally {
    render();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
} else {
  initializeApp();
}
