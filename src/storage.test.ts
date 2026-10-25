// @ts-nocheck -- Node runs this test directly; the app tsconfig has no Node types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimer } from './timer.ts';
import {
  emptyData,
  parseBackup,
  readData,
  saveData,
  StorageConflictError,
} from './storage.ts';

function mockStorage(t, initialRaw = null) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let raw = initialRaw;
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => key === 'xitomatl:data:v1' ? raw : null,
      setItem: (key, value) => {
        assert.equal(key, 'xitomatl:data:v1');
        raw = value;
        writes += 1;
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  return { get raw() { return raw; }, get writes() { return writes; } };
}

test('damaged JSON remains untouched and is reported to the caller', (t) => {
  const storage = mockStorage(t, '{incomplete');
  const result = readData();
  assert.equal(result.raw, '{incomplete');
  assert.ok(result.error);
  assert.deepEqual(result.data.tasks, []);
  assert.equal(storage.raw, '{incomplete');
  assert.equal(storage.writes, 0);
});

test('an unsupported backup version remains available for recovery', (t) => {
  const raw = JSON.stringify({ ...emptyData(), version: 2 });
  const storage = mockStorage(t, raw);
  const result = readData();
  assert.equal(result.raw, raw);
  assert.match(result.error ?? '', /版本/);
  assert.equal(storage.raw, raw);
  assert.equal(storage.writes, 0);
});

test('backup import rejects an orphan focus session or invalid timer', () => {
  const started = new Date('2026-10-25T09:00:00.000Z');
  const task = { id: 'task-1', title: '写报告', kind: 'open', createdAt: started.toISOString(), updatedAt: started.toISOString(), sop: [] };
  const session = { id: 'session-1', taskId: task.id, startedAt: started.toISOString(), plannedMinutes: 25 };
  const focus = { sessionId: session.id, taskId: task.id, timer: createTimer(started.getTime(), 25 * 60_000), alerted: false };
  const valid = { ...emptyData(), tasks: [task], sessions: [session], activeFocus: focus };
  assert.equal(parseBackup(valid).activeFocus?.sessionId, session.id);
  assert.throws(() => parseBackup({ ...valid, sessions: [] }), /计时状态与任务记录不匹配/);
  assert.throws(() => parseBackup({ ...valid, activeFocus: { ...focus, timer: { ...focus.timer, runningSinceMs: null, pausedAtMs: null } } }), /计时状态格式不正确/);
});

test('a stale tab cannot overwrite a newer saved snapshot', (t) => {
  const storage = mockStorage(t);
  const firstRaw = saveData(emptyData(), null);
  const newer = { ...emptyData(), dayEndedOn: '2026-10-25' };
  const newerRaw = saveData(newer, firstRaw);
  assert.throws(() => saveData(emptyData(), firstRaw), StorageConflictError);
  assert.equal(storage.raw, newerRaw);
  assert.equal(storage.writes, 2);
  assert.equal(readData().data.dayEndedOn, '2026-10-25');
});
