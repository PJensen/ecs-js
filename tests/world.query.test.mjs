import { assert, test } from './testlib.js';
import { World, defineComponent, defineTag, Not, Changed } from '../core.js';

const Position = defineComponent('QPos', { x: 0, y: 0 });
const Velocity = defineComponent('QVel', { dx: 0, dy: 0 });
const Marker   = defineTag('QMarker');
const Health   = defineComponent('QHealth', { hp: 10 });

// ---- Not() ----

test('Not() excludes entities that have the negated component', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1 }); world.add(e1, Velocity, { dx: 1 });
  const e2 = world.create(); world.add(e2, Position, { x: 2 });
  const e3 = world.create(); world.add(e3, Position, { x: 3 }); world.add(e3, Marker);

  const ids = [...world.query(Position, Not(Velocity))].map(r => r[0]).sort((a, b) => a - b);
  assert.deepEqual(ids, [e2, e3].sort((a, b) => a - b));
});

test('Not() with all entities having negated component returns empty', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1 }); world.add(e1, Velocity, { dx: 1 });
  const e2 = world.create(); world.add(e2, Position, { x: 2 }); world.add(e2, Velocity, { dx: 2 });

  const result = [...world.query(Position, Not(Velocity))];
  assert.equal(result.length, 0);
});

// ---- Changed() ----

test('Changed() matches only entities modified between ticks', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1, y: 0 });
  const e2 = world.create(); world.add(e2, Position, { x: 2, y: 0 });
  const e3 = world.create(); world.add(e3, Position, { x: 3, y: 0 });

  // Tick to clear initial change marks from add()
  world.setScheduler(() => {});
  world.tick(1);

  // Modify e1 and e3 BETWEEN ticks (set runs immediately, marks changed)
  world.set(e1, Position, { x: 10 });
  world.set(e3, Position, { x: 30 });

  // Now query — Changed() sees marks set between ticks
  let capturedIds = [];
  world.setScheduler((w) => {
    capturedIds = [...w.query(Position, Changed(Position))].map(r => r[0]).sort((a, b) => a - b);
  });
  world.tick(1);
  assert.deepEqual(capturedIds, [e1, e3].sort((a, b) => a - b), 'only modified entities should match');
});

test('Changed() returns nothing after tick clears change marks', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1, y: 0 });

  // Tick to clear add() marks
  world.setScheduler(() => {});
  world.tick(1);

  // Modify e1 in a tick
  world.setScheduler((w) => { w.set(e1, Position, { x: 99 }); });
  world.tick(1);

  // After tick, change marks are cleared
  const result = [...world.query(Position, Changed(Position))];
  assert.equal(result.length, 0, 'change marks should be cleared after tick');
});

test('Combined Not() and Changed() filters', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1, y: 0 }); world.add(e1, Velocity, { dx: 1 });
  const e2 = world.create(); world.add(e2, Position, { x: 2, y: 0 });
  const e3 = world.create(); world.add(e3, Position, { x: 3, y: 0 });

  // Tick to clear initial marks
  world.setScheduler(() => {});
  world.tick(1);

  // Modify e1 (has Velocity) and e2 (no Velocity) between ticks
  world.set(e1, Position, { x: 10 });
  world.set(e2, Position, { x: 20 });
  // e3 not modified

  let capturedIds = [];
  world.setScheduler((w) => {
    capturedIds = [...w.query(Position, Not(Velocity), Changed(Position))].map(r => r[0]);
  });
  world.tick(1);
  // Only e2: changed AND lacks Velocity
  assert.deepEqual(capturedIds, [e2]);
});

// ---- Empty results ----

test('query on empty world returns empty iterable', () => {
  const world = new World();
  const result = [...world.query(Position)];
  assert.equal(result.length, 0);
});

test('query with no matching component returns empty', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1 });
  const e2 = world.create(); world.add(e2, Position, { x: 2 });

  const result = [...world.query(Velocity)];
  assert.equal(result.length, 0);
});

// ---- count() ----

test('count() returns accurate count with dynamic filters', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1, y: 0 }); world.add(e1, Velocity, { dx: 1 });
  const e2 = world.create(); world.add(e2, Position, { x: 2, y: 0 });
  const e3 = world.create(); world.add(e3, Position, { x: 3, y: 0 });

  const result = world.query(Position, Not(Velocity));
  const spread = [...result].length;
  const counted = result.count();
  assert.equal(counted, spread, 'count() should match iteration length');
  assert.equal(counted, 2);
});

test('count({cheap:true}) may overcount with Not() filter', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1, y: 0 }); world.add(e1, Velocity, { dx: 1 });
  const e2 = world.create(); world.add(e2, Position, { x: 2, y: 0 });
  const e3 = world.create(); world.add(e3, Position, { x: 3, y: 0 });

  const result = world.query(Position, Not(Velocity));
  const cheap = result.count({ cheap: true });
  const accurate = result.count();
  // cheap returns base cached list size (all with Position = 3)
  // accurate filters out those with Velocity = 2
  assert.ok(cheap >= accurate, 'cheap count should be >= accurate count');
  assert.equal(cheap, 3, 'cheap returns base list size');
  assert.equal(accurate, 2, 'accurate filters Not()');
});

// ---- Cache invalidation ----

test('cache invalidation: adding a component updates query results', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1, y: 0 });
  const before = [...world.query(Position)].map(r => r[0]);
  assert.deepEqual(before, [e1]);

  const e2 = world.create(); world.add(e2, Position, { x: 2, y: 0 });
  const after = [...world.query(Position)].map(r => r[0]).sort((a, b) => a - b);
  assert.deepEqual(after, [e1, e2].sort((a, b) => a - b));
});

test('cache invalidation: removing a component updates query results', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1, y: 0 });
  const e2 = world.create(); world.add(e2, Position, { x: 2, y: 0 });

  const before = [...world.query(Position)].map(r => r[0]).sort((a, b) => a - b);
  assert.deepEqual(before, [e1, e2].sort((a, b) => a - b));

  world.remove(e1, Position);
  const after = [...world.query(Position)].map(r => r[0]);
  assert.deepEqual(after, [e2]);
});

// ---- offset/limit ----

test('limit=0 returns nothing', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1, y: 0 });
  const e2 = world.create(); world.add(e2, Position, { x: 2, y: 0 });

  const result = [...world.query(Position, { limit: 0 })];
  assert.equal(result.length, 0);
});

test('offset greater than result count returns nothing', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1, y: 0 });
  const e2 = world.create(); world.add(e2, Position, { x: 2, y: 0 });

  const result = [...world.query(Position, { offset: 100 })];
  assert.equal(result.length, 0);
});

// ---- defineQuery handle across ticks ----

test('defineQuery handle returns consistent results across ticks', () => {
  const world = new World();
  const e1 = world.create(); world.add(e1, Position, { x: 1, y: 0 });
  const e2 = world.create(); world.add(e2, Position, { x: 2, y: 0 });

  const qh = world.defineQuery(Position);
  world.setScheduler(() => {});

  const ids1 = [...qh()].map(r => r[0]).sort((a, b) => a - b);
  world.tick(1);
  const ids2 = [...qh()].map(r => r[0]).sort((a, b) => a - b);

  assert.deepEqual(ids1, [e1, e2].sort((a, b) => a - b));
  assert.deepEqual(ids2, ids1, 'handle should return same results across ticks');
});
