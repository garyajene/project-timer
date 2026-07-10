const STORAGE_KEY = 'project-timer-state-v1';
const DEFAULT_BLOCK_MINUTES = 30;
const DURATION_PRESETS = [15, 30, 45, 60, 120, 180, 240];
const ZEN_BREAK_PRESETS = [0, 2, 5, 10, 15];

const DEMO_PROJECTS = new Set(['Project Timer', 'Writing system', 'Portfolio refresh', 'Health tracker', 'Home admin', 'Morning setup', 'Daily review']);
const DEMO_TITLES = new Set(['Plan daily priorities', 'Use Project Timer', 'Review content backlog', 'Focused project block', 'Wrap-up and tomorrow setup']);

const defaultState = {
  projects: [],
  schedule: [],
  activeIndex: 0,
};

const icon = { clock: '◷', edit: '✎', trash: '⌫', plus: '+', check: '✓', next: '›' };
const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthDays = Array.from({ length: 30 }, (_, index) => index + 1);
let state = loadState();
let todayDraft = cloneSchedule(state.schedule.filter((block) => !block.isBreak));
let isRunning = false;
let remainingSeconds = getBlockDurationSeconds(state.activeIndex);
let lastTick = Date.now();
let timerId;
let zenBreakNotifiedKey = null;
let quickTask = null;
let isQuickTaskFormOpen = false;
let zenBreak = null;
const zenBreakTriggers = new Map();
saveState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.projects) || !Array.isArray(saved.schedule)) return structuredClone(defaultState);
    const projects = saved.projects.filter(Boolean).filter((project) => !DEMO_PROJECTS.has(project));
    const schedule = saved.schedule
      .map(normalizeBlock)
      .filter((block) => block.time && (block.project || block.title) && !DEMO_TITLES.has(block.title) && !DEMO_PROJECTS.has(block.project));
    return {
      projects,
      schedule,
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
  return { time, title: '', project: '', duration: DEFAULT_BLOCK_MINUTES, zenBreakMinutes: 0, done: false };
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
  return `<form id="quick-task-form" class="quick-task-form"><div class="planning-fields"><label>Project <select class="text-input" id="quick-project" required>${projectOptions('')}</select></label><label>Task <input class="text-input" id="quick-title" placeholder="Optional task description" /></label></div><fieldset class="preset-group quick-duration-group"><legend>Duration</legend>${DURATION_PRESETS.map((minutes, index) => `<button type="button" class="preset-button quick-duration-preset ${index === 0 ? 'active-preset' : ''}" data-minutes="${minutes}">${formatMinutes(minutes)}</button>`).join('')}</fieldset><input type="hidden" id="quick-duration" value="15" /><div class="actions quick-form-actions"><button type="submit" class="primary">Start Now</button><button type="button" id="cancel-quick-task">Cancel</button></div></form>`;
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
  return `<div class="zen-break-overlay" role="dialog" aria-modal="true" aria-label="Zen Break"><div><p class="eyebrow">Zen Break</p><h2>Pause and reset</h2><span id="zen-break-countdown">${formatSeconds(zenBreak.remainingSeconds)}</span></div></div>`;
}

function projectOptions(selectedProject) {
  const placeholder = `<option value="" ${selectedProject ? '' : 'selected'} disabled>Select project</option>`;
  return placeholder + state.projects.map((project) => `<option value="${escapeHtml(project)}" ${project === selectedProject ? 'selected' : ''}>${escapeHtml(project)}</option>`).join('');
}

