const STORAGE_KEY = 'project-timer-state-v1';
const DEFAULT_BLOCK_MINUTES = 30;

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
let todayDraft = cloneSchedule(state.schedule);
let isRunning = false;
let remainingSeconds = getBlockDurationSeconds(state.activeIndex);
let lastTick = Date.now();
let timerId;
saveState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.projects) || !Array.isArray(saved.schedule)) return structuredClone(defaultState);
    const projects = saved.projects.filter(Boolean).filter((project) => !DEMO_PROJECTS.has(project));
    const schedule = saved.schedule
      .map(normalizeBlock)
      .filter((block) => block.time && block.title && !DEMO_TITLES.has(block.title) && !DEMO_PROJECTS.has(block.project));
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
  return `<article class="project-card ${active ? 'active-card' : ''}"><p class="eyebrow">${label}</p><h3 data-card-title>${escapeHtml(title)}</h3><p data-card-meta>${escapeHtml(meta)}</p></article>`;
}

function header() {
  return `<header class="app-header"><div><p class="eyebrow">Personal workspace</p><h1>Project Timer</h1></div><div class="header-meta" aria-label="Current date and time"><span>${icon.clock}</span><span>${formatDate()}</span></div><nav class="top-nav" aria-label="Primary navigation">${['Today', 'Timer', 'Projects', 'Calendar', 'Notes'].map((item) => `<a href="#${item.toLowerCase()}" ${getRoute() === item.toLowerCase() ? 'aria-current="page"' : ''}>${item}</a>`).join('')}</nav></header>`;
}

function timerPage() {
  const current = state.schedule[state.activeIndex];
  const next = state.schedule[state.activeIndex + 1];
  return `${section({ id: 'timer', title: 'Timer', eyebrow: 'Execution only', className: 'hero-panel', content: `<div class="dashboard-grid">${projectCard('Active Block', current?.project || 'No block selected', current?.title || 'Save today’s schedule to begin', true)}${projectCard('Next Block', next?.project || 'End of schedule', next?.title || 'No next block')}</div><div class="timer-shell" aria-label="Countdown timer"><span id="timer-display">${formatSeconds(remainingSeconds)}</span><p id="timer-status">${current ? `${isRunning ? 'Running' : 'Paused'} · ${escapeHtml(current.title)}` : 'No saved blocks for today'}</p></div><div class="actions"><button id="start-button" class="primary">Start</button><button id="stop-button">Stop</button><button id="skip-button">Skip</button></div>` })}${timerSchedule()}`;
}

function timerSchedule() {
  const blocks = state.schedule.map((block, index) => `<div class="time-block timer-block ${index === state.activeIndex ? 'active-task' : ''}" data-index="${index}" role="button" tabindex="0" aria-label="Make ${escapeHtml(block.title)} active"><input class="schedule-done" data-index="${index}" type="checkbox" ${block.done ? 'checked' : ''} aria-label="Mark ${escapeHtml(block.title)} complete" /><span class="time">${escapeHtml(block.time)}</span><span class="task-copy"><strong>${escapeHtml(block.title)}</strong><small>${escapeHtml(block.project)}</small></span></div>`).join('') || '<p class="empty-state">No saved schedule yet. Plan today on the Today page.</p>';
  return section({ id: 'timer-schedule', title: 'Today’s Saved Schedule', eyebrow: 'Read-only plan', content: `<div class="schedule-list">${blocks}</div>` });
}

