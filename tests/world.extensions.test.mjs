import { assert, test } from './testlib.js';

import { World, defineComponent, defineExtension } from '../core.js';
import { applySnapshot, makeRegistry, serializeWorld } from '../serialization.js';
import { PHASE_SCRIPTS } from '../scripts.js';

const Position = defineComponent('ExtensionPosition', { x: 0 });

test('defineExtension validates names and installers', () => {
  assert.throws(() => defineExtension('', () => {}), /name must be a non-empty string/);
  assert.throws(() => defineExtension('bad', null), /installer must be a function/);
});

test('world installs canonical extensions once and exposes diagnostics', () => {
  const world = new World();
  let installs = 0;
  const extension = defineExtension('testExtension', () => {
    installs++;
  });

  world.install(extension).install(extension);

  assert.equal(installs, 1);
  assert.equal(world.hasExtension(extension), true);

  const records = world.extensions();
  assert.equal(records.length, 1);
  assert.equal(records[0].name, 'testExtension');
  assert.equal(records[0].extension, extension);
  assert.equal(records[0].uninstallable, false);
});

test('world installs function extensions once by function identity', () => {
  const world = new World();
  let installs = 0;

  function testFunctionExtension() {
    installs++;
  }

  world.install(testFunctionExtension);
  world.install(testFunctionExtension);

  assert.equal(installs, 1);
  assert.equal(world.hasExtension(testFunctionExtension), true);
});

test('world uninstall runs cleanup and removes listener extension', () => {
  const world = new World();
  let handled = 0;
  let cleaned = 0;

  const extension = defineExtension('listenerExtension', (w) => {
    const off = w.on('x', () => {
      handled++;
    });
    return () => {
      cleaned++;
      off();
    };
  });

  world.install(extension);
  assert.equal(world.extensions()[0].uninstallable, true);

  world.emit('x');
  assert.equal(handled, 1);

  assert.equal(world.uninstall(extension), true);
  assert.equal(cleaned, 1);

  world.emit('x');
  assert.equal(handled, 1);
  assert.equal(world.hasExtension(extension), false);
  assert.equal(world.uninstall(extension), false);
});

test('failed extension install rethrows and is not marked attached', () => {
  const world = new World();
  const extension = defineExtension('badExtension', () => {
    throw new Error('boom');
  });

  assert.throws(() => world.install(extension), /boom/);
  assert.equal(world.hasExtension(extension), false);
  assert.equal(world.extensions().length, 0);
});

test('builder duplicate install delegates to world extension lifecycle', () => {
  let installs = 0;
  const extension = defineExtension('builderExtension', () => {
    installs++;
  });

  const world = World.create()
    .install(extension)
    .install(extension)
    .build();

  assert.equal(installs, 1);
  assert.equal(world.hasExtension(extension), true);
});

test('builder useScripts is idempotent for the same phase', () => {
  const world = World.create()
    .useScripts()
    .useScripts()
    .withScheduler(PHASE_SCRIPTS)
    .build();

  assert.ok(world.scripts);
  const scriptExtensions = world.extensions().filter((rec) => rec.name === `scripts:${PHASE_SCRIPTS}`);
  assert.equal(scriptExtensions.length, 1);
});

test('extensions are runtime-only and survive load/applySnapshot', () => {
  const source = new World({ seed: 1 });
  const eid = source.create();
  source.add(eid, Position, { x: 7 });
  const snapshot = serializeWorld(source);
  const registry = makeRegistry(Position);

  const extension = defineExtension('runtimeOnly', () => {});

  const loaded = new World();
  const placeholder = loaded.create();
  loaded.add(placeholder, Position, { x: 0 });
  loaded.install(extension);
  loaded.load(snapshot);

  assert.equal(loaded.hasExtension(extension), true);
  assert.equal(serializeWorld(loaded).extensions, undefined);
  assert.equal(serializeWorld(loaded).installed, undefined);
  assert.equal(serializeWorld(loaded).installers, undefined);

  const applied = new World();
  applied.install(extension);
  applySnapshot(applied, snapshot, registry, { mode: 'replace' });

  assert.equal(applied.hasExtension(extension), true);
  assert.equal(serializeWorld(applied).extensions, undefined);
});
