/** Domain logic for Xitomatl. Dates are local to the user's device. */

export type TaskKind = 'daily' | 'weekly' | 'deadline' | 'open' | 'planned';

export interface SopItem {
  id: string;
  title: string;
  completedAt?: string;
}

export interface Task {
  id: string;
  title: string;
  kind: TaskKind;
  createdAt: string;
  updatedAt: string;
  sop: SopItem[];
  /** Local calendar date, YYYY-MM-DD. Required when kind is deadline. */
  deadlineDate?: string;
  estimatedMinutes?: number;
  archivedAt?: string;
  /** Local day keys for daily tasks; Monday keys for weekly tasks. */
  completedCycles?: string[];
}

export type SessionOutcome = 'archive' | 'continue' | 'end-day';

export interface FocusSession {
  id: string;
  taskId: string;
  startedAt: string;
  /** null means count up without a time limit. */
  plannedMinutes: number | null;
  endedAt?: string;
  outcome?: SessionOutcome;
  /** Measured focus time, excluding pauses; takes precedence over wall time. */
  actualSeconds?: number;
}

export interface DrawCandidate {
  task: Task;
  weight: number;
  reasons: string[];
}

export interface DurationChoice {
  minutes: number | null;
  source: 'user' | 'history' | 'estimate' | 'default';
  explanation: string;
}

export interface DailyTaskSummary {
  taskId: string;
  title: string;
  focusSeconds: number;
  sessionCount: number;
}

export interface DailySummary {
  date: string;
  focusSeconds: number;
  sessionCount: number;
  taskCount: number;
  archivedTaskIds: string[];
  endedDay: boolean;
  tasks: DailyTaskSummary[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STANDARD_DURATIONS = [15, 25, 45] as const;

/** YYYY-MM-DD in the device's local time zone. */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localWeekKey(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return localDateKey(monday);
}

function validDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

function daysUntil(dateKey: string, now: Date): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const due = Date.UTC(year, month - 1, day);
  if (new Date(due).toISOString().slice(0, 10) !== dateKey) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / DAY_MS);
}

/** Toggle a checklist item without mutating the stored task. */
export function setSopItemDone(task: Task, itemId: string, done: boolean, now: Date): Task {
  if (!task.sop.some((item) => item.id === itemId)) return task;
  const timestamp = now.toISOString();
  return {
    ...task,
    updatedAt: timestamp,
    sop: task.sop.map((item) =>
      item.id === itemId
        ? { ...item, completedAt: done ? (item.completedAt ?? timestamp) : undefined }
        : item,
    ),
  };
}

function cycleKey(task: Task, now: Date): string | null {
  if (task.kind === 'daily') return localDateKey(now);
  if (task.kind === 'weekly') return localWeekKey(now);
  return null;
}

/** Complete a recurring task's current local day or Monday-based week. */
export function completeTaskCycle(task: Task, now: Date): Task {
  const key = cycleKey(task, now);
  if (!key || task.completedCycles?.includes(key)) return task;
  return {
    ...task,
    updatedAt: now.toISOString(),
    completedCycles: [...(task.completedCycles ?? []), key],
    sop: task.sop.map((item) => ({ ...item, completedAt: undefined })),
  };
}

/** Undo the current cycle's completion; a reset SOP stays reset. */
export function undoTaskCycle(task: Task, now: Date): Task {
  const key = cycleKey(task, now);
  if (!key || !task.completedCycles?.includes(key)) return task;
  return {
    ...task,
    updatedAt: now.toISOString(),
    completedCycles: task.completedCycles.filter((completed) => completed !== key),
  };
}

/** A daily task recurs each day; a weekly task recurs each Monday. */
export function isTaskEligible(task: Task, _sessions: FocusSession[], now: Date): boolean {
  if (task.archivedAt || task.kind === 'planned') return false;
  const key = cycleKey(task, now);
  return !key || !task.completedCycles?.includes(key);
}

