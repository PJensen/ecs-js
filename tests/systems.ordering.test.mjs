import { assert, test } from './testlib.js';

import { World } from '../core.js';
import {
  clearSystems,
  composeScheduler,
  getOrderedSystems,
  registerSystem,
  runSystems,
  setSystemOrder
} from '../systems.js';

test('getOrderedSystems respects mixed before/after constraints', (t) => {
  t.after(() => clearSystems());

  const calls = [];
  const phase = 'turn';

  const sense = () => { calls.push('sense'); };
  const plan = () => { calls.push('plan'); };
  const act = () => { calls.push('act'); };
  const tally = () => { calls.push('tally'); };
  const cleanup = () => { calls.push('cleanup'); };

  // Register out of execution order; rely on dependency edges instead.
  registerSystem(plan, phase, { after: [sense] });
  registerSystem(cleanup, phase, { after: [tally] });
  registerSystem(tally, phase, { after: [act], before: [cleanup] });
  registerSystem(act, phase, { after: [plan] });
  registerSystem(sense, phase);

  const ordered = getOrderedSystems(phase);
  assert.deepEqual(ordered, [sense, plan, act, tally, cleanup]);

  runSystems(phase, new World(), 0);
  assert.deepEqual(calls, ['sense', 'plan', 'act', 'tally', 'cleanup']);
});

test('explicit order overrides dependency hints and scheduler steps stay in sequence', (t) => {
  t.after(() => clearSystems());

  const phase = 'render';
  const trace = [];
  const a = () => trace.push('a');
  const b = () => trace.push('b');
  const c = () => trace.push('c');

  registerSystem(a, phase, { after: [b] });
  registerSystem(b, phase, { after: [c] });
  registerSystem(c, phase);

  // Force a reverse order even though constraints say c -> b -> a.
  setSystemOrder(phase, [b, a, c]);

  const sched = composeScheduler(
    (_world, dt) => trace.push(`custom:${dt}`),
    phase
  );

  const world = new World();
  world.setScheduler(sched);
  world.tick(16);

  assert.deepEqual(getOrderedSystems(phase), [b, a, c]);
  assert.deepEqual(trace, ['custom:16', 'b', 'a', 'c']);
});
