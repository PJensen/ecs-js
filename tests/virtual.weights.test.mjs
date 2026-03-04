// Canonical demo: virtual components + derived aggregate carry weight.
// Demonstrates createVirtualRegistry() and a tick-driven weight derivation system.
import { assert, test } from './testlib.js';

import {
  World,
  defineComponent,
  attach,
  reparent,
  children,
  composeScheduler,
  createVirtualRegistry,
} from '../index.js';

// ---- Component definitions ------------------------------------------------

const Actor     = defineComponent('VW.Actor',     {});
const Container = defineComponent('VW.Container', { capacity: 999 });
const Item      = defineComponent('VW.Item',      { type: '', qty: 1 });
// Weight is explicit: self = intrinsic mass, total = subtree aggregate (derived each tick).
const Weight    = defineComponent('VW.Weight',    { self: 0, total: 0 });

// ---- Derivation helper ----------------------------------------------------

/**
 * Post-order subtree traversal: recomputes Weight.total for every node.
 * Only operates on entities that already have the Weight component; add
 * world.add(entity, Weight, ...) in setup for any container that should
 * participate in weight tracking.
 */
function recomputeSubtreeWeights(world, rootId) {
  const stack = [rootId];
  const order = [];
  while (stack.length) {
    const id = stack.pop();
    order.push(id);
    for (const c of children(world, id)) stack.push(c);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const w = world.get(id, Weight);
    if (!w) continue;
    let total = w.self;
    for (const c of children(world, id)) {
      const cw = world.get(c, Weight);
      if (cw) total += cw.total;
    }
    world.set(id, Weight, { total });
  }
}

// ---- Tests ----------------------------------------------------------------

test('createVirtualRegistry: basic get + step-based memoization', () => {
  const world = new World({ seed: 1 });
  const virtuals = createVirtualRegistry(world);

  world.setScheduler((w, _dt) => virtuals.clear());

  let callCount = 0;
  const Doubled = virtuals.define('Doubled', (_w, id) => {
    callCount++;
    return id * 2;
  });

  world.tick(0); // step = 1

  assert.equal(virtuals.get(5, Doubled), 10);
  assert.equal(callCount, 1);
  assert.equal(virtuals.get(5, Doubled), 10); // cached — same step
  assert.equal(callCount, 1);

  world.tick(0); // clear runs, step = 2
  assert.equal(virtuals.get(5, Doubled), 10); // recomputed
  assert.equal(callCount, 2);
});

test('createVirtualRegistry: clear(VComp) clears only that virtual', () => {
  const world = new World({ seed: 2 });
  const virtuals = createVirtualRegistry(world);
  world.setScheduler((_w, _dt) => {});

  let aCount = 0, bCount = 0;
  const VA = virtuals.define('VA', () => { aCount++; return 'a'; });
  const VB = virtuals.define('VB', () => { bCount++; return 'b'; });

  world.tick(0);
  virtuals.get(1, VA);
  virtuals.get(1, VB);
  assert.equal(aCount, 1); assert.equal(bCount, 1);

  virtuals.clear(VA);
  virtuals.get(1, VA); // recomputed
  virtuals.get(1, VB); // still cached
  assert.equal(aCount, 2); assert.equal(bCount, 1);
});

test('createVirtualRegistry: multiple independent registries on one world', () => {
  const world = new World({ seed: 3 });
  const va = createVirtualRegistry(world);
  const vb = createVirtualRegistry(world);
  world.setScheduler((_w, _dt) => {});

  world.tick(0);
  const A = va.define('X', () => 'from-a');
  const B = vb.define('X', () => 'from-b');
  assert.equal(va.get(1, A), 'from-a');
  assert.equal(vb.get(1, B), 'from-b');
});

test('get: throws on unknown virtual', () => {
  const world = new World({ seed: 4 });
  const virtuals = createVirtualRegistry(world);
  world.setScheduler((_w, _dt) => {});
  world.tick(0);
  assert.throws(() => virtuals.get(1, { key: Symbol('nope'), name: 'Nope' }), Error);
});

