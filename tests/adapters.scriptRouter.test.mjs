import { assert, test } from './testlib.js';

import { World } from '../core.js';
import { makeScriptRouter } from '../adapters/scriptRouter.js';
import { ScriptMeta } from '../scripts.js';

test('script router dispatches events to matching handlers with context', (t) => {
  const world = World.create()
    .withPhases('scripts')
    .useScripts()
    .build();

  t.after(() => world.scripts.clear());

  const hits = [];

  world.script('listener', () => ({
    damage(_world, eid, payload, ctx) {
      hits.push({ eid, amount: payload.amount, rand: typeof ctx.rand === 'function' });
      ctx.emit('logged', { eid, amount: payload.amount });
    }
  }));

  const eid = world.create();
  world.addScript(eid, 'listener');

  const router = makeScriptRouter({
    damage: (payload) => payload.targets
  });
  router(world);

  const logs = [];
  world.on('logged', (payload) => logs.push(payload));

  world.tick(0); // attach scripts
  world.emit('damage', { targets: [eid], amount: 3 });

  assert.deepEqual(hits, [{ eid, amount: 3, rand: true }]);
  assert.deepEqual(logs, [{ eid, amount: 3 }]);
});

test('script router records handler errors on ScriptMeta', (t) => {
  const world = World.create()
    .withPhases('scripts')
    .useScripts()
    .build();

  t.after(() => world.scripts.clear());

  world.script('boom', () => ({
    ping() {
      throw new Error('kaboom');
    }
  }));

  const eid = world.create();
  world.addScript(eid, 'boom');

  makeScriptRouter({ ping: () => [eid] })(world);

  world.tick(0);
  world.emit('ping', { target: eid });

  const meta = world.get(eid, ScriptMeta);
  assert.ok(meta);
  assert.match(meta.lastError, /kaboom/);
});