/** Weight is capped so an overdue task cannot monopolize every draw. */
export function getDrawCandidates(tasks: Task[], sessions: FocusSession[], now: Date): DrawCandidate[] {
  return tasks.filter((task) => isTaskEligible(task, sessions, now)).map((task) => {
    let weight = 1;
    const reasons = ['基础权重 1'];
    const lastTouch = sessions
      .filter((session) => session.taskId === task.id)
      .map((session) => validDate(session.endedAt ?? session.startedAt)?.getTime() ?? NaN)
      .filter(Number.isFinite)
      .reduce((latest, timestamp) => Math.max(latest, timestamp), validDate(task.createdAt)?.getTime() ?? now.getTime());
    const idleDays = Math.max(0, Math.floor((now.getTime() - lastTouch) / DAY_MS));
    const idleBoost = Math.min(0.65, idleDays * 0.05);
    if (idleBoost > 0) {
      weight += idleBoost;
      reasons.push(`距上次触达 ${idleDays} 天，权重 +${idleBoost.toFixed(2)}`);
    }

    if (task.kind === 'deadline' && task.deadlineDate) {
      const daysLeft = daysUntil(task.deadlineDate, now);
      const dueBoost = daysLeft === null ? 0 : daysLeft < 0 ? 1.2 : daysLeft === 0 ? 0.9 : daysLeft <= 2 ? 0.5 : daysLeft <= 6 ? 0.2 : 0;
      if (dueBoost > 0) {
        weight += dueBoost;
        const description = daysLeft! < 0 ? `已逾期 ${-daysLeft!} 天` : daysLeft === 0 ? '今日截止' : `距截止 ${daysLeft} 天`;
        reasons.push(`${description}，权重 +${dueBoost.toFixed(2)}`);
      }
    }
    return { task, weight: Math.round(weight * 100) / 100, reasons };
  });
}

/** Pass a roll from Math.random() in the UI; the selection itself stays deterministic. */
export function drawTask(candidates: DrawCandidate[], roll: number): DrawCandidate | null {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new RangeError('roll must be in [0, 1)');
  }
  const positive = candidates.filter((candidate) => candidate.weight > 0 && Number.isFinite(candidate.weight));
  if (positive.length === 0) return null;
  const total = positive.reduce((sum, candidate) => sum + candidate.weight, 0);
  let target = roll * total;
  for (const candidate of positive) {
    target -= candidate.weight;
    if (target < 0) return candidate;
  }
  return positive[positive.length - 1];
}

function nearestStandard(minutes: number): number {
  return STANDARD_DURATIONS.reduce((best, option) =>
    Math.abs(option - minutes) < Math.abs(best - minutes) ? option : best,
  );
}

