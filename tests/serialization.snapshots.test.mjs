// Run with: `deno test --allow-read tests/serialization.snapshots.test.mjs`
import { assert, test } from './testlib.js';

import { World, defineComponent, defineTag } from '../core.js';
import {
  serializeWorld,
  serializeEntities,
  serializeEntity,
  deserializeWorld,
  applySnapshot,
  makeRegistry
} from '../serialization.js';

const Position = defineComponent('Position', { x: 0, y: 0 });
const Velocity = defineComponent('Velocity', { dx: 0, dy: 0 });
const Health = defineComponent('Health', { value: 0 });
const Label = defineComponent('Label', { text: '' });
const Marker = defineTag('Marker');

function setupWorld(seed = 1234) {
  const world = new World({ seed });
  const a = world.create();
  const b = world.create();
  const c = world.create();

  world.add(a, Position, { x: 1, y: 2 });
  world.add(a, Velocity, { dx: 0.5, dy: -0.5 });
  world.add(a, Marker);

  world.add(b, Position, { x: 10, y: 20 });
  world.add(b, Label, { text: 'npc-beta' });

  world.add(c, Health, { value: 7 });

  world.frame = 8;
  world.time = 16;

  return { world, ids: [a, b, c] };
}

function collectComponent(world, Comp) {
  return Array.from(world.alive)
    .map((id) => ({ id, rec: world.get(id, Comp) }))
    .filter((row) => row.rec != null)
    .map((row) => ({ id: row.id, rec: row.rec }))
    .sort((a, b) => a.rec.x - b.rec.x || a.rec.y - b.rec.y || a.id - b.id)
    .map((row) => row.rec);
}

function collectRows(rows) {
  return rows.map(([, rec]) => rec);
}

test('serializeWorld produces deterministic alive/meta data and respects filters', () => {
  const { world, ids } = setupWorld();

  const snapshot = serializeWorld(world, { note: 'baseline' });

  assert.deepEqual(snapshot.alive, [...ids].sort((a, b) => a - b));
  assert.deepEqual(snapshot.meta, {
    seed: world.seed >>> 0,
    frame: world.frame,
    time: world.time,
    store: world.storeMode,
    note: 'baseline'
  });

  assert.deepEqual(Object.keys(snapshot.comps).sort(), ['Health', 'Label', 'Marker', 'Position', 'Velocity']);

  const includeOnlyPosition = serializeWorld(world, { include: 'Position' });
  assert.deepEqual(Object.keys(includeOnlyPosition.comps), ['Position']);
  const expectedPositionIds = snapshot.comps.Position.map(([id]) => id).sort((a, b) => a - b);
  assert.deepEqual(
    includeOnlyPosition.comps.Position.map(([id]) => id).sort((a, b) => a - b),
    expectedPositionIds
  );

  const excludeVelocity = serializeWorld(world, { exclude: ['Velocity'] });
  assert.ok(!('Velocity' in excludeVelocity.comps));
  assert.ok('Position' in excludeVelocity.comps, 'other components should remain when excluding specific names');

  const subset = serializeEntities(world, [ids[1], ids[2]]);
  assert.deepEqual(subset.alive, [ids[1], ids[2]].sort((a, b) => a - b));
  assert.deepEqual(
    subset.comps.Position?.map(([id]) => id) ?? [],
    [ids[1]]
  );
  assert.deepEqual(
    subset.comps.Health?.map(([id]) => id) ?? [],
    [ids[2]]
  );

  const single = serializeEntity(world, ids[0]);
  assert.deepEqual(single.alive, [ids[0]]);
  assert.equal(single.comps.Position.length, 1);
  assert.equal(single.comps.Position[0][0], ids[0]);
});

const Owner = defineComponent('Owner', { targetId: 0 });

