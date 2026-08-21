import { sounds } from './audio.js';
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
  schedule: [],
  schedules: {},
  activeIndex: 0,
  autoStartNextTask: false,
};

const icon = { clock: '◷', edit: '✎', trash: '⌫', plus: '+', check: '✓', next: '›' };
const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
let state = structuredClone(defaultState);
let todayDraft = [];
let calendarView = 'day';
let calendarDate = toDateKey(new Date());
let calendarDraft = [];
let isRunning = false;
let isUserPaused = false;
let remainingSeconds = DEFAULT_BLOCK_MINUTES * 60;
let configuredDurationSeconds = remainingSeconds;
let hasTimerStarted = false;
let lastTick = Date.now();
let timerId;
let zenBreakNotifiedKey = null;
let quickTask = null;
let zenBreak = null;
const zenBreakTriggers = new Map();
let pendingSave = Promise.resolve();
let projectSaveTimer;
let scheduleSaveMessage = '';
let viewedIndex = null;
let runningIndex = null;
let conflictModalOpen = false;
let pendingStart = false;
let pendingStartIndex = null;
let pendingStartDuration = 0;
let conflictIndexes = new Set();
let conflictPreviousCalendarDate = null;
let conflictPreviousCalendarDraft = null;
let authorityTimerId;


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
      schedules,
      schedule: cloneSchedule(schedules[todayKey] || []),
      activeIndex: Number.isInteger(saved.activeIndex) ? saved.activeIndex : 0,
      autoStartNextTask: saved.autoStartNextTask === true,
    };
  } catch {
    return structuredClone(defaultState);
  }
}

async function loadState() {
  try {
    const response = await fetch('/api/state', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const serverState = await response.json();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serverState));
    return sanitizeState(serverState);
  } catch (error) {
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
  return { projects, schedules, schedule: cloneSchedule(schedules[todayKey] || []), activeIndex: Number.isInteger(saved.activeIndex) ? saved.activeIndex : 0, autoStartNextTask: saved.autoStartNextTask === true };
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
  const snapshot = structuredClone(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  pendingSave = pendingSave.catch(() => {}).then(async () => {
    const response = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
      keepalive: true,
    });
    if (!response.ok) throw new Error(`Server rejected state with status ${response.status}`);
    return true;
  }).catch((error) => {
    console.error('Could not save state to the server.', error);
    return false;
  });
  return pendingSave;
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

