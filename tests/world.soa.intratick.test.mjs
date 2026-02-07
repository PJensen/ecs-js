import { assert, test } from './testlib.js';

import { World, defineComponent } from '../core.js';
import { clearSystems, composeScheduler } from '../systems.js';

const Position = defineComponent('Position', { x: 0, y: 0 });
const Velocity = defineComponent('Velocity', { dx: 0, dy: 0 });

test('SoA direct mutation is visible to later phases in the same tick', (t) => {
  for (const store of ['soa', 'map']) {
    clearSystems();
    const world = new World({ store });
    const e = world.create();
    world.add(e, Position, { x: 0, y: 0 });
    world.add(e, Velocity, { dx: 10, dy: 5 });

    let posAfterMove = null;

    // Phase 1: move — directly mutate Position via the query tuple reference
    function moveSystem(w, dt) {
      for (const [id, pos, vel] of w.query(Position, Velocity)) {
        pos.x += vel.dx * dt;
        pos.y += vel.dy * dt;
      }
    }

    // Phase 2: read — read Position and verify it reflects the mutation
    function readSystem(w, dt) {
      for (const [id, pos] of w.query(Position)) {
        posAfterMove = { x: pos.x, y: pos.y };
      }
    }

    world.system(moveSystem, 'move');
    world.system(readSystem, 'read');
    world.setScheduler(composeScheduler('move', 'read'));

    world.tick(1);

    assert.equal(posAfterMove.x, 10, `[${store}] direct mutation should be visible in later phase`);
    assert.equal(posAfterMove.y, 5, `[${store}] direct mutation should be visible in later phase`);
  }
  t.after(clearSystems);
});

test('world.set() is deferred during tick and NOT visible to later phases', (t) => {
  for (const store of ['soa', 'map']) {
    clearSystems();
    const world = new World({ store });
    const e = world.create();
    world.add(e, Position, { x: 0, y: 0 });
    world.add(e, Velocity, { dx: 10, dy: 5 });

    let posAfterMove = null;

    // Phase 1: move — use world.set() (deferred in non-strict mode)
    function moveSystem(w, dt) {
      for (const [id, pos, vel] of w.query(Position, Velocity)) {
        w.set(id, Position, { x: pos.x + vel.dx * dt, y: pos.y + vel.dy * dt });
      }
    }

    // Phase 2: read — check what Position looks like
    function readSystem(w, dt) {
      for (const [id, pos] of w.query(Position)) {
        posAfterMove = { x: pos.x, y: pos.y };
      }
    }

    world.system(moveSystem, 'move');
    world.system(readSystem, 'read');
    world.setScheduler(composeScheduler('move', 'read'));

    world.tick(1);

    // world.set() was deferred, so readSystem sees OLD values
    assert.equal(posAfterMove.x, 0, `[${store}] world.set() should be deferred; old value visible`);
    assert.equal(posAfterMove.y, 0, `[${store}] world.set() should be deferred; old value visible`);

    // After tick completes, deferred set is flushed
    const pos = world.get(e, Position);
    assert.equal(pos.x, 10, `[${store}] deferred set should be applied after tick`);
    assert.equal(pos.y, 5, `[${store}] deferred set should be applied after tick`);
  }
  t.after(clearSystems);
});

test('SoA view object properties write through to backing arrays', () => {
  const world = new World({ store: 'soa' });
  const e = world.create();
  world.add(e, Position, { x: 1, y: 2 });

  // Get a view, mutate it, then get another view — should reflect the mutation
  const view1 = world.get(e, Position);
  view1.x = 99;

  const view2 = world.get(e, Position);
  assert.equal(view2.x, 99, 'SoA views should share the same backing array');
  assert.equal(view1 === view2, true, 'SoA should return the same view object for a given entity');
});

test('multi-phase pipeline: steer → integrate → wrap all via direct mutation', (t) => {
  clearSystems();
  const world = new World({ store: 'soa' });
  const Accel = defineComponent('Accel', { ax: 0, ay: 0 });
  const e = world.create();
  world.add(e, Position, { x: 50, y: 50 });
  world.add(e, Velocity, { dx: 0, dy: 0 });
  world.add(e, Accel, { ax: 100, ay: 0 });

  const WIDTH = 100;
  const trail = [];

  function integrateSystem(w, dt) {
    for (const [id, pos, vel, acc] of w.query(Position, Velocity, Accel)) {
      vel.dx += acc.ax * dt;
      vel.dy += acc.ay * dt;
      pos.x += vel.dx * dt;
      pos.y += vel.dy * dt;
    }
  }

  function wrapSystem(w, dt) {
    for (const [id, pos] of w.query(Position)) {
      pos.x = ((pos.x % WIDTH) + WIDTH) % WIDTH;
    }
  }

  function recordSystem(w, dt) {
    for (const [id, pos, vel] of w.query(Position, Velocity)) {
      trail.push({ x: pos.x, y: pos.y, dx: vel.dx, dy: vel.dy });
    }
  }

  world.system(integrateSystem, 'integrate');
  world.system(wrapSystem, 'wrap');
  world.system(recordSystem, 'record');
  world.setScheduler(composeScheduler('integrate', 'wrap', 'record'));

  // Tick 1: accel=100, dt=1 → vel becomes 100, pos becomes 50+100=150 → wrap to 50
  world.tick(1);
  assert.equal(trail[0].dx, 100, 'velocity should update from acceleration');
  assert.equal(trail[0].x, 50, 'position should wrap after exceeding width');

  // Tick 2: vel=100+100=200, pos=50+200=250 → wrap to 50
  world.tick(1);
  assert.equal(trail[1].dx, 200, 'velocity accumulates across ticks');
  assert.equal(trail[1].x, 50, 'position should wrap again');

  t.after(clearSystems);
});
