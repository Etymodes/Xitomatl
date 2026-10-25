import { useEffect, useMemo, useRef, useState } from 'react';
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
  type DrawCandidate,
  type SessionOutcome,
  type Task,
  type TaskKind,
} from './core/index';
import { createTimer, getTimerSnapshot, pauseTimer, pauseAfterInactiveGap, resumeTimer, formatHms } from './timer';
import { downloadBackup, emptyData, parseBackup, readData, saveData, STORAGE_KEY, StorageConflictError, type AppData, type DrawStyle, type Theme } from './storage';

type Page = 'tasks' | 'draw' | 'focus' | 'summary' | 'settings';
type TaskFilter = 'today' | 'all' | 'planned' | 'archived';

const kindNames: Record<TaskKind, string> = {
  daily: '每日任务',
  weekly: '每周任务',
  deadline: '限期任务',
  open: '单次任务',
  planned: '长期计划',
};

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const prettyDate = (value: Date) => value.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const initialRead = (() => {
  const result = readData();
  const focus = result.data.activeFocus;
  if (!result.error && focus?.lastHeartbeatAtMs !== undefined) {
    const recoveredTimer = pauseAfterInactiveGap(focus.timer, focus.lastHeartbeatAtMs, Date.now());
    if (recoveredTimer !== focus.timer) {
      result.data = { ...result.data, activeFocus: { ...focus, timer: recoveredTimer, pausedForGap: true } };
    }
  }
  return result;
})();

function deadlineText(task: Task, today: string): string | null {
  if (!task.deadlineDate) return null;
  if (task.deadlineDate < today) return `已逾期 · ${task.deadlineDate}`;
  if (task.deadlineDate === today) return '今天截止';
  return `${task.deadlineDate} 截止`;
}

function playBell(existingContext?: AudioContext | null): void {
  try {
    const context = existingContext ?? new AudioContext();
    void context.resume().then(() => {
      [0, 0.28, 0.56].forEach((offset) => {
        const oscillator = context.createOscillator();
        const volume = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 740;
        volume.gain.setValueAtTime(0.0001, context.currentTime + offset);
        volume.gain.exponentialRampToValueAtTime(0.18, context.currentTime + offset + 0.02);
        volume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.23);
        oscillator.connect(volume).connect(context.destination);
        oscillator.start(context.currentTime + offset);
        oscillator.stop(context.currentTime + offset + 0.24);
      });
      if (!existingContext) window.setTimeout(() => void context.close(), 1200);
    });
  } catch {
    // Visible reminder remains available if the browser blocks audio.
  }
}

