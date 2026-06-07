import { assert, test } from './testlib.js';

import { World, defineComponent, defineExtension, defineWorldResource } from '../core.js';
import { applySnapshot, makeRegistry, serializeWorld } from '../serialization.js';

const Marker = defineComponent('ResourceMarker', { value: 0 });

test('defineWorldResource validates names and hooks', () => {
  assert.throws(() => defineWorldResource('', {}), /name must be a non-empty string/);
  assert.throws(() => defineWorldResource('bad.create', { create: 1 }), /create must be a function/);
  assert.throws(() => defineWorldResource('bad.reset', { reset: 1 }), /reset must be a function/);
  assert.throws(() => defineWorldResource('bad.dispose', { dispose: 1 }), /dispose must be a function/);
  assert.throws(() => defineWorldResource('bad.serialize', { serialize: 1 }), /serialize must be a function/);
  assert.throws(() => defineWorldResource('bad.deserialize', { deserialize: 1 }), /deserialize must be a function/);
});

test('world resources are lazily created and discoverable', () => {
  let creates = 0;
  const Queue = defineWorldResource('test.queue', {
    create: () => {
      creates++;
      return [];
    },
    reset: (queue) => {
      queue.length = 0;
    }
  });

  const world = new World();
  assert.equal(world.hasResource(Queue), false);

  const first = world.resource(Queue);
  const second = world.resource(Queue);
  first.push('event');

  assert.equal(first, second);
  assert.equal(creates, 1);
  assert.equal(world.hasResource(Queue), true);

  const records = world.resources();
  assert.equal(records.length, 1);
  assert.equal(records[0].name, 'test.queue');
  assert.equal(records[0].resource, Queue);
  assert.equal(records[0].value, first);
  assert.equal(records[0].serializable, false);
  assert.equal(records[0].resettable, true);
  assert.equal(world.debug.resources()[0].name, 'test.queue');
});

test('resource reset, set, and delete run definition hooks', () => {
  const disposed = [];
  const Handles = defineWorldResource('test.handles', {
    create: () => ({ ids: [1, 2] }),
    dispose: (value) => {
      disposed.push(value.ids.slice());
    }
  });

  const world = new World();
  const first = world.resource(Handles);
  assert.deepEqual(first.ids, [1, 2]);

  const reset = world.resetResource(Handles);
  assert.deepEqual(reset.ids, [1, 2]);
  assert.ok(reset !== first);
  assert.deepEqual(disposed, [[1, 2]]);

  const replacement = { ids: [9] };
  world.setResource(Handles, replacement);
  assert.deepEqual(disposed, [[1, 2], [1, 2]]);
  assert.equal(world.resource(Handles), replacement);

  assert.equal(world.deleteResource(Handles), true);
  assert.deepEqual(disposed, [[1, 2], [1, 2], [9]]);
  assert.equal(world.hasResource(Handles), false);
  assert.equal(world.deleteResource(Handles), false);
});

test('extensions can use world resources without becoming resource owners', () => {
  const Queue = defineWorldResource('test.extensionQueue', {
    create: () => []
  });
  const listener = defineExtension('test.queueListener', (world) => {
    return world.on('queued', (payload, w) => {
      w.resource(Queue).push(payload);
    });
  });

  const world = new World();
  world.install(listener);
  world.emit('queued', { id: 1 });

  assert.deepEqual(world.resource(Queue), [{ id: 1 }]);
  assert.equal(world.hasExtension(listener), true);
});

test('runtime resources are omitted from snapshots and survive load/applySnapshot', () => {
  const Queue = defineWorldResource('test.runtimeQueue', {
    create: () => []
  });

  const source = new World({ seed: 11 });
  const id = source.create();
  source.add(id, Marker, { value: 7 });
  source.resource(Queue).push('runtime-only');

  const snapshot = serializeWorld(source);
  assert.equal(snapshot.resources, undefined);

  const loaded = new World({ seed: 12 });
  const known = loaded.create();
  loaded.add(known, Marker, { value: 0 });
  loaded.resource(Queue).push('keep');
  loaded.load(snapshot, { skipUnknown: false });

  assert.deepEqual(loaded.resource(Queue), ['keep']);

  const applied = new World({ seed: 13 });
  applied.resource(Queue).push('also-keep');
  applySnapshot(applied, snapshot, makeRegistry(Marker));

  assert.deepEqual(applied.resource(Queue), ['also-keep']);
});

test('serializable resources round-trip through serializeWorld and applySnapshot', () => {
  const Counter = defineWorldResource('test.counter', {
    create: () => ({ value: 0 }),
    serialize: (counter) => counter.value,
    deserialize: (value) => ({ value }),
    serializable: true
  });

  const source = new World({ seed: 21 });
  source.resource(Counter).value = 42;

  const snapshot = serializeWorld(source);
  assert.deepEqual(snapshot.resources, { 'test.counter': 42 });

  const restored = new World({ seed: 22 });
  applySnapshot(restored, snapshot, makeRegistry(), {
    resources: [Counter]
  });

  assert.deepEqual(restored.resource(Counter), { value: 42 });
});

test('World.load restores serializable resources known to the target world', () => {
  const Counter = defineWorldResource('test.loadCounter', {
    create: () => ({ value: 0 }),
    serializable: true
  });

  const source = new World({ seed: 31 });
  source.setResource(Counter, { value: 5 });

  const target = new World({ seed: 32 });
  target.resource(Counter);
  target.load(serializeWorld(source));

  assert.deepEqual(target.resource(Counter), { value: 5 });
});

test('unknown serializable resources are rejected unless skipped', () => {
  const Counter = defineWorldResource('test.unknownCounter', {
    create: () => ({ value: 0 }),
    serializable: true
  });

  const source = new World({ seed: 41 });
  source.setResource(Counter, { value: 9 });
  const snapshot = serializeWorld(source);

  assert.throws(() => applySnapshot(new World(), snapshot, makeRegistry()), /unknown resource/);

  const skipped = new World();
  applySnapshot(skipped, snapshot, makeRegistry(), { skipUnknown: true });
  assert.equal(skipped.resources().length, 0);
});
