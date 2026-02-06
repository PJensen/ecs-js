import { assert, test } from './testlib.js';
import { World, defineComponent } from '../core.js';

const Tag = defineComponent('StrictTag', { v: 0 });

test('strict handler returning "defer" string queues the operation', () => {
  const world = new World({ strict: true });
  const eid = world.create();
  world.onStrictError(() => 'defer');
  world.setScheduler((w) => {
    w.add(eid, Tag, { v: 7 });
  });
  world.tick(1);
  const rec = world.get(eid, Tag);
  assert.ok(rec, 'component should be attached after deferred execution');
  assert.equal(rec.v, 7);
});

test('strict handler returning false ignores the operation', () => {
  const world = new World({ strict: true });
  const eid = world.create();
  world.onStrictError(() => false);
  world.setScheduler((w) => {
    w.destroy(eid);
  });
  world.tick(1);
  assert.ok(world.isAlive(eid), 'false should act as ignore, keeping entity alive');
  assert.equal(world.pendingOps().length, 0, 'no commands should be queued');
});

test('strict handler returning undefined falls through to throw', () => {
  const world = new World({ strict: true });
  const eid = world.create();
  world.onStrictError(() => { /* returns undefined */ });
  world.setScheduler((w) => {
    w.add(eid, Tag, { v: 1 });
  });
  // tick catches the re-thrown strict error
  world.tick(1);
  assert.equal(world.has(eid, Tag), false, 'mutation should not apply when handler returns undefined');
});

test('strict handler that throws its own error still blocks mutation', () => {
  const world = new World({ strict: true });
  const eid = world.create();
  world.onStrictError(() => { throw new Error('custom handler error'); });
  world.setScheduler((w) => {
    w.add(eid, Tag, { v: 1 });
  });
  // tick catches the error chain
  world.tick(1);
  assert.equal(world.has(eid, Tag), false, 'mutation should not apply when handler throws');
});
