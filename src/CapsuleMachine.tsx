import { useEffect, useMemo, useRef } from 'react';
import type { PointerEvent } from 'react';
import type { DrawCandidate } from './core/index';
import { capsuleBallSpecs, MAX_CAPSULE_BALLS } from './draw';
import { CAPSULE_GEOMETRY, CapsuleWorld } from './capsulePhysics';

export default function CapsuleMachine({ candidates, drawTargetId, selectedId, onComplete }: {
  candidates: DrawCandidate[];
  drawTargetId?: string;
  selectedId?: string;
  onComplete: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<CapsuleWorld | null>(null);
  const completeRef = useRef(onComplete);
  const selectedRef = useRef(selectedId);
  const previousDraw = useRef<string | undefined>(undefined);
  const specs = useMemo(() => {
    const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    return total <= MAX_CAPSULE_BALLS ? capsuleBallSpecs(candidates) : [];
  }, [candidates]);
  completeRef.current = onComplete;
  selectedRef.current = selectedId;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const world = new CapsuleWorld();
    worldRef.current = world;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = CAPSULE_GEOMETRY.width * ratio;
    canvas.height = CAPSULE_GEOMETRY.height * ratio;
    let animation = 0;
    let previous = performance.now();
    let accumulator = 0;
    let frame = 0;
    const animate = (now: number) => {
      accumulator += Math.min(66, now - previous);
      previous = now;
      while (accumulator >= 1000 / 60) {
        world.step();
        accumulator -= 1000 / 60;
      }
      if (world.consumeCompletion()) completeRef.current();
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, CAPSULE_GEOMETRY.width, CAPSULE_GEOMETRY.height);
      for (const { body, radius, spec } of world.balls.values()) {
        context.save();
        context.translate(body.position.x, body.position.y);
        context.rotate(body.angle);
        context.shadowColor = 'rgba(49, 37, 26, .20)';
        context.shadowBlur = 5;
        context.shadowOffsetY = 4;
        const fill = context.createRadialGradient(-radius * .35, -radius * .4, radius * .08, 0, 0, radius);
        fill.addColorStop(0, '#fff9ed');
        fill.addColorStop(.42, spec.color);
        fill.addColorStop(1, spec.color);
        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.fillStyle = fill;
        context.fill();
        context.shadowBlur = 0;
        context.shadowOffsetY = 0;
        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI);
        context.fillStyle = 'rgba(255, 250, 235, .48)';
        context.fill();
        context.beginPath();
        context.arc(0, 0, radius - 1, 0, Math.PI * 2);
        context.strokeStyle = spec.taskId === selectedRef.current ? '#7E2B25' : 'rgba(58, 44, 31, .23)';
        context.lineWidth = spec.taskId === selectedRef.current ? 3 : 1.4;
        context.stroke();
        context.beginPath();
        context.arc(0, 0, radius * .63, 0, Math.PI * 2);
        context.fillStyle = '#fffaf1';
        context.fill();
        context.fillStyle = '#302D28';
        context.font = '800 ' + Math.max(7, radius * (spec.number >= 100 ? .52 : .78)) + 'px "Segoe UI", sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(String(spec.number), 0, 1);
        context.restore();
      }
      if (++frame % 15 === 0) {
        canvas.dataset.ballCount = String(world.balls.size);
        canvas.dataset.ballCollisions = String(world.metrics.ballCollisions);
        canvas.dataset.wallCollisions = String(world.metrics.wallCollisions);
      }
      animation = requestAnimationFrame(animate);
    };
    animation = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(animation);
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => { worldRef.current?.sync(specs); }, [specs]);
  useEffect(() => {
    if (drawTargetId) {
      worldRef.current?.startDraw(drawTargetId);
      previousDraw.current = drawTargetId;
    } else if (previousDraw.current) {
      if (selectedId === previousDraw.current) worldRef.current?.finishImmediately(selectedId);
      previousDraw.current = undefined;
    }
  }, [drawTargetId, selectedId]);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * 520, y: (event.clientY - rect.top) / rect.height * 670 };
  }
  const selected = candidates.find((candidate) => candidate.task.id === selectedId);
  const number = candidates.findIndex((candidate) => candidate.task.id === selectedId) + 1;
  return <div className="physics-capsule-machine">
    <div className="capsule-stage">
      <svg viewBox="0 0 520 670" className="capsule-frame" aria-hidden="true">
        <defs><linearGradient id="capsule-glass" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fffdf8" /><stop offset="1" stopColor="#e6efea" /></linearGradient></defs>


        <circle cx="260" cy="250" r="225" fill="url(#capsule-glass)" className="machine-glass" />
        <rect className="machine-lid" x="126" y="4" width="268" height="36" rx="18" />
        <text x="260" y="28" textAnchor="middle" className="machine-brand">XITOMATL · TASK CAPSULES</text>
        <path d="M96 152 A184 184 0 0 1 185 77" className="machine-shine" />
        <rect className="machine-base" x="70" y="450" width="380" height="190" rx="34" />
        <rect className="machine-foot" x="115" y="638" width="290" height="19" rx="8" />
        <rect x="203" y="530" width="114" height="99" rx="18" className="machine-outlet" />
        <text x="260" y="518" textAnchor="middle" className="machine-outlet-label">出 球 口</text>
        <g className={drawTargetId ? 'machine-handle is-turning' : 'machine-handle'}>
          <circle cx="129" cy="548" r="32" className="machine-handle-rim" />
          <rect x="105" y="541" width="48" height="14" rx="7" className="machine-handle-bar" />
        </g>
        <text x="383" y="550" textAnchor="middle" className="machine-count">{specs.length}</text>
        <text x="383" y="573" textAnchor="middle" className="machine-outlet-label">颗任务球</text>
      </svg>
      <canvas ref={canvasRef} className="capsule-physics-canvas" aria-label={specs.length + ' 颗独立编号圆球，支持重力、球间和内壁碰撞，可拖动圆球'} onPointerDown={(event) => {
        if (!drawTargetId && worldRef.current?.beginDrag(point(event))) event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => worldRef.current?.moveDrag(point(event))} onPointerUp={(event) => {
        worldRef.current?.releaseDrag();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={() => worldRef.current?.releaseDrag()} />
    </div>
    <div className="capsule-live-status" aria-live="polite">{drawTargetId ? '球池搅拌中，编号球将从下方出口落出…' : selected ? '本次抽中 #' + number + ' · ' + selected.task.title : '调整任务球数，新的圆球会落入球池。'}</div>
    <button className="text-button stir-button" disabled={Boolean(drawTargetId) || !specs.length} onClick={() => worldRef.current?.stir()}>搅拌球池</button>
    <p className="capsule-interaction-hint">可拖动圆球；松手后会自然落下。下一次抽取前，出球会放回球池。</p>
  </div>;
}