function getStartConflicts(durationSeconds) {
  const start = currentLocalMinutes();
  const end = start + (Math.max(0, durationSeconds) / 60);
  return new Set(state.schedule.map((block, index) => ({ index, start: timeToMinutes(block.time), end: timeToMinutes(block.time) + (Number(block.duration) || DEFAULT_BLOCK_MINUTES) })).filter((block) => start < block.end && end > block.start).map((block) => block.index));
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

function activeBlockCard(current) {
  if (!current) return projectCard('Active Block', 'Nothing scheduled right now', 'The timer is waiting for the next block', true);
  const scheduledTimes = current.time ? `<div><dt>Start Time</dt><dd>${escapeHtml(formatTime(current.time))}</dd></div><div><dt>End Time</dt><dd>${escapeHtml(formatTime(getNextStartTime(current)))}</dd></div>` : '';
  return `<article class="project-card active-card active-block-card"><p class="eyebrow">Active Block</p><h3 data-card-title>${escapeHtml(current.project || QUICK_START_PROJECT)}</h3><p data-card-meta>${escapeHtml(current.title || 'Untitled task')}</p><dl class="active-block-details"><div><dt>Duration</dt><dd>${escapeHtml(formatMinutes(current.duration || DEFAULT_BLOCK_MINUTES))}</dd></div>${scheduledTimes}</dl></article>`;
}

function viewedBlockCard(block) {
  if (!block) return '';
  return `<article class="project-card viewed-block-card"><p class="eyebrow">This Block</p><h3>${escapeHtml(block.project || 'Task')}</h3><p>${escapeHtml(block.title || 'Untitled task')}</p><dl class="active-block-details"><div><dt>Starts</dt><dd>${escapeHtml(formatTime(block.time))}</dd></div><div><dt>Ends</dt><dd>${escapeHtml(formatTime(getNextStartTime(block)))}</dd></div><div><dt>Duration</dt><dd>${escapeHtml(formatMinutes(block.duration))}</dd></div></dl></article>`;
}

function getTimerStatus(current) {
  if (!current) return state.schedule.length ? 'Nothing scheduled right now' : 'Add a schedule block to start timing';
  const paused = isUserPaused ? 'PAUSED · ' : '';
  const name = `${current.project}${current.title ? ` · ${current.title}` : ''}`;
  const endTime = quickTask?.active ? '' : ` · ENDS AT ${formatTime(getNextStartTime(current))}`;
  return `${paused}${name}${endTime}`;
}

function primaryNavigation(className = '') {
  return `<nav class="top-nav ${className}" aria-label="Primary navigation">${['Today', 'Timer', 'Projects', 'Calendar', 'Notes'].map((item) => { const route = item.toLowerCase().replaceAll(' ', '-'); return `<a href="#${route}" ${getRoute() === route ? 'aria-current="page"' : ''}>${item}</a>`; }).join('')}</nav>`;
}

function header() {
  return `<header class="app-header ${getRoute() === 'timer' ? 'timer-header' : ''}"><div><p class="eyebrow">Personal workspace</p><h1>Project Timer</h1></div><div class="header-meta" aria-label="Current date and time"><span>${icon.clock}</span><span>${formatDate()}</span></div>${getRoute() === 'timer' ? '' : primaryNavigation()}</header>`;
}

function getActiveBlock() {
  if (quickTask?.active) return quickTask;
  if (runningIndex !== null) return state.schedule[runningIndex];
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
  const previousIndex = quickTask?.active ? null : position.previousIndex;
  const previous = previousIndex === null ? null : state.schedule[previousIndex];
  const nextIndex = position.nextIndex;
  const next = nextIndex === null ? null : state.schedule[nextIndex];
  const inspected = viewedIndex === null ? null : state.schedule[viewedIndex];
  const canStart = Boolean(quickTask?.active || inspected || current);
  const quickTaskControls = quickTask?.active ? `${quickTaskNameField()}<fieldset class="preset-group timer-presets"><legend>Duration</legend>${DURATION_PRESETS.map((minutes) => `<button type="button" class="preset-button timer-duration-preset ${configuredDurationSeconds === minutes * 60 ? 'active-preset' : ''}" data-minutes="${minutes}" ${hasTimerStarted ? 'disabled' : ''}>${formatMinutes(minutes)}</button>`).join('')}</fieldset>` : '';
  const autoStartControl = `<label class="auto-start-control"><span>Auto-Start</span><input id="auto-start-next-task" type="checkbox" role="switch" aria-label="Auto-Start Next Task" ${state.autoStartNextTask ? 'checked' : ''} /></label>`;
  const timerActions = `<div class="actions timer-actions"><button id="start-button" class="primary" ${canStart ? '' : 'disabled'}>Start</button><button id="stop-button">Pause</button><button id="reset-button" ${canStart ? '' : 'disabled'} aria-label="Clear timer to zero">Reset</button><button id="skip-button">Skip</button>${autoStartControl}${zenBreakControl(inspected || current)}</div>`;
  const quickTaskButton = quickTask?.active ? '' : `<button id="quick-task-button" class="quick-task-button" ${hasTimerStarted ? 'disabled' : ''}>${icon.plus} Quick Task</button>`;
  return `${section({ id: 'timer', title: 'Timer', eyebrow: 'Execution only', className: 'hero-panel', content: `<div class="timer-control-area"><div class="timer-shell" data-inactive="${current ? 'false' : 'true'}" aria-label="Countdown timer"><input id="timer-display" value="${formatSeconds(remainingSeconds)}" aria-label="Timer duration in hours, minutes, and seconds" inputmode="numeric" pattern="[0-9]+:[0-5][0-9]:[0-5][0-9]" ${hasTimerStarted ? 'disabled' : ''} /><p id="timer-status">${escapeHtml(getTimerStatus(current))}</p></div>${quickTaskControls}${timerActions}${quickTaskButton}</div>${primaryNavigation('timer-nav')}<div class="block-navigation"><div class="dashboard-grid">${projectCard('Previous Block', previous ? `← ${previous.project}` : 'Start of schedule', previous?.title || 'No previous block', false, previous ? previousIndex : null)}${activeBlockCard(current)}${projectCard('Next Block', next ? `${next.project} →` : 'End of schedule', next?.title || 'No next block', false, next ? nextIndex : null)}</div>${viewedBlockCard(inspected)}</div>` })}${timerSchedule()}${conflictModal()}${zenBreakOverlay()}`;
}

function timerSchedule() {
  const currentIndex = getSchedulePosition().currentIndex;
  const blocks = state.schedule.map((block, index) => `<div class="time-block timer-block ${block.isBreak ? 'break-block' : ''} ${!quickTask?.active && index === currentIndex ? 'active-task' : ''} ${index === viewedIndex ? 'viewed-task' : ''}" data-index="${index}" role="button" tabindex="0" aria-label="View ${escapeHtml(block.title || block.project)}"><input class="schedule-done" data-index="${index}" type="checkbox" ${block.done ? 'checked' : ''} aria-label="Mark ${escapeHtml(block.title || block.project)} complete" /><span class="time">${escapeHtml(formatTime(block.time))}</span><span class="task-copy"><strong>${escapeHtml(block.project || 'Task')}</strong><small>${escapeHtml([block.title || 'Task', block.zenBreakMinutes ? `Zen Break: ${formatMinutes(block.zenBreakMinutes)}` : ''].filter(Boolean).join(' · '))}</small></span></div>`).join('') || '<p class="empty-state">No saved schedule yet. Plan today on the Today page.</p>';
  return section({ id: 'timer-schedule', title: 'Today’s Saved Schedule', eyebrow: 'Read-only plan', content: `<div class="schedule-list">${blocks}</div>` });
}

function conflictModal() {
  if (!conflictModalOpen) return '';
  const rows = calendarDraft.map((block, index) => `<article class="calendar-block-card ${conflictIndexes.has(index) ? 'conflict-block' : ''}" data-index="${index}">${conflictIndexes.has(index) ? '<strong class="conflict-label">CONFLICT</strong>' : ''}<div class="calendar-card-fields"><label>Project<select class="text-input" disabled>${projectOptions(block.project)}</select></label><label>Task<input class="text-input" value="${escapeHtml(block.title)}" disabled /></label><fieldset><legend>Start Time</legend>${calendarTimeSelector(block, index).replaceAll('calendar-hour', 'conflict-hour').replaceAll('calendar-minute', 'conflict-minute').replaceAll('calendar-period', 'conflict-period')}</fieldset><div class="calendar-timing-summary"><label>Block Length<select class="text-input conflict-duration" data-index="${index}">${CALENDAR_DURATION_OPTIONS.map((minutes) => `<option value="${minutes}" ${Number(block.duration) === minutes ? 'selected' : ''}>${formatMinutes(minutes)}</option>`).join('')}</select></label><div class="calendar-ends-at"><span>Ends At</span><strong>${escapeHtml(formatTime(getNextStartTime(block)))}</strong></div></div></div></article>`).join('');
  return `<div class="conflict-overlay" role="dialog" aria-modal="true" aria-labelledby="conflict-title"><section class="conflict-dialog"><button id="close-conflict" class="escape-close" type="button" aria-label="Cancel start and close schedule conflict" aria-keyshortcuts="Escape" title="Cancel and close">×</button><p class="eyebrow">Schedule Conflict</p><h2 id="conflict-title">This block conflicts with another scheduled block.</h2><p>Please readjust your schedule before continuing.</p><div class="conflict-schedule">${rows}</div><button id="conflict-save" class="primary">Save Schedule</button><p id="conflict-status" class="helper-text" role="status">${conflictIndexes.size ? 'Resolve every highlighted overlap.' : '✓ No conflicts'}</p></section></div>`;
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
  if (!state.projects.includes(project)) state.projects.push(project);
  return project;
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
  return section({ id: 'projects', title: 'Master Project List', eyebrow: 'Backlog', content: `<div class="project-list">${state.projects.map((project, index) => `<div class="project-row"><input class="text-input project-name" data-index="${index}" value="${escapeHtml(project)}" aria-label="Project name" /><div class="row-actions"><button class="delete-project" data-index="${index}" aria-label="Delete ${escapeHtml(project)}">${icon.trash} Delete</button></div></div>`).join('') || '<p class="empty-state">No projects yet.</p>'}</div><button id="add-project" class="add-button"><span>${icon.plus}</span> Add Project</button>` });
}

function calendarTaskSummary(block) {
  return `<button type="button" class="calendar-task" data-calendar-task-time="${escapeHtml(block.time)}"><span class="time">${escapeHtml(formatTime(block.time))}</span><strong>${escapeHtml(block.project || 'Task')}</strong>${block.title ? `<small>${escapeHtml(block.title)}</small>` : ''}</button>`;
}

function dayView(dateKey) {
  return `<div class="day-view calendar-full-view"><div class="calendar-view-heading"><h3>${escapeHtml(formatDateLabel(dateKey))}</h3><div class="actions"><button id="calendar-prev">Previous Day</button><button id="calendar-next">Next Day</button></div></div>${calendarPlanner()}</div>`;
}

function weekView(dateKey) {
  const weekStart = getWeekStart(dateKey);
  const columns = weekDays.map((day, index) => {
    const columnDate = addDays(weekStart, index);
    const blocks = getScheduleForDate(columnDate).map(calendarTaskSummary).join('') || '<p class="empty-state">No tasks</p>';
    return `<div><strong>${day}</strong><small>${escapeHtml(formatDateLabel(columnDate, { month: 'short', day: 'numeric' }))}</small>${blocks}</div>`;
  }).join('');
  return `<div class="calendar-full-view"><div class="calendar-view-heading"><h3>Week of ${escapeHtml(formatDateLabel(weekStart, { month: 'long', day: 'numeric', year: 'numeric' }))}</h3><div class="actions"><button id="calendar-prev">Previous Week</button><button id="calendar-next">Next Week</button></div></div><div class="week-view">${columns}</div></div>`;
}

function monthView(dateKey) {
  const date = parseDateKey(dateKey);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const gridStart = getWeekStart(toDateKey(first));
  const currentMonth = date.getMonth();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const cellDate = addDays(gridStart, index);
    const parsed = parseDateKey(cellDate);
    const classes = [cellDate === toDateKey(new Date()) ? 'today-dot' : '', parsed.getMonth() !== currentMonth ? 'outside-month' : ''].filter(Boolean).join(' ');
    const blocks = getScheduleForDate(cellDate).map((block) => `<span class="month-task"><strong>${escapeHtml(block.project || 'Task')}</strong>${block.title ? ` <small>${escapeHtml(block.title)}</small>` : ''}</span>`).join('');
    return `<button type="button" class="month-day ${classes}" data-calendar-date="${cellDate}"><strong>${parsed.getDate()}</strong>${blocks || '<small class="empty-month-day">No tasks</small>'}</button>`;
  }).join('');
  return `<div class="calendar-full-view"><div class="calendar-view-heading"><h3>${escapeHtml(formatDateLabel(dateKey, { month: 'long', year: 'numeric' }))}</h3><div class="actions"><button id="calendar-prev">Previous Month</button><button id="calendar-next">Next Month</button></div></div><div class="month-view">${cells}</div></div>`;
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
  return section({ id: 'calendar', title: 'Calendar', eyebrow: 'Planning', content: `<div class="calendar-controls"><label>Planning Date <input id="calendar-date" class="text-input" type="date" value="${calendarDate}" /></label></div><div class="calendar-tabs"><button class="${calendarView === 'day' ? 'active-tab' : ''}" data-calendar-view="day">Day</button><button class="${calendarView === 'week' ? 'active-tab' : ''}" data-calendar-view="week">Week</button><button class="${calendarView === 'month' ? 'active-tab' : ''}" data-calendar-view="month">Month</button></div><div class="calendar-layout single-calendar-view">${selectedView}</div>` });
}

