export function remainingFromTimerState(timerState, now = Date.now()) {
  if (timerState?.status === 'running' && timerState.endsAt) return Math.max(0, (Date.parse(timerState.endsAt) - now) / 1000);
  return Math.max(0, Number(timerState?.remainingSecondsWhenPaused) || 0);
}
