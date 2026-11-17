// @ts-nocheck -- Node runs these checks directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CapsuleWorld, CAPSULE_GEOMETRY } from './capsulePhysics.ts';
import { capsuleBallSpecs, withBallWeights, wheelSegments } from './draw.ts';
import { drawTask } from './core/index.ts';

const candidates = [1, 2, 1].map((weight, index) => ({ task: { id: String(index), title: '任务 ' + index }, weight, reasons: [] }));

test('one shared ball count controls the exact number of objects, draw probability and wheel area', () => {
  const pool = withBallWeights(candidates, { '0': 1, '1': 3, '2': 0 });
  const balls = capsuleBallSpecs(pool);
  assert.equal(balls.length, 4);
  assert.equal(balls.filter((ball) => ball.taskId === '1').length, 3);
  assert.deepEqual(wheelSegments(pool).map((segment) => segment.endAngle - segment.startAngle), [90, 270]);
  assert.equal(drawTask(pool, .2499).task.id, '0');
  assert.equal(drawTask(pool, .25).task.id, '1');
  assert.equal(drawTask(pool, .999).task.id, '1');
  assert.equal(withBallWeights(candidates, { '0': 0 })[0].weight, 0);
});

test('adding one ball preserves the existing bodies and positions; gravity and both collision types are active', () => {
  const world = new CapsuleWorld(() => .5);
  const pool = withBallWeights(candidates, { '0': 1, '1': 1, '2': 1 });
  world.sync(capsuleBallSpecs(pool));
  const original = world.balls.get('0:0');
  const initial = { ...original.body.position };
  world.sync(capsuleBallSpecs(withBallWeights(candidates, { '0': 2, '1': 1, '2': 1 })));
  assert.equal(world.balls.size, 4);
  assert.equal(world.balls.get('0:0'), original);
  assert.deepEqual(original.body.position, initial);
  for (let index = 0; index < 480; index++) world.step();
  assert.ok(original.body.position.y > initial.y + 100);
  assert.ok(world.metrics.ballCollisions > 0);
  assert.ok(world.metrics.wallCollisions > 0);
  for (const ball of world.balls.values()) {
    assert.ok(Math.hypot(ball.body.position.x - CAPSULE_GEOMETRY.x, ball.body.position.y - CAPSULE_GEOMETRY.y) < CAPSULE_GEOMETRY.radius - ball.radius + 3);
  }
  const balls = [...world.balls.values()];
  for (let a = 0; a < balls.length; a++) for (let b = a + 1; b < balls.length; b++) {
    assert.ok(Math.hypot(balls[a].body.position.x - balls[b].body.position.x, balls[a].body.position.y - balls[b].body.position.y) >= balls[a].radius + balls[b].radius - 2);
  }
  world.dispose();
});

test('the selected task falls through the outlet while other balls remain inside', () => {
  for (const count of [1, 30, 120, 240]) {
    let seed = 41 + count;
    const world = new CapsuleWorld(() => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646);
    world.sync(Array.from({ length: count }, (_, index) => ({ id: String(index), taskId: String(index % 5), number: index % 5 + 1, color: '#edaa92' })));
    for (let index = 0; index < 240; index++) world.step();
    const target = count === 1 ? '0' : '3';
    world.startDraw(target);
    let complete = false;
    for (let index = 0; index < 720; index++) {
      world.step();
      if (world.consumeCompletion()) { complete = true; break; }
    }
    assert.ok(complete, 'outlet timeout with ' + count + ' balls');
    const outside = [...world.balls.values()].filter((ball) => ball.body.position.y > 490);
    assert.equal(outside.length, 1);
    assert.equal(outside[0].spec.taskId, target);
    world.dispose();
  }
});

test('off-centre selected balls are guided into the outlet without disabling their collisions', () => {
  for (const seed of [8, 10, 32, 38]) {
    let state = seed;
    const world = new CapsuleWorld(() => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; });
    world.sync(capsuleBallSpecs([6, 9, 3, 12].map((weight, index) => ({ task: { id: String(index) }, weight }))));
    for (let index = 0; index < 180; index++) world.step();
    world.startDraw(String(seed % 4));
    let finished = false;
    for (let index = 0; index < 600; index++) { world.step(); if (world.consumeCompletion()) { finished = true; break; } }
    assert.ok(finished, 'stuck with seed ' + seed);
    const chosen = [...world.balls.values()].find((ball) => ball.body.position.y > 552);
    assert.equal(chosen.spec.taskId, String(seed % 4));
    assert.equal(chosen.body.isSensor, false);
    world.dispose();
  }
});
