import type { DrawCandidate } from './core/index';
import { DRAW_COLORS, MAX_CAPSULE_BALLS, MAX_TASK_BALLS, wheelSegments } from './draw';
import type { DrawStyle } from './storage';
import CapsuleMachine from './CapsuleMachine';

function point(angle: number, radius = 198) {
  const radians = (angle - 90) * Math.PI / 180;
  return (220 + Math.cos(radians) * radius) + ',' + (220 + Math.sin(radians) * radius);
}

export default function DrawMachine({ style, candidates, spinning, rotation, selectedId, drawTargetId, disabled, onDraw, onComplete }: {
  style: DrawStyle;
  candidates: DrawCandidate[];
  spinning: boolean;
  rotation: number;
  selectedId?: string;
  drawTargetId?: string;
  disabled: boolean;
  onDraw: () => void;
  onComplete: () => void;
}) {
  const segments = wheelSegments(candidates);
  return <div className={'task-draw-machine ' + style + (spinning ? ' is-spinning' : '')}>
    {style === 'wheel' ? <div className="task-wheel" aria-label={'任务转盘，共 ' + segments.length + ' 项任务'}>
      <div className="task-wheel-pointer" aria-hidden="true" />
      <svg className="task-wheel-disc" viewBox="0 0 440 440" style={{ transform: 'rotate(' + rotation + 'deg)' }} role="img" aria-label="扇区使用任务编号，面积与旁边列表中的概率一致">
        <circle cx="220" cy="220" r="210" className="wheel-rim" />
        {segments.map((segment) => {
          const index = candidates.findIndex((candidate) => candidate.task.id === segment.candidate.task.id);
          const span = segment.endAngle - segment.startAngle;
          const labelAngle = segment.middleAngle;
          return <g key={segment.candidate.task.id} className={'task-wheel-segment' + (selectedId === segment.candidate.task.id && !spinning ? ' is-selected' : '')}>
            <title>{'#' + (index + 1) + ' ' + segment.candidate.task.title + ' · ' + (segment.probability * 100).toFixed(1) + '%'}</title>
            {span >= 359.999 ? <circle cx="220" cy="220" r="198" fill={DRAW_COLORS[index % DRAW_COLORS.length]} /> :
              <path d={'M220,220 L' + point(segment.startAngle) + ' A198,198 0 ' + (span > 180 ? 1 : 0) + ',1 ' + point(segment.endAngle) + ' Z'} fill={DRAW_COLORS[index % DRAW_COLORS.length]} />}
            <g transform={'rotate(' + labelAngle + ' 220 220)'}>
              <text transform={'translate(220 79) rotate(' + (labelAngle > 90 && labelAngle < 270 ? 180 : 0) + ')'} textAnchor="middle" dominantBaseline="middle" fontSize={span < 12 ? 12 : 27} fontWeight="850">{'#' + (index + 1)}</text>
              {span > 22 && <text transform={'translate(220 108) rotate(' + (labelAngle > 90 && labelAngle < 270 ? 180 : 0) + ')'} textAnchor="middle" dominantBaseline="middle" fontSize="11">{(segment.probability * 100).toFixed(1) + '%'}</text>}
            </g>
          </g>;
        })}
        {segments.length === 0 && <text x="220" y="110" textAnchor="middle" className="wheel-empty-label">先给任务分配球数</text>}
      </svg>
      <button className="wheel-center-button" onClick={onDraw} disabled={disabled} aria-label="转动任务转盘"><span aria-hidden="true">↻</span><strong>{spinning ? '转动中' : '转起来'}</strong></button>
    </div> : <CapsuleMachine candidates={candidates} drawTargetId={drawTargetId} selectedId={selectedId} onComplete={onComplete} />}
  </div>;
}

export function DrawPool({ candidates, selectedId, disabled, onChoose, onCount, onReset, onEqual }: {
  candidates: DrawCandidate[];
  selectedId?: string;
  disabled: boolean;
  onChoose: (candidate: DrawCandidate) => void;
  onCount: (taskId: string, count: number) => void;
  onReset: () => void;
  onEqual: () => void;
}) {
  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  return <section className="draw-pool" aria-labelledby="draw-pool-title">
    <div className="draw-pool-heading"><div><span className="eyebrow">TASK PROBABILITIES</span><h2 id="draw-pool-title">任务与概率 <span>{candidates.length}</span></h2></div><span className="pool-total">{total} 颗球</span></div>
    <p className="pool-explanation">同号球越多，抽中概率越高。球数和转盘面积同步，设为 0 可暂时排除。</p>
    <div className="pool-tools"><button className="text-button" disabled={disabled} onClick={onEqual}>均等概率</button><button className="text-button" disabled={disabled} onClick={onReset}>恢复自适应</button></div>
    <div className="pool-column-labels"><span>编号与任务</span><span>球数 / 权重</span><span>概率</span></div>
    <ol aria-label="任务编号、球数与概率">
      {candidates.map((candidate, index) => <li key={candidate.task.id} className={(candidate.task.id === selectedId ? 'is-selected ' : '') + (candidate.weight === 0 ? 'is-excluded' : '')}>
        <button className="pool-task-choice" disabled={disabled} onClick={() => onChoose(candidate)} title={'直接选择：' + candidate.task.title}><span className="pool-number" style={{ background: DRAW_COLORS[index % DRAW_COLORS.length] }}>{index + 1}</span><span className="pool-task-title">{candidate.task.title}</span></button>
        <div className="pool-stepper"><button aria-label={'减少任务 ' + (index + 1) + ' 的球数'} disabled={disabled || candidate.weight === 0} onClick={() => onCount(candidate.task.id, candidate.weight - 1)}>−</button><input type="number" min="0" max={Math.max(0, Math.min(MAX_TASK_BALLS, MAX_CAPSULE_BALLS - total + candidate.weight))} step="1" aria-label={'任务 ' + (index + 1) + ' 的球数'} value={candidate.weight} disabled={disabled} onChange={(event) => onCount(candidate.task.id, Number(event.target.value))} /><button aria-label={'增加任务 ' + (index + 1) + ' 的球数'} disabled={disabled || candidate.weight >= MAX_TASK_BALLS || total >= MAX_CAPSULE_BALLS} onClick={() => onCount(candidate.task.id, candidate.weight + 1)}>＋</button></div>
        <span className="pool-task-chance">{(total ? candidate.weight / total * 100 : 0).toFixed(1)}%</span>
      </li>)}
    </ol>
    {!candidates.length && <p className="pool-empty">登记近期任务后，它们会出现在这里。</p>}
    {total > MAX_CAPSULE_BALLS && <p className="pool-error" role="alert">球数超过 {MAX_CAPSULE_BALLS}，请减少权重后再抽取。</p>}
    {candidates.length > 0 && total === 0 && <p className="pool-error" role="status">所有任务都已排除，至少给一项任务分配 1 颗球。</p>}
    <p className="pool-footnote">概率 = 该任务球数 ÷ 总球数。最多 {MAX_CAPSULE_BALLS} 颗球，调整会自动保存。</p>
  </section>;
}
