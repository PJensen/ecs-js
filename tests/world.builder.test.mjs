import { assert, test } from './testlib.js';

import { World, WorldBuilder, Component } from '../core.js';
import { ScriptRef, ScriptMeta } from '../scripts.js';

test('World builder configures world, scheduler, and scripts API', () => {
  const calls = [];
  const builder = World.create()
    .useSoA()
    .withSeed(1234)
    .withScheduler('alpha')
    .useScripts()
    .system((world) => { calls.push(['alpha', world.step]); }, 'alpha');

  const world = builder.build();
  assert.equal(world.storeMode, 'soa');
  assert.equal(world.seed, 1234 >>> 0);
  assert.equal(world.strict, false);
  assert.ok(world.scripts, 'scripts API should be installed');

  let scriptRuns = 0;
  world.scripts.register('tickOnce', () => ({
    onTick() {
      scriptRuns++;
    }
  }));

  const eid = world.create();
  world.add(eid, ScriptRef, { id: 'tickOnce' });

  world.tick(16);
  assert.deepEqual(calls[0], ['alpha', 1]);
  const meta = world.get(eid, ScriptMeta);
  assert.ok(world.has(eid, ScriptMeta));
  assert.equal(meta.invoked, 0);
  assert.equal(meta.version, world.step);
  assert.equal(scriptRuns, 1);
});

test('Component builder produces data and tag components', () => {
  const Validated = Component('Validated')
    .defaults({ value: 1 })
    .validate((rec) => typeof rec.value === 'number')
    .build();

  const Tag = Component('Marker').tag();

  const world = new World();
  const entity = world.create();
  world.add(entity, Validated, { value: 5 });
  assert.equal(world.get(entity, Validated).value, 5);

  const second = world.create();
  world.add(second, Tag);
  assert.ok(world.has(second, Tag));
  assert.equal(Tag.isTag, true);
});