test('replace mode preserves original entity IDs and cross-entity references', () => {
  const world = new World({ seed: 42 });
  const a = world.create();
  const b = world.create();

  world.add(a, Position, { x: 1, y: 2 });
  world.add(b, Position, { x: 3, y: 4 });
  world.add(b, Owner, { targetId: a });

  const snapshot = serializeWorld(world);
  const registry = makeRegistry(Position, Velocity, Health, Label, Marker, Owner);

  // applySnapshot path (replace, no remap)
  const restored = deserializeWorld(snapshot, registry, { World });
  assert.ok(restored.alive.has(a), 'original entity a should keep its ID');
  assert.ok(restored.alive.has(b), 'original entity b should keep its ID');
  const ownerData = restored.get(b, Owner);
  assert.equal(ownerData.targetId, a, 'cross-entity reference should point to original ID');
  assert.ok(restored.alive.has(ownerData.targetId), 'referenced entity should be alive');
  assert.deepEqual(restored.get(ownerData.targetId, Position), { x: 1, y: 2 });
});

test('World.load restores snapshot using known components and preserves IDs', () => {
  const src = new World({ seed: 77 });
  const a = src.create();
  const b = src.create();

  src.add(a, Position, { x: 5, y: 6 });
  src.add(b, Position, { x: 7, y: 8 });
  src.add(b, Owner, { targetId: a });

  const snapshot = serializeWorld(src);

  // Target world must have seen the same components so _components is populated.
  const target = new World({ seed: 99 });
  const tmp = target.create();
  target.add(tmp, Position, { x: 0, y: 0 });
  target.add(tmp, Owner, { targetId: 0 });

  target.load(snapshot);

  assert.equal(target.alive.size, 2);
  assert.ok(target.alive.has(a));
  assert.ok(target.alive.has(b));
  assert.deepEqual(target.get(a, Position), { x: 5, y: 6 });
  const ref = target.get(b, Owner);
  assert.equal(ref.targetId, a, 'cross-entity ref intact after World.load');
  assert.ok(target.alive.has(ref.targetId));
});

test('World.load rejects being called during tick', () => {
  const src = new World({ seed: 88 });
  const a = src.create();
  src.add(a, Position, { x: 3, y: 4 });
  const snapshot = serializeWorld(src);

  const world = new World({ seed: 89 });
  const e = world.create();
  world.add(e, Position, { x: 10, y: 20 });

  let err = null;
  world.setScheduler((w) => {
    try {
      w.load(snapshot);
    } catch (e) {
      err = e;
    }
  });

  world.tick(1);

  assert.ok(err instanceof Error);
  assert.match(err.message, /load: cannot be called during tick/);
  assert.equal(world.alive.size, 1, 'failed in-tick load should not mutate world state');
  assert.deepEqual(world.get(e, Position), { x: 10, y: 20 });
});

test('World.load applies zero meta values', () => {
  const source = new World({ seed: 901 });
  const id = source.create();
  source.add(id, Position, { x: 9, y: 9 });
  source.time = 0;
  source.frame = 0;
  const snapshot = serializeWorld(source);

  const target = new World({ seed: 902 });
  const seen = target.create();
  target.add(seen, Position, { x: 0, y: 0 });
  target.time = 123;
  target.frame = 456;

  target.load(snapshot);

  assert.equal(target.time, 0);
  assert.equal(target.frame, 0);
});

test('World.load rejects invalid entity IDs from snapshot', () => {
  const world = new World({ seed: 903 });
  const seen = world.create();
  world.add(seen, Position, { x: 1, y: 1 });

  const badSnapshot = {
    v: 1,
    meta: {},
    comps: { Position: [[0, { x: 7, y: 8 }]] },
    alive: [0]
  };

  assert.throws(() => world.load(badSnapshot), Error, /load: invalid entity id/);
});

