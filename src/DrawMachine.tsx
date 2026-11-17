import type { CSSProperties } from 'react';
import type { DrawCandidate } from './core/index';
import { wheelSegments } from './draw';
import type { DrawStyle } from './storage';

const colors = ['#F3C5B5', '#F5DEA5', '#C6DCD2', '#D7CDE6', '#EAB6B9', '#C8DCE5', '#DDD9AB', '#EDCEB7'];

function point(angle: number, radius = 198) {
  const radians = (angle - 90) * Math.PI / 180;
  return `${220 + Math.cos(radians) * radius},${220 + Math.sin(radians) * radius}`;
}

function labelLines(title: string, width: number): string[] {
  const characters = Array.from(title);
  if (characters.length <= width) return [title];
  return [characters.slice(0, width).join(''), characters.slice(width, width * 2 - 1).join('') + (characters.length > width * 2 - 1 ? '…' : '')];
}

export default function DrawMachine({ style, candidates, spinning, rotation, selectedId, disabled, onDraw, onChoose }: {
  style: DrawStyle;
  candidates: DrawCandidate[];
  spinning: boolean;
  rotation: number;
  selectedId?: string;
  disabled: boolean;
  onDraw: () => void;
  onChoose: (candidate: DrawCandidate) => void;
}) {
  const segments = wheelSegments(candidates);
  const selected = candidates.find((candidate) => candidate.task.id === selectedId);
  return <>
    <div className={`task-draw-machine ${style} ${spinning ? 'is-spinning' : ''}`}>
      {style === 'wheel' ? <div className="task-wheel" aria-label={`任务转盘，共 ${segments.length} 项任务`}>
        <div className="task-wheel-pointer" aria-hidden="true" />
        <svg className="task-wheel-disc" viewBox="0 0 440 440" style={{ transform: `rotate(${rotation}deg)` }} role="img" aria-label="每个扇区对应一项任务，扇区大小表示抽取概率">
          <circle cx="220" cy="220" r="210" className="wheel-rim" />
          {segments.map((segment, index) => {
            const { task } = segment.candidate;
            const span = segment.endAngle - segment.startAngle;
            const labelAngle = segment.middleAngle;
            const flip = labelAngle > 90 && labelAngle < 270;
            const fontSize = span < 14 ? 11 : span < 25 ? 13 : 15;
            const labelWidth = Math.max(2, Math.min(8, Math.floor(260 * Math.sin(Math.min(span, 180) * Math.PI / 360) / fontSize)));
            const lines = labelLines(task.title, labelWidth);
            return <g key={task.id} className={`task-wheel-segment ${selectedId === task.id && !spinning ? 'is-selected' : ''}`}>
              <title>{task.title} · {(segment.probability * 100).toFixed(1)}%</title>
              {span >= 359.999 ? <circle cx="220" cy="220" r="198" fill={colors[index % colors.length]} /> :
                <path d={`M220,220 L${point(segment.startAngle)} A198,198 0 ${span > 180 ? 1 : 0},1 ${point(segment.endAngle)} Z`} fill={colors[index % colors.length]} />}
              <g transform={`rotate(${labelAngle} 220 220)`}>
                <text transform={`translate(220 78) rotate(${flip ? 180 : 0})`} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize}>
                  {lines.map((line, lineIndex) => <tspan x="0" dy={lineIndex === 0 ? lines.length === 1 ? 0 : -9 : 18} key={lineIndex}>{line}</tspan>)}
                </text>
              </g>
            </g>;
          })}
          {segments.length === 0 && <text x="220" y="110" textAnchor="middle" className="wheel-empty-label">先登记任务</text>}
        </svg>
        <button className="wheel-center-button" onClick={onDraw} disabled={disabled} aria-label="转动任务转盘"><span aria-hidden="true">↻</span><strong>{spinning ? '转动中' : '转起来'}</strong></button>
      </div> : <div className="task-capsule-machine" aria-label={`任务扭蛋机，共 ${segments.length} 项任务`}>
        <div className="capsule-lid"><span>时茄任务扭蛋</span></div>
        <div className="capsule-globe">
          <div className="capsule-tokens" role="list" aria-label="扭蛋中的任务">
            {segments.map(({ candidate }, index) => <div role="listitem" className={`task-capsule ${selectedId === candidate.task.id && !spinning ? 'is-selected' : ''}`} style={{ '--capsule-color': colors[index % colors.length], '--tilt': `${[-9, 8, -5, 6][index % 4]}deg` } as CSSProperties} key={candidate.task.id} title={candidate.task.title}>
              <span className="capsule-number">{index + 1}</span><span>{candidate.task.title}</span>
            </div>)}
            {segments.length === 0 && <p className="capsule-empty-label">把任务装进来<br />再转动一次</p>}
          </div>
        </div>
        <div className="task-capsule-base"><div className="capsule-crank" aria-hidden="true"><i /></div><div className={`capsule-outlet ${selected && !spinning ? 'has-result' : ''}`} aria-live="polite">{spinning ? '正在摇出一项任务…' : selected ? <><small>本次扭蛋</small><strong>{selected.task.title}</strong></> : '下一件事，等你转出来'}</div></div>
      </div>}
    </div>
    <div className="draw-pool">
      <div className="draw-pool-heading"><strong>本次候选任务 <span>{segments.length}</span></strong><small>{style === 'wheel' ? '扇区大小对应抽取概率' : '每一颗扭蛋都是一项任务'}</small></div>
      <ol aria-label="完整候选任务与抽取概率">
        {segments.map(({ candidate, probability }, index) => <li key={candidate.task.id}><button disabled={spinning} className={candidate.task.id === selectedId ? 'is-selected' : ''} onClick={() => onChoose(candidate)} title={`直接选择：${candidate.task.title}`}><i style={{ background: colors[index % colors.length] }} aria-hidden="true" /><span className="pool-task-number">{index + 1}</span><span className="pool-task-title">{candidate.task.title}</span><span className="pool-task-chance">{(probability * 100).toFixed(1)}%</span></button></li>)}
      </ol>
    </div>
  </>;
}
