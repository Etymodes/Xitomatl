/** Serializable timer state. All timestamps and durations use milliseconds. */
export interface TimerRecord {
  /** Wall-clock time when this timer was first created. */
  startedAtMs: number;
  /** null counts upward; a number counts down from that duration. */
  durationMs: number | null;
  /** Active time accumulated before the current running segment. */
  elapsedBeforeRunMs: number;
  /** Start of the current running segment, or null while paused. */
  runningSinceMs: number | null;
  /** Last pause time, or null while running. */
  pausedAtMs: number | null;
}

export interface TimerSnapshot {
  elapsedMs: number;
  remainingMs: number | null;
  /** Actual deadline while running; unknown while paused or counting upward. */
  deadlineAtMs: number | null;
  isPaused: boolean;
  isDue: boolean;
  display: string;
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

/** Start a count-up timer with null, or a countdown with a duration in ms. */
export function createTimer(startedAtMs: number, durationMs: number | null): TimerRecord {
  requireFinite(startedAtMs, 'startedAtMs');
  if (durationMs !== null) {
    requireFinite(durationMs, 'durationMs');
    if (durationMs < 0) throw new RangeError('durationMs must be non-negative');
  }
  return {
    startedAtMs,
    durationMs,
    elapsedBeforeRunMs: 0,
    runningSinceMs: startedAtMs,
    pausedAtMs: null,
  };
}

/** Freeze the elapsed time. Pausing an already paused timer has no effect. */
export function pauseTimer(timer: TimerRecord, nowMs: number): TimerRecord {
  requireFinite(nowMs, 'nowMs');
  if (timer.runningSinceMs === null) return timer;
  if (nowMs < timer.runningSinceMs) throw new RangeError('nowMs precedes the running segment');
  const elapsedMs = timer.elapsedBeforeRunMs + nowMs - timer.runningSinceMs;
  return {
    ...timer,
    elapsedBeforeRunMs: elapsedMs,
    runningSinceMs: null,
    pausedAtMs: nowMs,
  };
}

/** Start a new running segment; a countdown gets a new absolute deadline. */
export function resumeTimer(timer: TimerRecord, nowMs: number): TimerRecord {
  requireFinite(nowMs, 'nowMs');
  if (timer.runningSinceMs !== null) return timer;
  if (timer.pausedAtMs !== null && nowMs < timer.pausedAtMs) {
    throw new RangeError('nowMs precedes the pause');
  }
  return { ...timer, runningSinceMs: nowMs, pausedAtMs: null };
}

/** Exclude a long period when the app stopped sending heartbeats (close or sleep). */
export function pauseAfterInactiveGap(timer: TimerRecord, lastActiveAtMs: number, nowMs: number, gapMs = 60_000): TimerRecord {
  requireFinite(lastActiveAtMs, 'lastActiveAtMs');
  requireFinite(nowMs, 'nowMs');
  if (timer.runningSinceMs === null || nowMs - lastActiveAtMs <= gapMs) return timer;
  return pauseTimer(timer, Math.max(timer.runningSinceMs, lastActiveAtMs));
}

/** Format a non-negative number of seconds as HH:MM:SS, including hours above 99. */
export function formatHms(totalSeconds: number): string {
  requireFinite(totalSeconds, 'totalSeconds');
  if (totalSeconds < 0) throw new RangeError('totalSeconds must be non-negative');
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

/** Recompute display and deadline from a stored record and the current wall-clock time. */
export function getTimerSnapshot(timer: TimerRecord, nowMs: number): TimerSnapshot {
  requireFinite(nowMs, 'nowMs');
  const runningMs = timer.runningSinceMs === null ? 0 : Math.max(0, nowMs - timer.runningSinceMs);
  const elapsedMs = Math.max(0, timer.elapsedBeforeRunMs + runningMs);
  const remainingMs = timer.durationMs === null ? null : Math.max(0, timer.durationMs - elapsedMs);
  const deadlineAtMs = timer.durationMs === null || timer.runningSinceMs === null
    ? null
    : timer.runningSinceMs + (timer.durationMs - timer.elapsedBeforeRunMs);
  const isDue = remainingMs !== null && remainingMs === 0;
  const displaySeconds = remainingMs === null ? Math.floor(elapsedMs / 1000) : Math.ceil(remainingMs / 1000);
  return {
    elapsedMs,
    remainingMs,
    deadlineAtMs,
    isPaused: timer.runningSinceMs === null,
    isDue,
    display: formatHms(displaySeconds),
  };
}

export function isTimerDue(timer: TimerRecord, nowMs: number): boolean {
  return getTimerSnapshot(timer, nowMs).isDue;
}