function TaskEditor({ initial, onClose, onSave }: { initial: Task | null; onClose: () => void; onSave: (task: Task) => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [kind, setKind] = useState<TaskKind>(initial?.kind ?? 'open');
  const [deadlineDate, setDeadlineDate] = useState(initial?.deadlineDate ?? '');
  const [estimate, setEstimate] = useState(initial?.estimatedMinutes?.toString() ?? '');
  const [steps, setSteps] = useState(initial?.sop.map((item) => item.title).join('\n') ?? '');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || (kind === 'deadline' && !deadlineDate)) return;
    const now = new Date().toISOString();
    const existing = initial?.sop ?? [];
    const used = new Set<string>();
    const sop = steps.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const match = existing.find((item) => item.title === line && !used.has(item.id));
      if (match) {
        used.add(match.id);
        return match;
      }
      return { id: makeId(), title: line };
    });
    const minutes = Number(estimate);
    onSave({
      id: initial?.id ?? makeId(),
      title: cleanTitle,
      kind,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
      archivedAt: initial?.archivedAt,
      completedCycles: initial?.kind === kind ? initial?.completedCycles : undefined,
      deadlineDate: kind === 'deadline' ? deadlineDate : undefined,
      estimatedMinutes: estimate && Number.isFinite(minutes) && minutes > 0 ? Math.min(480, Math.round(minutes)) : undefined,
      sop,
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal editor" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="modal-heading">
          <div><span className="eyebrow">任务卡片</span><h2 id="editor-title">{initial ? '编辑任务' : '登记新任务'}</h2></div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit}>
          <label className="field">任务名称<input autoFocus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：整理本周的项目笔记" /></label>
          <div className="form-grid">
            <label className="field">任务类型
              <select value={kind} onChange={(event) => setKind(event.target.value as TaskKind)}>
                {Object.entries(kindNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            {kind === 'deadline' ? <label className="field">截止日期<input required type="date" value={deadlineDate} onChange={(event) => setDeadlineDate(event.target.value)} /></label> :
              <label className="field">预计分钟数 <span className="field-hint">可不填</span><input min="1" max="480" type="number" value={estimate} onChange={(event) => setEstimate(event.target.value)} placeholder="例如 30" /></label>}
          </div>
          {kind === 'deadline' && <label className="field">预计分钟数 <span className="field-hint">可不填</span><input min="1" max="480" type="number" value={estimate} onChange={(event) => setEstimate(event.target.value)} placeholder="例如 30" /></label>}
          <label className="field">SOP 小任务 <span className="field-hint">每行一项，之后可逐项勾选</span><textarea rows={5} value={steps} onChange={(event) => setSteps(event.target.value)} placeholder={'准备资料\n写出初稿\n复查并提交'} /></label>
          <div className="modal-actions"><button className="button ghost" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit">保存任务</button></div>
        </form>
      </section>
    </div>
  );
}

function TaskCard({ task, today, eligible, startBlocked, onToggleStep, onEdit, onStart, onArchive, onRestore, onActivate, onCycle }: {
  task: Task;
  today: string;
  eligible: boolean;
  startBlocked: boolean;
  onToggleStep: (task: Task, itemId: string, done: boolean) => void;
  onEdit: (task: Task) => void;
  onStart: (task: Task) => void;
  onArchive: (task: Task) => void;
  onRestore: (task: Task) => void;
  onActivate: (task: Task) => void;
  onCycle: (task: Task, complete: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const done = task.sop.filter((item) => item.completedAt).length;
  const deadline = deadlineText(task, today);
  return (
    <article className={`task-card ${task.archivedAt ? 'is-archived' : ''}`}>
      <div className="task-card-main">
        <div className="task-card-copy">
          <div className="task-meta"><span className="kind-pill">{kindNames[task.kind]}</span>{deadline && <span className={task.deadlineDate && task.deadlineDate <= today ? 'deadline urgent' : 'deadline'}>{deadline}</span>}{!eligible && !task.archivedAt && task.kind !== 'planned' && <span className="muted-tag">本轮已完成</span>}</div>
          <h3>{task.title}</h3>
          {task.sop.length > 0 && <button className="steps-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>步骤 {done}/{task.sop.length} <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span></button>}
        </div>
        <div className="task-actions">
          {!task.archivedAt && task.kind !== 'planned' && eligible && <button className="button small primary" disabled={startBlocked} onClick={() => onStart(task)}>开始</button>}
          {!task.archivedAt && task.kind === 'planned' && <button className="button small secondary" onClick={() => onActivate(task)}>移入待办</button>}
          {!task.archivedAt && (task.kind === 'daily' || task.kind === 'weekly') && <button className="text-button" onClick={() => onCycle(task, eligible)}>{eligible ? '完成本轮' : '撤销本轮'}</button>}
          {task.archivedAt ? <button className="text-button" onClick={() => onRestore(task)}>恢复</button> : <button className="text-button" onClick={() => onEdit(task)}>编辑</button>}
          {!task.archivedAt && <button className="text-button" onClick={() => onArchive(task)}>归档</button>}
        </div>
      </div>
      {expanded && task.sop.length > 0 && <ul className="steps-list">
        {task.sop.map((item) => <li key={item.id}><label><input type="checkbox" checked={Boolean(item.completedAt)} disabled={Boolean(task.archivedAt)} onChange={(event) => onToggleStep(task, item.id, event.target.checked)} /><span className={item.completedAt ? 'done' : ''}>{item.title}</span></label></li>)}
      </ul>}
    </article>
  );
}

function EndActions({ onEnd }: { onEnd: (outcome: SessionOutcome) => void }) {
  return <div className="end-actions">
    <button className="button secondary" onClick={() => onEnd('continue')}>结束本次</button>
    <button className="button secondary" onClick={() => onEnd('end-day')}>结束当日</button>
    <button className="button primary" onClick={() => onEnd('archive')}>任务归档</button>
  </div>;
}

export default function App() {
  const [data, setData] = useState<AppData>(initialRead.data);
  const [page, setPage] = useState<Page>(() => initialRead.data.activeFocus ? 'focus' : 'tasks');
  const [loadError, setLoadError] = useState(initialRead.error);
  const [storageError, setStorageError] = useState('');
  const [writeConflict, setWriteConflict] = useState(false);
  const lastSavedRaw = useRef<string | null>(initialRead.raw);
  const [filter, setFilter] = useState<TaskFilter>('today');
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [selected, setSelected] = useState<DrawCandidate | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [duration, setDuration] = useState<number | null>(25);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState('');
  const [summaryDate, setSummaryDate] = useState(localDateKey(new Date()));
  const importRef = useRef<HTMLInputElement>(null);
  const bellPlayedFor = useRef<string | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const drawTimeout = useRef<number | null>(null);
  const pendingDraw = useRef<DrawCandidate | null>(null);
  const today = localDateKey(new Date(now));
  const candidates = useMemo(() => getDrawCandidates(data.tasks, data.sessions, new Date()), [data.tasks, data.sessions, today]);
  const active = data.activeFocus;
  const activeTask = active ? data.tasks.find((task) => task.id === active.taskId) : null;
  const timer = active ? getTimerSnapshot(active.timer, now) : null;
  const reminderVisible = Boolean(active && timer?.isDue && data.settings.fullCover && !active.overlayDismissed);
  const dayEnded = data.dayEndedOn === today;
  const summary = useMemo(() => summarizeDay(summaryDate, data.tasks, data.sessions), [summaryDate, data.tasks, data.sessions]);
  const summaryTaskEvents = useMemo(() => (data.taskEvents ?? []).filter((event) => localDateKey(new Date(event.at)) === summaryDate), [data.taskEvents, summaryDate]);
  const summaryTasks = useMemo(() => {
    const tasks = new Map(summary.tasks.map((task) => [task.taskId, task]));
    for (const event of summaryTaskEvents) {
      if (!tasks.has(event.taskId)) tasks.set(event.taskId, { taskId: event.taskId, title: event.title, focusSeconds: 0, sessionCount: 0 });
    }
    return [...tasks.values()];
  }, [summary.tasks, summaryTaskEvents]);
  const summaryArchiveCount = new Set([...summary.archivedTaskIds, ...summaryTaskEvents.filter((event) => event.kind === 'archive').map((event) => event.taskId)]).size;
  const summaryCycleEvents = summaryTaskEvents.filter((event) => event.kind === 'cycle');
  const summarySteps = useMemo(() => {
    const latest = new Map<string, AppData['stepEvents'][number]>();
    for (const event of data.stepEvents) {
      if (localDateKey(new Date(event.at)) === summaryDate) latest.set(`${event.taskId}:${event.itemId}`, event);
    }
    return [...latest.values()].filter((event) => event.done);
  }, [data.stepEvents, summaryDate]);

  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(id); }, []);
  useEffect(() => {
    if (loadError || writeConflict || !active || active.timer.runningSinceMs === null) return;
    const id = window.setInterval(() => {
      const tick = Date.now();
      setData((current) => {
        const focus = current.activeFocus;
        if (!focus || focus.timer.runningSinceMs === null) return current;
        const recoveredTimer = focus.lastHeartbeatAtMs === undefined ? focus.timer : pauseAfterInactiveGap(focus.timer, focus.lastHeartbeatAtMs, tick);
        return { ...current, activeFocus: recoveredTimer !== focus.timer
          ? { ...focus, timer: recoveredTimer, pausedForGap: true }
          : { ...focus, lastHeartbeatAtMs: Math.max(tick, focus.timer.runningSinceMs) } };
      });
    }, 5_000);
    return () => window.clearInterval(id);
  }, [active?.sessionId, active?.timer.runningSinceMs, loadError, writeConflict]);
  useEffect(() => {
    if (loadError || writeConflict) return;
    try {
      lastSavedRaw.current = saveData(data, lastSavedRaw.current);
      setStorageError('');
    } catch (error) {
      if (error instanceof StorageConflictError) setWriteConflict(true);
      else setStorageError('本地保存失败。请导出备份，并检查浏览器存储权限和空间。');
    }
  }, [data, loadError, writeConflict]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue !== lastSavedRaw.current) setWriteConflict(true);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = data.settings.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', data.settings.theme === 'ink' ? '#F4F3F0' : data.settings.theme === 'forest' ? '#F6F9F5' : '#FBF7F0');
  }, [data.settings.theme]);
  useEffect(() => { void window.xitomatlDesktop?.setReminderFullscreen(reminderVisible).catch(() => {}); }, [reminderVisible]);
  useEffect(() => {
    if (active && timer?.isDue && !active.alerted) {
      setData((current) => current.activeFocus?.sessionId === active.sessionId ? { ...current, activeFocus: { ...current.activeFocus, alerted: true } } : current);
      if (data.settings.bell && bellPlayedFor.current !== active.sessionId) {
        bellPlayedFor.current = active.sessionId;
        playBell(audioContext.current);
      }
    }
  }, [active, timer?.isDue, data.settings.bell]);

  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice((current) => current === message ? '' : current), 5000); };
  const updateSetting = <K extends keyof AppData['settings']>(key: K, value: AppData['settings'][K]) => setData((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));

  function saveTask(task: Task) {
    setData((current) => ({ ...current, tasks: current.tasks.some((item) => item.id === task.id) ? current.tasks.map((item) => item.id === task.id ? task : item) : [task, ...current.tasks] }));
    setEditing(null);
    showNotice('任务已保存。');
  }

  function archiveTask(task: Task) {
    if (data.activeFocus?.taskId === task.id) { setPage('focus'); showNotice('请先结束这项任务正在进行的专注。'); return; }
    if (!window.confirm(`归档“${task.title}”？这表示这项任务已彻底完成。`)) return;
    const timestamp = new Date().toISOString();
    setData((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === task.id ? { ...item, archivedAt: timestamp, updatedAt: timestamp } : item), taskEvents: [...(current.taskEvents ?? []), { taskId: task.id, title: task.title, kind: 'archive', at: timestamp }] }));
    showNotice('任务已归档，可在“已归档”中恢复。');
  }

  function prepareTask(task: Task) {
    const candidate = candidates.find((item) => item.task.id === task.id) ?? { task, weight: 1, reasons: ['由你直接选择'] };
    setSelected(candidate);
    setDuration(recommendDuration(task, data.sessions).minutes);
    setPage('draw');
  }

  function doDraw() {
    if (candidates.length === 0 || spinning) return;
    setSelected(null);
    const result = drawTask(candidates, Math.random());
    pendingDraw.current = result;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      setSelected(result);
      if (result) setDuration(recommendDuration(result.task, data.sessions).minutes);
      return;
    }
    setSpinning(true);
    drawTimeout.current = window.setTimeout(revealDraw, 1000);
  }

  function revealDraw() {
    if (drawTimeout.current !== null) window.clearTimeout(drawTimeout.current);
    drawTimeout.current = null;
    setSpinning(false);
    const result = pendingDraw.current;
    setSelected(result);
    if (result) setDuration(recommendDuration(result.task, data.sessions).minutes);
  }

  function beginFocus() {
    if (!selected) return;
    const currentTask = data.tasks.find((task) => task.id === selected.task.id);
    if (active || dayEnded || !currentTask || !isTaskEligible(currentTask, data.sessions, new Date())) {
      setSelected(null);
      showNotice('这项任务当前不可开始，请重新选择。');
      return;
    }
    if (data.settings.bell) {
      try {
        audioContext.current ??= new AudioContext();
        void audioContext.current.resume();
      } catch { /* Visible reminder remains available. */ }
    }
    const start = new Date();
    const session = startSession(makeId(), currentTask.id, duration, start);
    const focus = { sessionId: session.id, taskId: currentTask.id, timer: createTimer(start.getTime(), duration === null ? null : duration * 60_000), alerted: false, overlayDismissed: false, lastHeartbeatAtMs: start.getTime(), pausedForGap: false };
    bellPlayedFor.current = null;
    setData((current) => ({ ...current, sessions: [...current.sessions, session], activeFocus: focus, dayEndedOn: null }));
    setPage('focus');
  }

  function endFocus(outcome: SessionOutcome) {
    if (!active || !activeTask) return;
    if (outcome === 'archive' && !window.confirm(`确认归档“${activeTask.title}”？这表示任务已彻底完成。`)) return;
    const currentSession = data.sessions.find((session) => session.id === active.sessionId);
    if (!currentSession) return;
    const ended = finishSession(currentSession, activeTask, outcome, new Date());
    const actualSeconds = Math.floor(getTimerSnapshot(active.timer, Date.now()).elapsedMs / 1000);
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((task) => task.id === ended.task.id ? ended.task : task),
      sessions: current.sessions.map((session) => session.id === ended.session.id ? { ...ended.session, actualSeconds } : session),
      taskEvents: outcome === 'archive' || (outcome === 'end-day' && (activeTask.kind === 'daily' || activeTask.kind === 'weekly'))
        ? [...(current.taskEvents ?? []), { taskId: activeTask.id, title: activeTask.title, kind: outcome === 'archive' ? 'archive' : 'cycle', at: new Date().toISOString() }]
        : current.taskEvents,
      activeFocus: null,
      dayEndedOn: outcome === 'end-day' ? today : current.dayEndedOn,
    }));
    setSelected(null);
    setSummaryDate(today);
    setPage(outcome === 'end-day' ? 'summary' : 'tasks');
    showNotice(outcome === 'archive' ? '任务已归档。' : outcome === 'end-day' ? '今天已收工，记录已进入每日总结。' : '本次专注已记录，任务仍在待办中。');
  }

  function toggleStep(task: Task, itemId: string, done: boolean) {
    const at = new Date();
    const title = task.sop.find((item) => item.id === itemId)?.title ?? '';
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => item.id === task.id ? setSopItemDone(item, itemId, done, at) : item),
      stepEvents: [...current.stepEvents, { taskId: task.id, itemId, title, done, at: at.toISOString() }],
    }));
  }

  function setCycle(task: Task, complete: boolean) {
    if (data.activeFocus?.taskId === task.id) { setPage('focus'); showNotice('请先结束这项任务正在进行的专注。'); return; }
    const at = new Date();
    const periodStart = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    if (task.kind === 'weekly') periodStart.setDate(periodStart.getDate() - ((periodStart.getDay() + 6) % 7));
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => item.id === task.id ? complete ? completeTaskCycle(item, at) : undoTaskCycle(item, at) : item),
      taskEvents: complete
        ? [...(current.taskEvents ?? []), { taskId: task.id, title: task.title, kind: 'cycle', at: at.toISOString() }]
        : (current.taskEvents ?? []).filter((event) => !(event.taskId === task.id && event.kind === 'cycle' && new Date(event.at) >= periodStart)),
    }));
    showNotice(complete ? '本轮已完成，下一周期会重新出现。' : '已撤销本轮完成。');
  }

  async function importBackup(file: File | undefined) {
    if (!file) return;
    try {
      const next = parseBackup(JSON.parse(await file.text()));
      if (!window.confirm('导入会替换本设备当前的全部时茄数据。建议先导出备份。确定导入吗？')) return;
      setData(next);
      setSelected(null);
      setPage(next.activeFocus ? 'focus' : 'tasks');
      showNotice('备份已导入。');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '导入失败。');
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  }

  const visibleTasks = data.tasks.filter((task) => {
    if (filter === 'archived') return Boolean(task.archivedAt);
    if (task.archivedAt) return false;
    if (filter === 'planned') return task.kind === 'planned';
    if (filter === 'today') return task.kind !== 'planned';
    return true;
  }).sort((a, b) => {
    if (a.deadlineDate && b.deadlineDate) return a.deadlineDate.localeCompare(b.deadlineDate);
    if (a.deadlineDate) return -1;
    if (b.deadlineDate) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const urgent = data.tasks.filter((task) => !task.archivedAt && task.kind === 'deadline' && task.deadlineDate && task.deadlineDate <= today).sort((a, b) => (a.deadlineDate ?? '').localeCompare(b.deadlineDate ?? ''));
  const selectedSuggestion = selected ? recommendDuration(selected.task, data.sessions) : null;

  if (loadError || writeConflict) {
    return <main className="recovery-screen"><section className="recovery-card" role="alert">
      <img src="/logo.svg" alt="" width="64" height="64" />
      <span className="eyebrow">DATA PROTECTION</span>
      <h1>{writeConflict ? '另一个标签页更新了数据' : '本地数据需要处理'}</h1>
      <p>{writeConflict ? '此标签页已停止写入，避免覆盖较新的任务。你可以先导出当前页面中的记录，再重新载入。' : `${loadError} 原始数据仍保留在浏览器中，时茄不会自动覆盖它。`}</p>
      <div className="recovery-actions">
        {writeConflict ? <button className="button secondary" onClick={() => downloadBackup(data)}>导出当前记录</button> : <button className="button secondary" onClick={() => {
          if (!initialRead.raw) return;
          const url = URL.createObjectURL(new Blob([initialRead.raw], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = url; link.download = 'xitomatl-unreadable-backup.json'; link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>下载原始数据</button>}
        {writeConflict ? <button className="button primary" onClick={() => window.location.reload()}>重新载入最新数据</button> : <button className="button primary" onClick={() => {
          if (!window.confirm('确定清除当前浏览器中的时茄数据并重新开始吗？请先下载原始数据。')) return;
          try { localStorage.removeItem(STORAGE_KEY); lastSavedRaw.current = null; setData(emptyData()); setLoadError(null); setPage('tasks'); }
          catch { setStorageError('无法清除本地数据，请检查浏览器存储权限。'); }
        }}>清除并重新开始</button>}
      </div>
      {storageError && <p className="error-text">{storageError}</p>}
    </section></main>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><img src={data.settings.theme === 'forest' ? '/logo-c.svg' : '/logo-a.svg'} width="44" height="44" alt="" /><div><strong>时茄</strong><span>Xitomatl</span></div></div>
        <nav aria-label="主导航" className="main-nav">
          <button className={page === 'tasks' ? 'active' : ''} onClick={() => setPage('tasks')}><span aria-hidden="true">▦</span> 任务表</button>
          <button className={page === 'draw' ? 'active' : ''} onClick={() => setPage('draw')}><span aria-hidden="true">✳</span> 随机抽取</button>
          {active && <button className={page === 'focus' ? 'active' : ''} onClick={() => setPage('focus')}><span aria-hidden="true">◷</span> 专注中</button>}
          <button className={page === 'summary' ? 'active' : ''} onClick={() => setPage('summary')}><span aria-hidden="true">▤</span> 每日总结</button>
          <button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}><span aria-hidden="true">⚙</span> 设置</button>
        </nav>
        <div className="sidebar-foot"><span className="sidebar-dot" /> 一次只做眼前的一件事</div>
      </aside>

      <main className="main-content">
        <header className="topbar"><span>{prettyDate(new Date(now))}</span><div className="topbar-right">{active && <button className="focus-chip" onClick={() => setPage('focus')}>● 正在专注 · {timer?.display}</button>}<span className="local-badge">数据保存在本设备</span></div></header>
        {storageError && <div className="notice error-notice" role="alert">{storageError}</div>}
        {notice && <div className="notice" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}

        {page === 'tasks' && <>
          <section className="hero">
            <div><span className="eyebrow">MY TASKS · 我的任务</span><h1>今天，先从一件事开始。</h1><p>把脑中的待办放在这里。准备好时，让时茄帮你选一个起点。</p></div>
            <div className="hero-actions"><button className="button primary large" disabled={candidates.length === 0 || Boolean(active) || dayEnded} onClick={() => { setSelected(null); setPage('draw'); }}>开始抽取 <span aria-hidden="true">↗</span></button><button className="button white" onClick={() => setEditing('new')}>＋ 登记任务</button></div>
          </section>
          {dayEnded && <div className="banner"><div><strong>今天的量已完成。</strong><span>所有记录都可以在每日总结中查看；如需继续，也可以重新开启今天。</span></div><button className="button small secondary" onClick={() => setData((current) => ({ ...current, dayEndedOn: null }))}>继续今天</button></div>}
          {urgent.length > 0 && <div className="deadline-alert"><strong>截止日期提醒</strong><span>{urgent.length} 项任务今天截止或已经逾期。</span><button disabled={Boolean(active) || dayEnded} onClick={() => prepareTask(urgent[0])}>直接开始最紧急任务 →</button></div>}
          <section className="section-head"><div><span className="eyebrow">TASK BOARD</span><h2>任务表 <span className="count">{visibleTasks.length}</span></h2></div><button className="button secondary small" onClick={() => setEditing('new')}>＋ 新任务</button></section>
          <div className="tabs" role="tablist" aria-label="任务筛选">{([['today', '近期任务'], ['all', '全部任务'], ['planned', '长期计划'], ['archived', '已归档']] as const).map(([value, label]) => <button role="tab" aria-selected={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div>
          <div className="task-list">{visibleTasks.length ? visibleTasks.map((task) => <TaskCard key={task.id} task={task} today={today} eligible={isTaskEligible(task, data.sessions, new Date(now))} startBlocked={Boolean(active) || dayEnded} onToggleStep={toggleStep} onEdit={setEditing} onStart={prepareTask} onArchive={archiveTask} onRestore={(item) => setData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === item.id ? { ...task, archivedAt: undefined, updatedAt: new Date().toISOString() } : task) }))} onActivate={(item) => setData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === item.id ? { ...task, kind: 'open', updatedAt: new Date().toISOString() } : task) }))} onCycle={setCycle} />) : <div className="empty-state"><div className="empty-icon">✦</div><h3>{filter === 'today' ? '把第一件事写下来' : '这里暂时没有任务'}</h3><p>{filter === 'today' ? '登记任务后，就可以开始抽取。' : '切换分类，或登记新的任务。'}</p><button className="button primary" onClick={() => setEditing('new')}>登记任务</button></div>}</div>
        </>}

        {page === 'draw' && <section className="draw-page">
          <div className="page-heading"><span className="eyebrow">RANDOM DRAW</span><h1>抽取下一件事</h1><p>从 {candidates.length} 项近期任务中抽取。你始终可以重抽，或回任务表自行选择。</p></div>
          {active ? <div className="banner"><strong>已有正在进行的专注。</strong><button className="button small primary" onClick={() => setPage('focus')}>返回计时</button></div> : dayEnded ? <div className="empty-state"><h3>今天已经收工</h3><p>你可以明天再抽取，也可以继续今天。</p><button className="button primary" onClick={() => setData((current) => ({ ...current, dayEndedOn: null }))}>继续今天</button></div> : <>
            <div className="draw-layout"><div className="draw-machine-panel">
              <div className="style-switch" role="group" aria-label="抽取外观"><button className={data.settings.drawStyle === 'capsule' ? 'active' : ''} onClick={() => updateSetting('drawStyle', 'capsule' as DrawStyle)}>扭蛋桶</button><button className={data.settings.drawStyle === 'wheel' ? 'active' : ''} onClick={() => updateSetting('drawStyle', 'wheel' as DrawStyle)}>转盘</button></div>
              <div className={`draw-visual ${data.settings.drawStyle} ${spinning ? 'spinning' : ''}`} aria-hidden="true">{data.settings.drawStyle === 'capsule' ? <><div className="capsule-top"><i /><i /><i /><i /><i /></div><div className="capsule-neck" /><div className="capsule-base"><span>?</span></div></> : <><div className="wheel-disc"><span>✦</span><span>●</span><span>✦</span><span>●</span></div><div className="wheel-pointer" /></>}</div>
              <button className="button primary large draw-button" onClick={doDraw} disabled={candidates.length === 0 || spinning}>{spinning ? '正在抽取…' : selected ? '再抽一次' : '抽取任务'}</button>
              {spinning && <button className="text-button skip-button" onClick={revealDraw}>跳过动画</button>}
              <p className="draw-note">抽取有随机性；临近截止日期的任务会获得更高权重。</p>
            </div><div className="draw-result-panel">
              {selected ? <><span className="eyebrow">YOUR NEXT TASK</span><div className="result-mark">✦</div><span className="kind-pill">{kindNames[selected.task.kind]}</span><h2>{selected.task.title}</h2>{selected.task.sop.length > 0 && <p className="result-steps">{selected.task.sop.filter((item) => !item.completedAt).length} 个步骤待完成</p>}
                <details className="why"><summary>为什么抽到它？</summary><ul>{selected.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><p>这是可解释的产品规则，不代表预测了你的效率。</p></details>
                <div className="duration-area"><h3>这次专注多久？</h3><p>{selectedSuggestion?.explanation}</p><div className="duration-options">{([null, 15, 25, 45] as const).map((value) => <button key={String(value)} className={duration === value ? 'active' : ''} onClick={() => setDuration(value)}>{value === null ? '不定时' : `${value} 分`}</button>)}<button className={duration === data.settings.customMinutes ? 'active' : ''} onClick={() => setDuration(data.settings.customMinutes)}>自定义</button></div><label className="custom-duration">自定义分钟数 <input type="number" min="1" max="480" value={data.settings.customMinutes} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 480) { updateSetting('customMinutes', value); setDuration(value); } }} /></label></div>
                <button className="button primary large start-focus" onClick={beginFocus}>开始专注 <span aria-hidden="true">→</span></button>
              </> : <div className="result-placeholder"><div className="placeholder-star">✳</div><h2>让下一件事出现</h2><p>抽取后，你可以先看任务，再决定是否开始。</p></div>}
            </div></div>
            {candidates.length === 0 && <p className="inline-empty">当前没有可抽取任务。先在任务表中登记或启用任务。</p>}
          </>}
        </section>}

        {page === 'focus' && <section className="focus-page">
          {active && activeTask && timer ? <><div className="page-heading"><span className="eyebrow">FOCUS SESSION</span><h1>专注眼前的任务</h1><p>计时结束只是提醒，你可以自行决定何时结束这次专注。</p></div>
            <div className="focus-card"><div className="focus-task"><span className="kind-pill">{kindNames[activeTask.kind]}</span><h2>{activeTask.title}</h2></div><div className="clock-wrap"><div className={`clock-ring ${timer.isDue ? 'due' : ''}`}><div><span className="clock-label">{timer.isDue ? '计时已到' : timer.isPaused ? '已暂停' : active.timer.durationMs === null ? '正计时' : '倒计时'}</span><time className="digital-clock" aria-live="off">{timer.display}</time><span className="clock-caption">{active.timer.durationMs === null ? '按自己的节奏继续' : `本次设定 ${Math.round(active.timer.durationMs / 60_000)} 分钟`}</span></div></div></div>
              <div className="timer-controls"><button className="button secondary" onClick={() => setData((current) => {
                if (!current.activeFocus) return current;
                const at = Date.now();
                return { ...current, activeFocus: { ...current.activeFocus, timer: timer.isPaused ? resumeTimer(current.activeFocus.timer, at) : pauseTimer(current.activeFocus.timer, at), lastHeartbeatAtMs: at, pausedForGap: false } };
              })}>{timer.isPaused ? '继续计时' : '暂停计时'}</button></div>
              {active.pausedForGap && <p className="due-inline" role="status">应用曾长时间未运行，计时已在上次活跃时暂停。确认后可继续。</p>}
              {timer.isDue && <p className="due-inline" role="status">时间到了。你可以继续专注，或结束本次记录。</p>}
              {activeTask.sop.length > 0 && <div className="focus-steps"><h3>SOP 步骤</h3>{activeTask.sop.map((item) => <label key={item.id}><input type="checkbox" checked={Boolean(item.completedAt)} onChange={(event) => toggleStep(activeTask, item.id, event.target.checked)} /><span className={item.completedAt ? 'done' : ''}>{item.title}</span></label>)}</div>}
              <div className="focus-footer"><p>结束本次会保留任务；结束当日会停止今天的抽取；归档表示任务彻底完成。</p><EndActions onEnd={endFocus} /></div>
            </div>
          </> : <div className="empty-state"><h2>还没有正在进行的专注</h2><p>先从任务表选择，或随机抽取一件事。</p><button className="button primary" onClick={() => setPage('tasks')}>查看任务表</button></div>}
        </section>}

        {page === 'summary' && <section className="summary-page"><div className="page-heading"><span className="eyebrow">DAILY REVIEW</span><h1>每日总结</h1><p>回看今天做过的事，给下一次开始留一点线索。</p></div><div className="summary-date"><label>查看日期 <input type="date" value={summaryDate} onChange={(event) => setSummaryDate(event.target.value)} /></label><button className="button secondary small" onClick={() => { const text = `${summary.date} · 时茄每日总结\n专注 ${summary.sessionCount} 次，共 ${formatHms(summary.focusSeconds)}；涉及 ${summaryTasks.length} 项任务，勾选 ${summarySteps.length} 个步骤，归档 ${summaryArchiveCount} 项。\n${summaryTasks.map((task) => `- ${task.title}：${formatHms(task.focusSeconds)}`).join('\n')}`; void navigator.clipboard.writeText(text).then(() => showNotice('总结已复制。')).catch(() => showNotice('复制失败，可手动查看总结。')); }}>复制总结</button></div><div className="summary-stats"><div><span>专注次数</span><strong>{summary.sessionCount}</strong></div><div><span>实际专注</span><strong>{formatHms(summary.focusSeconds)}</strong></div><div><span>勾选步骤</span><strong>{summarySteps.length}</strong></div><div><span>归档任务</span><strong>{summaryArchiveCount}</strong></div></div><div className="summary-card"><h2>这一天的记录</h2>{summaryTasks.length ? <ul>{summaryTasks.map((task) => <li key={task.taskId}><div><strong>{task.title}</strong><span>{task.sessionCount} 次专注</span></div><time>{formatHms(task.focusSeconds)}</time></li>)}</ul> : <div className="summary-empty">这一天还没有专注记录。休息也是正常的一天。</div>}{summarySteps.length > 0 && <div className="summary-steps"><h3>完成的步骤</h3><ul>{summarySteps.map((step) => <li key={`${step.taskId}:${step.itemId}`}>{step.title}</li>)}</ul></div>}{summaryCycleEvents.length > 0 && <div className="summary-steps"><h3>完成的本轮任务</h3><ul>{summaryCycleEvents.map((event, index) => <li key={`${event.taskId}:${event.at}:${index}`}>{event.title}</li>)}</ul></div>}{summary.endedDay && <p className="summary-finish">你选择了“结束当日”，今天的量已完成。</p>}</div><div className="summary-tip"><span aria-hidden="true">✦</span><p>明天可从仍在待办中的任务继续。时长建议会参考历史记录，但选择始终由你决定。</p></div></section>}

        {page === 'settings' && <section className="settings-page"><div className="page-heading"><span className="eyebrow">PREFERENCES</span><h1>设置</h1><p>让抽取方式和提醒符合你的习惯。</p></div><div className="settings-card"><h2>视觉外观</h2><p>选择你喜欢的色彩，抽取页的外观可随时切换。</p><div className="theme-grid">{([['tomato', '暖番茄', '温暖、轻快'], ['forest', '森林绿', '安静、专注'], ['ink', '墨色', '简洁、克制']] as const).map(([value, name, description]) => <button className={`theme-option ${value} ${data.settings.theme === value ? 'active' : ''}`} key={value} onClick={() => updateSetting('theme', value as Theme)}><span className="theme-swatches"><i /><i /><i /></span><strong>{name}</strong><small>{description}</small></button>)}</div></div><div className="settings-card"><h2>计时提醒</h2><label className="switch-row"><span><strong>全屏覆盖提醒</strong><small>倒计时结束时覆盖应用界面，保留三个结束操作。</small></span><input type="checkbox" checked={data.settings.fullCover} onChange={(event) => updateSetting('fullCover', event.target.checked)} /></label><label className="switch-row"><span><strong>响铃</strong><small>倒计时结束时播放提示音。</small></span><input type="checkbox" checked={data.settings.bell} onChange={(event) => updateSetting('bell', event.target.checked)} /></label></div><div className="settings-card"><h2>本地数据</h2><p>任务与专注记录只保存在本设备的时茄应用中。建议定期导出备份，换设备时可以导入。</p><div className="settings-actions"><button className="button secondary" onClick={() => downloadBackup(data)}>导出 JSON 备份</button><button className="button secondary" onClick={() => importRef.current?.click()}>导入 JSON 备份</button><input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importBackup(event.target.files?.[0])} /></div></div></section>}
      </main>

      {editing && <TaskEditor key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={saveTask} />}
      {active && activeTask && timer?.isDue && reminderVisible && <div className="timer-overlay" role="alertdialog" aria-modal="true" aria-labelledby="timer-done-title"><div className="timer-overlay-card"><span className="eyebrow">TIME IS UP</span><div className="overlay-symbol">✦</div><h2 id="timer-done-title">本次计时已到</h2><p>“{activeTask.title}”已经专注了 {formatHms(Math.floor(timer.elapsedMs / 1000))}。你可以继续，也可以记录这次结果。</p><div className="overlay-clock">{timer.display}</div><button className="text-button overlay-continue" onClick={() => setData((current) => current.activeFocus ? { ...current, activeFocus: { ...current.activeFocus, overlayDismissed: true } } : current)}>继续专注，关闭覆盖</button><EndActions onEnd={endFocus} /></div></div>}
    </div>
  );
}
