import { assert, test } from './testlib.js';
import { World } from '../core.js';
import {
  attach, detach, children, childCount, ensureParent,
  Parent, Sibling, getParent, indexOf
} from '../hierarchy.js';

test('attach throws on self-attach', () => {
  const world = new World();
  const e = world.create();
  assert.throws(() => attach(world, e, e), Error, /cannot parent to self/);
});

test('attach throws when parent is descendant of child (cycle)', () => {
  const world = new World();
  const a = world.create();
  const b = world.create();
  const c = world.create();
  attach(world, b, a);
  attach(world, c, b);
  // a -> b -> c; attaching a under c would create a cycle
  assert.throws(() => attach(world, a, c), Error, /cannot create a cycle/);
});

test('attach throws when both before and after specified', () => {
  const world = new World();
  const parent = world.create();
  const x = world.create();
  const y = world.create();
  attach(world, x, parent);
  attach(world, y, parent);
  const child = world.create();
  assert.throws(
    () => attach(world, child, parent, { before: x, after: y }),
    Error,
    /at most one of before\/after/
  );
});

test('attach throws when before target is not child of parent', () => {
  const world = new World();
  const p1 = world.create();
  const p2 = world.create();
  const x = world.create();
  attach(world, x, p2); // x belongs to p2, not p1
  ensureParent(world, p1);
  const child = world.create();
  assert.throws(
    () => attach(world, child, p1, { before: x }),
    Error,
    /before target not child of parent/
  );
});

test('attach throws when after target is not child of parent', () => {
  const world = new World();
  const p1 = world.create();
  const p2 = world.create();
  const x = world.create();
  attach(world, x, p2); // x belongs to p2, not p1
  ensureParent(world, p1);
  const child = world.create();
  assert.throws(
    () => attach(world, child, p1, { after: x }),
    Error,
    /after target not child of parent/
  );
});

test('detach is a no-op for entity without Sibling component', () => {
  const world = new World();
  const e = world.create();
  // should not throw, just return the entity
  const result = detach(world, e);
  assert.equal(result, e);
  assert.equal(world.has(e, Sibling), false, 'entity should still lack Sibling');
});

test('detach an only child empties the parent', () => {
  const world = new World();
  const parent = world.create();
  const child = world.create();
  attach(world, child, parent);
  assert.equal(childCount(world, parent), 1);

  detach(world, child);
  assert.equal(childCount(world, parent), 0);
  const p = world.get(parent, Parent);
  assert.equal(p.first, 0, 'first should be 0');
  assert.equal(p.last, 0, 'last should be 0');
});

test('detach with opts.remove strips Sibling component', () => {
  const world = new World();
  const parent = world.create();
  const child = world.create();
  attach(world, child, parent);
  assert.ok(world.has(child, Sibling));

  detach(world, child, { remove: true });
  assert.equal(world.has(child, Sibling), false, 'Sibling should be removed');
});

test('detach without opts.remove zeroes Sibling fields', () => {
  const world = new World();
  const parent = world.create();
  const child = world.create();
  attach(world, child, parent);

  detach(world, child);
  assert.ok(world.has(child, Sibling), 'Sibling should still be present');
  const s = world.get(child, Sibling);
  assert.equal(s.parent, 0, 'parent should be zeroed');
  assert.equal(s.prev, 0, 'prev should be zeroed');
  assert.equal(s.next, 0, 'next should be zeroed');
  assert.equal(s.index, 0, 'index should be zeroed');
});

test('children yields nothing for entity without Parent component', () => {
  const world = new World();
  const e = world.create();
  const list = [...children(world, e)];
  assert.deepEqual(list, []);
});

test('children yields nothing for ensured but empty parent', () => {
  const world = new World();
  const e = world.create();
  ensureParent(world, e);
  assert.ok(world.has(e, Parent), 'should have Parent component');
  const list = [...children(world, e)];
  assert.deepEqual(list, []);
});
