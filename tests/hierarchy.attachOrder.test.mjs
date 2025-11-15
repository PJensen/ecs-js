import { test } from 'node:test';
import assert from 'node:assert/strict';

import { World } from '../core.js';
import { attach, children, Parent, Sibling, indexOf } from '../hierarchy.js';

test('attach bumps sibling indices before pointer rewiring', () => {
  const world = new World();
  const parent = world.create();
  const first = world.create();
  const second = world.create();

  attach(world, first, parent);
  attach(world, second, parent);

  const inserted = world.create();
  const events = [];
  const originalSet = world.set.bind(world);
  world.set = (id, Comp, patch) => {
    if (Comp === Parent || Comp === Sibling) {
      const pointer = ('prev' in patch) || ('next' in patch) || ('first' in patch) || ('last' in patch);
      const indexUpdate = Object.prototype.hasOwnProperty.call(patch, 'index');
      if (pointer || indexUpdate) events.push({ id, pointer, indexUpdate });
    }
    return originalSet(id, Comp, patch);
  };

  try {
    attach(world, inserted, parent, { before: second });
  } finally {
    world.set = originalSet;
  }

  const firstPointerEvent = events.findIndex(ev => ev.pointer);
  const firstIndexEvent = events.findIndex(ev => ev.indexUpdate && ev.id !== inserted);
  assert.ok(firstPointerEvent !== -1, 'expected a pointer mutation when inserting before a sibling');
  assert.ok(firstIndexEvent !== -1, 'expected an index bump for existing siblings');
  assert.ok(firstPointerEvent > firstIndexEvent,
    `expected pointer mutations to happen after index bumps (got pointer at ${firstPointerEvent}, bump at ${firstIndexEvent})`);

  assert.deepEqual(Array.from(children(world, parent)), [first, inserted, second]);
  assert.equal(indexOf(world, first), 0);
  assert.equal(indexOf(world, inserted), 1);
  assert.equal(indexOf(world, second), 2);
});
