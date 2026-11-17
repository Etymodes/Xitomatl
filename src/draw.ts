import type { DrawCandidate } from './core/index';

export interface WheelSegment {
  candidate: DrawCandidate;
  startAngle: number;
  endAngle: number;
  middleAngle: number;
  probability: number;
}

/** Sector sizes show the same probabilities that the draw actually uses. */
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

/** Keep turning forward, then place the winning sector under the top pointer. */
export function wheelLandingRotation(current: number, middleAngle: number, turns = 5): number {
  const normalized = ((current % 360) + 360) % 360;
  const target = (360 - middleAngle) % 360;
  return current + turns * 360 + ((target - normalized + 360) % 360);
}