function notesAndReview() {
  return `<div class="notes-grid">${section({ id: 'parking', title: 'Parking Lot', eyebrow: 'Quick capture', content: '<textarea aria-label="Parking lot notes"></textarea>' })}${section({ id: 'notes', title: 'Project Notes', eyebrow: 'Current project', content: '<textarea aria-label="Project notes"></textarea>' })}${section({ id: 'end-day', title: 'End of Day', eyebrow: 'Review', content: '<div class="review-card"><span>✓</span><div><h3>Accomplishments</h3><p>Summarize completed work and lessons learned.</p></div></div><div class="review-card"><span>›</span><div><h3>First Task for tomorrow</h3><p>Choose the next focused starting point.</p></div></div>' })}</div>`;
}

function getRoute() {
  const route = window.location.hash.replace('#', '').toLowerCase();
  return route || 'today';
}

function mainContent() {
  const route = getRoute();
  if (route === 'projects') return masterProjectList();
  if (route === 'timer') return timerPage();
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

function updateTimerDisplay() {
  const display = document.querySelector('#timer-display');
  const status = document.querySelector('#timer-status');
  const current = getActiveBlock();
  if (display) display.value = formatSeconds(remainingSeconds);
  if (status) status.textContent = getTimerStatus(current);
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
  clearInterval(timerId);
  if (quickTask?.active) {
    quickTask = null;
    remainingSeconds = getBlockDurationSeconds(state.activeIndex);
    configuredDurationSeconds = remainingSeconds;
    const resumeSchedule = shouldContinue && Boolean(state.schedule[state.activeIndex]);
    lastTick = Date.now();
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
  if (quickTask?.active && !quickTask.title.trim()) {
    document.querySelector('#quick-title')?.focus();
    return;
  }
  const currentIndex = getSchedulePosition().currentIndex;
  const requestedIndex = quickTask?.active ? null : (viewedIndex ?? currentIndex);
  const isCurrentScheduledBlock = !quickTask?.active && requestedIndex === currentIndex;
  const requestedDuration = isCurrentScheduledBlock ? remainingSeconds : (quickTask?.active ? configuredDurationSeconds : getBlockDurationSeconds(requestedIndex));
  const startConflicts = isCurrentScheduledBlock ? new Set() : getStartConflicts(requestedDuration);
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
  if (!quickTask?.active && viewedIndex !== null) {
    configuredDurationSeconds = getBlockDurationSeconds(viewedIndex);
    remainingSeconds = configuredDurationSeconds;
  }
  isRunning = true;
  isUserPaused = false;
  hasTimerStarted = true;
  document.querySelectorAll('#timer-display, #quick-title, .timer-duration-preset, #quick-task-button').forEach((control) => { control.disabled = true; });
  if (playStartSound) sounds.start();
  lastTick = Date.now();
  clearInterval(timerId);
  timerId = setInterval(tick, 250);
  updateTimerDisplay();
}

function stopTimer() {
  if (!isRunning) return;
  isRunning = false;
  isUserPaused = true;
  clearInterval(timerId);
  updateTimerDisplay();
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
  configuredDurationSeconds = 0;
  remainingSeconds = 0;
  render();
}

function activateQuickTask() {
  isRunning = false;
  isUserPaused = false;
  clearInterval(timerId);
  zenBreak = null;
  hasTimerStarted = false;
  if (configuredDurationSeconds <= 0) configuredDurationSeconds = DEFAULT_BLOCK_MINUTES * 60;
  quickTask = { active: true, project: QUICK_START_PROJECT, title: '', duration: configuredDurationSeconds / 60, zenBreakMinutes: 0, zenBreakTiming: 'midpoint' };
  viewedIndex = null;
  runningIndex = null;
  remainingSeconds = configuredDurationSeconds;
  zenBreakNotifiedKey = null;
  render();
  document.querySelector('#quick-title')?.focus();
}

function selectActiveBlock(index) {
  const nextIndex = Number(index);
  if (!Number.isInteger(nextIndex) || !state.schedule[nextIndex]) return;
  isRunning = false;
  isUserPaused = false;
  clearInterval(timerId);
  zenBreak = null;
  quickTask = null;
  viewedIndex = nextIndex;
  state.activeIndex = nextIndex;
  syncTimerToClock();
  hasTimerStarted = false;
  zenBreakNotifiedKey = null;
  lastTick = Date.now();
  render();
}


function handleProjectSelectChange(event) {
  const select = event.target;
  if (select.value === '__create_project__') {
    showInlineProjectCreator(select);
    return;
  }
  if (select.classList.contains('schedule-project')) todayDraft[select.dataset.index].project = select.value;
  if (select.classList.contains('calendar-project')) calendarDraft[select.dataset.index].project = select.value;
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
}

function handleEscapeKey(event) {
  if (event.key !== 'Escape') return;
  if (conflictModalOpen) cancelConflictStart();
  else if (zenBreak?.active) cancelZenBreak();
  else document.querySelector('.zen-break-menu[open]')?.removeAttribute('open');
}

function syncTimerToClock() {
  state.schedule = cloneSchedule(getScheduleForDate(toDateKey(new Date())));
  if (isRunning || quickTask?.active) return;
  const { currentIndex } = getSchedulePosition();
  if (currentIndex === null) {
    configuredDurationSeconds = 0;
    remainingSeconds = 0;
    return;
  }
  const block = state.schedule[currentIndex];
  const endMinutes = timeToMinutes(block.time) + (Number(block.duration) || DEFAULT_BLOCK_MINUTES);
  remainingSeconds = Math.max(0, (endMinutes - currentLocalMinutes()) * 60);
  configuredDurationSeconds = remainingSeconds;
}

function handleRouteChange() {
  viewedIndex = null;
  if (getRoute() === 'timer') syncTimerToClock();
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

function bindEvents() {
  bindGlobalEvents();
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
    if (!quickTask?.active) saveState();
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
    if (!quickTask?.active) saveState();
  });
  document.querySelector('#timer-zen-break-timing')?.addEventListener('change', (event) => {
    const block = getActiveBlock();
    if (!block || block.isBreak) return;
    const oldKey = getZenBreakKey(quickTask?.active ? 'quick' : state.activeIndex);
    block.zenBreakTiming = event.target.value;
    zenBreakTriggers.delete(oldKey);
    zenBreakNotifiedKey = null;
    if (!quickTask?.active) saveState();
  });
  document.querySelector('#end-zen-break')?.addEventListener('click', endZenBreakNow);
  document.querySelector('#extend-zen-break')?.addEventListener('click', extendZenBreak);
  document.querySelector('#close-zen-break')?.addEventListener('click', cancelZenBreak);
  document.querySelector('#close-zen-break-options')?.addEventListener('click', () => document.querySelector('.zen-break-menu')?.removeAttribute('open'));
  document.querySelector('#close-conflict')?.addEventListener('click', cancelConflictStart);
  document.querySelector('#quick-task-button')?.addEventListener('click', activateQuickTask);
  document.querySelector('#quick-title')?.addEventListener('input', (event) => { quickTask.title = event.target.value; });
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
  document.querySelector('#conflict-save')?.addEventListener('click', async () => {
    conflictIndexes = findScheduleConflicts(calendarDraft);
    if (!conflictIndexes.size && pendingStart) {
      const start = currentLocalMinutes();
      const end = start + (pendingStartDuration / 60);
      calendarDraft.forEach((block, index) => {
        const blockStart = timeToMinutes(block.time);
        const blockEnd = blockStart + Number(block.duration);
        if (start < blockEnd && end > blockStart) conflictIndexes.add(index);
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
  document.querySelector('#timer-display')?.addEventListener('change', (event) => {
    const match = event.target.value.trim().match(/^(\d+):([0-5]\d):([0-5]\d)$/);
    if (!match) { event.target.value = formatSeconds(remainingSeconds); return; }
    configuredDurationSeconds = (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
    remainingSeconds = configuredDurationSeconds;
    if (quickTask?.active) quickTask.duration = configuredDurationSeconds / 60;
    updateTimerDisplay();
  });
  document.querySelectorAll('.timer-duration-preset').forEach((button) => button.addEventListener('click', (event) => {
    configuredDurationSeconds = Number(event.currentTarget.dataset.minutes) * 60;
    remainingSeconds = configuredDurationSeconds;
    if (quickTask?.active) quickTask.duration = configuredDurationSeconds / 60;
    render();
  }));
  document.querySelector('#add-project')?.addEventListener('click', () => {
    let name = 'New Project';
    let suffix = 2;
    while (state.projects.includes(name)) name = `New Project ${suffix++}`;
    state.projects.push(name);
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
  document.querySelectorAll('.delete-project').forEach((button) => button.addEventListener('click', (event) => { state.projects.splice(event.currentTarget.dataset.index, 1); saveState(); render(); }));
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
      if (event.target.closest('.delete-block')) return;
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
  document.querySelectorAll('.schedule-done').forEach((input) => input.addEventListener('change', (event) => { state.schedule[event.target.dataset.index].done = event.target.checked; saveState(); render(); }));
  document.querySelectorAll('.zen-timing-select').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.target.dataset.index); state.schedule[index].zenBreakTiming = event.target.value; zenBreakTriggers.delete(getZenBreakKey(index)); zenBreakNotifiedKey = null; saveState(); render(); }));
  document.querySelectorAll('.time-input').forEach((input) => input.addEventListener('change', (event) => { state.schedule[event.target.dataset.index].time = event.target.value; resetCurrentDuration(); render(); }));
  document.querySelectorAll('.move-block').forEach((button) => button.addEventListener('click', (event) => { const index = Number(event.currentTarget.dataset.index); const offset = event.currentTarget.dataset.direction === 'up' ? -1 : 1; const nextIndex = index + offset; if (!state.schedule[index] || !state.schedule[nextIndex]) return; const [block] = state.schedule.splice(index, 1); state.schedule.splice(nextIndex, 0, block); state.activeIndex = nextIndex; resetCurrentDuration(); render(); }));
  document.querySelectorAll('.delete-block').forEach((button) => button.addEventListener('click', (event) => { state.schedule.splice(event.currentTarget.dataset.index, 1); state.activeIndex = clampActiveIndex(state.activeIndex); resetCurrentDuration(); render(); }));
}

async function initializeApp() {
  try {
    state = await loadState();
    todayDraft = cloneSchedule(state.schedule.filter((block) => !block.isBreak));
    calendarDraft = cloneSchedule(getScheduleForDate(calendarDate).filter((block) => !block.isBreak));
    syncTimerToClock();
    clearInterval(authorityTimerId);
    authorityTimerId = setInterval(() => {
      if (getRoute() !== 'timer' || isRunning || quickTask?.active) return;
      const before = getSchedulePosition().currentIndex;
      syncTimerToClock();
      const after = getSchedulePosition().currentIndex;
      if (before !== after) render();
      else updateTimerDisplay();
    }, 1000);
  } catch (error) {
    console.error('Project Timer startup failed while loading saved state.', error);
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
