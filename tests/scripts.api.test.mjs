import { test } from 'node:test';
import assert from 'node:assert/strict';

import { World } from '../core.js';
import { PHASE_SCRIPTS, ScriptMeta, ScriptRef } from '../scripts.js';

test('world.script helpers register handlers and entity sugar attaches scripts', () => {
  const world = World.create().useScripts().withScheduler(PHASE_SCRIPTS).build();

  let ticks = 0;

  world.script('TestScript', ({ onTick, args }) => {
    onTick(() => { ticks += 1; assert.equal(args.foo, 42); });
    return { onHeartbeat: () => {} };
  });

  world.script('PlainScript', {
    onTick: () => { ticks += 10; }
  });

  const eid = world.create();
  const other = world.create();

  world.entity(eid).addScript('TestScript', { foo: 42 });
  world.addScript(other, 'PlainScript');

  world.tick(0.016);
  world.tick(0.016);

  const handlers = world.scripts.handlersOf(eid);
  assert.ok(handlers);
  assert.equal(typeof handlers.onTick, 'function');
  assert.equal(typeof handlers.onHeartbeat, 'function');
  assert.equal(ticks, 22);

  const meta = world.get(eid, ScriptMeta);
  if (meta) {
    assert.equal(meta.invoked >= 1, true);
  }

  world.entity(eid).removeScript();
  assert.equal(world.has(eid, ScriptRef), false);
});

test('useScripts installs systems into a custom phase', () => {
  const world = World.create()
    .useScripts({ phase: 'update' })
    .withScheduler('update')
    .build();

  let ticks = 0;
  world.script('CustomPhaseScript', {
    onTick() { ticks++; }
  });

  const eid = world.create();
  world.addScript(eid, 'CustomPhaseScript');
  world.tick(0.016);

  assert.equal(ticks, 1);
  const meta = world.get(eid, ScriptMeta);
  assert.ok(meta);
});
