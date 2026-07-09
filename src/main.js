const STORAGE_KEY = 'project-timer-state-v1';
const DEFAULT_BLOCK_MINUTES = 30;

const defaultState = {
  projects: ['Project Timer', 'Writing system', 'Portfolio refresh', 'Health tracker', 'Home admin'],
  schedule: [
    { time: '08:30', title: 'Plan daily priorities', project: 'Morning setup', done: false },
    { time: '09:00', title: 'Use Project Timer', project: 'Project Timer', done: false },
    { time: '11:00', title: 'Review content backlog', project: 'Writing system', done: false },
    { time: '13:30', title: 'Focused project block', project: 'Project Timer', done: false },
    { time: '16:00', title: 'Wrap-up and tomorrow setup', project: 'Daily review', done: false },
  ],
  activeIndex: 0,
};

const icon = { clock: '◷', edit: '✎', trash: '⌫', plus: '+', check: '✓', next: '›' };
const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthDays = Array.from({ length: 30 }, (_, index) => index + 1);
let state = loadState();
let isRunning = false;
let remainingSeconds = getBlockDurationSeconds(state.activeIndex);
let lastTick = Date.now();
let timerId;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.projects) || !Array.isArray(saved.schedule)) return structuredClone(defaultState);
    return {
      projects: saved.projects.filter(Boolean),
      schedule: saved.schedule.map(normalizeBlock).filter((block) => block.time && block.title),
      activeIndex: Number.isInteger(saved.activeIndex) ? saved.activeIndex : 0,
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function normalizeBlock(block) {
  return {
    time: block.time ?? '09:00',
    title: block.title ?? 'Project block',
    project: block.project ?? '',
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

function getBlockDurationSeconds(index) {
  const block = state.schedule[index];
  if (!block) return DEFAULT_BLOCK_MINUTES * 60;
  const nextBlock = state.schedule[index + 1];
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
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date());
}

function section({ id, title, eyebrow, className = '', content }) {
  return `<section id="${id}" class="panel ${className}"><div class="section-heading"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h2>${title}</h2></div></div>${content}</section>`;
}

function projectCard(label, title, meta, active = false) {
  return `<article class="project-card ${active ? 'active-card' : ''}"><p class="eyebrow">${label}</p><h3>${escapeHtml(title)}</h3><p>${escapeHtml(meta)}</p></article>`;
}

function header() {
  return `<header class="app-header"><div><p class="eyebrow">Personal workspace</p><h1>Project Timer</h1></div><div class="header-meta" aria-label="Current date and time"><span>${icon.clock}</span><span>${formatDate()}</span></div><nav class="top-nav" aria-label="Primary navigation">${['Today', 'Projects', 'Calendar', 'Notes'].map((item) => `<a href="#${item.toLowerCase()}">${item}</a>`).join('')}</nav></header>`;
}

function todayDashboard() {
  const current = state.schedule[state.activeIndex];
  const next = state.schedule[state.activeIndex + 1];
  return section({ id: 'today', title: 'Today Dashboard', eyebrow: 'Default screen', className: 'hero-panel', content: `<div class="dashboard-grid">${projectCard('Current Project', current?.project || 'No block selected', current?.title || 'Add a block to begin', true)}${projectCard('Next Project', next?.project || 'End of schedule', next?.title || 'No next block')}</div><div class="timer-shell" aria-label="Countdown timer"><span id="timer-display">${formatSeconds(remainingSeconds)}</span><p id="timer-status">${current ? `${isRunning ? 'Running' : 'Paused'} · ${escapeHtml(current.title)}` : 'Add a schedule block to start timing'}</p></div><div class="actions"><button id="start-button" class="primary">Start</button><button id="stop-button">Stop</button><button id="skip-button">Skip</button></div>` });
}

function schedule() {
  return section({ id: 'schedule', title: 'Today’s Schedule', eyebrow: 'Time blocks', content: `<div class="schedule-list">${state.schedule.map((block, index) => `<div class="time-block ${index === state.activeIndex ? 'active-task' : ''}"><input class="schedule-done" data-index="${index}" type="checkbox" ${block.done ? 'checked' : ''} aria-label="Mark ${escapeHtml(block.title)} complete" /><input class="time-input" data-index="${index}" type="time" value="${escapeHtml(block.time)}" /><span class="task-copy"><input class="text-input schedule-title" data-index="${index}" value="${escapeHtml(block.title)}" aria-label="Block title" /><input class="text-input schedule-project" data-index="${index}" value="${escapeHtml(block.project)}" aria-label="Block project" list="project-options" /></span><div class="row-actions"><button class="delete-block" data-index="${index}" aria-label="Delete ${escapeHtml(block.title)}">${icon.trash} Delete</button></div></div>`).join('')}</div><button id="add-block" class="add-button"><span>${icon.plus}</span> Add Block</button><datalist id="project-options">${state.projects.map((project) => `<option value="${escapeHtml(project)}"></option>`).join('')}</datalist>` });
}

function masterProjectList() {
  return section({ id: 'projects', title: 'Master Project List', eyebrow: 'Backlog', content: `<div class="project-list">${state.projects.map((project, index) => `<div class="project-row"><input class="text-input project-name" data-index="${index}" value="${escapeHtml(project)}" aria-label="Project name" /><div class="row-actions"><button class="delete-project" data-index="${index}" aria-label="Delete ${escapeHtml(project)}">${icon.trash} Delete</button></div></div>`).join('')}</div><button id="add-project" class="add-button"><span>${icon.plus}</span> Add Project</button>` });
}

function calendarSection() {
  const dayItems = state.schedule.map((block) => `<p>${escapeHtml(block.time)} · ${escapeHtml(block.title)}</p>`).join('') || '<p>No blocks scheduled.</p>';
  return section({ id: 'calendar', title: 'Calendar', eyebrow: 'Today', content: `<div class="calendar-tabs"><button class="active-tab">Day</button><button>Week</button><button>Month</button></div><div class="calendar-layout"><div class="day-view"><h3>Day view</h3>${dayItems}</div><div class="week-view">${weekDays.map((day) => `<div><strong>${day}</strong><span></span></div>`).join('')}</div><div class="month-view">${monthDays.map((day) => `<span class="${day === new Date().getDate() ? 'today-dot' : ''}">${day}</span>`).join('')}</div></div>` });
}

function notesAndReview() {
  return `<div class="notes-grid">${section({ id: 'parking', title: 'Parking Lot', eyebrow: 'Quick capture', content: '<textarea aria-label="Parking lot notes"></textarea>' })}${section({ id: 'notes', title: 'Project Notes', eyebrow: 'Current project', content: '<textarea aria-label="Project notes"></textarea>' })}${section({ id: 'end-day', title: 'End of Day', eyebrow: 'Review', content: '<div class="review-card"><span>✓</span><div><h3>Accomplishments</h3><p>Summarize completed work and lessons learned.</p></div></div><div class="review-card"><span>›</span><div><h3>First task for tomorrow</h3><p>Choose the next focused starting point.</p></div></div>' })}</div>`;
}

function render() {
  document.querySelector('#app').innerHTML = `${header()}<main>${todayDashboard()}<div class="two-column">${schedule()}${masterProjectList()}</div>${calendarSection()}${notesAndReview()}</main>`;
  bindEvents();
}

function updateTimerDisplay() {
  const display = document.querySelector('#timer-display');
  const status = document.querySelector('#timer-status');
  const current = state.schedule[state.activeIndex];
  if (display) display.textContent = formatSeconds(remainingSeconds);
  if (status) status.textContent = current ? `${isRunning ? 'Running' : 'Paused'} · ${current.title}` : 'Add a schedule block to start timing';
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

function advanceBlock() {
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
  else updateTimerDisplay();
}

function startTimer() {
  if (!state.schedule.length) return;
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

function sortSchedule() {
  const activeBlock = state.schedule[state.activeIndex];
  state.schedule.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  state.activeIndex = Math.max(0, state.schedule.indexOf(activeBlock));
}

function bindEvents() {
  document.querySelector('#start-button')?.addEventListener('click', startTimer);
  document.querySelector('#stop-button')?.addEventListener('click', stopTimer);
  document.querySelector('#skip-button')?.addEventListener('click', advanceBlock);
  document.querySelector('#add-project')?.addEventListener('click', () => { state.projects.push('New Project'); saveState(); render(); });
  document.querySelector('#add-block')?.addEventListener('click', () => { state.schedule.push({ time: '09:00', title: 'New block', project: state.projects[0] ?? '', done: false }); sortSchedule(); resetCurrentDuration(); saveState(); render(); });
  document.querySelectorAll('.project-name').forEach((input) => input.addEventListener('change', (event) => { state.projects[event.target.dataset.index] = event.target.value.trim() || 'Untitled Project'; saveState(); render(); }));
  document.querySelectorAll('.delete-project').forEach((button) => button.addEventListener('click', (event) => { state.projects.splice(event.currentTarget.dataset.index, 1); saveState(); render(); }));
  document.querySelectorAll('.schedule-done').forEach((input) => input.addEventListener('change', (event) => { state.schedule[event.target.dataset.index].done = event.target.checked; saveState(); }));
  document.querySelectorAll('.time-input').forEach((input) => input.addEventListener('change', (event) => { state.schedule[event.target.dataset.index].time = event.target.value; sortSchedule(); resetCurrentDuration(); saveState(); render(); }));
  document.querySelectorAll('.schedule-title').forEach((input) => input.addEventListener('change', (event) => { state.schedule[event.target.dataset.index].title = event.target.value.trim() || 'Untitled block'; saveState(); render(); }));
  document.querySelectorAll('.schedule-project').forEach((input) => input.addEventListener('change', (event) => { state.schedule[event.target.dataset.index].project = event.target.value.trim(); saveState(); render(); }));
  document.querySelectorAll('.delete-block').forEach((button) => button.addEventListener('click', (event) => { state.schedule.splice(event.currentTarget.dataset.index, 1); state.activeIndex = clampActiveIndex(state.activeIndex); resetCurrentDuration(); saveState(); render(); }));
}

render();
