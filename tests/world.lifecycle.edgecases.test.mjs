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
  assert.equal(world.get(eid, Position).x, 5, 'deferred add should win after the queued remove');

  world.tick(0);
  assert.equal(world.changed(eid, Position), false, 'change marks clear after each tick');
});