function elapsedSeconds(session: FocusSession): number {
  if (!session.endedAt) return 0;
  if (session.actualSeconds !== undefined && Number.isFinite(session.actualSeconds) && session.actualSeconds >= 0) {
    return Math.floor(session.actualSeconds);
  }
  const start = validDate(session.startedAt)?.getTime();
  const end = validDate(session.endedAt)?.getTime();
  if (start === undefined || end === undefined) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

/** Recent completed sessions inform a suggestion; any explicit user choice wins. */
export function recommendDuration(task: Task, sessions: FocusSession[], overrideMinutes?: number | null): DurationChoice {
  if (overrideMinutes !== undefined) {
    if (overrideMinutes !== null && (!Number.isInteger(overrideMinutes) || overrideMinutes < 1 || overrideMinutes > 480)) {
      throw new RangeError('duration must be 1–480 minutes or null');
    }
    return { minutes: overrideMinutes, source: 'user', explanation: overrideMinutes === null ? '由你选择不定时' : `由你选择 ${overrideMinutes} 分钟` };
  }

  const history = sessions
    .filter((session) => session.taskId === task.id && (session.outcome === 'end-day' || session.outcome === 'archive'))
    .slice(-5)
    .map((session) => elapsedSeconds(session) / 60)
    .filter((minutes) => minutes >= 5 && minutes <= 120)
    .sort((a, b) => a - b);
  if (history.length > 0) {
    const middle = Math.floor(history.length / 2);
    const median = history.length % 2 ? history[middle] : (history[middle - 1] + history[middle]) / 2;
    const minutes = nearestStandard(median);
    return { minutes, source: 'history', explanation: `参考最近 ${history.length} 次完成时长的中位数，建议 ${minutes} 分钟` };
  }
  if (task.estimatedMinutes && Number.isFinite(task.estimatedMinutes) && task.estimatedMinutes > 0) {
    const minutes = nearestStandard(task.estimatedMinutes);
    return { minutes, source: 'estimate', explanation: `参考任务预计时长，建议 ${minutes} 分钟` };
  }
  return { minutes: 25, source: 'default', explanation: '暂无任务时长记录，先建议 25 分钟' };
}

/** IDs are supplied by the caller so this function has no clock or randomness side effects. */
export function startSession(id: string, taskId: string, plannedMinutes: number | null, now: Date): FocusSession {
  if (plannedMinutes !== null && (!Number.isInteger(plannedMinutes) || plannedMinutes < 1 || plannedMinutes > 480)) {
    throw new RangeError('duration must be 1–480 minutes or null');
  }
  return { id, taskId, plannedMinutes, startedAt: now.toISOString() };
}

export function finishSession(session: FocusSession, task: Task, outcome: SessionOutcome, now: Date): { session: FocusSession; task: Task } {
  if (session.taskId !== task.id) throw new Error('session and task must match');
  if (session.endedAt) throw new Error('session is already finished');
  if (now.getTime() < new Date(session.startedAt).getTime()) throw new RangeError('end must follow start');
  const timestamp = now.toISOString();
  const updatedTask: Task = {
    ...task,
    updatedAt: timestamp,
    archivedAt: outcome === 'archive' ? timestamp : task.archivedAt,
  };
  const nextTask = outcome === 'end-day' ? completeTaskCycle(updatedTask, now) : updatedTask;
  return { session: { ...session, endedAt: timestamp, outcome }, task: nextTask };
}

/** Finished sessions are attributed to their local end date. */
export function summarizeDay(date: string, tasks: Task[], sessions: FocusSession[]): DailySummary {
  const selected = sessions.filter((session) => {
    const ended = session.endedAt && validDate(session.endedAt);
    return ended && localDateKey(ended) === date;
  });
  const taskNames = new Map(tasks.map((task) => [task.id, task.title]));
  const taskMap = new Map<string, DailyTaskSummary>();
  const archivedTaskIds = new Set<string>();
  for (const session of selected) {
    const previous = taskMap.get(session.taskId) ?? {
      taskId: session.taskId,
      title: taskNames.get(session.taskId) ?? session.taskId,
      focusSeconds: 0,
      sessionCount: 0,
    };
    previous.focusSeconds += elapsedSeconds(session);
    previous.sessionCount += 1;
    taskMap.set(session.taskId, previous);
    if (session.outcome === 'archive') archivedTaskIds.add(session.taskId);
  }
  for (const task of tasks) {
    const archived = task.archivedAt && validDate(task.archivedAt);
    if (!archived || localDateKey(archived) !== date) continue;
    archivedTaskIds.add(task.id);
    if (!taskMap.has(task.id)) {
      taskMap.set(task.id, { taskId: task.id, title: task.title, focusSeconds: 0, sessionCount: 0 });
    }
  }
  const taskSummaries = [...taskMap.values()];
  return {
    date,
    focusSeconds: taskSummaries.reduce((sum, item) => sum + item.focusSeconds, 0),
    sessionCount: selected.length,
    taskCount: taskSummaries.length,
    archivedTaskIds: [...archivedTaskIds],
    endedDay: selected.some((session) => session.outcome === 'end-day'),
    tasks: taskSummaries,
  };
}