function todayPlanner() {
  return section({ id: 'today', title: 'Today’s Schedule', eyebrow: 'Planning', content: `<p class="helper-text">Build today’s schedule from your Master Project List, adjust the order, then save it for the Timer page.</p><div class="schedule-list">${todayDraft.map((block, index) => `<div class="time-block" data-index="${index}"><input class="time-input" data-index="${index}" type="time" value="${escapeHtml(block.time)}" aria-label="Block time" /><span class="task-copy"><input class="text-input schedule-title" data-index="${index}" value="${escapeHtml(block.title)}" aria-label="Block title" /><input class="text-input schedule-project" data-index="${index}" value="${escapeHtml(block.project)}" aria-label="Block project" list="project-options" /></span><div class="row-actions"><button class="move-block" data-direction="up" data-index="${index}" aria-label="Move ${escapeHtml(block.title)} earlier">↑</button><button class="move-block" data-direction="down" data-index="${index}" aria-label="Move ${escapeHtml(block.title)} later">↓</button><button class="delete-block" data-index="${index}" aria-label="Delete ${escapeHtml(block.title)}">${icon.trash} Delete</button></div></div>`).join('') || '<p class="empty-state">No blocks planned for today.</p>'}</div><button id="add-block" class="add-button"><span>${icon.plus}</span> Add Project Block</button><button id="save-today" class="primary save-button">Save Today’s Schedule</button><datalist id="project-options">${state.projects.map((project) => `<option value="${escapeHtml(project)}"></option>`).join('')}</datalist>` });
}

function masterProjectList() {
  return section({ id: 'projects', title: 'Master Project List', eyebrow: 'Backlog', content: `<div class="project-list">${state.projects.map((project, index) => `<div class="project-row"><input class="text-input project-name" data-index="${index}" value="${escapeHtml(project)}" aria-label="Project name" /><div class="row-actions"><button class="delete-project" data-index="${index}" aria-label="Delete ${escapeHtml(project)}">${icon.trash} Delete</button></div></div>`).join('') || '<p class="empty-state">No projects yet.</p>'}</div><button id="add-project" class="add-button"><span>${icon.plus}</span> Add Project</button>` });
}

function calendarSection() {
  const dayItems = state.schedule.map((block) => `<p>${escapeHtml(block.time)} · ${escapeHtml(block.title)}</p>`).join('') || '<p>No blocks scheduled.</p>';
  return section({ id: 'calendar', title: 'Calendar', eyebrow: 'Today', content: `<div class="calendar-tabs"><button class="active-tab">Day</button><button>Week</button><button>Month</button></div><div class="calendar-layout"><div class="day-view"><h3>Day view</h3>${dayItems}</div><div class="week-view">${weekDays.map((day) => `<div><strong>${day}</strong><span></span></div>`).join('')}</div><div class="month-view">${monthDays.map((day) => `<span class="${day === new Date().getDate() ? 'today-dot' : ''}">${day}</span>`).join('')}</div></div>` });
}

function notesAndReview() {
  return `<div class="notes-grid">${section({ id: 'parking', title: 'Parking Lot', eyebrow: 'Quick capture', content: '<textarea aria-label="Parking lot notes"></textarea>' })}${section({ id: 'notes', title: 'Project Notes', eyebrow: 'Current project', content: '<textarea aria-label="Project notes"></textarea>' })}${section({ id: 'end-day', title: 'End of Day', eyebrow: 'Review', content: '<div class="review-card"><span>✓</span><div><h3>Accomplishments</h3><p>Summarize completed work and lessons learned.</p></div></div><div class="review-card"><span>›</span><div><h3>First task for tomorrow</h3><p>Choose the next focused starting point.</p></div></div>' })}</div>`;
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

function updateSelectedBlockUI() {
  const current = state.schedule[state.activeIndex];
  const next = state.schedule[state.activeIndex + 1];
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
    block.classList.toggle('active-task', Number(block.dataset.index) === state.activeIndex);
  });
  updateTimerDisplay();
}

