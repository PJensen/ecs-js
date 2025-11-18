import { assert, test } from './testlib.js';

import { World, defineComponent } from '../core.js';

const Position = defineComponent('Position', { x: 0, y: 0 });
const Velocity = defineComponent('Velocity', { x: 0, y: 0 });

test('world.debug.inspect snapshots component values with diffs', () => {
  const world = new World({ debug: true });
  const eid = world.create();

  world.add(eid, Position, { x: 2, y: 4 });
  world.add(eid, Velocity, { x: -1, y: 1 });

  let snapshot = world.debug.inspect(eid);
  assert.equal(snapshot.id, eid);
  assert.equal(snapshot.alive, true);
  assert.deepEqual(snapshot.removed, []);
  assert.deepEqual(snapshot.components.Position.value, { x: 2, y: 4 });
  assert.equal(snapshot.components.Position.previous, null);
  assert.equal(snapshot.components.Position.diff, null);

  world.set(eid, Position, { y: 8 });
  world.remove(eid, Velocity);

  snapshot = world.debug.inspect(eid);
  assert.equal(snapshot.components.Position.changed, true);
  assert.deepEqual(snapshot.components.Position.previous, { x: 2, y: 4 });
  assert.deepEqual(snapshot.components.Position.diff, {
    changed: { y: { before: 4, after: 8 } },
  });
  assert.deepEqual(snapshot.removed, ['Velocity']);

  world.destroy(eid);
  snapshot = world.debug.inspect(eid);
  assert.equal(snapshot.alive, false);
});