test('weight derivation: single bag with nested pouch', () => {
  const world = new World({ seed: 10 });
  const virtuals = createVirtualRegistry(world);

  // ---- Virtual queries --------------------------------------------------
  const ActorCarry = virtuals.define('ActorCarry', (world, actorId) => {
    let total = 0;
    for (const bagId of children(world, actorId)) {
      const w = world.get(bagId, Weight);
      if (w) total += w.total;
    }
    return Object.freeze({ total });
  });

  const TotalWeight = virtuals.define('TotalWeight', (world, id) => {
    const w = world.get(id, Weight);
    return Object.freeze({ total: w ? w.total : 0 });
  });

  // ---- Derivation system ------------------------------------------------
  function DeriveWeightTotals(world) {
    for (const [actorId] of world.query(Actor)) {
      for (const bagId of children(world, actorId)) {
        if (world.has(bagId, Container)) recomputeSubtreeWeights(world, bagId);
      }
    }
    virtuals.clear();
  }
  world.setScheduler(composeScheduler((w, dt) => DeriveWeightTotals(w, dt)));

  // ---- Setup ------------------------------------------------------------
  const alice = world.create(); world.add(alice, Actor);
  const bob   = world.create(); world.add(bob,   Actor);

  const aliceBag = world.create();
  world.add(aliceBag, Container, { capacity: 10 });
  world.add(aliceBag, Weight,    { self: 0, total: 0 });

  const bobBag = world.create();
  world.add(bobBag, Container, { capacity: 10 });
  world.add(bobBag, Weight,    { self: 0, total: 0 });

  attach(world, aliceBag, alice);
  attach(world, bobBag,   bob);

  const pouch = world.create();
  world.add(pouch, Container, { capacity: 5 });
  world.add(pouch, Weight,    { self: 0, total: 0 });
  attach(world, pouch, aliceBag);

  const gold = world.create();
  world.add(gold, Item,   { type: 'gold', qty: 50 });
  world.add(gold, Weight, { self: 0.5, total: 0.5 });
  attach(world, gold, pouch);

  const rock = world.create();
  world.add(rock, Item,   { type: 'rock', qty: 1 });
  world.add(rock, Weight, { self: 5.0, total: 5.0 });
  attach(world, rock, aliceBag);

  // ---- Tick 1: initial derivation ---------------------------------------
  world.tick(0);

  // pouch: 0 (self) + 0.5 (gold) = 0.5
  // aliceBag: 0 (self) + 0.5 (pouch) + 5.0 (rock) = 5.5
  assert.equal(world.get(pouch,    Weight).total, 0.5);
  assert.equal(world.get(aliceBag, Weight).total, 5.5);
  assert.equal(world.get(bobBag,   Weight).total, 0);

  assert.equal(virtuals.get(aliceBag, TotalWeight).total, 5.5);
  assert.equal(virtuals.get(alice, ActorCarry).total, 5.5);
  assert.equal(virtuals.get(bob,   ActorCarry).total, 0);

  // ---- Reparent gold: pouch → bobBag ------------------------------------
  reparent(world, gold, bobBag);

  // ---- Tick 2: re-derivation after structural change --------------------
  world.tick(0);

  // aliceBag: 0 (self) + 0 (pouch, now empty) + 5.0 (rock) = 5.0
  // bobBag:   0 (self) + 0.5 (gold) = 0.5
  assert.equal(world.get(pouch,    Weight).total, 0);
  assert.equal(world.get(aliceBag, Weight).total, 5.0);
  assert.equal(world.get(bobBag,   Weight).total, 0.5);

  assert.equal(virtuals.get(alice, ActorCarry).total, 5.0);
  assert.equal(virtuals.get(bob,   ActorCarry).total, 0.5);

  // Memoization: second call in same step returns cached value
  assert.equal(virtuals.get(alice, ActorCarry).total, 5.0);
});
