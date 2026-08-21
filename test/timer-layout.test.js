import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('Timer page keeps all duration and task controls connected to the main timer', () => {
  const timerPage = mainSource.slice(mainSource.indexOf('function timerPage()'), mainSource.indexOf('function timerSchedule()'));
  const orderedMarkers = ['class="timer-shell"', '${quickTaskControls}', '${timerActions}', '${quickTaskButton}', "primaryNavigation('timer-nav')", 'class="dashboard-grid"'];
  const positions = orderedMarkers.map((marker) => timerPage.indexOf(marker));

  assert.ok(positions.every((position) => position >= 0), 'all Timer page layout regions are present');
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
});

test('Quick Task fields and duration presets render only while Quick Task is active', () => {
  const timerPage = mainSource.slice(mainSource.indexOf('function timerPage()'), mainSource.indexOf('function timerSchedule()'));
  assert.match(timerPage, /const quickTaskControls = quickTask\?\.active \?/);
  assert.match(timerPage, /const quickTaskButton = quickTask\?\.active \? ''/);
  assert.match(timerPage, /quickTaskNameField\(\).*timer-presets/);
});

test('Auto-Start is a compact Timer control without a separate explanation card', () => {
  const timerPage = mainSource.slice(mainSource.indexOf('function timerPage()'), mainSource.indexOf('function timerSchedule()'));
  assert.match(timerPage, /timer-actions.*\$\{autoStartControl\}/);
  assert.doesNotMatch(timerPage, /Begin the next scheduled task|<small>/);
});