function todayPlanner() {
  const rows = todayDraft.map((block, index) => `<div class="time-block planning-block" data-index="${index}"><div class="planning-fields"><label>Project <select class="text-input schedule-project" data-index="${index}" aria-label="Project" required>${projectOptions(block.project)}</select></label><label>Task <input class="text-input schedule-title" data-index="${index}" value="${escapeHtml(block.title)}" aria-label="Task" placeholder="Optional task description" /></label></div><div class="planning-controls"><label>Start Time ${timeSelector(block, index)}</label><fieldset class="preset-group"><legend>Duration</legend>${DURATION_PRESETS.map((minutes) => `<button type="button" class="preset-button duration-preset ${block.duration === minutes ? 'active-preset' : ''}" data-index="${index}" data-minutes="${minutes}">${formatMinutes(minutes)}</button>`).join('')}</fieldset><label>Zen Break <select class="text-input zen-break-select" data-index="${index}" aria-label="Zen Break during work block">${ZEN_BREAK_PRESETS.map((minutes) => `<option value="${minutes}" ${block.zenBreakMinutes === minutes ? 'selected' : ''}>${minutes ? formatMinutes(minutes) : 'None'}</option>`).join('')}</select></label></div><div class="row-actions"><button class="move-block" data-direction="up" data-index="${index}" aria-label="Move task earlier">↑</button><button class="move-block" data-direction="down" data-index="${index}" aria-label="Move task later">↓</button><button class="delete-block" data-index="${index}" aria-label="Delete task">${icon.trash} Delete</button></div></div>`).join('') || '<p class="empty-state">No blocks planned for today.</p>';
  return section({ id: 'today', title: 'Today’s Schedule', eyebrow: 'Planning', content: `<p class="helper-text">Build today’s schedule from your Master Project List with as little typing as possible: choose a project, add an optional task, then tap duration presets, and an optional Zen Break reminder.</p><div class="schedule-list">${rows}</div><button id="add-block" class="add-button"><span>${icon.plus}</span> Add Project Block</button><button id="save-today" class="primary save-button">Save Today’s Schedule</button>` });
}


function masterProjectList() {
  return section({ id: 'projects', title: 'Master Project List', eyebrow: 'Backlog', content: `<div class="project-list">${state.projects.map((project, index) => `<div class="project-row"><input class="text-input project-name" data-index="${index}" value="${escapeHtml(project)}" aria-label="Project name" /><div class="row-actions"><button class="delete-project" data-index="${index}" aria-label="Delete ${escapeHtml(project)}">${icon.trash} Delete</button></div></div>`).join('') || '<p class="empty-state">No projects yet.</p>'}</div><button id="add-project" class="add-button"><span>${icon.plus}</span> Add Project</button>` });
}

