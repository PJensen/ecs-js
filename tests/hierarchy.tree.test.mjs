import { assert, test } from './testlib.js';

import { World } from '../core.js';
import { Tree, children, childCount } from '../hierarchy.js';

test('Tree facade wires hierarchy operations', () => {
  const world = new World();
  const root = world.create();
  const a = world.create();
  const b = world.create();
  const c = world.create();

  const tree = Tree(world);

  tree.attach(a).to(root);
  tree.attach(b).to(root).first();
  tree.attach(c).to(root).after(a);

  assert.deepEqual(tree.children(root), [b, a, c]);
  assert.equal(childCount(world, root), 3);

  tree.detach(a);
  assert.deepEqual(Array.from(children(world, root)), [b, c]);

  tree.destroySubtree(root);
  assert.equal(world.isAlive(root), false);
  assert.equal(world.isAlive(a), true);
  assert.equal(world.isAlive(b), false);
  assert.equal(world.isAlive(c), false);
});
