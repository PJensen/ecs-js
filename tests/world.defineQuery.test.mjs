import { assert, test } from './testlib.js';

import { World, defineComponent } from '../core.js';

const Position = defineComponent('Position', { x: 0, y: 0 });
const Velocity = defineComponent('Velocity', { x: 0, y: 0 });

test('defineQuery creates reusable handles with chaining', () => {
  const world = new World();
  const e1 = world.create();
  world.add(e1, Position, { x: 5, y: 0 });
  world.add(e1, Velocity, { x: 1, y: 0 });

  const e2 = world.create();
  world.add(e2, Position, { x: -2, y: 1 });
  world.add(e2, Velocity, { x: 0, y: 1 });

  const movingRight = world.defineQuery(Position, Velocity).where((pos, vel) => pos.x > 0 && vel.x >= 0);
  const rows = [...movingRight()].map(([id]) => id);
  assert.deepEqual(rows, [e1]);

  const limited = movingRight.limit(0);
  assert.equal([...limited()].length, 0);

  const ordered = world.defineQuery(Position, Velocity)
    .orderBy((a, b) => a.comps[0].x - b.comps[0].x)
    .project((id, pos, vel) => ({ id, speed: vel.x + vel.y }));

  const orderedRows = [...ordered()];
  assert.deepEqual(orderedRows, [
    { id: e2, speed: 1 },
    { id: e1, speed: 1 }
  ]);
});