function calendarSection() {
  const dayItems = state.schedule.map((block) => `<p>${escapeHtml(formatTime(block.time))} · ${escapeHtml(block.project)}${block.title ? ` · ${escapeHtml(block.title)}` : ''}</p>`).join('') || '<p>No blocks scheduled.</p>';
  return section({ id: 'calendar', title: 'Calendar', eyebrow: 'Today', content: `<div class="calendar-tabs"><button class="active-tab">Day</button><button>Week</button><button>Month</button></div><div class="calendar-layout"><div class="day-view"><h3>Day view</h3>${dayItems}</div><div class="week-view">${weekDays.map((day) => `<div><strong>${day}</strong><span></span></div>`).join('')}</div><div class="month-view">${monthDays.map((day) => `<span class="${day === new Date().getDate() ? 'today-dot' : ''}">${day}</span>`).join('')}</div></div>` });
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

function render() {
  document.querySelector('#app').innerHTML = `${header()}<main>${mainContent()}</main>`;
  bindEvents();
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
  const block = state.schedule[index];
  if (!block) return null;
  return `${index}-${block.time}-${block.project}-${block.title}-${block.duration}-${block.zenBreakMinutes}`;
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

function tickZenBreak() {
  if (!zenBreak?.active) return;
  const now = Date.now();
  zenBreak.remainingSeconds -= (now - zenBreak.lastTick) / 1000;
  zenBreak.lastTick = now;
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
  if (quickTask?.active || zenBreak?.active) return false;
  const block = state.schedule[state.activeIndex];
  if (!block?.zenBreakMinutes || block.isBreak) return false;
  const durationSeconds = getBlockDurationSeconds(state.activeIndex);
  const elapsedSeconds = durationSeconds - remainingSeconds;
  const key = getZenBreakKey(state.activeIndex);
  if (zenBreakNotifiedKey === key) return false;
  if (elapsedSeconds < getZenBreakTriggerSecond(state.activeIndex, block, durationSeconds)) return false;
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
  if (!project) return;
  quickTask = {
    active: true,
    project,
    title: document.querySelector('#quick-title')?.value.trim() || '',
    duration: Number(document.querySelector('#quick-duration')?.value) || 15,
    pausedRemainingSeconds: remainingSeconds,
  };
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

function bindEvents() {
  window.removeEventListener('hashchange', render);
  window.addEventListener('hashchange', render);
  document.querySelector('#start-button')?.addEventListener('click', startTimer);
  document.querySelector('#stop-button')?.addEventListener('click', stopTimer);
  document.querySelector('#skip-button')?.addEventListener('click', advanceBlock);
  document.querySelector('#quick-task-button')?.addEventListener('click', () => { isQuickTaskFormOpen = true; render(); });
  document.querySelector('#cancel-quick-task')?.addEventListener('click', () => { isQuickTaskFormOpen = false; render(); });
  document.querySelector('#quick-task-form')?.addEventListener('submit', startQuickTask);
  document.querySelectorAll('.quick-duration-preset').forEach((button) => button.addEventListener('click', (event) => {
    document.querySelector('#quick-duration').value = event.currentTarget.dataset.minutes;
    document.querySelectorAll('.quick-duration-preset').forEach((preset) => preset.classList.toggle('active-preset', preset === event.currentTarget));
  }));
  document.querySelector('#add-project')?.addEventListener('click', () => { state.projects.push('New Project'); saveState(); render(); });
  document.querySelectorAll('.project-name').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.target.dataset.index); const previousName = state.projects[index]; const nextName = event.target.value.trim() || 'Untitled Project'; state.projects[index] = nextName; state.schedule.forEach((block) => { if (block.project === previousName) block.project = nextName; }); todayDraft.forEach((block) => { if (block.project === previousName) block.project = nextName; }); saveState(); render(); }));
  document.querySelectorAll('.delete-project').forEach((button) => button.addEventListener('click', (event) => { state.projects.splice(event.currentTarget.dataset.index, 1); saveState(); render(); }));
  if (document.querySelector('#save-today')) {
    document.querySelector('#add-block')?.addEventListener('click', () => {
      const time = todayDraft.length ? getNextStartTime(todayDraft[todayDraft.length - 1]) : '09:00';
      todayDraft.push(createDraftBlock(time));
      render();
      document.querySelector(`.schedule-project[data-index="${todayDraft.length - 1}"]`)?.focus();
    });
    document.querySelector('#save-today')?.addEventListener('click', () => { state.schedule = buildSavedSchedule(todayDraft); state.activeIndex = clampActiveIndex(state.activeIndex); resetCurrentDuration(); saveState(); render(); });
    document.querySelectorAll('.time-hour, .time-minutes, .time-period').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.target.dataset.index); const row = event.target.closest('.planning-block'); const hour = row.querySelector('.time-hour').value; const minutes = row.querySelector('.time-minutes').value; const period = row.querySelector('.time-period').value; todayDraft[index].time = timePartsToTime(hour, minutes, period); applyNextStartTimes(index); render(); }));
    document.querySelectorAll('.schedule-title').forEach((input) => input.addEventListener('input', (event) => { todayDraft[event.target.dataset.index].title = event.target.value; }));
    document.querySelectorAll('.schedule-project').forEach((input) => input.addEventListener('change', (event) => { todayDraft[event.target.dataset.index].project = event.target.value; }));
    document.querySelectorAll('.duration-preset').forEach((button) => button.addEventListener('click', (event) => { const index = Number(event.currentTarget.dataset.index); todayDraft[index].duration = Number(event.currentTarget.dataset.minutes); applyNextStartTimes(index); render(); }));
    document.querySelectorAll('.zen-break-select').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.target.dataset.index); todayDraft[index].zenBreakMinutes = Number(event.target.value); render(); }));
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

render();
