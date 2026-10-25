// @ts-nocheck -- Node runs this file directly; app typechecking excludes Node declarations.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeTaskCycle,
  drawTask,
  finishSession,
  getDrawCandidates,
  isTaskEligible,
  localDateKey,
  recommendDuration,
  setSopItemDone,
  startSession,
  summarizeDay,
  undoTaskCycle,
} from './index.ts';
import type { FocusSession, Task, TaskKind } from './index.ts';

function task(id: string, kind: TaskKind, changes: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    kind,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    sop: [],
    ...changes,
  };
}

test('SOP items toggle immutably and retain their original completion time', () => {
  const original = task('a', 'open', { sop: [{ id: 'step', title: '第一步' }] });
  const now = new Date('2026-10-25T09:00:00.000Z');
  const done = setSopItemDone(original, 'step', true, now);
  assert.equal(original.sop[0].completedAt, undefined);
  assert.equal(done.sop[0].completedAt, now.toISOString());
  assert.equal(setSopItemDone(done, 'step', true, new Date('2026-10-26T00:00:00Z')).sop[0].completedAt, now.toISOString());
  assert.equal(setSopItemDone(done, 'step', false, now).sop[0].completedAt, undefined);
});

test('daily and weekly completion can be undone and recur in their next local period', () => {
  const daily = task('daily', 'daily');
  const weekly = task('weekly', 'weekly');
  const sunday = new Date(2026, 9, 25, 12);
  const monday = new Date(2026, 9, 26, 12);
  const completedDaily = completeTaskCycle(daily, sunday);
  const completedWeekly = completeTaskCycle(weekly, sunday);
  assert.deepEqual(completedDaily.completedCycles, ['2026-10-25']);
  assert.deepEqual(completedWeekly.completedCycles, ['2026-10-19']);
  assert.equal(isTaskEligible(completedDaily, [], sunday), false);
  assert.equal(isTaskEligible(completedWeekly, [], sunday), false);
  assert.equal(isTaskEligible(undoTaskCycle(completedDaily, sunday), [], sunday), true);
  assert.equal(isTaskEligible(undoTaskCycle(completedWeekly, sunday), [], sunday), true);
  assert.equal(isTaskEligible(completedDaily, [], monday), true);
  assert.equal(isTaskEligible(completedWeekly, [], monday), true);
  assert.equal(localDateKey(monday), '2026-10-26');
});

test('planned and archived tasks are never drawn', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const candidates = getDrawCandidates([
    task('plan', 'planned'),
    task('archived', 'open', { archivedAt: now.toISOString() }),
    task('ready', 'open'),
  ], [], now);
  assert.deepEqual(candidates.map((candidate) => candidate.task.id), ['ready']);
});

test('deadline and idle boosts remain bounded and explain the draw', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const candidates = getDrawCandidates([
    task('normal', 'open', { createdAt: now.toISOString() }),
    task('due', 'deadline', { deadlineDate: '2026-10-25' }),
    task('overdue', 'deadline', { deadlineDate: '2026-10-20' }),
  ], [], now);
  assert.equal(candidates[0].weight, 1);
  assert.ok(candidates[1].weight > candidates[0].weight);
  assert.ok(candidates[2].weight > candidates[1].weight);
  assert.ok(candidates[2].weight <= 2.85);
  assert.match(candidates[1].reasons.join(' '), /今日截止/);
});

test('weighted selection is deterministic at its boundaries', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const candidates = getDrawCandidates([
    task('first', 'open', { createdAt: now.toISOString() }),
    task('second', 'open', { createdAt: now.toISOString() }),
  ], [], now);
  assert.equal(drawTask(candidates, 0)?.task.id, 'first');
  assert.equal(drawTask(candidates, 0.5)?.task.id, 'second');
  assert.equal(drawTask([], 0.5), null);
  assert.throws(() => drawTask(candidates, 1), RangeError);
});

test('duration advice uses successful sessions and allows user override', () => {
  const item = task('a', 'open', { estimatedMinutes: 45 });
  const started = startSession('s', 'a', 25, new Date('2026-10-25T09:00:00Z'));
  const finished = finishSession(started, item, 'end-day', new Date('2026-10-25T09:18:00Z'));
  assert.deepEqual(recommendDuration(item, [], undefined).minutes, 45);
  assert.equal(recommendDuration(item, [finished.session]).minutes, 15);
  assert.deepEqual(recommendDuration(item, [finished.session], null), {
    minutes: null,
    source: 'user',
    explanation: '由你选择不定时',
  });
  assert.equal(recommendDuration(item, [finished.session], 37).minutes, 37);
});

test('finishing a recurring session resets its SOP and builds a daily summary', () => {
  const original = task('routine', 'daily', { sop: [{ id: 'step', title: '准备', completedAt: '2026-10-25T09:01:00Z' }] });
  const started = startSession('s', 'routine', 25, new Date('2026-10-25T09:00:00Z'));
  const result = finishSession(started, original, 'end-day', new Date('2026-10-25T09:25:00Z'));
  assert.equal(result.task.sop[0].completedAt, undefined);
  assert.deepEqual(result.task.completedCycles, [localDateKey(new Date('2026-10-25T09:25:00Z'))]);
  assert.equal(original.sop[0].completedAt, '2026-10-25T09:01:00Z');
  const summary = summarizeDay('2026-10-25', [result.task], [result.session]);
  assert.equal(summary.focusSeconds, 1500);
  assert.equal(summary.sessionCount, 1);
  assert.equal(summary.taskCount, 1);
  assert.equal(summary.endedDay, true);
  assert.equal(summary.tasks[0].title, 'routine');
});

test('archiving ends eligibility and is reflected in the summary', () => {
  const original = task('once', 'deadline', { deadlineDate: '2026-10-26' });
  const started = startSession('s', 'once', null, new Date('2026-10-25T10:00:00Z'));
  const result = finishSession(started, original, 'archive', new Date('2026-10-25T10:30:00Z'));
  assert.equal(isTaskEligible(result.task, [result.session], new Date('2026-10-26T10:00:00Z')), false);
  assert.deepEqual(summarizeDay('2026-10-25', [result.task], [result.session]).archivedTaskIds, ['once']);
  const restored = { ...result.task, archivedAt: undefined };
  assert.equal(isTaskEligible(restored, [result.session], new Date('2026-10-26T10:00:00Z')), true);
});

test('daily summary uses measured focus time and includes direct task-list archives', () => {
  const date = new Date(2026, 9, 25, 12);
  const dateKey = localDateKey(date);
  const session: FocusSession = {
    id: 'paused',
    taskId: 'worked',
    startedAt: new Date(2026, 9, 25, 9).toISOString(),
    endedAt: new Date(2026, 9, 25, 10).toISOString(),
    plannedMinutes: 25,
    actualSeconds: 900,
    outcome: 'continue',
  };
  const archived = task('direct', 'open', { archivedAt: date.toISOString() });
  const summary = summarizeDay(dateKey, [task('worked', 'open'), archived], [session]);
  assert.equal(summary.focusSeconds, 900);
  assert.equal(summary.sessionCount, 1);
  assert.equal(summary.taskCount, 2);
  assert.deepEqual(summary.archivedTaskIds, ['direct']);
  assert.deepEqual(summary.tasks.find((item) => item.taskId === 'direct'), {
    taskId: 'direct', title: 'direct', focusSeconds: 0, sessionCount: 0,
  });
});
