import { assert, test } from './testlib.js';

import { World } from '../core.js';
import { createCrossWorldReference, isCrossWorldReferenceValid, resolveCrossWorldReference } from '../crossWorld.js';
import { attach, destroySubtree } from '../hierarchy.js';

test('cross-world references invalidate when hierarchy nodes are destroyed', () => {
  const worldA = new World();
  const parent = worldA.create();
  const child = worldA.create();
  attach(worldA, child, parent);

  const ref = createCrossWorldReference(worldA, child);
  assert.ok(isCrossWorldReferenceValid(ref));
  assert.equal(resolveCrossWorldReference(ref), child);

  destroySubtree(worldA, parent);

  assert.equal(worldA.isAlive(parent), false);
  assert.equal(worldA.isAlive(child), false);
  assert.equal(resolveCrossWorldReference(ref), 0, 'destroying the subtree should invalidate the reference');

  const worldB = new World();
  const strayRef = { world: worldB, id: 999 };
  assert.equal(isCrossWorldReferenceValid(strayRef), false);
  assert.equal(resolveCrossWorldReference({ world: null, id: child }), 0);
});
