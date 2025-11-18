import { assert, test } from './testlib.js';

import { World } from '../core.js';
import { Systems, runSystems, clearSystems } from '../systems.js';

test('phase builder wires dependencies and introspection', (t) => {
  t.after(() => clearSystems());

  const world = new World();
  const calls = [];
  const update = () => { calls.push('update'); };
  const integrate = () => { calls.push('integrate'); };
  const cleanup = () => { calls.push('cleanup'); };

  Systems.phase('physics')
    .clear()
    .add(update).before(integrate)
    .add(integrate)
    .add(cleanup).after(integrate);

  assert.deepEqual(Systems.phase('physics').list(), [update, integrate, cleanup]);

  runSystems('physics', world, 16);
  assert.deepEqual(calls, ['update', 'integrate', 'cleanup']);
});

test('phase builder orders phases explicitly', (t) => {
  t.after(() => clearSystems());

  const world = new World();
  const order = [];
  const first = () => { order.push('first'); };
  const second = () => { order.push('second'); };

  Systems.phase('render')
    .clear()
    .add(first)
    .add(second)
    .order(second, first);

  runSystems('render', world, 0);
  assert.deepEqual(order, ['second', 'first']);
});
