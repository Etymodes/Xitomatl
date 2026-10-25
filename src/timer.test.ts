// @ts-nocheck -- Node runs this file directly; app typechecking excludes Node declarations.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimer, formatHms, getTimerSnapshot, isTimerDue, pauseAfterInactiveGap, pauseTimer, resumeTimer } from './timer.ts';

test('a closed or sleeping app excludes a long inactive gap from recorded focus', () => {
  const running = createTimer(1_000, 25 * 60_000);
  assert.equal(pauseAfterInactiveGap(running, 6_000, 16_000), running);
  const paused = pauseAfterInactiveGap(running, 6_000, 86_000);
  assert.equal(getTimerSnapshot(paused, 86_000).elapsedMs, 5_000);
  assert.equal(getTimerSnapshot(paused, 86_000).isPaused, true);
  const resumed = resumeTimer(paused, 86_000);
  assert.equal(getTimerSnapshot(resumed, 91_000).elapsedMs, 10_000);
});

test('count-up display uses elapsed wall-clock time and grows past 24 hours', () => {
  const timer = createTimer(1_000, null);
  assert.deepEqual(getTimerSnapshot(timer, 1_999), {
    elapsedMs: 999,
    remainingMs: null,
    deadlineAtMs: null,
    isPaused: false,
    isDue: false,
    display: '00:00:00',
  });
  assert.equal(getTimerSnapshot(timer, 1_000 + 25 * 60 * 60 * 1000 + 1_000).display, '25:00:01');
  assert.equal(isTimerDue(timer, 999_999), false);
});

test('countdown rounds remaining display upward until its exact deadline', () => {
  const timer = createTimer(10_000, 15_000);
  assert.equal(getTimerSnapshot(timer, 10_000).display, '00:00:15');
  assert.equal(getTimerSnapshot(timer, 24_999).display, '00:00:01');
  assert.equal(getTimerSnapshot(timer, 24_999).deadlineAtMs, 25_000);
  assert.equal(isTimerDue(timer, 24_999), false);
  assert.equal(getTimerSnapshot(timer, 25_000).display, '00:00:00');
  assert.equal(isTimerDue(timer, 25_000), true);
  assert.equal(getTimerSnapshot(timer, 30_000).remainingMs, 0);
});

test('pause freezes count-up time and resume excludes paused wall-clock time', () => {
  const started = createTimer(1_000, null);
  const paused = pauseTimer(started, 5_000);
  assert.equal(getTimerSnapshot(paused, 100_000).display, '00:00:04');
  assert.equal(getTimerSnapshot(paused, 100_000).isPaused, true);
  const resumed = resumeTimer(paused, 100_000);
  assert.equal(getTimerSnapshot(resumed, 103_000).display, '00:00:07');
  assert.equal(started.elapsedBeforeRunMs, 0);
});

test('pause and resume shift a countdown deadline by the pause length', () => {
  const started = createTimer(10_000, 25_000);
  const paused = pauseTimer(started, 15_000);
  assert.equal(getTimerSnapshot(paused, 100_000).remainingMs, 20_000);
  assert.equal(getTimerSnapshot(paused, 100_000).deadlineAtMs, null);
  assert.equal(isTimerDue(paused, 100_000), false);
  const resumed = resumeTimer(paused, 100_000);
  assert.equal(getTimerSnapshot(resumed, 100_000).deadlineAtMs, 120_000);
  assert.equal(getTimerSnapshot(resumed, 119_999).display, '00:00:01');
  assert.equal(isTimerDue(resumed, 120_000), true);
});

test('countdown keeps actual focus time after it reaches zero, including pauses', () => {
  const started = createTimer(1_000, 3_000);
  const overdue = getTimerSnapshot(started, 5_500);
  assert.equal(overdue.elapsedMs, 4_500);
  assert.equal(overdue.remainingMs, 0);
  assert.equal(overdue.display, '00:00:00');
  assert.equal(overdue.isDue, true);

  const paused = pauseTimer(started, 6_000);
  assert.equal(paused.elapsedBeforeRunMs, 5_000);
  assert.equal(getTimerSnapshot(paused, 20_000).elapsedMs, 5_000);
  const resumed = resumeTimer(paused, 20_000);
  const later = getTimerSnapshot(JSON.parse(JSON.stringify(resumed)), 22_000);
  assert.equal(later.elapsedMs, 7_000);
  assert.equal(later.remainingMs, 0);
  assert.equal(later.display, '00:00:00');
  assert.equal(later.isDue, true);
});

test('JSON round-trip restores both running and paused timers without drift', () => {
  const running = createTimer(1_000, 25_000);
  const storedRunning = JSON.parse(JSON.stringify(running));
  assert.equal(getTimerSnapshot(storedRunning, 11_000).remainingMs, 15_000);

  const paused = pauseTimer(running, 6_000);
  const storedPaused = JSON.parse(JSON.stringify(paused));
  assert.equal(getTimerSnapshot(storedPaused, 60_000).remainingMs, 20_000);
  assert.equal(getTimerSnapshot(resumeTimer(storedPaused, 60_000), 60_000).deadlineAtMs, 80_000);
});

test('repeated pause and resume calls are harmless and records stay immutable', () => {
  const started = createTimer(0, 10_000);
  const paused = pauseTimer(started, 2_000);
  assert.equal(pauseTimer(paused, 5_000), paused);
  const resumed = resumeTimer(paused, 5_000);
  assert.equal(resumeTimer(resumed, 8_000), resumed);
  assert.equal(getTimerSnapshot(started, 5_000).display, '00:00:05');
  assert.equal(getTimerSnapshot(resumed, 5_000).display, '00:00:08');
});

test('zero duration is immediately due and formatting handles long durations', () => {
  assert.equal(isTimerDue(createTimer(1_000, 0), 1_000), true);
  assert.equal(formatHms(3661), '01:01:01');
  assert.equal(formatHms(360_000), '100:00:00');
  assert.throws(() => createTimer(0, -1), RangeError);
  assert.throws(() => formatHms(Infinity), RangeError);
});
