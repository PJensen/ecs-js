import test from 'node:test';
import assert from 'node:assert/strict';

import { World, defineComponent } from '../core.js';

test('pendingOps exposes a snapshot of queued commands', () => {
  const world = new World();
  world.command(['destroy', 1]);
  const snapshot = world.pendingOps();
  assert.deepEqual(snapshot, [['destroy', 1]]);
  snapshot.push(['mutate']);
  assert.deepEqual(world.pendingOps(), [['destroy', 1]], 'snapshot should not mutate internal queue');
});

test('strict handler can defer structural operations', () => {
  const Position = defineComponent('Position', { x: 0 });
  const world = new World({ strict: true });
  const eid = world.create();
  const events = [];

  world.onStrictError(({ op, args, defer, error }) => {
    events.push({ op, args: Array.from(args), message: error.message });
    defer();
  });

  world.setScheduler((w) => {
    w.add(eid, Position, { x: 42 });
  });

  world.tick(1);

  const rec = world.get(eid, Position);
  assert.ok(rec, 'component should be attached after deferred execution');
  assert.equal(rec.x, 42);
  assert.equal(events.length, 1);
  assert.equal(events[0].op, 'add');
  assert.match(events[0].message, /structural mutation during tick/);
});

test('strict handler may ignore operations', () => {
  const world = new World({ strict: true });
  const eid = world.create();
  world.onStrictError(() => 'ignore');

  world.setScheduler((w) => {
    w.destroy(eid);
  });

  world.tick(1);

  assert.ok(world.isAlive(eid), 'ignored destroy should keep entity alive');
  assert.equal(world.pendingOps().length, 0, 'ignore should not queue commands');
});
