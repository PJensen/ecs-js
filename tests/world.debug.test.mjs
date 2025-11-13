import test from 'node:test';
import assert from 'node:assert/strict';

import { World, defineComponent } from '../core.js';
import { clearSystems, registerSystem, composeScheduler } from '../systems.js';

const Position = defineComponent('Position', { x: 0, y: 0 });
const Velocity = defineComponent('Velocity', { x: 0, y: 0 });

test('world.debug.inspect snapshots component values with diffs', () => {
  const world = new World({ debug: true });
  const eid = world.create();

  world.add(eid, Position, { x: 2, y: 4 });
  world.add(eid, Velocity, { x: -1, y: 1 });

  let snapshot = world.debug.inspect(eid);
  assert.equal(snapshot.id, eid);
  assert.equal(snapshot.alive, true);
  assert.deepEqual(snapshot.removed, []);
  assert.deepEqual(snapshot.components.Position.value, { x: 2, y: 4 });
  assert.equal(snapshot.components.Position.previous, null);
  assert.equal(snapshot.components.Position.diff, null);

  world.set(eid, Position, { y: 8 });
  world.remove(eid, Velocity);

  snapshot = world.debug.inspect(eid);
  assert.equal(snapshot.components.Position.changed, true);
  assert.deepEqual(snapshot.components.Position.previous, { x: 2, y: 4 });
  assert.deepEqual(snapshot.components.Position.diff, {
    changed: { y: { before: 4, after: 8 } },
  });
  assert.deepEqual(snapshot.removed, ['Velocity']);

  world.destroy(eid);
  snapshot = world.debug.inspect(eid);
  assert.equal(snapshot.alive, false);
});

class Tracker {
  constructor() {
    this.calls = [];
  }
  push(label) {
    this.calls.push(label);
  }
}

test('world.debug profiling captures per-system timings', (t) => {
  clearSystems();
  t.after(() => clearSystems());
  const tracker = new Tracker();

  function phaseA(world) {
    tracker.push('a');
  }

  function phaseB(world) {
    tracker.push('b');
  }

  registerSystem(phaseA, 'alpha');
  registerSystem(phaseB, 'beta');

  const world = new World({ debug: true });
  world.debug.enableProfiling(true);
  Tracker._time = 0;
  world.debug.useTimeSource(() => {
    Tracker._time = (Tracker._time || 0) + 1;
    return Tracker._time;
  });

  let profile = null;
  const off = world.debug.onProfile((payload) => {
    profile = payload;
  });

  world.setScheduler(composeScheduler('alpha', 'beta'));
  world.tick(1);

  assert.deepEqual(tracker.calls, ['a', 'b']);
  assert.ok(profile, 'profiling payload should be delivered');
  assert.equal(world.debug.lastProfile, profile);
  assert.equal(profile.systems.length, 2);
  assert.deepEqual(profile.systems.map((r) => r.phase), ['alpha', 'beta']);
  assert.ok(profile.systems.every((r) => typeof r.duration === 'number'));
  assert.deepEqual(profile.phases.map((p) => p.phase), ['alpha', 'beta']);
  assert.ok(typeof profile.total === 'number');
  assert.equal(typeof profile.dt, 'number');

  off();
});
