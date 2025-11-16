/**
 * Run with: `node tests/serialization.snapshots.test.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

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