function selectActiveBlock(index, shouldRender = true) {
  const nextIndex = Number(index);
  if (!Number.isInteger(nextIndex) || !state.schedule[nextIndex]) return;
  state.activeIndex = nextIndex;
  resetCurrentDuration();
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
  document.querySelector('#add-project')?.addEventListener('click', () => { state.projects.push('New Project'); saveState(); render(); });
  document.querySelectorAll('.project-name').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.target.dataset.index); const previousName = state.projects[index]; const nextName = event.target.value.trim() || 'Untitled Project'; state.projects[index] = nextName; state.schedule.forEach((block) => { if (block.project === previousName) block.project = nextName; }); todayDraft.forEach((block) => { if (block.project === previousName) block.project = nextName; }); saveState(); render(); }));
  document.querySelectorAll('.delete-project').forEach((button) => button.addEventListener('click', (event) => { state.projects.splice(event.currentTarget.dataset.index, 1); saveState(); render(); }));
  if (document.querySelector('#save-today')) {
    document.querySelector('#add-block')?.addEventListener('click', () => { const project = state.projects[0] ?? ''; todayDraft.push({ time: '09:00', title: project || 'New block', project, done: false }); render(); });
    document.querySelector('#save-today')?.addEventListener('click', () => { state.schedule = cloneSchedule(todayDraft); state.activeIndex = clampActiveIndex(state.activeIndex); resetCurrentDuration(); saveState(); render(); });
    document.querySelectorAll('.time-input').forEach((input) => input.addEventListener('change', (event) => { todayDraft[event.target.dataset.index].time = event.target.value; }));
    document.querySelectorAll('.schedule-title').forEach((input) => input.addEventListener('change', (event) => { todayDraft[event.target.dataset.index].title = event.target.value.trim() || 'Untitled block'; }));
    document.querySelectorAll('.schedule-project').forEach((input) => input.addEventListener('change', (event) => { const project = event.target.value.trim(); const block = todayDraft[event.target.dataset.index]; block.project = project; if (!block.title || block.title === 'New block') block.title = project || 'Untitled block'; }));
    document.querySelectorAll('.move-block').forEach((button) => button.addEventListener('click', (event) => { const index = Number(event.currentTarget.dataset.index); const offset = event.currentTarget.dataset.direction === 'up' ? -1 : 1; const nextIndex = index + offset; if (!todayDraft[index] || !todayDraft[nextIndex]) return; const [block] = todayDraft.splice(index, 1); todayDraft.splice(nextIndex, 0, block); render(); }));
    document.querySelectorAll('.delete-block').forEach((button) => button.addEventListener('click', (event) => { todayDraft.splice(event.currentTarget.dataset.index, 1); render(); }));
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
  document.querySelectorAll('.time-input').forEach((input) => input.addEventListener('change', (event) => { state.schedule[event.target.dataset.index].time = event.target.value; resetCurrentDuration(); render(); }));
  document.querySelectorAll('.schedule-title').forEach((input) => input.addEventListener('change', (event) => { state.schedule[event.target.dataset.index].title = event.target.value.trim() || 'Untitled block'; render(); }));
  document.querySelectorAll('.schedule-project').forEach((input) => input.addEventListener('change', (event) => { const project = event.target.value.trim(); state.schedule[event.target.dataset.index].project = project; if (!state.schedule[event.target.dataset.index].title || state.schedule[event.target.dataset.index].title === 'New block') state.schedule[event.target.dataset.index].title = project || 'Untitled block'; render(); }));
  document.querySelectorAll('.move-block').forEach((button) => button.addEventListener('click', (event) => { const index = Number(event.currentTarget.dataset.index); const offset = event.currentTarget.dataset.direction === 'up' ? -1 : 1; const nextIndex = index + offset; if (!state.schedule[index] || !state.schedule[nextIndex]) return; const [block] = state.schedule.splice(index, 1); state.schedule.splice(nextIndex, 0, block); state.activeIndex = nextIndex; resetCurrentDuration(); render(); }));
  document.querySelectorAll('.delete-block').forEach((button) => button.addEventListener('click', (event) => { state.schedule.splice(event.currentTarget.dataset.index, 1); state.activeIndex = clampActiveIndex(state.activeIndex); resetCurrentDuration(); render(); }));
}

render();
