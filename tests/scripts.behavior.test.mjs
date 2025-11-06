import test from 'node:test';
import assert from 'node:assert/strict';

import { World } from '../core.js';
import { composeScheduler } from '../systems.js';
import { installScriptsAPI, ScriptRef, ScriptMeta, PHASE_SCRIPTS } from '../scripts.js';

test('scripts attach before ticking', () => {
  const world = installScriptsAPI(new World());
  world.scripts.clear();
  world.setScheduler(composeScheduler(PHASE_SCRIPTS));

  let tickCount = 0;
  world.scripts.register('counter', () => ({
    onTick() { tickCount++; }
  }));

  const eid = world.create();
  world.add(eid, ScriptRef, { id: 'counter' });

  world.tick(1);

  assert.equal(tickCount, 1, 'onTick should run immediately after attach');
  const meta = world.get(eid, ScriptMeta);
  assert.ok(meta, 'ScriptMeta should be present');
  assert.equal(meta.version, world.step, 'meta version should reflect attach step');
  assert.ok(world.scripts.handlersOf(eid), 'handlers should be cached for entity');
});

test('handlers are cleared when script factory is missing', () => {
  const world = installScriptsAPI(new World());
  world.scripts.clear();
  world.setScheduler(composeScheduler(PHASE_SCRIPTS));

  let tickCount = 0;
  world.scripts.register('ok', () => ({
    onTick() { tickCount++; }
  }));

  const eid = world.create();
  world.add(eid, ScriptRef, { id: 'ok' });
  world.tick(1);
  assert.equal(tickCount, 1, 'baseline tick should occur');

  world.set(eid, ScriptRef, { id: 'missing' });
  world.tick(1);

  assert.equal(tickCount, 1, 'stale handlers should not run after missing factory');
  assert.equal(world.scripts.handlersOf(eid), null, 'handler table should be cleared');

  const meta = world.get(eid, ScriptMeta);
  assert.ok(meta, 'ScriptMeta should exist to record errors');
  assert.ok(meta.lastError.includes('Missing script'), 'lastError should report missing script');
});
