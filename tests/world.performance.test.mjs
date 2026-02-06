import { assert, test } from './testlib.js';
import { World, defineComponent, defineTag, Not } from '../core.js';
import { attach, destroySubtree, children } from '../hierarchy.js';

const Position = defineComponent('PerfPos', { x: 0, y: 0 });
const Velocity = defineComponent('PerfVel', { dx: 0, dy: 0 });

test('bulk creation: 10,000 entities', () => {
  const world = new World();
  const ids = new Set();
  for (let i = 0; i < 10000; i++) {
    ids.add(world.create());
  }
  assert.equal(world.alive.size, 10000, 'all 10K entities should be alive');
  assert.equal(ids.size, 10000, 'all ids should be unique');
});

test('bulk query: 10,000 entities with component', () => {
  const world = new World();
  for (let i = 0; i < 10000; i++) {
    const e = world.create();
    world.add(e, Position, { x: i, y: i * 2 });
  }
  const result = world.query(Position);
  assert.equal(result.count(), 10000);

  // Verify iteration works
  let count = 0;
  for (const [id, pos] of result) { count++; }
  assert.equal(count, 10000, 'iteration should yield all 10K');
});

test('query cache invalidation under churn', () => {
  const world = new World();
  const entities = [];
  for (let i = 0; i < 1000; i++) {
    const e = world.create();
    world.add(e, Position, { x: i, y: 0 });
    entities.push(e);
  }

  // Warm the cache
  assert.equal(world.query(Position).count(), 1000);

  // Remove Position from first 500
  for (let i = 0; i < 500; i++) {
    world.remove(entities[i], Position);
  }

  // Add Position to 500 new entities
  for (let i = 0; i < 500; i++) {
    const e = world.create();
    world.add(e, Position, { x: 1000 + i, y: 0 });
  }

  // Re-query — cache should have been invalidated
  assert.equal(world.query(Position).count(), 1000, 'query should reflect churn');
});

test('SoA store: create and query 5,000 entities', () => {
  const world = new World({ store: 'soa' });
  for (let i = 0; i < 5000; i++) {
    const e = world.create();
    world.add(e, Position, { x: i, y: i * 3 });
  }
  const result = world.query(Position);
  assert.equal(result.count(), 5000);

  // Verify data integrity via iteration
  let count = 0;
  for (const [id, pos] of result) {
    assert.ok(Number.isFinite(pos.x), 'x should be finite');
    count++;
  }
  assert.equal(count, 5000);
});

test('deferred op queue at MAX boundary (1001 destroys)', () => {
  const world = new World();
  const entities = [];
  for (let i = 0; i < 1001; i++) {
    entities.push(world.create());
  }
  assert.equal(world.alive.size, 1001);

  world.setScheduler((w) => {
    for (const e of entities) w.destroy(e);
  });

  // First tick: scheduler queues 1001 destroys, flush processes MAX=1000
  world.tick(1);
  assert.equal(world.alive.size, 1, 'exactly 1 entity should survive first flush');

  // Second tick: remaining 1 destroy flushes
  world.tick(1);
  assert.equal(world.alive.size, 0, 'all entities should be gone after second tick');
});

test('deep hierarchy: 100-level chain with destroySubtree', () => {
  const world = new World();
  const root = world.create();
  let parent = root;
  for (let i = 0; i < 100; i++) {
    const child = world.create();
    attach(world, child, parent);
    parent = child;
  }
  // 101 entities total (root + 100 levels)
  assert.equal(world.alive.size, 101);

  destroySubtree(world, root);
  assert.equal(world.alive.size, 0, 'all 101 entities should be dead');
});

test('entity id reuse after bulk destroy', () => {
  const world = new World();
  const entities = [];
  for (let i = 0; i < 1000; i++) {
    entities.push(world.create());
  }
  const nextIdAfterCreate = world._nextId;

  // Destroy all
  for (const e of entities) world.destroy(e);
  assert.equal(world.alive.size, 0);
  assert.equal(world._free.length, 1000, 'free list should have 1000 ids');

  // Create 1000 new — should reuse from free list
  for (let i = 0; i < 1000; i++) {
    world.create();
  }
  assert.equal(world.alive.size, 1000);
  assert.equal(world._nextId, nextIdAfterCreate, '_nextId should not grow when reusing ids');
});
