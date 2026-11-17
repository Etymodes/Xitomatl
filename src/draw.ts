import type { DrawCandidate } from './core/index';

export const MAX_CAPSULE_BALLS = 240;
export const MAX_TASK_BALLS = 50;
export const DRAW_COLORS = ['#EDAA92', '#EBC974', '#9FC8B6', '#BAACD4', '#D98F9B', '#9FBFCE', '#C1C385', '#D7B091'];

export interface BallSpec {
  id: string;
  taskId: string;
  number: number;
  color: string;
}

export function withBallWeights(candidates: DrawCandidate[], saved: Record<string, number> = {}): DrawCandidate[] {
  const sum = candidates.reduce((total, candidate) => total + candidate.weight, 0);
  const scale = Math.min(4, 96 / Math.max(1, sum));
  return candidates.map((candidate) => {
    const own = Object.hasOwn(saved, candidate.task.id) ? saved[candidate.task.id] : undefined;
    const weight = Number.isInteger(own) && own! >= 0 && own! <= MAX_TASK_BALLS ? own! : Math.max(1, Math.round(candidate.weight * scale));
    return { ...candidate, weight, reasons: ['本任务 ' + weight + ' 颗球；概率按球数占比计算', ...candidate.reasons] };
  });
}

export function capsuleBallSpecs(candidates: DrawCandidate[]): BallSpec[] {
  return candidates.flatMap((candidate, index) => Array.from({ length: Math.max(0, Math.floor(candidate.weight)) }, (_, ordinal) => ({
    id: candidate.task.id + ':' + ordinal,
    taskId: candidate.task.id,
    number: index + 1,
    color: DRAW_COLORS[index % DRAW_COLORS.length],
  })));
}

export interface WheelSegment {
  candidate: DrawCandidate;
  startAngle: number;
  endAngle: number;
  middleAngle: number;
  probability: number;
}

export function wheelSegments(candidates: DrawCandidate[]): WheelSegment[] {
  const pool = candidates.filter((candidate) => Number.isFinite(candidate.weight) && candidate.weight > 0);
  const total = pool.reduce((sum, candidate) => sum + candidate.weight, 0);
  let angle = 0;
  return pool.map((candidate, index) => {
    const startAngle = angle;
    angle = index === pool.length - 1 ? 360 : angle + candidate.weight / total * 360;
    return { candidate, startAngle, endAngle: angle, middleAngle: (startAngle + angle) / 2, probability: candidate.weight / total };
  });
}

export function wheelLandingRotation(current: number, middleAngle: number, turns = 5): number {
  const normalized = ((current % 360) + 360) % 360;
  const target = (360 - middleAngle) % 360;
  return current + turns * 360 + ((target - normalized + 360) % 360);
}
