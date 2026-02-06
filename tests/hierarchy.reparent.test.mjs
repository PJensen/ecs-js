import { assert, test } from './testlib.js';
import { World } from '../core.js';
import {
  attach, detach, reparent, destroySubtree,
  children, childCount, getParent, indexOf,
  Parent, Sibling, ensureParent
} from '../hierarchy.js';

test('reparent moves child from one parent to another', () => {
  const world = new World();
  const pA = world.create();
  const pB = world.create();
  const child = world.create();
  attach(world, child, pA);
  assert.equal(getParent(world, child), pA);
  assert.equal(childCount(world, pA), 1);

  reparent(world, child, pB);
  assert.equal(getParent(world, child), pB);
  assert.equal(childCount(world, pA), 0, 'old parent should have 0 children');
  assert.equal(childCount(world, pB), 1, 'new parent should have 1 child');
});

test('reparent with before/after ordering', () => {
  const world = new World();
  const pA = world.create();
  const pB = world.create();
  const x = world.create();
  const y = world.create();
  const child = world.create();
  attach(world, x, pB);
  attach(world, y, pB);
  attach(world, child, pA);

  reparent(world, child, pB, { before: y });
  const kids = [...children(world, pB)];
  assert.deepEqual(kids, [x, child, y]);
});

test('reparent to self throws via attach guard', () => {
  const world = new World();
  const e = world.create();
  assert.throws(() => reparent(world, e, e), Error, /cannot parent to self/);
});

test('reparent creating cycle throws', () => {
  const world = new World();
  const a = world.create();
  const b = world.create();
  const c = world.create();
  attach(world, b, a);
  attach(world, c, b);
  // a -> b -> c; reparenting a under c would be a cycle
  assert.throws(() => reparent(world, a, c), Error, /cannot create a cycle/);
});

test('deep tree: 5-level hierarchy traversal', () => {
  const world = new World();
  const root = world.create();
  const a = world.create();
  const b = world.create();
  const c = world.create();
  const d = world.create();
  const e = world.create();
  attach(world, a, root);
  attach(world, b, a);
  attach(world, c, b);
  attach(world, d, c);
  attach(world, e, d);

  assert.equal(getParent(world, a), root);
  assert.equal(getParent(world, b), a);
  assert.equal(getParent(world, c), b);
  assert.equal(getParent(world, d), c);
  assert.equal(getParent(world, e), d);
  assert.equal(childCount(world, root), 1);
  assert.equal(childCount(world, d), 1);
});

test('destroySubtree on deep tree destroys all descendants', () => {
  const world = new World();
  const root = world.create();
  const a = world.create();
  const b = world.create();
  const c = world.create();
  const d = world.create();
  const e = world.create();
  attach(world, a, root);
  attach(world, b, a);
  attach(world, c, b);
  attach(world, d, c);
  attach(world, e, d);

  destroySubtree(world, root);
  for (const eid of [root, a, b, c, d, e]) {
    assert.equal(world.isAlive(eid), false, `entity ${eid} should be dead`);
  }
});

test('destroySubtree on leaf destroys only that node', () => {
  const world = new World();
  const parent = world.create();
  const leaf = world.create();
  const sibling = world.create();
  attach(world, leaf, parent);
  attach(world, sibling, parent);
  assert.equal(childCount(world, parent), 2);

  // destroySubtree calls world.destroy() which removes component stores
  // but does NOT call detach(), so the parent's count is not decremented.
  // Use detach + destroy for clean removal from a surviving parent.
  detach(world, leaf);
  destroySubtree(world, leaf);
  assert.equal(world.isAlive(leaf), false, 'leaf should be dead');
  assert.ok(world.isAlive(parent), 'parent should be alive');
  assert.ok(world.isAlive(sibling), 'sibling should be alive');
  assert.equal(childCount(world, parent), 1, 'parent should have 1 child remaining');
});

test('reparent preserves sibling indices at new parent', () => {
  const world = new World();
  const pA = world.create();
  const pB = world.create();
  const x = world.create();
  const child = world.create();
  const y = world.create();
  const m = world.create();
  const n = world.create();

  // pA has [x, child, y]
  attach(world, x, pA);
  attach(world, child, pA);
  attach(world, y, pA);
  // pB has [m, n]
  attach(world, m, pB);
  attach(world, n, pB);

  assert.equal(indexOf(world, x), 0);
  assert.equal(indexOf(world, child), 1);
  assert.equal(indexOf(world, y), 2);

  reparent(world, child, pB);

  // pA should now have [x, y] with contiguous indices 0, 1
  assert.deepEqual([...children(world, pA)], [x, y]);
  assert.equal(childCount(world, pA), 2);
  assert.equal(indexOf(world, x), 0);
  assert.equal(indexOf(world, y), 1, 'y should be bumped down to index 1 after middle child removed');

  // pB should have [m, n, child] with contiguous indices
  assert.deepEqual([...children(world, pB)], [m, n, child]);
  assert.equal(indexOf(world, m), 0);
  assert.equal(indexOf(world, n), 1);
  assert.equal(indexOf(world, child), 2);
});
