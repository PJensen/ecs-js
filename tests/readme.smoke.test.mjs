import { assert, test } from './testlib.js';

import { World, defineComponent } from '../core.js';
import { PHASE_SCRIPTS } from '../scripts.js';
import { makeScriptRouter } from '../adapters/scriptRouter.js';
import { createDualLoopRafLoop, createRealtimeRafLoop } from '../adapters/raf-adapters.js';
import { addScriptTickPhase, ScriptPhase } from '../scriptsPhasesExtra.js';

const Position = defineComponent('README.Position', { x: 0, y: 0 });
const Velocity = defineComponent('README.Velocity', { dx: 0, dy: 0 });

test('README query builder snippet shape executes', () => {
  const world = new World({ seed: 1 });

  const a = world.create();
  world.add(a, Position, { x: 1, y: 2 });
  world.add(a, Velocity, { dx: 2, dy: 0 });

  const b = world.create();
  world.add(b, Position, { x: 5, y: 6 });
  world.add(b, Velocity, { dx: 1, dy: 0 });

  const moving = world
    .defineQuery(Position, Velocity)
    .where((pos, vel) => Math.abs(vel.dx) + Math.abs(vel.dy) > 0)
    .orderBy((left, right) => left.id - right.id);

  const projected = moving.project((id, _pos, vel) => ({ id, vel }));
  const seen = [];
  projected().run((row) => seen.push([row.id, row.vel.dx, row.vel.dy]));

  assert.deepEqual(seen, [
    [a, 2, 0],
    [b, 1, 0]
  ]);
});

test('README script helper chaining works with dynamic handlers', () => {
  const world = World.create({ seed: 42 })
    .useScripts()
    .withScheduler(PHASE_SCRIPTS)
    .build();

  const events = [];
  world.on('pulse', (payload) => events.push(['pulse', payload.id]));
  world.on('damage:seen', (payload) => events.push(['damage', payload.amount]));

  const scriptId = 'README.ScriptChain';
  world.script(scriptId, (helper) =>
    helper
      .onTick((w, id, _dt, ctx) => ctx.emit('pulse', { id, at: w.step }))
      .damage((_w, _id, payload, ctx) => ctx.emit('damage:seen', { amount: payload.amount }))
  );

  const eid = world.create();
  world.addScript(eid, scriptId);
  makeScriptRouter({ damage: (payload) => [payload.targetId] })(world);

  world.tick(1);
  world.emit('damage', { targetId: eid, amount: 7 });

  assert.deepEqual(events, [
    ['pulse', eid],
    ['damage', 7]
  ]);
});

test('README ScriptPhase snippet accepts per-entity phase data', () => {
  const phase = 'scripts:readme-smoke-early';
  addScriptTickPhase(phase, 'onTickEarly');

  const world = World.create({ seed: 9 })
    .useScripts()
    .withScheduler(phase, PHASE_SCRIPTS)
    .build();

  let earlyTicks = 0;
  world.script('README.ScriptPhase', (helper) =>
    helper.onTickEarly(() => {
      earlyTicks += 1;
    })
  );

  const eid = world.create();
  world.add(eid, ScriptPhase, { tick: phase });
  world.addScript(eid, 'README.ScriptPhase');
  world.tick(1);
  world.tick(1);

  assert.equal(earlyTicks, 1);
});

test('README RAF adapter API split stays stable', () => {
  const world = { tick() {} };
  const request = () => 1;
  const cancel = () => {};
  const now = () => 0;

  const realtime = createRealtimeRafLoop({ world, request, cancel, now });
  const dual = createDualLoopRafLoop({ world, request, cancel, now });

  assert.equal(typeof realtime.start, 'function');
  assert.equal(typeof realtime.stop, 'function');
  assert.equal(typeof realtime.stepWorldImmediate, 'function');
  assert.equal(typeof realtime.advanceSim, 'undefined');
  assert.equal(typeof realtime.queueSimStep, 'undefined');

  assert.equal(typeof dual.start, 'function');
  assert.equal(typeof dual.stop, 'function');
  assert.equal(typeof dual.advanceSim, 'function');
  assert.equal(typeof dual.queueSimStep, 'function');
  assert.equal(typeof dual.stepWorldImmediate, 'undefined');
});
