// @ts-nocheck -- Node runs these tests directly.
import assert from 'node:assert/strict';
import test from 'node:test';
import { drawTask } from './core/index.ts';
import { wheelLandingRotation, wheelSegments } from './draw.ts';

test('the sector under the pointer matches weighted draws, including repeated draws', () => {
  const pool = [1, 2.5, 1.5].map((weight, index) => ({ task: { id: String(index), title: `任务 ${index}` }, weight, reasons: [] }));
  const segments = wheelSegments(pool);
  assert.deepEqual(segments.map((segment) => segment.endAngle - segment.startAngle), [72, 180, 108]);
  let rotation = 0;
  for (const roll of [0, 0.199, 0.2, 0.69, 0.7, 0.999, 0.999]) {
    const chosen = drawTask(pool, roll);
    const segment = segments.find((item) => item.candidate.task.id === chosen.task.id);
    const next = wheelLandingRotation(rotation, segment.middleAngle);
    assert.ok(next - rotation >= 1800);
    assert.ok(Math.abs(((segment.middleAngle + next) % 360)) < 1e-8);
    rotation = next;
  }
  assert.deepEqual(wheelSegments([]), []);
  assert.equal(wheelSegments(pool.slice(0, 1))[0].endAngle, 360);
});