test('applySnapshot rejects being called during tick', () => {
  const src = new World({ seed: 904 });
  const srcId = src.create();
  src.add(srcId, Position, { x: 2, y: 3 });
  const snapshot = serializeWorld(src);
  const registry = makeRegistry(Position, Velocity, Health, Label, Marker, Owner);

  const world = new World({ seed: 905 });
  const id = world.create();
  world.add(id, Position, { x: 9, y: 9 });

  let err = null;
  world.setScheduler((w) => {
    try {
      applySnapshot(w, snapshot, registry, { mode: 'replace' });
    } catch (e) {
      err = e;
    }
  });

  world.tick(1);

  assert.ok(err instanceof Error);
  assert.match(err.message, /applySnapshot: cannot be called during tick/);
  assert.equal(world.alive.size, 1, 'failed in-tick applySnapshot should not mutate world state');
  assert.deepEqual(world.get(id, Position), { x: 9, y: 9 });
});

test('applySnapshot applies zero meta values', () => {
  const source = new World({ seed: 906 });
  const id = source.create();
  source.add(id, Position, { x: 4, y: 4 });
  source.time = 0;
  source.frame = 0;
  const snapshot = serializeWorld(source);
  const registry = makeRegistry(Position, Velocity, Health, Label, Marker);

  const target = new World({ seed: 907 });
  const seen = target.create();
  target.add(seen, Position, { x: 1, y: 1 });
  target.time = 100;
  target.frame = 200;

  applySnapshot(target, snapshot, registry, { mode: 'replace' });

  assert.equal(target.time, 0);
  assert.equal(target.frame, 0);
});

test('applySnapshot rejects invalid entity IDs from snapshot', () => {
  const world = new World({ seed: 908 });
  const registry = makeRegistry(Position);
  const badSnapshot = {
    v: 1,
    meta: {},
    comps: { Position: [[0, { x: 10, y: 20 }]] },
    alive: [0]
  };

  assert.throws(
    () => applySnapshot(world, badSnapshot, registry, { mode: 'replace' }),
    Error,
    /applySnapshot: invalid entity id/
  );
});

function sortByVec(a, b) {
  return (a.x - b.x) || (a.y - b.y);
}

test('deserialize and apply snapshots rebuild worlds with registry/append/remap options', () => {
  const { world } = setupWorld(9001);
  const snapshot = serializeWorld(world, { note: 'roundtrip' });
  const registry = makeRegistry(Position, Velocity, Health, Label, Marker);

  const restored = deserializeWorld(snapshot, registry, { World });
  assert.equal(restored.alive.size, snapshot.alive.length);

  const restoredPositions = collectComponent(restored, Position).sort(sortByVec);
  const expectedPositions = collectRows(snapshot.comps.Position).sort(sortByVec);
  assert.deepEqual(restoredPositions, expectedPositions);

  const replaced = new World({ seed: 1111 });
  const old = replaced.create();
  replaced.add(old, Label, { text: 'legacy' });
  applySnapshot(replaced, snapshot, registry, { mode: 'replace' });
  assert.equal(replaced.alive.size, snapshot.alive.length);
  const replacedPositions = collectComponent(replaced, Position).sort(sortByVec);
  assert.deepEqual(replacedPositions, expectedPositions);

  const unknownSnapshot = {
    ...snapshot,
    comps: {
      ...snapshot.comps,
      UnknownComp: [[snapshot.alive[0], { foo: 1 }]]
    }
  };

  const appendWorld = new World({ seed: 4242 });
  const keep = appendWorld.create();
  appendWorld.add(keep, Label, { text: 'keep' });
  const anchor = appendWorld.create();
  appendWorld.add(anchor, Position, { x: -1, y: -1 });

  applySnapshot(appendWorld, unknownSnapshot, registry, {
    mode: 'append',
    skipUnknown: true,
    remapId(oldId) {
      return oldId === snapshot.alive[0] ? anchor : 0;
    }
  });

  assert.ok(appendWorld.has(keep, Label), 'append mode should preserve pre-existing entities');
  const anchorPos = appendWorld.get(anchor, Position);
  assert.deepEqual(anchorPos, expectedPositions[0]);

  const totalExpected = 2 + (snapshot.alive.length - 1);
  assert.equal(appendWorld.alive.size, totalExpected);
});
