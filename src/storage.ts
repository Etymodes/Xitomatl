import type { FocusSession, Task } from './core/index';
import type { TimerRecord } from './timer';

export type DrawStyle = 'capsule' | 'wheel';
export type Theme = 'tomato' | 'forest' | 'ink';

export interface Settings {
  drawStyle: DrawStyle;
  theme: Theme;
  bell: boolean;
  fullCover: boolean;
  customMinutes: number;
}

export interface ActiveFocus {
  sessionId: string;
  taskId: string;
  timer: TimerRecord;
  alerted: boolean;
  overlayDismissed?: boolean;
  lastHeartbeatAtMs?: number;
  pausedForGap?: boolean;
}

export interface StepEvent {
  taskId: string;
  itemId: string;
  title: string;
  done: boolean;
  at: string;
}

export interface TaskEvent {
  taskId: string;
  kind: 'archive' | 'cycle';
  at: string;
  title: string;
}

export interface AppData {
  version: 1;
  tasks: Task[];
  sessions: FocusSession[];
  stepEvents: StepEvent[];
  taskEvents?: TaskEvent[];
  settings: Settings;
  activeFocus: ActiveFocus | null;
  dayEndedOn: string | null;
}

export const STORAGE_KEY = 'xitomatl:data:v1';

export class StorageConflictError extends Error {
  constructor() {
    super('本地数据已被其他标签页更新，请先重新载入最新数据。');
    this.name = 'StorageConflictError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}

function isTask(value: unknown): value is Task {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id || typeof value.title !== 'string' || !value.title.trim()) return false;
  if (!['daily', 'weekly', 'deadline', 'open', 'planned'].includes(String(value.kind))) return false;
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) || !Array.isArray(value.sop)) return false;
  if (!value.sop.every((item) => isRecord(item) && typeof item.id === 'string' && Boolean(item.id) && typeof item.title === 'string' && (item.completedAt === undefined || isTimestamp(item.completedAt)))) return false;
  if (value.kind === 'deadline' && !isDateKey(value.deadlineDate)) return false;
  if (value.deadlineDate !== undefined && !isDateKey(value.deadlineDate)) return false;
  if (value.estimatedMinutes !== undefined && (!Number.isInteger(value.estimatedMinutes) || (value.estimatedMinutes as number) < 1 || (value.estimatedMinutes as number) > 480)) return false;
  if (value.archivedAt !== undefined && !isTimestamp(value.archivedAt)) return false;
  if (value.completedCycles !== undefined && (!Array.isArray(value.completedCycles) || !value.completedCycles.every(isDateKey))) return false;
  return true;
}

function isSession(value: unknown): value is FocusSession {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id || typeof value.taskId !== 'string' || !value.taskId || !isTimestamp(value.startedAt)) return false;
  if (value.plannedMinutes !== null && (!Number.isInteger(value.plannedMinutes) || (value.plannedMinutes as number) < 1 || (value.plannedMinutes as number) > 480)) return false;
  if (value.endedAt === undefined) {
    if (value.outcome !== undefined || value.actualSeconds !== undefined) return false;
  } else {
    if (!isTimestamp(value.endedAt) || Date.parse(value.endedAt) < Date.parse(value.startedAt)) return false;
    if (!['archive', 'continue', 'end-day'].includes(String(value.outcome))) return false;
  }
  if (value.actualSeconds !== undefined && (!Number.isInteger(value.actualSeconds) || (value.actualSeconds as number) < 0)) return false;
  return true;
}

function isTimer(value: unknown): value is TimerRecord {
  if (!isRecord(value)) return false;
  const finite = (number: unknown): number is number => typeof number === 'number' && Number.isFinite(number);
  if (!finite(value.startedAtMs) || !finite(value.elapsedBeforeRunMs) || value.elapsedBeforeRunMs < 0) return false;
  if (value.durationMs !== null && (!finite(value.durationMs) || value.durationMs < 0)) return false;
  if (value.runningSinceMs !== null && !finite(value.runningSinceMs)) return false;
  if (value.pausedAtMs !== null && !finite(value.pausedAtMs)) return false;
  if ((value.runningSinceMs === null) === (value.pausedAtMs === null)) return false;
  if (value.runningSinceMs !== null && value.runningSinceMs < value.startedAtMs) return false;
  if (value.pausedAtMs !== null && value.pausedAtMs < value.startedAtMs) return false;
  return true;
}

export function emptyData(): AppData {
  return {
    version: 1,
    tasks: [],
    sessions: [],
    stepEvents: [],
    taskEvents: [],
    settings: {
      drawStyle: 'capsule',
      theme: 'tomato',
      bell: true,
      fullCover: true,
      customMinutes: 30,
    },
    activeFocus: null,
    dayEndedOn: null,
  };
}

