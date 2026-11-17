import Matter from 'matter-js';
import type { BallSpec } from './draw';

const { Bodies, Body, Composite, Constraint, Engine, Events, Sleeping } = Matter;
export const CAPSULE_GEOMETRY = { width: 520, height: 670, x: 260, y: 250, radius: 218 };
export interface CapsuleBall {
  spec: BallSpec;
  body: Matter.Body;
  radius: number;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A fixed-step rigid-body world shared by the desktop scene and physics checks. */
export class CapsuleWorld {
  readonly engine = Engine.create({ enableSleeping: true, positionIterations: 8, velocityIterations: 8 });
  readonly balls = new Map<string, CapsuleBall>();
  readonly metrics = { ballCollisions: 0, wallCollisions: 0 };
  private random: () => number;
  private stirringUntil = 0;
  private dragConstraint: Matter.Constraint | null = null;
  private drawing: { taskId: string; started: number; target: CapsuleBall | null } | null = null;
  private released: CapsuleBall | null = null;
  private completed = false;

  constructor(random = Math.random) {
    this.random = random;
    const { x, y, radius } = CAPSULE_GEOMETRY;
    const walls = Array.from({ length: 80 }, (_, index) => {
      const angle = index * Math.PI * 2 / 80;
      const gate = angle > Math.PI * .43 && angle < Math.PI * .57;
      return Bodies.rectangle(x + Math.cos(angle) * (radius + 10), y + Math.sin(angle) * (radius + 10), 23, 22, {
        angle: angle + Math.PI / 2, isStatic: true, label: gate ? 'gate' : 'wall',
        collisionFilter: { category: 4, mask: gate ? 1 : 3 },
        friction: .2, restitution: .35,
      });
    });
    walls.push(
      Bodies.rectangle(211, 554, 14, 174, { isStatic: true, label: 'wall' }),
      Bodies.rectangle(309, 554, 14, 174, { isStatic: true, label: 'wall' }),
      Bodies.rectangle(260, 627, 112, 14, { isStatic: true, label: 'wall', restitution: .3 }),
    );
    Composite.add(this.engine.world, walls);
    Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        if (pair.bodyA.label === 'ball' && pair.bodyB.label === 'ball') this.metrics.ballCollisions++;
        else if (pair.bodyA.label === 'ball' || pair.bodyB.label === 'ball') this.metrics.wallCollisions++;
      }
    });
  }

  sync(specs: BallSpec[]) {
    const ids = new Set(specs.map((spec) => spec.id));
    for (const [id, ball] of this.balls) {
      if (!ids.has(id)) {
        if (ball === this.released) this.released = null;
        Composite.remove(this.engine.world, ball.body);
        this.balls.delete(id);
      }
    }
    const radius = specs.length <= 48 ? 24 : specs.length <= 96 ? 18 : specs.length <= 160 ? 14 : 11;
    const initial = this.balls.size === 0;
    const slots: { x: number; y: number }[] = [];
    for (let y = 70 + radius; y < 450 - radius; y += radius * 2.12) {
      for (let x = 45 + radius; x < 475 - radius; x += radius * 2.12) {
        if (Math.hypot(x - 260, y - 250) < 218 - radius - 4) slots.push({ x, y });
      }
    }
    let added = 0;
    for (const spec of specs) {
      const existing = this.balls.get(spec.id);
      if (existing) {
        existing.spec = spec;
        if (existing.radius !== radius) {
          Body.scale(existing.body, radius / existing.radius, radius / existing.radius);
          existing.radius = radius;
          Sleeping.set(existing.body, false);
        }
        continue;
      }
      const point = initial && slots.length ? slots[added % slots.length] : { x: 260 + (this.random() - .5) * 80, y: 65 + radius };
      const body = Bodies.circle(point.x, point.y, radius, {
        label: 'ball', restitution: .5, friction: .12, frictionStatic: .25, frictionAir: .008,
        density: .001, sleepThreshold: 80, collisionFilter: { category: 1, mask: 0xffffffff },
      });
      Body.setAngle(body, (this.random() - .5) * .9);
      Body.setVelocity(body, { x: (this.random() - .5) * 2, y: 0 });
      this.balls.set(spec.id, { spec, body, radius });
      Composite.add(this.engine.world, body);
      added++;
    }
  }

  stir(milliseconds = 700) {
    this.stirringUntil = this.engine.timing.timestamp + milliseconds;
    for (const { body } of this.balls.values()) Sleeping.set(body, false);
  }

  startDraw(taskId: string) {
    this.releaseDrag();
    if (this.released) {
      this.released.body.collisionFilter.category = 1;
      Body.setPosition(this.released.body, { x: 260, y: 75 });
      Body.setVelocity(this.released.body, { x: 0, y: 0 });
      Sleeping.set(this.released.body, false);
      this.released = null;
    }
    this.completed = false;
    this.drawing = { taskId, started: this.engine.timing.timestamp, target: null };
    this.stir(2300);
  }

  finishImmediately(taskId: string) {
    if (this.released?.spec.taskId === taskId && !this.drawing) return;
    const ball = this.drawing?.target ?? [...this.balls.values()].find((item) => item.spec.taskId === taskId);
    if (ball) {
      ball.body.collisionFilter.category = 2;
      Body.setPosition(ball.body, { x: 260, y: 618 - ball.radius });
      Body.setVelocity(ball.body, { x: 0, y: 0 });
      this.released = ball;
    }
    this.drawing = null;
    this.stirringUntil = 0;
  }

  step() {
    const timestamp = this.engine.timing.timestamp;
    const stirring = timestamp < this.stirringUntil;
    for (const ball of this.balls.values()) {
      const { body } = ball;
      if (stirring && ball !== this.released && body.position.y < 485) {
        Sleeping.set(body, false);
        const dx = body.position.x - 260;
        const dy = body.position.y - 250;
        const length = Math.max(80, Math.hypot(dx, dy));
        Body.applyForce(body, body.position, {
          x: body.mass * (-dy / length * .0028 + Math.sin(timestamp / 190 + ball.spec.number * 1.7) * .001),
          y: body.mass * (dx / length * .0028 - .0015),
        });
      }
    }
    if (this.drawing && timestamp - this.drawing.started > 2300) {
      if (!this.drawing.target) {
        this.drawing.target = [...this.balls.values()].filter((item) => item.spec.taskId === this.drawing!.taskId).sort((a, b) => Math.hypot(a.body.position.x - 260, a.body.position.y - 444) - Math.hypot(b.body.position.x - 260, b.body.position.y - 444))[0] ?? null;
        if (this.drawing.target) this.drawing.target.body.collisionFilter.category = 2;
      }
      const target = this.drawing.target;
      if (target) {
        const body = target.body;
        Sleeping.set(body, false);
        const dx = 260 - body.position.x;
        Body.applyForce(body, body.position, { x: body.mass * clamp(dx * .00015 - body.velocity.x * .00045, -.008, .008), y: body.mass * (Math.abs(dx) > 28 && body.position.y < 490 ? -.0022 : .002) });
        for (const other of this.balls.values()) {
          if (other !== target && other.body.position.y > 160 && Math.abs(other.body.position.x - 260) < 88) {
            Sleeping.set(other.body, false);
            Body.applyForce(other.body, other.body.position, { x: (other.body.position.x < 260 ? -1 : 1) * other.body.mass * .008, y: -other.body.mass * .002 });
          }
        }
        if (body.position.y > 552) {
          this.released = target;
          this.drawing = null;
          this.completed = true;
        }
      }
    }
    Engine.update(this.engine, 1000 / 60);
    for (const ball of this.balls.values()) {
      const { body } = ball;
      if (body.speed > 13) Body.setVelocity(body, { x: body.velocity.x * 13 / body.speed, y: body.velocity.y * 13 / body.speed });
    }
  }

  consumeCompletion() {
    const completed = this.completed;
    this.completed = false;
    return completed;
  }

  beginDrag(point: { x: number; y: number }) {
    this.releaseDrag();
    const ball = [...this.balls.values()].reverse().find((item) => item !== this.released && Math.hypot(item.body.position.x - point.x, item.body.position.y - point.y) < item.radius + 3);
    if (!ball) return false;
    Sleeping.set(ball.body, false);
    this.dragConstraint = Constraint.create({ pointA: point, bodyB: ball.body, pointB: { x: 0, y: 0 }, length: 0, stiffness: .12, damping: .15 });
    Composite.add(this.engine.world, this.dragConstraint);
    return true;
  }

  moveDrag(point: { x: number; y: number }) {
    if (this.dragConstraint) {
      const dx = point.x - 260;
      const dy = point.y - 250;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const scale = Math.min(1, 185 / distance);
      this.dragConstraint.pointA = { x: 260 + dx * scale, y: 250 + dy * scale };
    }
  }

  releaseDrag() {
    if (this.dragConstraint) Composite.remove(this.engine.world, this.dragConstraint);
    this.dragConstraint = null;
  }

  dispose() {
    Events.off(this.engine, 'collisionStart');
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
  }
}
