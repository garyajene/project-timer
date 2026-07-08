const scheduleBlocks = [
  { time: '08:30', title: 'Plan daily priorities', project: 'Morning setup', done: true },
  { time: '09:00', title: 'Design Project Timer shell', project: 'Project Timer', active: true },
  { time: '11:00', title: 'Review content backlog', project: 'Writing system' },
  { time: '13:30', title: 'Prototype dashboard states', project: 'UI experiments' },
  { time: '16:00', title: 'Wrap-up and tomorrow setup', project: 'Daily review' },
];

const projects = ['Project Timer', 'Writing system', 'Portfolio refresh', 'Health tracker', 'Home admin'];
const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthDays = Array.from({ length: 30 }, (_, index) => index + 1);

const icon = {
  clock: '◷', edit: '✎', trash: '⌫', plus: '+', note: '✦', check: '✓', next: '›',
};

function section({ id, title, eyebrow, className = '', content }) {
  return `
    <section id="${id}" class="panel ${className}">
      <div class="section-heading"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h2>${title}</h2></div></div>
      ${content}
    </section>`;
}

function projectCard(label, title, meta, active = false) {
  return `<article class="project-card ${active ? 'active-card' : ''}"><p class="eyebrow">${label}</p><h3>${title}</h3><p>${meta}</p></article>`;
}

function header() {
  return `
    <header class="app-header">
      <div><p class="eyebrow">Personal workspace</p><h1>Project Timer</h1></div>
      <div class="header-meta" aria-label="Current date and time placeholder"><span>${icon.clock}</span><span>Wednesday, July 8 · 10:24 AM</span></div>
      <nav class="top-nav" aria-label="Primary navigation">
        ${['Today', 'Projects', 'Calendar', 'Notes'].map((item) => `<a href="#${item.toLowerCase()}">${item}</a>`).join('')}
      </nav>
    </header>`;
}

function todayDashboard() {
  return section({
    id: 'today', title: 'Today Dashboard', eyebrow: 'Default screen', className: 'hero-panel',
    content: `
      <div class="dashboard-grid">
        ${projectCard('Current Project', 'Project Timer UI', 'Build a polished V1 foundation', true)}
        ${projectCard('Next Project', 'Writing system', 'Draft article outline')}
      </div>
      <div class="timer-shell" aria-label="Countdown timer placeholder"><span>01:25:00</span><p>Countdown placeholder · timer logic coming later</p></div>
      <div class="actions"><button class="primary">Start</button><button>Stop</button><button>Skip</button></div>`,
  });
}

function schedule() {
  return section({ id: 'schedule', title: 'Today’s Schedule', eyebrow: 'Time blocks', content: `
    <div class="schedule-list">
      ${scheduleBlocks.map((block) => `
        <label class="time-block ${block.active ? 'active-task' : ''}">
          <input type="checkbox" ${block.done ? 'checked' : ''} />
          <span class="time">${block.time}</span>
          <span class="task-copy"><strong>${block.title}</strong><small>${block.project}</small></span>
        </label>`).join('')}
    </div>` });
}

function masterProjectList() {
  return section({ id: 'projects', title: 'Master Project List', eyebrow: 'Backlog', content: `
    <div class="project-list">
      ${projects.map((project, index) => `
        <div class="project-row">
          <label><input type="checkbox" ${index === 0 ? 'checked' : ''} /> ${project}</label>
          <div class="row-actions"><button aria-label="Edit ${project}">${icon.edit} Edit</button><button aria-label="Delete ${project}">${icon.trash} Delete</button></div>
        </div>`).join('')}
    </div>
    <button class="add-button"><span>${icon.plus}</span> Add Project</button>` });
}

function calendarSection() {
  return section({ id: 'calendar', title: 'Calendar', eyebrow: 'UI only', content: `
    <div class="calendar-tabs"><button class="active-tab">Day</button><button>Week</button><button>Month</button></div>
    <div class="calendar-layout">
      <div class="day-view"><h3>Day view</h3><p>9:00 AM · Project Timer UI</p><p>1:30 PM · Prototype dashboard states</p></div>
      <div class="week-view">${weekDays.map((day) => `<div><strong>${day}</strong><span></span></div>`).join('')}</div>
      <div class="month-view">${monthDays.map((day) => `<span class="${day === 8 ? 'today-dot' : ''}">${day}</span>`).join('')}</div>
    </div>` });
}

function notesAndReview() {
  return `<div class="notes-grid">
    ${section({ id: 'parking', title: 'Parking Lot', eyebrow: 'Quick capture', content: '<textarea aria-label="Parking lot notes" placeholder="Small note area for thoughts that should not interrupt the current project."></textarea><button class="add-button">✦ Add quick thought</button>' })}
    ${section({ id: 'notes', title: 'Project Notes', eyebrow: 'Current project', content: '<textarea aria-label="Project notes" placeholder="Notes area for the currently selected project."></textarea>' })}
    ${section({ id: 'end-day', title: 'End of Day', eyebrow: 'Review', content: '<div class="review-card"><span>✓</span><div><h3>Accomplishments</h3><p>Summarize completed work and lessons learned.</p></div></div><div class="review-card"><span>›</span><div><h3>First task for tomorrow</h3><p>Choose the next focused starting point.</p></div></div>' })}
  </div>`;
}

function app() {
  return `${header()}<main>${todayDashboard()}<div class="two-column">${schedule()}${masterProjectList()}</div>${calendarSection()}${notesAndReview()}</main>`;
}

document.querySelector('#app').innerHTML = app();
