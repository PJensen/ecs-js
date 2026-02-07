import { assert, test } from './testlib.js';
import { World, defineComponent, Component, WorldBuilder } from '../core.js';

const Position = defineComponent('ErrPos', { x: 0, y: 0 });
const Validated = defineComponent('ErrVal', { x: 0 }, {
  validate: (r) => r.x > 0
});

test('add on dead entity throws', () => {
  const world = new World();
  const eid = world.create();
  world.destroy(eid);
  assert.throws(() => world.add(eid, Position, { x: 1 }), Error, /add: entity not alive/);
});

test('set on missing component throws', () => {
  const world = new World();
  const eid = world.create();
  assert.throws(() => world.set(eid, Position, { x: 1 }), Error, /set: entity lacks component/);
});

test('mutate on missing component throws', () => {
  const world = new World();
  const eid = world.create();
  assert.throws(() => world.mutate(eid, Position, r => { r.x = 1; }), Error, /mutate: entity lacks component/);
});

test('tick without scheduler throws', () => {
  const world = new World();
  assert.throws(() => world.tick(1), Error, /tick: no scheduler installed/);
});

test('add with failing validation throws', () => {
  const world = new World();
  const eid = world.create();
  assert.throws(() => world.add(eid, Validated, { x: -1 }), Error, /Validation failed/);
});

test('set with failing validation throws', () => {
  const world = new World();
  const eid = world.create();
  world.add(eid, Validated, { x: 5 });
  assert.throws(() => world.set(eid, Validated, { x: -1 }), Error, /Validation failed/);
});

test('Component builder with empty name throws', () => {
  assert.throws(() => Component(''), Error, /non-empty name/);
});

test('withSchedulerFn with non-function throws', () => {
  const builder = new WorldBuilder();
  assert.throws(() => builder.withSchedulerFn('not a fn'), Error, /scheduler must be a function/);
});

test('setScheduler with non-function throws', () => {
  const world = new World();
  assert.throws(() => world.setScheduler(42), Error, /scheduler must be a function/);
});

test('onStrictError with non-function non-null throws', () => {
  const world = new World();
  assert.throws(() => world.onStrictError(42), Error, /handler must be a function or null/);
});

test('strict mode mid-tick mutation without handler is caught by tick', () => {
  const world = new World({ strict: true });
  const eid = world.create();
  world.setScheduler((w) => {
    w.add(eid, Position, { x: 99 });
  });
  // tick catches the scheduler error internally via logError
  world.tick(1);
  // The add should NOT have succeeded — strict threw, tick caught it
  assert.equal(world.has(eid, Position), false, 'mutation should not apply when strict throws');
});