export function parseBackup(value: unknown): AppData {
  if (!isRecord(value)) throw new Error('文件不是有效的时茄备份。');
  const input = value as Partial<AppData>;
  if (input.version !== 1 || !Array.isArray(input.tasks) || !Array.isArray(input.sessions)) {
    throw new Error('备份版本或内容不受支持。');
  }
  if (!input.tasks.every(isTask) || !input.sessions.every(isSession) ||
      new Set(input.tasks.map((task) => task.id)).size !== input.tasks.length ||
      new Set(input.sessions.map((session) => session.id)).size !== input.sessions.length) {
    throw new Error('备份中的任务或专注记录格式不正确。');
  }
  if (input.stepEvents !== undefined && (!Array.isArray(input.stepEvents) || !input.stepEvents.every((event) => isRecord(event) && typeof event.taskId === 'string' && typeof event.itemId === 'string' && typeof event.title === 'string' && typeof event.done === 'boolean' && isTimestamp(event.at)))) {
    throw new Error('备份中的步骤记录格式不正确。');
  }
  if (input.taskEvents !== undefined && (!Array.isArray(input.taskEvents) || !input.taskEvents.every((event) => isRecord(event) && typeof event.taskId === 'string' && typeof event.title === 'string' && (event.kind === 'archive' || event.kind === 'cycle') && isTimestamp(event.at)))) {
    throw new Error('备份中的任务事件格式不正确。');
  }
  if (input.settings !== undefined && !isRecord(input.settings)) throw new Error('备份中的设置格式不正确。');
  if (input.dayEndedOn !== undefined && input.dayEndedOn !== null && !isDateKey(input.dayEndedOn)) throw new Error('备份中的日期格式不正确。');
  if (input.activeFocus !== undefined && input.activeFocus !== null) {
    const focus = input.activeFocus;
    if (!isRecord(focus) || typeof focus.sessionId !== 'string' || typeof focus.taskId !== 'string' ||
        typeof focus.alerted !== 'boolean' || (focus.overlayDismissed !== undefined && typeof focus.overlayDismissed !== 'boolean') ||
        !isTimer(focus.timer) ||
        (focus.lastHeartbeatAtMs !== undefined && (typeof focus.lastHeartbeatAtMs !== 'number' || !Number.isFinite(focus.lastHeartbeatAtMs) || focus.lastHeartbeatAtMs < focus.timer.startedAtMs)) ||
        (focus.pausedForGap !== undefined && typeof focus.pausedForGap !== 'boolean')) {
      throw new Error('备份中的计时状态格式不正确。');
    }
    const session = input.sessions.find((item) => item.id === focus.sessionId && item.taskId === focus.taskId && !item.endedAt);
    if (!input.tasks.some((task) => task.id === focus.taskId) || !session ||
        Date.parse(session.startedAt) !== focus.timer.startedAtMs ||
        focus.timer.durationMs !== (session.plannedMinutes === null ? null : session.plannedMinutes * 60_000)) {
      throw new Error('备份中的计时状态与任务记录不匹配。');
    }
  }
  const defaults = emptyData();
  const settings = input.settings ?? defaults.settings;
  return {
    version: 1,
    tasks: input.tasks,
    sessions: input.sessions,
    stepEvents: input.stepEvents ?? [],
    taskEvents: input.taskEvents ?? [],
    settings: {
      drawStyle: settings.drawStyle === 'wheel' ? 'wheel' : 'capsule',
      theme: settings.theme === 'forest' || settings.theme === 'ink' ? settings.theme : 'tomato',
      bell: settings.bell !== false,
      fullCover: settings.fullCover !== false,
      customMinutes: Number.isInteger(settings.customMinutes) && settings.customMinutes >= 1 && settings.customMinutes <= 480 ? settings.customMinutes : 30,
    },
    activeFocus: input.activeFocus ?? null,
    dayEndedOn: input.dayEndedOn ?? null,
  };
}

export function readData(): { data: AppData; raw: string | null; error: string | null } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { data: emptyData(), raw, error: '无法读取本地数据。请检查浏览器存储权限。' };
  }
  if (raw === null) return { data: emptyData(), raw: null, error: null };
  try {
    return { data: parseBackup(JSON.parse(raw)), raw, error: null };
  } catch (error) {
    return { data: emptyData(), raw, error: error instanceof Error ? error.message : '本地数据无法解析。' };
  }
}

/** Compatibility reader. Never turn damaged storage into writable empty data. */
export function loadData(): AppData {
  const result = readData();
  if (result.error) throw new Error(result.error);
  return result.data;
}

export function saveData(data: AppData, expectedRaw: string | null): string {
  if (localStorage.getItem(STORAGE_KEY) !== expectedRaw) throw new StorageConflictError();
  const raw = JSON.stringify(data);
  localStorage.setItem(STORAGE_KEY, raw);
  return raw;
}

export function downloadBackup(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `xitomatl-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
