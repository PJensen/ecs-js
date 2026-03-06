import { assert, test } from './testlib.js';

import { World, defineComponent } from '../core.js';

test('large batches of deferred destroys flush across ticks in order', () => {
  const world = new World();
  const ids = Array.from({ length: 1002 }, () => world.create());
  let ran = false;

  world.setScheduler((w) => {
    if (ran) return;
    ran = true;
    for (const id of ids) w.destroy(id);
  });

  world.tick(0);
  assert.equal(world.alive.size, 2, 'first batch should process up to the command limit');
  assert.equal(world.pendingOps().length, 2, 'leftover destroy commands should remain queued');

  world.tick(0);
  assert.equal(world.alive.size, 0, 'remaining commands should flush on the next tick');
  assert.equal(world.pendingOps().length, 0);
});

test('remove/add sequencing during a tick preserves command order', () => {
  const Position = defineComponent('Position', { x: 0 });
  const world = new World();
  const eid = world.create();
  world.add(eid, Position, { x: 1 });

  let ran = false;
  world.setScheduler((w) => {
    if (ran) return;
    ran = true;
    w.remove(eid, Position);
    w.add(eid, Position, { x: 5 });
  });

  world.tick(0);
  assert.equal(world.get(eid, Position).x, 5, 'later immediate add should cancel the earlier queued remove');

  world.tick(0);
  assert.equal(world.changed(eid, Position), false, 'change marks clear after each tick');
});

test('addDeferred queues attachment until after the scheduler', () => {
  const Position = defineComponent('Position', { x: 0 });
  const world = new World();
  const eid = world.create();
  let seenDuringScheduler = false;

  world.setScheduler((w) => {
    w.addDeferred(eid, Position, { x: 42 });
    seenDuringScheduler = !!w.get(eid, Position);
  });

  world.tick(0);

  assert.equal(seenDuringScheduler, false, 'addDeferred should not attach the component until after the scheduler');
  assert.equal(world.get(eid, Position).x, 42, 'queued add should flush at the end of the tick');
});

test('removeImmediate cancels queued component ops and keeps the component absent', () => {
  const Position = defineComponent('Position', { x: 0 });
  const world = new World({ strict: true });
  const eid = world.create();
  let seenDuringScheduler = true;

  world.setScheduler((w) => {
    w.addDeferred(eid, Position, { x: 7 });
    w.removeImmediate(eid, Position);
    seenDuringScheduler = w.has(eid, Position);
  });

  world.tick(0);

  assert.equal(seenDuringScheduler, false, 'removeImmediate should make the component absent immediately');
  assert.equal(world.has(eid, Position), false, 'queued add should be cancelled by removeImmediate');
});

test('destroyImmediate clears queued ops for the destroyed entity', () => {
  const Position = defineComponent('Position', { x: 0 });
  const world = new World({ strict: true });
  const eid = world.create();
  let aliveDuringScheduler = true;

  world.setScheduler((w) => {
    w.addDeferred(eid, Position, { x: 1 });
    w.destroyImmediate(eid);
    aliveDuringScheduler = w.isAlive(eid);
  });

  world.tick(0);

  assert.equal(aliveDuringScheduler, false, 'destroyImmediate should destroy the entity immediately');
  assert.equal(world.isAlive(eid), false);
  assert.equal(world.pendingOps().length, 0, 'queued ops for the destroyed entity should be dropped');
});