test('Zen Break is restored as a compact, collapsed Timer control', () => {
  const timerPage = mainSource.slice(mainSource.indexOf('function zenBreakControl('), mainSource.indexOf('function timerSchedule()'));
  assert.match(timerPage, /class="zen-break-control"/);
  assert.match(timerPage, /id="zen-break-enabled"[^>]+role="switch"/);
  assert.match(timerPage, /<details class="zen-break-menu"/);
  assert.doesNotMatch(timerPage, /<details class="zen-break-menu"[^>]+open/);
  assert.match(mainSource, /#timer-zen-break-duration/);
  assert.match(mainSource, /#timer-zen-break-timing/);
});

test('temporary Timer interfaces have visible cancel controls and Escape handling', () => {
  assert.match(mainSource, /id="close-conflict"[^>]+aria-label="Cancel start and close schedule conflict"/);
  assert.match(mainSource, /id="close-zen-break"[^>]+aria-label="Cancel and close Zen Break"/);
  assert.match(mainSource, /id="close-zen-break-options"[^>]+aria-label="Close Zen Break options"/);
  assert.match(mainSource, /#close-conflict'\)\?\.addEventListener\('click', cancelConflictStart\)/);
  assert.match(mainSource, /#close-zen-break'\)\?\.addEventListener\('click', cancelZenBreak\)/);
  assert.match(mainSource, /if \(event\.key !== 'Escape'\) return/);
});

test('canceling a conflict discards its draft and never starts or saves', () => {
  const cancelConflict = mainSource.slice(mainSource.indexOf('function cancelConflictStart()'), mainSource.indexOf('function extendZenBreak()'));
  assert.match(cancelConflict, /conflictModalOpen = false/);
  assert.match(cancelConflict, /pendingStart = false/);
  assert.match(cancelConflict, /calendarDraft = conflictPreviousCalendarDraft/);
  assert.doesNotMatch(cancelConflict, /startTimer|saveState|setScheduleForDate/);
});

test('canceling Zen Break restores and resumes the interrupted timer only', () => {
  const cancelBreak = mainSource.slice(mainSource.indexOf('function cancelZenBreak()'), mainSource.indexOf('function cancelConflictStart()'));
  assert.match(cancelBreak, /remainingSeconds = zenBreak\.pausedRemainingSeconds/);
  assert.match(cancelBreak, /zenBreak = null/);
  assert.match(cancelBreak, /const resumeOnCancel = zenBreak\.resumeOnCancel/);
  assert.match(cancelBreak, /isRunning = resumeOnCancel/);
  assert.match(cancelBreak, /if \(isRunning\).*timerId = setInterval\(tick, 250\)/s);
  assert.doesNotMatch(cancelBreak, /saveState|sounds\.|startTimer/);
});

test('Zen Break remembers whether cancel should resume the timer', () => {
  const startBreak = mainSource.slice(mainSource.indexOf('function startZenBreak('), mainSource.indexOf('function syncZenBreakCountdown()'));
  assert.match(startBreak, /const resumeOnCancel = isRunning/);
  assert.match(startBreak, /resumeOnCancel,/);
});

test('main timer is editable only before a timer session starts', () => {
  assert.match(mainSource, /id="timer-display"[^>]+\$\{hasTimerStarted \? 'disabled' : ''\}/);
  assert.match(mainSource, /#timer-display'\)\?\.addEventListener\('change'/);
  assert.match(mainSource, /configuredDurationSeconds = \(Number\(match\[1\]\) \* 3600\)/);
  assert.match(mainSource, /hasTimerStarted = true/);
  assert.match(mainSource, /hasTimerStarted = false/);
});

test('Quick Task uses only a name and the shared timer duration controls', () => {
  const quickTaskField = mainSource.slice(mainSource.indexOf('function quickTaskNameField()'), mainSource.indexOf('function zenBreakControl('));
  assert.match(quickTaskField, /Quick Task Name/);
  assert.doesNotMatch(quickTaskField, /Project|Duration|Start Now/);
  assert.match(mainSource, /#quick-task-button'\)\?\.addEventListener\('click', activateQuickTask\)/);
  assert.match(mainSource, /if \(quickTask\?\.active\) quickTask\.duration = configuredDurationSeconds \/ 60/);
});

test('Timer navigation keeps all existing destinations and is moved rather than duplicated', () => {
  assert.match(mainSource, /\['Today', 'Timer', 'Projects', 'Calendar', 'Notes'\]/);
  assert.match(mainSource, /href="#\$\{route\}"/);
  assert.match(mainSource, /getRoute\(\) === 'timer' \? '' : primaryNavigation\(\)/);
  assert.match(mainSource, /primaryNavigation\('timer-nav'\)/);
});

test('all four Timer controls retain their existing event handlers', () => {
  assert.match(mainSource, /#start-button'\)\?\.addEventListener\('click', startTimer\)/);
  assert.match(mainSource, /#stop-button'\)\?\.addEventListener\('click', stopTimer\)/);
  assert.match(mainSource, /#reset-button'\)\?\.addEventListener\('click', resetTimer\)/);
  assert.match(mainSource, /#skip-button'\)\?\.addEventListener\('click', advanceBlock\)/);
});

test('Active Block shows scheduled duration, start time, and calculated end time only', () => {
  const activeBlockCard = mainSource.slice(mainSource.indexOf('function activeBlockCard('), mainSource.indexOf('function getTimerStatus('));
  assert.match(activeBlockCard, /<dt>Duration<\/dt>/);
  assert.match(activeBlockCard, /<dt>Start Time<\/dt>.*formatTime\(current\.time\)/);
  assert.match(activeBlockCard, /<dt>End Time<\/dt>.*formatTime\(getNextStartTime\(current\)\)/);
  assert.doesNotMatch(activeBlockCard, /Remaining|Status|Paused/);
});

test('empty current status previews the next saved block without activating it', () => {
  const upcomingStatus = mainSource.slice(mainSource.indexOf('function getNextScheduledBlock('), mainSource.indexOf('function viewedBlockCard('));
  assert.match(upcomingStatus, /state\.schedule\.find\(\(block\) => timeToMinutes\(block\.time\) > nowMinutes\)/);
  assert.match(upcomingStatus, /minutesUntilStart <= 60/);
  assert.match(upcomingStatus, /Starts in \$\{minutesUntilStart\}/);
  assert.match(upcomingStatus, /Starts at \$\{formatTime\(todayBlock\.time\)\}/);
  assert.match(upcomingStatus, /See you tomorrow at/);
  assert.match(upcomingStatus, /Next block: \$\{dayLabel\} at/);
  assert.match(upcomingStatus, /NO MORE BLOCKS TODAY/);
  assert.doesNotMatch(upcomingStatus, /startTimer|remainingSeconds|configuredDurationSeconds/);
});

test('upcoming block status refreshes with the existing real-time authority clock', () => {
  const timerUpdate = mainSource.slice(mainSource.indexOf('function updateTimerDisplay()'), mainSource.indexOf('function getZenBreakKey('));
  assert.match(timerUpdate, /getNextScheduledBlock\(\)/);
  assert.match(timerUpdate, /\[data-card-meta\]/);
  assert.match(mainSource, /authorityTimerId = setInterval\(\(\) =>/);
});

test('scheduled timer status shows end time and only marks an intentional pause', () => {
  const timerStatus = mainSource.slice(mainSource.indexOf('function getTimerStatus('), mainSource.indexOf('function primaryNavigation('));
  const stopTimer = mainSource.slice(mainSource.indexOf('function stopTimer()'), mainSource.indexOf('function resetCurrentDuration()'));
  assert.match(timerStatus, /isUserPaused \? 'PAUSED · ' : ''/);
  assert.match(timerStatus, /actualEnd \|\| formatTime\(getNextStartTime\(current\)\)/);
  assert.match(timerStatus, /formatTime\(getNextStartTime\(current\)\)/);
  assert.match(stopTimer, /if \(!isRunning\) return/);
  assert.match(stopTimer, /isUserPaused = true/);
  assert.match(mainSource, /<button id="stop-button">Pause<\/button>/);
});

test('Reset stops the shared timer and clears both timer values to zero', () => {
  const resetTimer = mainSource.slice(mainSource.indexOf('function resetTimer()'), mainSource.indexOf('function activateQuickTask()'));
  assert.match(resetTimer, /isRunning = false/);
  assert.match(resetTimer, /clearInterval\(timerId\)/);
  assert.match(resetTimer, /configuredDurationSeconds = 0/);
  assert.match(resetTimer, /remainingSeconds = 0/);
  assert.doesNotMatch(resetTimer, /resetCurrentDuration|getBlockDurationSeconds/);
});

test('selecting a scheduled block replaces Quick Task and pauses a freshly loaded duration', () => {
  const selectActiveBlock = mainSource.slice(mainSource.indexOf('function selectActiveBlock('), mainSource.indexOf('function handleProjectSelectChange'));
  assert.match(selectActiveBlock, /isRunning = false/);
  assert.match(selectActiveBlock, /clearInterval\(timerId\)/);
  assert.match(selectActiveBlock, /quickTask = null/);
  assert.match(selectActiveBlock, /state\.activeIndex = nextIndex/);
  assert.match(selectActiveBlock, /viewedIndex = nextIndex/);
  assert.match(selectActiveBlock, /syncTimerToClock\(\)/);
  assert.match(selectActiveBlock, /hasTimerStarted = false/);
  assert.doesNotMatch(selectActiveBlock, /quickTask\?\.active.*return/);
});

test('creating a Quick Task pauses the timer and loads its configured duration', () => {
  const activateQuickTask = mainSource.slice(mainSource.indexOf('function activateQuickTask()'), mainSource.indexOf('function selectActiveBlock('));
  assert.match(activateQuickTask, /isRunning = false/);
  assert.match(activateQuickTask, /clearInterval\(timerId\)/);
  assert.match(activateQuickTask, /remainingSeconds = configuredDurationSeconds/);
  assert.match(activateQuickTask, /hasTimerStarted = false/);
});

test('Next Block and saved schedule blocks use the same selection behavior', () => {
  assert.match(mainSource, /data-select-block="\$\{selectIndex\}"/);
  assert.match(mainSource, /projectCard\('Next Block'.*next \? nextIndex : null\)/);
  assert.match(mainSource, /document\.querySelectorAll\('\[data-select-block\]'\)/);
  assert.match(mainSource, /document\.querySelectorAll\('\.time-block'\)/);
});

test('block navigation exposes both adjacent scheduled blocks', () => {
  const timerPage = mainSource.slice(mainSource.indexOf('function timerPage()'), mainSource.indexOf('function timerSchedule()'));
  assert.match(timerPage, /const position = getSchedulePosition\(\)/);
  assert.match(timerPage, /const previousIndex = quickTask\?\.active \? null : position\.previousIndex/);
  assert.match(timerPage, /projectCard\('Previous Block'.*previous \? previousIndex : null\)/);
  assert.match(timerPage, /projectCard\('Next Block'.*next \? nextIndex : null\)/);
  assert.match(timerPage, /block-navigation/);
});


test('Timer distinguishes real current, viewed, and explicitly running blocks', () => {
  assert.match(mainSource, /function getSchedulePosition/);
  assert.match(mainSource, /let viewedIndex = null/);
  assert.match(mainSource, /let runningIndex = null/);
  assert.match(mainSource, /function findScheduleConflicts/);
  assert.match(mainSource, /This block conflicts with another scheduled block/);
  assert.match(mainSource, /conflictModalOpen = true/);
});

test('clock synchronization selects the relevant block without simulating elapsed work', () => {
  const syncTimer = mainSource.slice(mainSource.indexOf('function syncTimerToClock()'), mainSource.indexOf('function handleRouteChange()'));
  assert.match(syncTimer, /const relevantIndex = viewedIndex \?\? currentIndex/);
  assert.match(syncTimer, /remainingSeconds = getBlockDurationSeconds\(relevantIndex\)/);
  assert.doesNotMatch(syncTimer, /endMinutes - currentLocalMinutes/);
  assert.doesNotMatch(syncTimer, /startTimer/);
});

test('manual scheduled starts use full duration and check the actual interval', () => {
  const startTimer = mainSource.slice(mainSource.indexOf('function startTimer('), mainSource.indexOf('function stopTimer()'));
  assert.match(startTimer, /hasTimerStarted\s+\? remainingSeconds\s+: \(quickTask\?\.active \? configuredDurationSeconds : getBlockDurationSeconds\(requestedIndex\)\)/);
  assert.match(startTimer, /getStartConflicts\(requestedDuration, requestedIndex\)/);
  assert.match(startTimer, /remainingSeconds = requestedDuration/);
  assert.match(startTimer, /projectedEndTime = new Date\(Date\.now\(\) \+ \(remainingSeconds \* 1000\)\)/);
});
