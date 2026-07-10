const STORAGE_KEY = 'project-timer-state-v1';
const DEFAULT_BLOCK_MINUTES = 30;
const DURATION_PRESETS = [15, 30, 45, 60, 120, 180, 240];
const ZEN_BREAK_PRESETS = [0, 2, 5, 10, 15];

const DEMO_PROJECTS = new Set(['Project Timer', 'Writing system', 'Portfolio refresh', 'Health tracker', 'Home admin', 'Morning setup', 'Daily review']);
const DEMO_TITLES = new Set(['Plan daily priorities', 'Use Project Timer', 'Review content backlog', 'Focused project block', 'Wrap-up and tomorrow setup']);

const defaultState = {
  projects: [],
  schedule: [],
  schedules: {},
  activeIndex: 0,
};

const icon = { clock: '◷', edit: '✎', trash: '⌫', plus: '+', check: '✓', next: '›' };
const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
let state = structuredClone(defaultState);
let todayDraft = [];
let calendarView = 'day';
let calendarDate = toDateKey(new Date());
let calendarDraft = [];
let isRunning = false;
let remainingSeconds = DEFAULT_BLOCK_MINUTES * 60;
let lastTick = Date.now();
let timerId;
let zenBreakNotifiedKey = null;
let quickTask = null;
let isQuickTaskFormOpen = false;
let quickTaskDraft = { project: '', title: '', duration: 15, zenBreakMinutes: 0, zenBreakTiming: 'midpoint' };
let zenBreak = null;
const zenBreakTriggers = new Map();


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

