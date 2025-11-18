import { assert, test } from './testlib.js';

import { World, defineComponent } from '../core.js';
import { applySnapshot, deserializeWorld, makeRegistry, serializeWorld } from '../serialization.js';

const Position = defineComponent('Position', { x: 0 });
const Note = defineComponent('Note', { text: '' });

function collectPositions(world) {
  return Array.from(world.query(Position)).map(([, pos]) => pos.x).sort((a, b) => a - b);
}

test('serialize/deserialize round-trips across store modes and seeds', () => {
  const source = new World({ seed: 7, store: 'soa' });
  const a = source.create();
  const b = source.create();
  source.add(a, Position, { x: 10 });
  source.add(b, Position, { x: -1 });
  source.add(a, Note, { text: 'keep' });

  const snapshot = serializeWorld(source, { note: 'soa-to-map' });
  assert.equal(snapshot.meta.store, 'soa');

  const registry = makeRegistry(Position, Note);
  const restored = deserializeWorld(snapshot, registry, { World, store: 'map', seed: 42 });

  assert.equal(restored.storeMode, 'map', 'store override should be respected');
  assert.equal(restored.seed, 42);
  assert.deepEqual(collectPositions(restored), [-1, 10]);
});

test('unknown components error unless explicitly skipped', () => {
  const registry = makeRegistry(Position);
  const snapshot = {
    v: 1,
    meta: { seed: 1, frame: 0, time: 0, store: 'map' },
    comps: { Unknown: [[1, { foo: 'bar' }]] },
    alive: [1]
  };

  const world = new World();
  assert.throws(() => applySnapshot(world, snapshot, registry), /unknown component/i);
  assert.equal(world.alive.size, 0);
});
