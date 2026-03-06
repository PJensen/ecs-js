import { assert, test } from './testlib.js';

import { World, defineComponent } from '../core.js';

test('pendingOps exposes a snapshot of queued commands', () => {
  const world = new World();
  world.command(['destroy', 1]);
  const snapshot = world.pendingOps();
  assert.deepEqual(snapshot, [['destroy', 1]]);
  snapshot.push(['mutate']);
  assert.deepEqual(world.pendingOps(), [['destroy', 1]], 'snapshot should not mutate internal queue');
});

test('strict handler can defer destructive operations', () => {
  const Position = defineComponent('Position', { x: 0 });
  const world = new World({ strict: true });
  const eid = world.create();
  world.add(eid, Position, { x: 1 });
  const events = [];

  world.onStrictError(({ op, args, defer, error }) => {
    events.push({ op, args: Array.from(args), message: error.message });
    defer();
  });

  world.setScheduler((w) => {
    w.remove(eid, Position);
  });

  world.tick(1);

  const rec = world.get(eid, Position);
  assert.equal(rec, null, 'component should be removed after deferred execution');
  assert.equal(events.length, 1);
  assert.equal(events[0].op, 'remove');
  assert.match(events[0].message, /structural mutation during tick/);
});

test('world.add() stays immediate during tick in strict worlds', () => {
  const Position = defineComponent('Position', { x: 0 });
  const world = new World({ strict: true });
  const eid = world.create();
  const events = [];

  world.onStrictError(({ op }) => {
    events.push(op);
  });

  world.setScheduler((w) => {
    const rec = w.add(eid, Position, { x: 42 });
    assert.equal(rec.x, 42);
    assert.equal(w.get(eid, Position).x, 42, 'add should be visible immediately inside the scheduler');
  });

  world.tick(1);

  assert.equal(world.get(eid, Position).x, 42);
  assert.deepEqual(events, [], 'add should not go through the strict handler');
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