function loadState() {
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
    };
  } catch {
    return structuredClone(defaultState);
  }
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function minutesToTime(totalMinutes) {
  const minutesInDay = 24 * 60;
  const safeMinutes = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatMinutes(minutes) {
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

function projectCard(label, title, meta, active = false) {
  return `<article class="project-card ${active ? 'active-card' : ''}"><p class="eyebrow">${label}</p><h3 data-card-title>${escapeHtml(title)}</h3><p data-card-meta>${escapeHtml(meta)}</p></article>`;
}

function header() {
  return `<header class="app-header"><div><p class="eyebrow">Personal workspace</p><h1>Project Timer</h1></div><div class="header-meta" aria-label="Current date and time"><span>${icon.clock}</span><span>${formatDate()}</span></div><nav class="top-nav" aria-label="Primary navigation">${['Today', 'Timer', 'Projects', 'Calendar', 'Notes'].map((item) => `<a href="#${item.toLowerCase()}" ${getRoute() === item.toLowerCase() ? 'aria-current="page"' : ''}>${item}</a>`).join('')}</nav></header>`;
}

function getActiveBlock() {
  return quickTask?.active ? quickTask : state.schedule[state.activeIndex];
}

function getActiveLabel() {
  return quickTask?.active ? 'Quick Task' : 'Active Block';
}

function quickTaskForm() {
  if (!isQuickTaskFormOpen) return '';
  return `<form id="quick-task-form" class="quick-task-form"><div class="planning-fields"><label>Project <select class="text-input project-select" id="quick-project" required>${projectOptions(quickTaskDraft.project)}</select></label><label>Task <input class="text-input" id="quick-title" value="${escapeHtml(quickTaskDraft.title)}" placeholder="Optional task description" /></label></div><fieldset class="preset-group quick-duration-group"><legend>Duration</legend>${DURATION_PRESETS.map((minutes) => `<button type="button" class="preset-button quick-duration-preset ${quickTaskDraft.duration === minutes ? 'active-preset' : ''}" data-minutes="${minutes}">${formatMinutes(minutes)}</button>`).join('')}</fieldset><input type="hidden" id="quick-duration" value="${quickTaskDraft.duration}" /><div class="planning-controls"><label>Zen Break <select class="text-input" id="quick-zen-break" aria-label="Zen Break during quick task">${ZEN_BREAK_PRESETS.map((minutes) => `<option value="${minutes}" ${quickTaskDraft.zenBreakMinutes === minutes ? 'selected' : ''}>${minutes ? formatMinutes(minutes) : 'None'}</option>`).join('')}</select></label>${quickTaskDraft.zenBreakMinutes ? zenBreakTimingControl({ value: quickTaskDraft.zenBreakTiming, className: 'quick-zen-timing', id: 'quick-zen-break-timing' }) : ''}</div><div class="actions quick-form-actions"><button type="submit" class="primary">Start Now</button><button type="button" id="cancel-quick-task">Cancel</button></div></form>`;
}

function timerPage() {
  const current = getActiveBlock();
  const next = quickTask?.active ? state.schedule[state.activeIndex] : state.schedule[state.activeIndex + 1];
  const canStart = quickTask?.active || state.schedule.length;
  return `${section({ id: 'timer', title: 'Timer', eyebrow: 'Execution only', className: 'hero-panel', content: `<div class="dashboard-grid">${projectCard(getActiveLabel(), current?.project || 'No block selected', current?.title || (current?.isBreak ? 'Pause before the next project' : 'Save today’s schedule to begin'), true)}${projectCard('Next Block', next?.project || 'End of schedule', next?.title || 'No next block')}</div><div class="timer-shell" aria-label="Countdown timer"><span id="timer-display">${formatSeconds(remainingSeconds)}</span><p id="timer-status">${current ? `${isRunning ? 'Running' : 'Paused'} · ${escapeHtml(current.project)}${current.title ? ` · ${escapeHtml(current.title)}` : ''}` : 'No saved blocks for today'}</p></div><div class="actions"><button id="start-button" class="primary" ${canStart ? '' : 'disabled'}>Start</button><button id="stop-button">Stop</button><button id="skip-button">Skip</button></div><div class="quick-task-panel"><button id="quick-task-button" class="primary quick-task-button">${icon.plus} Quick Task</button>${quickTaskForm()}</div>` })}${timerSchedule()}${zenBreakOverlay()}`;
}

function timerSchedule() {
  const blocks = state.schedule.map((block, index) => `<div class="time-block timer-block ${block.isBreak ? 'break-block' : ''} ${!quickTask?.active && index === state.activeIndex ? 'active-task' : ''}" data-index="${index}" role="button" tabindex="0" aria-label="Make ${escapeHtml(block.title || block.project)} active"><input class="schedule-done" data-index="${index}" type="checkbox" ${block.done ? 'checked' : ''} aria-label="Mark ${escapeHtml(block.title || block.project)} complete" /><span class="time">${escapeHtml(formatTime(block.time))}</span><span class="task-copy"><strong>${escapeHtml(block.project || 'Task')}</strong><small>${escapeHtml([block.title || 'Task', block.zenBreakMinutes ? `Zen Break: ${formatMinutes(block.zenBreakMinutes)}` : ''].filter(Boolean).join(' · '))}</small>${block.zenBreakMinutes && !block.isBreak ? `<label class="zen-timing-control">Zen Break Timing <select class="text-input zen-timing-select" data-index="${index}" aria-label="Zen Break Timing"><option value="midpoint" ${block.zenBreakTiming === 'midpoint' ? 'selected' : ''}>Midpoint</option><option value="random" ${block.zenBreakTiming === 'random' ? 'selected' : ''}>Random</option></select></label>` : ''}</span></div>`).join('') || '<p class="empty-state">No saved schedule yet. Plan today on the Today page.</p>';
  return section({ id: 'timer-schedule', title: 'Today’s Saved Schedule', eyebrow: 'Read-only plan', content: `<div class="schedule-list">${blocks}</div>` });
}

function zenBreakOverlay() {
  if (!zenBreak?.active) return '';
  return `<div class="zen-break-overlay" role="dialog" aria-modal="true" aria-label="Zen Break"><div><p class="eyebrow">Zen Break</p><h2>Pause and reset</h2><span id="zen-break-countdown">${formatSeconds(zenBreak.remainingSeconds)}</span><div class="actions zen-break-actions"><button id="end-zen-break" type="button">End Break Now</button><button id="extend-zen-break" type="button" class="primary">Extend 2 Minutes</button></div></div></div>`;
}

function projectOptions(selectedProject) {
  const createOption = '<option value="__create_project__">+ Create New Project...</option>';
  const placeholder = `<option value="" ${selectedProject ? '' : 'selected'} disabled>Select project</option>`;
  return createOption + placeholder + state.projects.map((project) => `<option value="${escapeHtml(project)}" ${project === selectedProject ? 'selected' : ''}>${escapeHtml(project)}</option>`).join('');
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

function todayPlanner() {
  const rows = todayDraft.map((block, index) => `<div class="time-block planning-block" data-index="${index}"><div class="planning-fields"><label>Project <select class="text-input schedule-project project-select" data-index="${index}" aria-label="Project" required>${projectOptions(block.project)}</select></label><label>Task <input class="text-input schedule-title" data-index="${index}" value="${escapeHtml(block.title)}" aria-label="Task" placeholder="Optional task description" /></label></div><div class="planning-controls"><label>Start Time ${timeSelector(block, index)}</label><fieldset class="preset-group"><legend>Duration</legend>${DURATION_PRESETS.map((minutes) => `<button type="button" class="preset-button duration-preset ${block.duration === minutes ? 'active-preset' : ''}" data-index="${index}" data-minutes="${minutes}">${formatMinutes(minutes)}</button>`).join('')}</fieldset><label>Zen Break <select class="text-input zen-break-select" data-index="${index}" aria-label="Zen Break during work block">${ZEN_BREAK_PRESETS.map((minutes) => `<option value="${minutes}" ${block.zenBreakMinutes === minutes ? 'selected' : ''}>${minutes ? formatMinutes(minutes) : 'None'}</option>`).join('')}</select></label>${block.zenBreakMinutes ? zenBreakTimingControl({ value: block.zenBreakTiming, className: 'draft-zen-timing', index }) : ''}</div><div class="row-actions"><button class="move-block" data-direction="up" data-index="${index}" aria-label="Move task earlier">↑</button><button class="move-block" data-direction="down" data-index="${index}" aria-label="Move task later">↓</button><button class="delete-block" data-index="${index}" aria-label="Delete task">${icon.trash} Delete</button></div></div>`).join('') || '<p class="empty-state">No blocks planned for today.</p>';
  return section({ id: 'today', title: 'Today’s Schedule', eyebrow: 'Planning', content: `<p class="helper-text">Build today’s schedule from your Master Project List with as little typing as possible: choose a project, add an optional task, then tap duration presets, and an optional Zen Break reminder.</p><div class="schedule-list">${rows}</div><button id="add-block" class="add-button"><span>${icon.plus}</span> Add Project Block</button><button id="save-today" class="primary save-button">Save Today’s Schedule</button>` });
}


function masterProjectList() {
  return section({ id: 'projects', title: 'Master Project List', eyebrow: 'Backlog', content: `<div class="project-list">${state.projects.map((project, index) => `<div class="project-row"><input class="text-input project-name" data-index="${index}" value="${escapeHtml(project)}" aria-label="Project name" /><div class="row-actions"><button class="delete-project" data-index="${index}" aria-label="Delete ${escapeHtml(project)}">${icon.trash} Delete</button></div></div>`).join('') || '<p class="empty-state">No projects yet.</p>'}</div><button id="add-project" class="add-button"><span>${icon.plus}</span> Add Project</button>` });
}

function calendarTaskSummary(block) {
  return `<button type="button" class="calendar-task" data-calendar-task-time="${escapeHtml(block.time)}"><span class="time">${escapeHtml(formatTime(block.time))}</span><strong>${escapeHtml(block.project || 'Task')}</strong>${block.title ? `<small>${escapeHtml(block.title)}</small>` : ''}</button>`;
}

function calendarDetail(block) {
  return `<div class="calendar-detail"><h3>${escapeHtml(block.project || 'Task')}</h3><p>${escapeHtml(block.title || 'No task name')}</p><dl><div><dt>Start time</dt><dd>${escapeHtml(formatTime(block.time))}</dd></div><div><dt>Duration</dt><dd>${escapeHtml(formatMinutes(block.duration))}</dd></div><div><dt>Status</dt><dd>${block.done ? 'Complete' : 'Not complete'}</dd></div>${block.zenBreakMinutes ? `<div><dt>Zen Break</dt><dd>${escapeHtml(formatMinutes(block.zenBreakMinutes))}</dd></div>` : ''}</dl></div>`;
}

function dayView(dateKey) {
  const blocks = getScheduleForDate(dateKey);
  const items = blocks.map((block) => `<article class="calendar-day-task" data-calendar-task-time="${escapeHtml(block.time)}" role="button" tabindex="0"><div><span class="time">${escapeHtml(formatTime(block.time))}</span><strong>${escapeHtml(block.project || 'Task')}</strong><small>${escapeHtml(block.title || 'No task name')}</small></div><span>${escapeHtml(formatMinutes(block.duration))}</span><span>${block.done ? 'Complete' : 'Not complete'}</span></article>`).join('') || '<p class="empty-state">No blocks scheduled.</p>';
  return `<div class="day-view calendar-full-view"><div class="calendar-view-heading"><h3>${escapeHtml(formatDateLabel(dateKey))}</h3><div class="actions"><button id="calendar-prev">Previous Day</button><button id="calendar-next">Next Day</button></div></div><div class="calendar-day-list">${items}</div><div id="calendar-task-detail"></div></div>`;
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

function calendarPlanner(dateKey) {
  const rows = calendarDraft.map((block, index) => `<div class="time-block planning-block" data-index="${index}"><div class="planning-fields"><label>Project <select class="text-input calendar-project project-select" data-index="${index}" required>${projectOptions(block.project)}</select></label><label>Task <input class="text-input calendar-title" data-index="${index}" value="${escapeHtml(block.title)}" placeholder="Optional task description" /></label></div><div class="planning-controls"><label>Start Time ${timeSelector(block, index)}</label><fieldset class="preset-group"><legend>Duration</legend>${DURATION_PRESETS.map((minutes) => `<button type="button" class="preset-button calendar-duration-preset ${block.duration === minutes ? 'active-preset' : ''}" data-index="${index}" data-minutes="${minutes}">${formatMinutes(minutes)}</button>`).join('')}</fieldset></div><div class="row-actions"><button class="calendar-delete-block" data-index="${index}">${icon.trash} Delete</button></div></div>`).join('') || '<p class="empty-state">No blocks planned for this date.</p>';
  return `<div class="calendar-planner"><h3>Plan ${escapeHtml(formatDateLabel(dateKey))}</h3><div class="schedule-list">${rows}</div><button id="calendar-add-block" class="add-button"><span>${icon.plus}</span> Add Project Block</button><button id="calendar-save" class="primary save-button">Save Schedule</button></div>`;
}

function calendarSection() {
  const selectedView = calendarView === 'week' ? weekView(calendarDate) : calendarView === 'month' ? monthView(calendarDate) : dayView(calendarDate);
  return section({ id: 'calendar', title: 'Calendar', eyebrow: 'Planning', content: `<div class="calendar-controls"><label>Planning Date <input id="calendar-date" class="text-input" type="date" value="${calendarDate}" /></label></div><div class="calendar-tabs"><button class="${calendarView === 'day' ? 'active-tab' : ''}" data-calendar-view="day">Day</button><button class="${calendarView === 'week' ? 'active-tab' : ''}" data-calendar-view="week">Week</button><button class="${calendarView === 'month' ? 'active-tab' : ''}" data-calendar-view="month">Month</button></div><div class="calendar-layout single-calendar-view">${selectedView}</div>${calendarPlanner(calendarDate)}` });
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
  if (display) display.textContent = formatSeconds(remainingSeconds);
  if (status) status.textContent = current ? `${isRunning ? 'Running' : 'Paused'} · ${current.project}${current.title ? ` · ${current.title}` : ''}` : 'Add a schedule block to start timing';
}

function playNotification() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
  gain.gain.setValueAtTime(0.001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.25, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.35);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.35);
  oscillator.addEventListener('ended', () => audioContext.close());
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
  isRunning = false;
  clearInterval(timerId);
  playNotification();
  zenBreak = {
    active: true,
    remainingSeconds: Math.max(Number(block.zenBreakMinutes), 1) * 60,
    pausedRemainingSeconds: remainingSeconds,
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
  startTimer();
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
    startTimer();
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

function advanceBlock() {
  if (quickTask?.active) {
    playNotification();
    const restoreSeconds = quickTask.pausedRemainingSeconds;
    quickTask = null;
    remainingSeconds = restoreSeconds;
    isRunning = Boolean(state.schedule[state.activeIndex]);
    lastTick = Date.now();
    render();
    if (isRunning) startTimer();
    return;
  }
  if (state.schedule[state.activeIndex]) state.schedule[state.activeIndex].done = true;
  playNotification();
  if (state.activeIndex < state.schedule.length - 1) {
    state.activeIndex += 1;
    remainingSeconds = getBlockDurationSeconds(state.activeIndex);
  } else {
    isRunning = false;
    clearInterval(timerId);
    remainingSeconds = 0;
  }
  saveState();
  render();
}

function tick() {
  if (!isRunning) return;
  const now = Date.now();
  remainingSeconds -= (now - lastTick) / 1000;
  lastTick = now;
  if (remainingSeconds <= 0) advanceBlock();
  else {
    if (!maybeNotifyZenBreak()) updateTimerDisplay();
  }
}

function startTimer() {
  if (!quickTask?.active && !state.schedule.length) return;
  isRunning = true;
  lastTick = Date.now();
  clearInterval(timerId);
  timerId = setInterval(tick, 250);
  updateTimerDisplay();
}

function stopTimer() {
  isRunning = false;
  clearInterval(timerId);
  updateTimerDisplay();
}

function resetCurrentDuration() {
  remainingSeconds = getBlockDurationSeconds(state.activeIndex);
}

function startQuickTask(event) {
  event.preventDefault();
  const project = document.querySelector('#quick-project')?.value;
  if (!project || project === '__create_project__') return;
  quickTaskDraft = {
    project,
    title: document.querySelector('#quick-title')?.value.trim() || '',
    duration: Number(document.querySelector('#quick-duration')?.value) || 15,
    zenBreakMinutes: Number(document.querySelector('#quick-zen-break')?.value) || 0,
    zenBreakTiming: document.querySelector('#quick-zen-break-timing')?.value || 'midpoint',
  };
  quickTask = {
    active: true,
    ...quickTaskDraft,
    pausedRemainingSeconds: remainingSeconds,
  };
  zenBreakNotifiedKey = null;
  isQuickTaskFormOpen = false;
  remainingSeconds = getBlockDurationSeconds('quick');
  startTimer();
  render();
}

function updateSelectedBlockUI() {
  const current = getActiveBlock();
  const next = quickTask?.active ? state.schedule[state.activeIndex] : state.schedule[state.activeIndex + 1];
  const cards = document.querySelectorAll('.project-card');
  const currentCard = cards[0];
  const nextCard = cards[1];

  if (currentCard) {
    currentCard.querySelector('[data-card-title]').textContent = current?.project || 'No block selected';
    currentCard.querySelector('[data-card-meta]').textContent = current?.title || 'Add a block to begin';
  }

  if (nextCard) {
    nextCard.querySelector('[data-card-title]').textContent = next?.project || 'End of schedule';
    nextCard.querySelector('[data-card-meta]').textContent = next?.title || 'No next block';
  }

  document.querySelectorAll('.time-block').forEach((block) => {
    block.classList.toggle('active-task', !quickTask?.active && Number(block.dataset.index) === state.activeIndex);
  });
  updateTimerDisplay();
}

function selectActiveBlock(index, shouldRender = true) {
  const nextIndex = Number(index);
  if (quickTask?.active || !Number.isInteger(nextIndex) || !state.schedule[nextIndex]) return;
  state.activeIndex = nextIndex;
  resetCurrentDuration();
  zenBreakNotifiedKey = null;
  lastTick = Date.now();
  saveState();
  if (shouldRender) render();
  else updateSelectedBlockUI();
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
  window.removeEventListener('hashchange', render);
  window.addEventListener('hashchange', render);
}

function bindEvents() {
  bindGlobalEvents();
  document.querySelector('#start-button')?.addEventListener('click', startTimer);
  document.querySelector('#stop-button')?.addEventListener('click', stopTimer);
  document.querySelector('#skip-button')?.addEventListener('click', advanceBlock);
  document.querySelector('#end-zen-break')?.addEventListener('click', endZenBreakNow);
  document.querySelector('#extend-zen-break')?.addEventListener('click', extendZenBreak);
  document.querySelector('#quick-task-button')?.addEventListener('click', () => { isQuickTaskFormOpen = true; render(); });
  document.querySelector('#cancel-quick-task')?.addEventListener('click', () => { isQuickTaskFormOpen = false; render(); });
  document.querySelector('#quick-task-form')?.addEventListener('submit', startQuickTask);
  document.querySelector('#quick-project')?.addEventListener('change', handleProjectSelectChange);
  document.querySelector('#quick-title')?.addEventListener('input', (event) => { quickTaskDraft.title = event.target.value; });
  document.querySelector('#quick-zen-break')?.addEventListener('change', (event) => { quickTaskDraft.zenBreakMinutes = Number(event.target.value); if (!quickTaskDraft.zenBreakTiming) quickTaskDraft.zenBreakTiming = 'midpoint'; render(); });
  document.querySelector('#quick-zen-break-timing')?.addEventListener('change', (event) => { quickTaskDraft.zenBreakTiming = event.target.value; });
  document.querySelectorAll('.quick-duration-preset').forEach((button) => button.addEventListener('click', (event) => {
    quickTaskDraft.duration = Number(event.currentTarget.dataset.minutes);
    document.querySelector('#quick-duration').value = event.currentTarget.dataset.minutes;
    document.querySelectorAll('.quick-duration-preset').forEach((preset) => preset.classList.toggle('active-preset', preset === event.currentTarget));
  }));
  document.querySelector('#add-project')?.addEventListener('click', () => { state.projects.push('New Project'); saveState(); render(); });
  document.querySelectorAll('.project-name').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.target.dataset.index); const previousName = state.projects[index]; const nextName = event.target.value.trim() || 'Untitled Project'; state.projects[index] = nextName; state.schedule.forEach((block) => { if (block.project === previousName) block.project = nextName; }); Object.values(state.schedules || {}).forEach((schedule) => schedule.forEach((block) => { if (block.project === previousName) block.project = nextName; })); todayDraft.forEach((block) => { if (block.project === previousName) block.project = nextName; }); calendarDraft.forEach((block) => { if (block.project === previousName) block.project = nextName; }); saveState(); render(); }));
  document.querySelectorAll('.delete-project').forEach((button) => button.addEventListener('click', (event) => { state.projects.splice(event.currentTarget.dataset.index, 1); saveState(); render(); }));
  if (document.querySelector('#calendar')) {
    document.querySelectorAll('[data-calendar-view]').forEach((button) => button.addEventListener('click', (event) => { calendarView = event.currentTarget.dataset.calendarView; render(); }));
    document.querySelector('#calendar-date')?.addEventListener('change', (event) => { calendarDate = event.target.value || toDateKey(new Date()); loadCalendarDraft(); render(); });
    document.querySelector('#calendar-prev')?.addEventListener('click', () => shiftCalendarDate(-1));
    document.querySelector('#calendar-next')?.addEventListener('click', () => shiftCalendarDate(1));
    document.querySelectorAll('.month-day').forEach((button) => button.addEventListener('click', (event) => { calendarDate = event.currentTarget.dataset.calendarDate; calendarView = 'day'; loadCalendarDraft(); render(); }));
    document.querySelectorAll('.calendar-day-task').forEach((item) => {
      const showDetail = () => {
        const block = getScheduleForDate(calendarDate).find((candidate) => candidate.time === item.dataset.calendarTaskTime);
        const detail = document.querySelector('#calendar-task-detail');
        if (block && detail) detail.innerHTML = calendarDetail(block);
      };
      item.addEventListener('click', showDetail);
      item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showDetail(); } });
    });
    document.querySelector('#calendar-add-block')?.addEventListener('click', () => { const time = calendarDraft.length ? getNextStartTime(calendarDraft[calendarDraft.length - 1]) : '09:00'; calendarDraft.push(createDraftBlock(time)); render(); });
    document.querySelector('#calendar-save')?.addEventListener('click', () => { setScheduleForDate(calendarDate, buildSavedSchedule(calendarDraft)); state.activeIndex = clampActiveIndex(state.activeIndex); resetCurrentDuration(); saveState(); loadCalendarDraft(); render(); });
    document.querySelectorAll('.calendar-project').forEach((input) => input.addEventListener('change', handleProjectSelectChange));
    document.querySelectorAll('.calendar-title').forEach((input) => input.addEventListener('input', (event) => { calendarDraft[event.target.dataset.index].title = event.target.value; }));
    document.querySelectorAll('.calendar-duration-preset').forEach((button) => button.addEventListener('click', (event) => { const index = Number(event.currentTarget.dataset.index); calendarDraft[index].duration = Number(event.currentTarget.dataset.minutes); for (let i = index + 1; i < calendarDraft.length; i += 1) calendarDraft[i].time = getNextStartTime(calendarDraft[i - 1]); render(); }));
    document.querySelectorAll('.calendar-delete-block').forEach((button) => button.addEventListener('click', (event) => { calendarDraft.splice(Number(event.currentTarget.dataset.index), 1); render(); }));
    document.querySelectorAll('.time-hour, .time-minutes, .time-period').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.target.dataset.index); const row = event.target.closest('.planning-block'); calendarDraft[index].time = timePartsToTime(row.querySelector('.time-hour').value, row.querySelector('.time-minutes').value, row.querySelector('.time-period').value); for (let i = index + 1; i < calendarDraft.length; i += 1) calendarDraft[i].time = getNextStartTime(calendarDraft[i - 1]); render(); }));
    return;
  }
  if (document.querySelector('#save-today')) {
    document.querySelector('#add-block')?.addEventListener('click', () => {
      const time = todayDraft.length ? getNextStartTime(todayDraft[todayDraft.length - 1]) : '09:00';
      todayDraft.push(createDraftBlock(time));
      render();
      document.querySelector(`.schedule-project[data-index="${todayDraft.length - 1}"]`)?.focus();
    });
    document.querySelector('#save-today')?.addEventListener('click', () => { state.schedule = buildSavedSchedule(todayDraft); setScheduleForDate(toDateKey(new Date()), state.schedule); state.activeIndex = clampActiveIndex(state.activeIndex); resetCurrentDuration(); saveState(); render(); });
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
      selectActiveBlock(block.dataset.index, false);
    });
    block.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectActiveBlock(block.dataset.index, false);
      }
    });
  });
  document.querySelectorAll('.schedule-done').forEach((input) => input.addEventListener('change', (event) => { state.schedule[event.target.dataset.index].done = event.target.checked; saveState(); render(); }));
  document.querySelectorAll('.zen-timing-select').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.target.dataset.index); state.schedule[index].zenBreakTiming = event.target.value; zenBreakTriggers.delete(getZenBreakKey(index)); zenBreakNotifiedKey = null; saveState(); render(); }));
  document.querySelectorAll('.time-input').forEach((input) => input.addEventListener('change', (event) => { state.schedule[event.target.dataset.index].time = event.target.value; resetCurrentDuration(); render(); }));
  document.querySelectorAll('.move-block').forEach((button) => button.addEventListener('click', (event) => { const index = Number(event.currentTarget.dataset.index); const offset = event.currentTarget.dataset.direction === 'up' ? -1 : 1; const nextIndex = index + offset; if (!state.schedule[index] || !state.schedule[nextIndex]) return; const [block] = state.schedule.splice(index, 1); state.schedule.splice(nextIndex, 0, block); state.activeIndex = nextIndex; resetCurrentDuration(); render(); }));
  document.querySelectorAll('.delete-block').forEach((button) => button.addEventListener('click', (event) => { state.schedule.splice(event.currentTarget.dataset.index, 1); state.activeIndex = clampActiveIndex(state.activeIndex); resetCurrentDuration(); render(); }));
}

function initializeApp() {
  try {
    state = loadState();
    todayDraft = cloneSchedule(state.schedule.filter((block) => !block.isBreak));
    calendarDraft = cloneSchedule(getScheduleForDate(calendarDate).filter((block) => !block.isBreak));
    remainingSeconds = getBlockDurationSeconds(state.activeIndex);
    saveState();
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
